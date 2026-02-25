#!/usr/bin/env ts-node

import { Command } from 'commander';
import * as path from 'path';

import { findDefaultConfig, loadConfig } from './config';
import { Logger } from './logger';
import { run } from './merger';
import { getMessageFilePath, writeMessageFile } from './message';
import { svnInfo, svnStatusDirty, svnUpdate } from './svn';
import { MergeOptions } from './types';
import { groupSummaryByType, relPath } from './utils';

/** ANSI color helpers */
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;

const program = new Command();

program
  .name('svn-merge-tool')
  .description('SVN branch merge tool — merge specific revisions one by one')
  .version('1.0.0')
  .option('-c, --config <path>', 'Path to INI config file (can provide workspace and from-url)')
  .option('-w, --workspace <path>', 'SVN working copy directory')
  .option('-f, --from-url <url>', 'Source branch URL to merge from')
  .requiredOption(
    '-r, --revisions <revisions>',
    'Comma-separated list of revisions or ranges to merge (e.g. 1001,1002-1005,1008)'
  )
  .addHelpText(
    'after',
    `
Config file (YAML format):
  workspace: D:\\my-working-copy
  from-url: http://svn.example.com/branches/feature
  ignore-merge:
    - src/thirdparty/generated
    - assets/auto-generated/catalog.json

Default config discovery:
  When -c is omitted, the tool searches for "svn-merge-tool.yaml" (or .yml)
  starting from the current directory, walking up to the filesystem root.

Examples:
  svn-merge-tool -r 1001                          # auto-find svn-merge-tool.yaml
  svn-merge-tool -c .\\svn.yaml -r 84597-84608,84610
  svn-merge-tool -w D:\\my-copy -f http://svn.example.com/branches/feature -r 1001
  svn-merge-tool -c .\\svn.yaml -w D:\\override -r 1001,1002,1003
`
  );

program.parse(process.argv);

const opts = program.opts<{ config?: string; workspace?: string; fromUrl?: string; revisions: string }>();

// ─── Load config file (if provided) ──────────────────────────────────────────
let configWorkspace: string | undefined;
let configFromUrl: string | undefined;
let configIgnoreMerge: string[] = [];

// Resolve config path: explicit -c, or auto-discover svn-merge-config.ini
const configPath = opts.config ?? findDefaultConfig();

if (configPath) {
  try {
    const cfg = loadConfig(configPath);
    configWorkspace = cfg.workspace;
    configFromUrl = cfg['from-url'];
    configIgnoreMerge = cfg['ignore-merge'] ?? [];
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
  console.error(RED('Error: workspace is required. Provide -w <path>, -c <config>, or place svn-merge-config.ini in the current/parent directory.'));
  process.exit(1);
}
if (!rawFromUrl) {
  console.error(RED('Error: from-url is required. Provide -f <url>, -c <config>, or place svn-merge-config.ini in the current/parent directory.'));
  process.exit(1);
}

// ─── Validate workspace path ──────────────────────────────────────────────────
const workspace = path.resolve(rawWorkspace);

try {
  svnInfo(workspace);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(RED(`Error: ${msg}`));
  process.exit(1);
}

// ─── Parse revisions ─────────────────────────────────────────────────────────
const rawRevisions = opts.revisions
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (rawRevisions.length === 0) {
  console.error(RED('Error: No revisions specified. Use -r 1001,1002,1003'));
  process.exit(1);
}

const revisions: number[] = [];
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

// ─── Check for local modifications ──────────────────────────────────────────
const dirtyLines = svnStatusDirty(workspace);
if (dirtyLines.length > 0) {
  console.log(YELLOW('Warning: working copy has uncommitted changes:'));
  for (const line of dirtyLines) {
    console.log(YELLOW(`  ${line}`));
  }
  process.stdout.write(YELLOW('Continue anyway? [Y/N] '));

  // Synchronous stdin read
  const buf = Buffer.alloc(16);
  let input = '';
  try {
    const n = (require('fs') as typeof import('fs')).readSync(0, buf, 0, buf.length, null);
    input = buf.slice(0, n).toString().trim().toLowerCase();
  } catch {
    // stdin not a tty (e.g. piped) — treat as 'n'
  }

  if (input.toLocaleLowerCase() !== 'y') {
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

// ─── Run merge ───────────────────────────────────────────────────────────────
const options: MergeOptions = {
  workspace,
  fromUrl: rawFromUrl,
  revisions,
  ignorePaths: configIgnoreMerge,
};

const logger = new Logger();
const summary = run(options, logger);
logger.close();

// ─── Console summary helpers ──────────────────────────────────────────────────
const DONE_GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const DONE_YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DONE_RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ─── Console: conflict summary ────────────────────────────────────────────────
const allReverted = summary.results.flatMap((r) => r.reverted ?? []);
const uniqueReverted = [...new Map(allReverted.map((r) => [r.path, r])).values()];
const uniqueRevertedRel = uniqueReverted.map((r) => ({
  ...r,
  relPath: relPath(r.path, workspace),
}));
uniqueRevertedRel.sort((a, b) => a.relPath.localeCompare(b.relPath));

if (summary.withConflicts > 0 || summary.failed > 0 || uniqueReverted.length > 0) {
  console.log();
  console.log('\x1b[1mConflict Summary:\x1b[0m');

  for (const result of summary.results) {
    if (!result.success) {
      console.log(DONE_RED(`  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`));
    }
  }

  const groups = groupSummaryByType(summary.results, workspace);
  const typeLabels: Record<string, string> = {
    tree: 'Tree Conflicts',
    text: 'Text Conflicts',
    property: 'Property Conflicts',
  };

  const GRAY = (s: string) => `\x1b[90m${s}\x1b[0m`;
  for (const [type, entries] of groups) {
    if (entries.length === 0) continue;
    const activeCount = entries.filter((e) => !e.ignored).length;
    const ignoredCount = entries.filter((e) => e.ignored).length;
    const countLabel = ignoredCount > 0 ? `${activeCount} + ${ignoredCount} ignored` : `${entries.length}`;
    const allIgnored = activeCount === 0;
    console.log((allIgnored ? GRAY : DONE_YELLOW)(`  ${typeLabels[type]} (${countLabel}):`));
    for (const e of entries) {
      const kindTag = e.isDirectory ? '[D]' : '[F]';
      const line = `    ${kindTag}  ${e.relPath}  (${e.resolution})`;
      if (e.ignored) {
        console.log(GRAY(line));
      } else {
        console.log(DONE_YELLOW(line));
      }
    }
  }

  if (uniqueRevertedRel.length > 0) {
    console.log(GRAY(`  Reverted (${uniqueRevertedRel.length} Ignored):`));
    for (const r of uniqueRevertedRel) {
      const kindTag = r.isDirectory ? '[D]' : '[F]';
      console.log(GRAY(`    ${kindTag}  ${r.relPath}  (reverted)`));
    }
  }
}

// ─── Generate merge message file ─────────────────────────────────────────────
console.log('\nGenerating merge message...');
writeMessageFile(summary, rawFromUrl);

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
console.log(`Msg: ${getMessageFilePath()}`);

process.exit(summary.failed > 0 ? 1 : 0);
