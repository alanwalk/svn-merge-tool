import { Command } from 'commander';

import { mapExitCode } from '../core/exit-codes';
import { CleanupSummary } from '../core/models';
import { resolveCommandConfig } from '../cli-config';
import { resolveConsoleLanguage } from '../i18n';
import { TerminalRunLogger } from '../output/terminal/terminal-run-logger';
import { svnInfo, svnStatusDirty } from '../svn';
import { term } from '../utils';
import { runCleanupWorkflow } from '../workflows/cleanup-workflow';

function promptYN(question: string): boolean {
  process.stdout.write(question);
  const buf = Buffer.alloc(16);
  try {
    const n = require('fs').readSync(0, buf, 0, buf.length, null);
    const input = buf.slice(0, n).toString().trim().toLowerCase();
    return input === 'y';
  } catch {
    return false;
  }
}

function printCleanupSummary(summary: CleanupSummary, verbose: boolean): void {
  console.log();
  console.log(term.cyan('─── Cleanup Summary ──────────────────────────────────'));
  console.log(term.cyan(`  reverted : ${summary.revertedCount}`));
  console.log(term.cyan(`  removed  : ${summary.removedCount}`));
  console.log(term.cyan(`  failed   : ${summary.failedCount}`));
  console.log(term.cyan(`  clean    : ${summary.workspaceCleanAfterCleanup}`));
  if (verbose && summary.failedItems.length > 0) {
    for (const item of summary.failedItems) {
      console.log(term.red(`  ${item}`));
    }
  }
  console.log(term.cyan('──────────────────────────────────────────────────────'));
}

export async function runCleanupCommand(args: string[]): Promise<number> {
  const { lang, fallbackWarning } = resolveConsoleLanguage();
  if (fallbackWarning) console.log(term.yellow(fallbackWarning));
  const program = new Command();

  program
    .name('svnmerge cleanup')
    .description('Restore the SVN working copy to a clean state')
    .option('-c, --config <path>', 'Path to YAML config file')
    .option('-w, --workspace <path>', 'SVN working copy directory')
    .option('-V, --verbose', 'Show cleanup details in console output')
    .option('-y, --yes', 'Skip confirmation prompt')
    .helpOption('-h, --help', 'Display help');

  try {
    program.parse(['node', 'svnmerge cleanup', ...args]);
  } catch {
    return mapExitCode('invalid-usage');
  }

  const opts = program.opts<{ config?: string; workspace?: string; verbose?: boolean; yes?: boolean }>();

  let workspace: string | undefined;
  try {
    const resolvedConfig = resolveCommandConfig({
      configPath: opts.config,
      workspace: opts.workspace,
    });
    workspace = resolvedConfig.workspace;
  } catch (e) {
    console.error(term.red(`Config error: ${(e as Error).message}`));
    return mapExitCode('invalid-usage');
  }

  if (!workspace) {
    console.error(term.red('Error: workspace is required. Provide -w <path>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
    return mapExitCode('invalid-usage');
  }

  try {
    svnInfo(workspace);
  } catch (e) {
    console.error(term.red(`Error: ${(e as Error).message}`));
    return mapExitCode('failure');
  }

  const dirtyLines = svnStatusDirty(workspace);
  if (dirtyLines.length === 0) {
    console.log(term.green('Workspace is already clean.'));
    return mapExitCode('success');
  }

  console.log(term.cyan('─── Cleanup Parameters ───────────────────────────────'));
  console.log(term.cyan(`  workspace : ${workspace}`));
  console.log(term.cyan(`  changes   : ${dirtyLines.length}`));
  console.log(term.cyan(`  verbose   : ${!!opts.verbose}`));
  console.log(term.cyan('──────────────────────────────────────────────────────'));

  if (!opts.yes) {
    console.log(term.yellow('The cleanup command will revert versioned changes and remove unversioned files/directories.'));
    if (!promptYN(term.yellow('Continue cleanup? [y/N] '))) {
      console.log(term.red('Aborted.'));
      return mapExitCode('canceled');
    }
  }

  try {
    const summary: CleanupSummary = runCleanupWorkflow(
      { workspace, lang },
      new TerminalRunLogger(!!opts.verbose),
    );
    printCleanupSummary(summary, !!opts.verbose);

    if (summary.failedCount > 0) {
      return mapExitCode('failure');
    }
    if (!summary.workspaceCleanAfterCleanup) {
      console.error(term.red('Workspace is still dirty after cleanup.'));
      return mapExitCode('failure');
    }
    return mapExitCode('success');
  } catch (e) {
    console.error(term.red(`Cleanup failed: ${(e as Error).message}`));
    return mapExitCode('failure');
  }
}
