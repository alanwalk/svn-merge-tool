#!/usr/bin/env ts-node

import { spawnSync } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { resolveCommandConfig } from './cli-config';
import { Logger } from './logger';
import { run } from './merger';
import { buildMessage } from './message';
import {
    svnCommit, svnEligibleRevisions, svnInfo, svnLogBatch, svnStatusDirty, svnUpdate
} from './svn';
import { MergeOptions } from './types';
import { checkForUpdate, loadOrCreateRc } from './updater';
import { compressRevisions, getPackageVersion, groupSummaryByType, relPath, term } from './utils';
import { uiCommand } from './webui';

const LOG_PREVIEW_LINES = 3;
const APP_VERSION = getPackageVersion();

function printRevisionLogPreview(revision: number, body: string): void {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, LOG_PREVIEW_LINES);

  if (lines.length === 0) {
    console.log(term.cyan(`  r${revision}  (no message)`));
    return;
  }

  console.log(term.cyan(`  r${revision}  ${lines[0]}`));
  for (const line of lines.slice(1)) {
    console.log(term.cyan(`         ${line}`));
  }
}

/** Copy text to system clipboard (best-effort, silently ignores errors). */
function copyToClipboard(text: string): void {
  try {
    if (process.platform === 'win32') {
      spawnSync(
        'powershell',
        ['-noprofile', '-sta', '-command',
          '[Console]::InputEncoding=[Text.Encoding]::UTF8;Set-Clipboard([Console]::In.ReadToEnd())'],
        { input: text, encoding: 'utf8', timeout: 5000 }
      );
    } else if (process.platform === 'darwin') {
      spawnSync('pbcopy', [], { input: text, encoding: 'utf8', timeout: 5000 });
    } else {
      spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8', timeout: 5000 });
    }
  } catch {
    // silently ignore clipboard errors
  }
}

/** Timestamp string yyyymmddhhmmss for output filenames */
function makeStartTs(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}
const startTs = makeStartTs();

const subcommand = process.argv[2];
if (subcommand === 'ui') {
  void uiCommand(process.argv.slice(3));
} else {

const program = new Command();

program
  .name('svnmerge')
  .description('SVN branch merge tool — merge specific revisions one by one')
  .version(APP_VERSION, '-v, --version', 'Output version number')
  .option('-c, --config <path>', 'Path to YAML config file')
  .option('-w, --workspace <path>', 'SVN working copy directory')
  .option('-f, --from <url>', 'Source branch URL to merge from')
  .option('-V, --verbose', 'Show ignored/reverted file details in console output')
  .option('-o, --output <path>', 'Output directory for log and message files (overrides config output)')
  .option('-i, --ignore <paths>', 'Comma-separated paths to ignore (appended to config ignore list)')
  .option('-C, --commit', 'Automatically run svn commit after a successful merge, using the generated message file')
  .option(
    '-r, --revisions <revisions>',
    'Revisions or ranges to merge, e.g. 1001,1002-1005,1008. Omit to merge all eligible revisions.'
  )
  .addHelpText(
    'after',
    `
Config file (YAML format):
  workspace: /path/to/working-copy
  from: http://svn.example.com/branches/feature
  output: /logs/svn             # optional: absolute or workspace-relative
  commit: true                  # optional: auto svn commit after successful merge
  ignore:
    - src/thirdparty/generated
    - assets/auto-generated/catalog.json

Default config discovery:
  When -c is omitted, the tool searches for "svnmerge.yaml" (or .yml)
  starting from the current directory, walking up to the filesystem root.

Examples:
  svnmerge                                        # merge all eligible revisions (prompts confirm)
  svnmerge -r 1001                                # merge specific revision
  svnmerge -r 1001 -C                             # merge and auto-commit using generated message
  svnmerge -r 1001 -i src/gen,assets/auto         # merge ignoring specific paths
  svnmerge -c ./svn.yaml -r 84597-84608,84610
  svnmerge -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001
  svnmerge -c ./svn.yaml -w /path/to/override -r 1001,1002,1003
`
  );

program.parse(process.argv);
const rcConfig = loadOrCreateRc();
checkForUpdate(APP_VERSION, rcConfig);

const opts = program.opts<{ config?: string; workspace?: string; from?: string; revisions?: string; verbose?: boolean; output?: string; ignore?: string; commit?: boolean }>();

let configWorkspace: string | undefined;
let configFromUrl: string | undefined;
let configIgnoreMerge: string[] = [];
let configOutputDir: string | undefined;
let configVerbose = false;
let configCommit = false;

try {
  const resolvedConfig = resolveCommandConfig({
    configPath: opts.config,
    workspace: opts.workspace,
    fromUrl: opts.from,
  });
  configWorkspace = resolvedConfig.workspace;
  configFromUrl = resolvedConfig.fromUrl;
  configIgnoreMerge = resolvedConfig.configIgnorePaths;
  configOutputDir = resolvedConfig.configOutputDir;
  configVerbose = resolvedConfig.configVerbose;
  configCommit = resolvedConfig.configCommit;
  if (resolvedConfig.resolvedConfigPath) {
    const label = opts.config ? 'Config loaded' : 'Config auto-detected';
    console.log(term.cyan(`${label}: ${resolvedConfig.resolvedConfigPath}`));
  }
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(term.red(`Error: ${msg}`));
  process.exit(1);
}

// CLI options take precedence over config file
const rawWorkspace = configWorkspace;
const rawFromUrl = configFromUrl;

if (!rawWorkspace) {
  console.error(term.red('Error: workspace is required. Provide -w <path>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
  process.exit(1);
}
if (!rawFromUrl) {
  console.error(term.red('Error: from (source URL) is required. Provide -f <url>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
  process.exit(1);
}

// ─── Validate workspace path ──────────────────────────────────────────────────
const workspace = path.resolve(rawWorkspace);

// Resolve output dir: CLI -o > config > default (.svnmerge under workspace)
const rawOutputDir = opts.output ?? configOutputDir;
const outputDir = rawOutputDir
  ? (path.isAbsolute(rawOutputDir)
      ? rawOutputDir
      : path.resolve(workspace, rawOutputDir))
  : path.join(workspace, '.svnmerge');

try {
  svnInfo(workspace);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(term.red(`Error: ${msg}`));
  process.exit(1);
}

// ─── Synchronous yes/no prompt helper ────────────────────────────────────────
function promptYN(question: string): boolean {
  process.stdout.write(question);
  const buf = Buffer.alloc(16);
  try {
    const n = (require('fs') as typeof import('fs')).readSync(0, buf, 0, buf.length, null);
    const input = buf.slice(0, n).toString().trim().toLowerCase();
    return input === 'y';
  } catch {
    return false;
  }
}

// ─── Parse revisions ─────────────────────────────────────────────────────────
let revisions: number[] = [];

if (opts.revisions) {
  const rawRevisions = opts.revisions
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawRevisions.length === 0) {
    console.error(term.red('Error: No revisions specified. Use -r 1001,1002,1003'));
    process.exit(1);
  }

  for (const raw of rawRevisions) {
    // Support range syntax: e.g. "84597-84608"
    const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from <= 0 || to <= 0) {
        console.error(term.red(`Error: Invalid revision range "${raw}". Revisions must be positive integers.`));
        process.exit(1);
      }
      if (from > to) {
        console.error(term.red(`Error: Invalid revision range "${raw}": start must be <= end.`));
        process.exit(1);
      }
      for (let rev = from; rev <= to; rev++) {
        revisions.push(rev);
      }
    } else {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n <= 0) {
        console.error(term.red(`Error: Invalid revision "${raw}". Use integers or ranges like 1001-1005.`));
        process.exit(1);
      }
      revisions.push(n);
    }
  }
}

// ─── Print resolved parameters ───────────────────────────────────────────────
{
  const cliIgnorePaths = opts.ignore ? opts.ignore.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const allIgnore = [...rcConfig.globalIgnore, ...configIgnoreMerge, ...cliIgnorePaths];
  console.log(term.cyan('─── Parameters ───────────────────────────────────────'));
  console.log(term.cyan(`  workspace : ${workspace}`));
  console.log(term.cyan(`  from      : ${rawFromUrl}`));
  console.log(term.cyan(`  output    : ${outputDir}`));
  if (allIgnore.length === 0) {
    console.log(term.cyan('  ignore    : (none)'));
  } else {
    console.log(term.cyan(`  ignore    : ${allIgnore[0]}`));
    for (let i = 1; i < allIgnore.length; i++) {
      console.log(term.cyan(`              ${allIgnore[i]}`));
    }
  };
  console.log(term.cyan(`  verbose   : ${!!(opts.verbose || configVerbose)}`));
  console.log(term.cyan(`  commit    : ${!!(opts.commit || configCommit)}`));
  console.log(term.cyan(`  revisions : ${revisions.length ? compressRevisions(revisions) : '(auto — all eligible)'}`));
  console.log(term.cyan('──────────────────────────────────────────────────────'));
}

// ─── Check for local modifications ──────────────────────────────────────────
const dirtyLines = svnStatusDirty(workspace);
if (dirtyLines.length > 0) {
  console.log(term.yellow('Warning: working copy has uncommitted changes:'));
  for (const line of dirtyLines) {
    console.log(term.yellow(`  ${line}`));
  }
  if (!promptYN(term.yellow('Continue anyway? [y/N] '))) {
    console.log(term.red('Aborted.'));
    process.exit(1);
  }
}

// ─── svn update ────────────────────────────────────────────────────────
try {
  svnUpdate(workspace);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
    console.error(term.red(`Error: ${msg}`));
  process.exit(1);
}

// ─── If no -r provided, discover eligible revisions ──────────────────────────
let autoDiscovered = false;
if (revisions.length === 0) {
  let eligible: number[];
  try {
    eligible = svnEligibleRevisions(rawFromUrl, workspace);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(term.red(`Error querying eligible revisions: ${msg}`));
    process.exit(1);
  }

  if (eligible.length === 0) {
    console.log(term.cyan('No eligible revisions to merge. Working copy is up to date.'));
    process.exit(0);
  }

  const compressed = compressRevisions(eligible);
  console.log(term.cyan(`Found ${eligible.length} eligible revision(s): ${compressed}`));

  // Fetch log previews (one batch call)
  process.stdout.write(term.cyan('Fetching revision logs...\r'));
  const logMap = svnLogBatch(eligible, rawFromUrl);
  process.stdout.write(' '.repeat(40) + '\r');
  for (const rev of eligible) {
    const body = logMap.get(rev) ?? '';
    printRevisionLogPreview(rev, body);
  }

  if (!promptYN(term.yellow(`\nMerge all ${eligible.length} revision(s)? [y/N] `))) {
    console.log(term.red('Aborted.'));
    process.exit(0);
  }
  revisions.push(...eligible);
  autoDiscovered = true;
}

// ─── Preview + confirm for explicit -r ────────────────────────────────────────
if (!autoDiscovered && revisions.length > 0) {
  console.log(term.cyan(`Revisions to merge (${revisions.length}): ${compressRevisions(revisions)}`));
  process.stdout.write(term.cyan('Fetching revision logs...\r'));
  const logMap = svnLogBatch(revisions, rawFromUrl);
  process.stdout.write(' '.repeat(40) + '\r');
  for (const rev of revisions) {
    const body = logMap.get(rev) ?? '';
    printRevisionLogPreview(rev, body);
  }
  if (!promptYN(term.yellow(`\nMerge ${revisions.length} revision(s)? [y/N] `))) {
    console.log(term.red('Aborted.'));
    process.exit(0);
  }
}

// ─── Merge ignore paths: CLI -i appends to config ignore list ───────────────
const cliIgnorePaths = opts.ignore
  ? opts.ignore.split(',').map((s) => s.trim()).filter(Boolean)
  : [];
const ignorePaths = [...rcConfig.globalIgnore, ...configIgnoreMerge, ...cliIgnorePaths];

// ─── Run merge ───────────────────────────────────────────────────────────────
const options: MergeOptions = {
  workspace,
  fromUrl: rawFromUrl,
  revisions,
  ignorePaths,
  verbose: opts.verbose ?? configVerbose,
};

const logger = new Logger(outputDir, startTs);
const summary = run(options, logger);
// logger stays open until after summary is written to log

// ─── Console summary helpers ──────────────────────────────────────────────────
// ─── Console: conflict summary ────────────────────────────────────────────────
const verbose = opts.verbose ?? configVerbose;
const allReverted = summary.results.flatMap((r) => r.reverted ?? []);
const uniqueReverted = [...new Map(allReverted.map((r) => [r.path, r])).values()];
const uniqueRevertedRel = uniqueReverted.map((r) => ({
  ...r,
  relPath: relPath(r.path, workspace),
}));
uniqueRevertedRel.sort((a, b) => a.relPath.localeCompare(b.relPath));

const hasActiveConflicts = summary.results.some((r) => r.conflicts.some((c) => !c.ignored));
const hasIgnoredConflicts = summary.results.some((r) => r.conflicts.some((c) => c.ignored));
if (hasActiveConflicts || summary.failed > 0 || (verbose && (uniqueReverted.length > 0 || summary.withConflicts > 0 || hasIgnoredConflicts))) {
  console.log();
  console.log(term.bold('Merge Summary:'));
  logger.log('');
  logger.log('Merge Summary:');

  for (const result of summary.results) {
    if (!result.success) {
      console.log(term.red(`  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`));
      logger.log(`  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`);
    }
  }

  const groups = groupSummaryByType(summary.results, workspace);
  const typeLabels: Record<string, string> = {
    tree: 'Tree Conflicts',
    text: 'Text Conflicts',
    property: 'Property Conflicts',
  };

  for (const [type, entries] of groups) {
    if (entries.length === 0) continue;
    const activeEntries = entries.filter((e) => !e.ignored);
    const ignoredEntries = entries.filter((e) => e.ignored);
    // When not verbose, skip groups that have no active entries
    if (!verbose && activeEntries.length === 0) continue;
    const countLabel = verbose && ignoredEntries.length > 0
      ? `${activeEntries.length} + ${ignoredEntries.length} ignored`
      : `${activeEntries.length}`;
    const titleColor = activeEntries.length === 0 ? term.gray : (type === 'tree' ? term.red : term.yellow);
    const titleLine = `  ${typeLabels[type]} (${countLabel}):`;
    console.log(titleColor(titleLine));
    logger.log(titleLine);
    for (const e of activeEntries) {
      const kindTag = e.isDirectory ? '[D]' : '[F]';
      const line = `    ${kindTag}  ${e.relPath}  (${e.resolution})`;
      console.log((type === 'tree' ? term.red : term.yellow)(line));
      logger.log(line);
    }
    if (verbose) {
      for (const e of ignoredEntries) {
        const kindTag = e.isDirectory ? '[D]' : '[F]';
        const line = `    ${kindTag}  ${e.relPath}  (${e.resolution})`;
        console.log(term.gray(line));
        logger.log(line);
      }
    }
  }

  if (verbose && uniqueRevertedRel.length > 0) {
    const revertTitle = `  Ignored (${uniqueRevertedRel.length}):`;
    console.log(term.gray(revertTitle));
    logger.log(revertTitle);
    for (const r of uniqueRevertedRel) {
      const kindTag = r.isDirectory ? '[D]' : '[F]';
      const line = `    ${kindTag}  ${r.relPath}  (ignored)`;
      console.log(term.gray(line));
      logger.log(line);
    }
  }
}

// ─── Generate merge message ───────────────────────────────────────────────────
console.log('\nGenerating merge message...');
const mergeMessage = buildMessage(summary, rawFromUrl);
logger.appendRaw('\n' + '='.repeat(72) + '\n');
logger.appendRaw(mergeMessage);
logger.appendRaw('='.repeat(72) + '\n');

// ─── Copy merge message to clipboard ─────────────────────────────────────────
if (rcConfig.copyToClipboard) {
  copyToClipboard(mergeMessage);
  const clipMsg = 'Merge message copied to clipboard.';
  console.log(term.cyan(clipMsg));
  logger.log(clipMsg);
}

// ─── Console: done line ───────────────────────────────────────────────────────

console.log();
console.log(
  [
    `Done. Total: ${summary.total}`,
    term.green(`OK: ${summary.succeeded}`),
    summary.withConflicts > 0 ? term.yellow(`Conflicts: ${summary.withConflicts}`) : null,
    summary.failed > 0 ? term.red(`Failed: ${summary.failed}`) : null,
  ]
    .filter(Boolean)
    .join('  ')
);
console.log(`Log: ${logger.getLogPath()}`);

// ─── Auto-commit ─────────────────────────────────────────────────────────────
const shouldCommit = (opts.commit ?? false) || configCommit;
if (shouldCommit) {
  if (summary.failed > 0 || hasActiveConflicts) {
    const reasons: string[] = [];
    if (summary.failed > 0) {
      const failedRevs = summary.results.filter((r) => !r.success).map((r) => `r${r.revision}`).join(', ');
      reasons.push(`${summary.failed} revision(s) failed (${failedRevs})`);
    }
    if (hasActiveConflicts) {
      const conflictRevs = summary.results
        .filter((r) => r.conflicts.some((c) => !c.ignored))
        .map((r) => `r${r.revision}`)
        .join(', ');
      reasons.push(`unresolved conflicts (${conflictRevs})`);
    }
    const msg = `Auto-commit skipped: ${reasons.join(', ')}.`;
    console.log(term.yellow(`\n${msg}`));
    logger.log(msg);
  } else if (summary.succeeded === 0) {
    console.log(term.yellow('\nAuto-commit skipped: no revisions were successfully merged.'));
    logger.log('Auto-commit skipped: no revisions were successfully merged.');
  } else {
    console.log(term.green('\nRunning svn commit...'));
    logger.log('Running svn commit...');
    try {
      const allModifiedPaths = [
        ...new Map(
          summary.results
            .filter((r) => r.success)
            .flatMap((r) => r.modified.map((m) => [m.path, m]))
        ).values(),
      ].map((m) => m.path);
      const commitOut = svnCommit(workspace, mergeMessage, allModifiedPaths.length > 0 ? allModifiedPaths : undefined);
      console.log(term.green('Commit successful.'));
      if (commitOut) {
        console.log(commitOut);
        logger.log(commitOut);
      }
      logger.log('Commit successful.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(term.red(`Auto-commit failed: ${msg}`));
      logger.log(`Auto-commit failed: ${msg}`);
      logger.close();
      process.exit(1);
    }
  }
}

logger.close();
process.exit(summary.failed > 0 ? 1 : 0);
}
