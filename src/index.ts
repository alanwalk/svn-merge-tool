#!/usr/bin/env ts-node

import { Command } from 'commander';
import * as path from 'path';

import { findDefaultConfig, loadConfig } from './config';
import { Logger } from './logger';
import { run } from './merger';
import { getMessageFilePath, writeMessageFile } from './message';
import { svnEligibleRevisions, svnInfo, svnLogBatch, svnStatusDirty, svnUpdate } from './svn';
import { MergeOptions } from './types';
import { compressRevisions, groupSummaryByType, relPath } from './utils';

/** ANSI color helpers */
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;

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

const program = new Command();

program
  .name('svn-merge-tool')
  .description('SVN branch merge tool — merge specific revisions one by one')
  .version('1.0.3')
  .option('-c, --config <path>', 'Path to INI config file (can provide workspace and from-url)')
  .option('-w, --workspace <path>', 'SVN working copy directory')
  .option('-f, --from-url <url>', 'Source branch URL to merge from')
  .option('-v, --verbose', 'Show ignored/reverted file details in console output')
  .option('--dry-run', 'List eligible revisions and their log messages without merging')
  .option(
    '-r, --revisions <revisions>',
    'Revisions or ranges to merge, e.g. 1001,1002-1005,1008. Omit to merge all eligible revisions.'
  )
  .addHelpText(
    'after',
    `
Config file (YAML format):
  workspace: /path/to/working-copy
  fromUrl: http://svn.example.com/branches/feature
  outputDir: /logs/svn          # optional: absolute or workspace-relative
  ignoreMerge:
    - src/thirdparty/generated
    - assets/auto-generated/catalog.json

Default config discovery:
  When -c is omitted, the tool searches for "svnmerge.yaml" (or .yml)
  starting from the current directory, walking up to the filesystem root.

Examples:
  svn-merge-tool                                  # merge all eligible revisions (prompts confirm)
  svn-merge-tool --dry-run                        # preview eligible revisions and log, no merge
  svn-merge-tool -r 1001                          # merge specific revision
  svn-merge-tool --dry-run -r 84597-84610         # preview specific revisions and log
  svn-merge-tool -c ./svn.yaml -r 84597-84608,84610
  svn-merge-tool -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001
  svn-merge-tool -c ./svn.yaml -w /path/to/override -r 1001,1002,1003
`
  );

program.parse(process.argv);

const opts = program.opts<{ config?: string; workspace?: string; fromUrl?: string; revisions?: string; verbose?: boolean; dryRun?: boolean }>();

// ─── Load config file (if provided) ──────────────────────────────────────────
let configWorkspace: string | undefined;
let configFromUrl: string | undefined;
let configIgnoreMerge: string[] = [];
let configOutputDir: string | undefined;
let configVerbose = false;

// Resolve config path: explicit -c, or auto-discover svn-merge-config.ini
const configPath = opts.config ?? findDefaultConfig();

if (configPath) {
  try {
    const cfg = loadConfig(configPath);
    configWorkspace = cfg.workspace;
    configFromUrl = cfg.fromUrl;
    configIgnoreMerge = cfg.ignoreMerge ?? [];
    configOutputDir = cfg.outputDir;
    configVerbose = cfg.verbose ?? false;
    const label = opts.config ? 'Config loaded' : 'Config auto-detected';
    console.log(CYAN(`${label}: ${path.resolve(configPath)}`));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(RED(`Error: ${msg}`));
    process.exit(1);
  }
}

// CLI options take precedence over config file
const rawWorkspace = opts.workspace ?? configWorkspace;
const rawFromUrl = opts.fromUrl ?? configFromUrl;

if (!rawWorkspace) {
  console.error(RED('Error: workspace is required. Provide -w <path>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
  process.exit(1);
}
if (!rawFromUrl) {
  console.error(RED('Error: fromUrl is required. Provide -f <url>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
  process.exit(1);
}

// ─── Validate workspace path ──────────────────────────────────────────────────
const workspace = path.resolve(rawWorkspace);

// Resolve outputDir: explicit config > default (.svnmerge under workspace)
const outputDir = configOutputDir
  ? (path.isAbsolute(configOutputDir)
      ? configOutputDir
      : path.resolve(workspace, configOutputDir))
  : path.join(workspace, '.svnmerge');

try {
  svnInfo(workspace);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(RED(`Error: ${msg}`));
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
    console.error(RED('Error: No revisions specified. Use -r 1001,1002,1003'));
    process.exit(1);
  }

  for (const raw of rawRevisions) {
    // Support range syntax: e.g. "84597-84608"
    const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from <= 0 || to <= 0) {
        console.error(RED(`Error: Invalid revision range "${raw}". Revisions must be positive integers.`));
        process.exit(1);
      }
      if (from > to) {
        console.error(RED(`Error: Invalid revision range "${raw}": start must be <= end.`));
        process.exit(1);
      }
      for (let rev = from; rev <= to; rev++) {
        revisions.push(rev);
      }
    } else {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n <= 0) {
        console.error(RED(`Error: Invalid revision "${raw}". Use integers or ranges like 1001-1005.`));
        process.exit(1);
      }
      revisions.push(n);
    }
  }
}

// ─── Check for local modifications ──────────────────────────────────────────
const dirtyLines = svnStatusDirty(workspace);
if (dirtyLines.length > 0) {
  console.log(YELLOW('Warning: working copy has uncommitted changes:'));
  for (const line of dirtyLines) {
    console.log(YELLOW(`  ${line}`));
  }
  if (!promptYN(YELLOW('Continue anyway? [y/N] '))) {
    console.log(RED('Aborted.'));
    process.exit(1);
  }
}

// ─── svn update ────────────────────────────────────────────────────────
try {
  svnUpdate(workspace);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(RED(`Error: ${msg}`));
  process.exit(1);
}

// ─── If no -r provided, discover eligible revisions ──────────────────────────
if (revisions.length === 0) {
  let eligible: number[];
  try {
    eligible = svnEligibleRevisions(rawFromUrl, workspace);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(RED(`Error querying eligible revisions: ${msg}`));
    process.exit(1);
  }

  if (eligible.length === 0) {
    console.log(CYAN('No eligible revisions to merge. Working copy is up to date.'));
    process.exit(0);
  }

  const compressed = compressRevisions(eligible);
  console.log(CYAN(`Found ${eligible.length} eligible revision(s): ${compressed}`));

  // Fetch log previews (one batch call)
  process.stdout.write(CYAN('Fetching revision logs...\r'));
  const logMap = svnLogBatch(eligible, rawFromUrl);
  process.stdout.write(' '.repeat(40) + '\r');
  for (const rev of eligible) {
    const body = logMap.get(rev) ?? '';
    const firstLine = body.split('\n')[0].trim();
    console.log(CYAN(`  r${rev}  ${firstLine || '(no message)'}` ));
  }

  // --dry-run: stop here without merging
  if (opts.dryRun) {
    console.log(CYAN('\n[dry-run] No changes made.'));
    process.exit(0);
  }

  if (!promptYN(YELLOW(`\nMerge all ${eligible.length} revision(s)? [y/N] `))) {
    console.log(RED('Aborted.'));
    process.exit(0);
  }
  revisions.push(...eligible);
}


// ─── dry-run with explicit -r: show log preview and exit ─────────────────────
if (opts.dryRun && revisions.length > 0) {
  console.log(CYAN(`Revisions to merge (${revisions.length}): ${compressRevisions(revisions)}`));
  process.stdout.write(CYAN('Fetching revision logs...\r'));
  const logMap = svnLogBatch(revisions, rawFromUrl);
  process.stdout.write(' '.repeat(40) + '\r');
  for (const rev of revisions) {
    const body = logMap.get(rev) ?? '';
    const firstLine = body.split('\n')[0].trim();
    console.log(CYAN(`  r${rev}  ${firstLine || '(no message)'}`));
  }
  console.log(CYAN('\n[dry-run] No changes made.'));
  process.exit(0);
}

// ─── Run merge ───────────────────────────────────────────────────────────────
const options: MergeOptions = {
  workspace,
  fromUrl: rawFromUrl,
  revisions,
  ignorePaths: configIgnoreMerge,
  verbose: opts.verbose ?? configVerbose,
};

const logger = new Logger(outputDir, startTs);
const summary = run(options, logger);
// logger stays open until after summary is written to log

// ─── Console summary helpers ──────────────────────────────────────────────────
const DONE_GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const DONE_YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DONE_RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

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
if (hasActiveConflicts || summary.failed > 0 || (verbose && (uniqueReverted.length > 0 || summary.withConflicts > 0))) {
  console.log();
  console.log('\x1b[1mConflict Summary:\x1b[0m');
  logger.log('');
  logger.log('Conflict Summary:');

  for (const result of summary.results) {
    if (!result.success) {
      console.log(DONE_RED(`  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`));
      logger.log(`  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`);
    }
  }

  const groups = groupSummaryByType(summary.results, workspace);
  const GRAY = (s: string) => `\x1b[90m${s}\x1b[0m`;
  const typeLabels: Record<string, string> = {
    tree: 'Tree Conflicts',
    text: 'Text Conflicts',
    property: 'Property Conflicts',
  };

  const DONE_RED_SUMMARY = (s: string) => `\x1b[31m${s}\x1b[0m`;
  for (const [type, entries] of groups) {
    if (entries.length === 0) continue;
    const activeEntries = entries.filter((e) => !e.ignored);
    const ignoredEntries = entries.filter((e) => e.ignored);
    // When not verbose, skip groups that have no active entries
    if (!verbose && activeEntries.length === 0) continue;
    const countLabel = verbose && ignoredEntries.length > 0
      ? `${activeEntries.length} + ${ignoredEntries.length} ignored`
      : `${activeEntries.length}`;
    const titleColor = type === 'tree' ? DONE_RED_SUMMARY : DONE_YELLOW;
    const titleLine = `  ${typeLabels[type]} (${countLabel}):`;
    console.log(titleColor(titleLine));
    logger.log(titleLine);
    for (const e of activeEntries) {
      const kindTag = e.isDirectory ? '[D]' : '[F]';
      const line = `    ${kindTag}  ${e.relPath}  (${e.resolution})`;
      console.log((type === 'tree' ? DONE_RED_SUMMARY : DONE_YELLOW)(line));
      logger.log(line);
    }
    if (verbose) {
      for (const e of ignoredEntries) {
        const kindTag = e.isDirectory ? '[D]' : '[F]';
        const line = `    ${kindTag}  ${e.relPath}  (${e.resolution})`;
        console.log(GRAY(line));
        logger.log(line);
      }
    }
  }

  if (verbose && uniqueRevertedRel.length > 0) {
    const revertTitle = `  Reverted (${uniqueRevertedRel.length} Ignored):`;
    console.log(GRAY(revertTitle));
    logger.log(revertTitle);
    for (const r of uniqueRevertedRel) {
      const kindTag = r.isDirectory ? '[D]' : '[F]';
      const line = `    ${kindTag}  ${r.relPath}  (reverted)`;
      console.log(GRAY(line));
      logger.log(line);
    }
  }
}

// ─── Generate merge message file ─────────────────────────────────────────────
console.log('\nGenerating merge message...');
writeMessageFile(summary, rawFromUrl, outputDir, startTs);

// ─── Console: done line ───────────────────────────────────────────────────────

console.log();
console.log(
  [
    `Done. Total: ${summary.total}`,
    DONE_GREEN(`OK: ${summary.succeeded}`),
    summary.withConflicts > 0 ? DONE_YELLOW(`Conflicts: ${summary.withConflicts}`) : null,
    summary.failed > 0 ? DONE_RED(`Failed: ${summary.failed}`) : null,
  ]
    .filter(Boolean)
    .join('  ')
);
console.log(`Log: ${logger.getLogPath()}`);
console.log(`Msg: ${getMessageFilePath(outputDir, startTs)}`);

logger.close();
process.exit(summary.failed > 0 ? 1 : 0);
