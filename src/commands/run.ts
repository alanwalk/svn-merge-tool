import { Command } from 'commander';
import * as path from 'path';

import { mapExitCode } from '../core/exit-codes';
import { SelectionSnapshot } from '../core/models';
import { resolveConsoleLanguage } from '../i18n';
import { Logger } from '../logger';
import { buildSharedRunContext } from '../modules/options/build-shared-run-context';
import { copyToClipboard } from '../modules/platform/copy-to-clipboard';
import { parseRevisionExpression } from '../modules/revisions/parse-revision-expression';
import { CompositeRunLogger } from '../output/composite-run-logger';
import { FileRunLogger } from '../output/file/file-run-logger';
import { TerminalRunLogger } from '../output/terminal/terminal-run-logger';
import { runMergePipeline } from '../pipeline';
import {
  svnEligibleRevisions, svnInfo, svnLogBatch, svnStatusDirty,
} from '../svn';
import { checkForUpdate, loadOrCreateRc } from '../updater';
import { compressRevisions, getPackageVersion, term } from '../utils';

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

function makeStartTs(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

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

export async function runMergeCommand(args: string[]): Promise<number> {
  const startTs = makeStartTs();
  const { lang, fallbackWarning } = resolveConsoleLanguage();
  if (fallbackWarning) console.log(term.yellow(fallbackWarning));
  const program = new Command();

  program
    .name('svnmerge run')
    .description('SVN branch merge tool — merge specific revisions one by one')
    .version(APP_VERSION, '-v, --version', 'Output version number')
    .option('-c, --config <path>', 'Path to YAML config file')
    .option('-w, --workspace <path>', 'SVN working copy directory')
    .option('-f, --from <url>', 'Source branch URL to merge from')
    .option('-V, --verbose', 'Show ignored/reverted file details in console output')
    .option('-o, --output <path>', 'Output directory for log and message files (overrides config output)')
    .option('-i, --ignore <paths>', 'Comma-separated paths to ignore (appended to config ignore list)')
    .option('-C, --commit', 'Automatically run svn commit after a successful merge, using the generated message file')
    .option('-r, --revisions <revisions>', 'Revisions or ranges to merge, e.g. 1001,1002-1005,1008. Omit to merge all eligible revisions.')
    .helpOption('-h, --help', 'Display help')
    .addHelpText(
      'after',
      `
配置文件 (YAML):
  workspace: /path/to/working-copy
  from: http://svn.example.com/branches/feature
  output: /logs/svn
  commit: true
  ignore:
    - src/thirdparty/generated
    - assets/auto-generated/catalog.json

示例:
  svnmerge run
  svnmerge run -r 1001
  svnmerge run -r 1001 -C
  svnmerge run -c ./svn.yaml -r 84597-84608,84610
`,
    );

  try {
    program.parse(['node', 'svnmerge run', ...args]);
  } catch {
    return mapExitCode('invalid-usage');
  }

  const rcConfig = loadOrCreateRc();
  checkForUpdate(APP_VERSION, rcConfig);

  const opts = program.opts<{
    config?: string; workspace?: string; from?: string; revisions?: string;
    verbose?: boolean; output?: string; ignore?: string; commit?: boolean;
  }>();

  let sharedContext;
  try {
    sharedContext = buildSharedRunContext({
      configPath: opts.config,
      workspace: opts.workspace,
      fromUrl: opts.from,
      cliIgnorePaths: opts.ignore ? opts.ignore.split(',').map((s) => s.trim()).filter(Boolean) : [],
      cliOutput: opts.output,
      cliVerbose: opts.verbose,
      cliCommit: opts.commit,
    });
    if (sharedContext.resolvedConfigPath) {
      const label = opts.config ? 'Config loaded' : 'Config auto-detected';
      console.log(term.cyan(`${label}: ${sharedContext.resolvedConfigPath}`));
    }
  } catch (e) {
    console.error(term.red(`Error: ${(e as Error).message}`));
    return mapExitCode('invalid-usage');
  }

  const rawWorkspace = sharedContext.workspace ?? undefined;
  const rawFromUrl = sharedContext.fromUrl;

  if (!rawWorkspace) {
    console.error(term.red('Error: workspace is required. Provide -w <path>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
    return mapExitCode('invalid-usage');
  }
  if (!rawFromUrl) {
    console.error(term.red('Error: from (source URL) is required. Provide -f <url>, -c <config>, or place svnmerge.yaml in the current/parent directory.'));
    return mapExitCode('invalid-usage');
  }

  const workspace = path.resolve(rawWorkspace);
  const outputDir = sharedContext.outputDir;

  try {
    svnInfo(workspace);
  } catch (e) {
    console.error(term.red(`Error: ${(e as Error).message}`));
    return mapExitCode('failure');
  }

  let revisions: number[] = [];
  if (opts.revisions) {
    try {
      revisions = parseRevisionExpression(opts.revisions);
    } catch (e) {
      console.error(term.red(`Error: ${(e as Error).message}`));
      return mapExitCode('invalid-usage');
    }
  }

  const ignorePaths = sharedContext.ignorePaths;
  const verbose = sharedContext.verbose;
  const autoCommit = sharedContext.autoCommit;

  console.log(term.cyan('─── Parameters ───────────────────────────────────────'));
  console.log(term.cyan(`  workspace : ${workspace}`));
  console.log(term.cyan(`  from      : ${rawFromUrl}`));
  console.log(term.cyan(`  output    : ${outputDir}`));
  if (ignorePaths.length === 0) console.log(term.cyan('  ignore    : (none)'));
  else {
    console.log(term.cyan(`  ignore    : ${ignorePaths[0]}`));
    for (let i = 1; i < ignorePaths.length; i++) console.log(term.cyan(`              ${ignorePaths[i]}`));
  }
  console.log(term.cyan(`  verbose   : ${!!verbose}`));
  console.log(term.cyan(`  commit    : ${!!autoCommit}`));
  console.log(term.cyan(`  revisions : ${revisions.length ? compressRevisions(revisions) : '(auto — all eligible)'}`));
  console.log(term.cyan('──────────────────────────────────────────────────────'));

  const dirtyLines = svnStatusDirty(workspace);
  if (dirtyLines.length > 0) {
    console.error(term.red('Error: working copy has uncommitted or unversioned changes. Merge is blocked until the workspace is clean.'));
    for (const line of dirtyLines) {
      console.error(term.red(`  ${line}`));
    }
    console.error(term.yellow('Tip: run `svnmerge cleanup` after reviewing the workspace if you want to reset it.'));
    return mapExitCode('failure');
  }

  let autoDiscovered = false;
  if (revisions.length === 0) {
    let eligible: number[];
    try {
      eligible = svnEligibleRevisions(rawFromUrl, workspace);
    } catch (e) {
      console.error(term.red(`Error querying eligible revisions: ${(e as Error).message}`));
      return mapExitCode('failure');
    }

    if (eligible.length === 0) {
      console.log(term.cyan('No eligible revisions to merge. Working copy is up to date.'));
      return mapExitCode('success');
    }

    console.log(term.cyan(`Found ${eligible.length} eligible revision(s): ${compressRevisions(eligible)}`));
    process.stdout.write(term.cyan('Fetching revision logs...\r'));
    const logMap = svnLogBatch(eligible, rawFromUrl);
    process.stdout.write(' '.repeat(40) + '\r');
    for (const rev of eligible) printRevisionLogPreview(rev, logMap.get(rev) ?? '');

    if (!promptYN(term.yellow(`\nMerge all ${eligible.length} revision(s)? [y/N] `))) {
      console.log(term.red('Aborted.'));
      return mapExitCode('canceled');
    }

    revisions.push(...eligible);
    autoDiscovered = true;
  }

  if (!autoDiscovered && revisions.length > 0) {
    console.log(term.cyan(`Revisions to merge (${revisions.length}): ${compressRevisions(revisions)}`));
    process.stdout.write(term.cyan('Fetching revision logs...\r'));
    const logMap = svnLogBatch(revisions, rawFromUrl);
    process.stdout.write(' '.repeat(40) + '\r');
    for (const rev of revisions) printRevisionLogPreview(rev, logMap.get(rev) ?? '');
    if (!promptYN(term.yellow(`\nMerge ${revisions.length} revision(s)? [y/N] `))) {
      console.log(term.red('Aborted.'));
      return mapExitCode('canceled');
    }
  }

  const selectionSnapshot: SelectionSnapshot = {
    workspace,
    fromUrl: rawFromUrl,
    revisions: [...revisions],
    ignorePaths: [...ignorePaths],
    outputDir,
    verbose: !!verbose,
    autoCommit: !!autoCommit,
    copyToClipboard: sharedContext.copyToClipboard,
    lang,
  };

  const fileLogger = new Logger(outputDir, startTs);
  const logger = new CompositeRunLogger([
    new FileRunLogger(fileLogger),
    new TerminalRunLogger(!!verbose),
  ]);
  let pipelineResult;
  try {
    pipelineResult = runMergePipeline(
      {
        workspace: selectionSnapshot.workspace,
        fromUrl: selectionSnapshot.fromUrl,
        revisions: selectionSnapshot.revisions,
        lang,
        ignorePaths: selectionSnapshot.ignorePaths,
        verbose: selectionSnapshot.verbose,
        autoCommit: selectionSnapshot.autoCommit,
        copyToClipboard: selectionSnapshot.copyToClipboard,
      },
      logger,
      copyToClipboard,
    );
  } catch (e) {
    fileLogger.close();
    console.error(term.red(`Error: ${(e as Error).message}`));
    return mapExitCode('failure');
  }

  const summary = pipelineResult.summary;

  console.log();
  console.log(
    [
      `Done. Total: ${summary.total}`,
      term.green(`OK: ${summary.succeeded}`),
      summary.withConflicts > 0 ? term.yellow(`Conflicts: ${summary.withConflicts}`) : null,
      summary.failed > 0 ? term.red(`Failed: ${summary.failed}`) : null,
    ].filter(Boolean).join('  '),
  );
  console.log(`Log: ${fileLogger.getLogPath()}`);

  fileLogger.close();
  return (summary.failed > 0 || (pipelineResult.autoCommitAttempted && !pipelineResult.autoCommitSkipped && !pipelineResult.autoCommitOk))
    ? mapExitCode('failure')
    : mapExitCode('success');
}
