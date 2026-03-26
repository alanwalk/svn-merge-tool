#!/usr/bin/env ts-node

import { spawnSync } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import { findDefaultConfig, loadConfig } from './config';
import { resolveConsoleLanguage, tr } from './i18n';
import { Logger } from './logger';
import { RunLogger, runMergePipeline } from './pipeline';
import {
  svnCleanWorkspace, svnEligibleRevisions, svnInfo, svnLogBatch, svnStatusDirty
} from './svn';
import { checkForUpdate, loadOrCreateRc } from './updater';
import { compressRevisions } from './utils';
import { uiCommand } from './webui';

// ─── Dispatch 'ui' subcommand before Commander parses argv ───────────────────
function runMain(): void {

  if (process.argv[2] === 'ui') {
    uiCommand(process.argv.slice(3))
      .then(() => process.exit(0))
      .catch((e: Error) => { process.stderr.write(e.message + '\n'); process.exit(1); });
    return; // do not run the merge pipeline
  }

  /** ANSI color helpers */
  const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const { lang, fallbackWarning } = resolveConsoleLanguage();
  if (fallbackWarning) console.log(YELLOW(fallbackWarning));

  function runTimedStep<T>(label: string, fn: () => T): T {
    const start = Date.now();
    console.log(CYAN(tr(lang, `[Startup] ${label}...`, `[启动] ${label}...`)));
    try {
      const result = fn();
      console.log(CYAN(tr(lang, `[Startup] ${label} done (${Date.now() - start} ms)`, `[启动] ${label} 完成（${Date.now() - start} ms）`)));
      return result;
    } catch (e) {
      console.log(CYAN(tr(lang, `[Startup] ${label} failed (${Date.now() - start} ms)`, `[启动] ${label} 失败（${Date.now() - start} ms）`)));
      throw e;
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

  const program = new Command();

  program
    .name('svn-merge-tool')
    .description('SVN branch merge tool — merge specific revisions one by one')
    .version('1.0.6', '-v, --version', 'Output version number')
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
  When -c is omitted, and -w is provided, the tool first searches from the
  workspace directory upward; if not found, it falls back to the current
  directory upward for "svnmerge.yaml" (or .yml).

Examples:
  svn-merge-tool                                  # merge all eligible revisions (prompts confirm)
  svn-merge-tool -r 1001                          # merge specific revision
  svn-merge-tool -r 1001 -C                       # merge and auto-commit using generated message
  svn-merge-tool -r 1001 -i src/gen,assets/auto   # merge ignoring specific paths
  svn-merge-tool -c ./svn.yaml -r 84597-84608,84610
  svn-merge-tool -w /path/to/copy -f http://svn.example.com/branches/feature -r 1001
  svn-merge-tool -c ./svn.yaml -w /path/to/override -r 1001,1002,1003
`
    );

  program.parse(process.argv);
  const rcConfig = runTimedStep(tr(lang, 'Load user config', '加载用户配置'), () => loadOrCreateRc());
  runTimedStep(tr(lang, 'Check for updates', '检查更新'), () => checkForUpdate('1.0.6', rcConfig, lang));

  const opts = program.opts<{ config?: string; workspace?: string; from?: string; revisions?: string; verbose?: boolean; output?: string; ignore?: string; commit?: boolean }>();

  // ─── Load config file (if provided) ──────────────────────────────────────────
  let configWorkspace: string | undefined;
  let configFromUrl: string | undefined;
  let configIgnoreMerge: string[] = [];
  let configOutputDir: string | undefined;
  let configVerbose = false;
  let configCommit = false;

  // Resolve config path:
  // 1) explicit -c
  // 2) auto-discover from -w/--workspace (if provided)
  // 3) auto-discover from current directory
  const configPath = opts.config
    ?? (opts.workspace ? findDefaultConfig(path.resolve(opts.workspace)) : undefined)
    ?? findDefaultConfig();

  if (configPath) {
    try {
      const cfg = loadConfig(configPath);
      configWorkspace = cfg.workspace;
      configFromUrl = cfg.from;
      configIgnoreMerge = cfg.ignore ?? [];
      configOutputDir = cfg.output;
      configVerbose = cfg.verbose ?? false;
      configCommit = cfg.commit ?? false;
      const label = opts.config
        ? tr(lang, 'Config loaded', '配置已加载')
        : tr(lang, 'Config auto-detected', '已自动检测到配置');
      console.log(CYAN(`${label}: ${path.resolve(configPath)}`));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(RED(`Error: ${msg}`));
      process.exit(1);
    }
  }

  // CLI options take precedence over config file
  const rawWorkspace = opts.workspace ?? configWorkspace;
  const rawFromUrl = opts.from ?? configFromUrl;

  if (!rawWorkspace) {
    console.error(RED(tr(
      lang,
      'Error: workspace is required. Provide -w <path>, -c <config>, or place svnmerge.yaml in the current/parent directory.',
      '错误：缺少 workspace。请使用 -w <path>、-c <config>，或在当前/父目录放置 svnmerge.yaml。'
    )));
    process.exit(1);
  }
  if (!rawFromUrl) {
    console.error(RED(tr(
      lang,
      'Error: from (source URL) is required. Provide -f <url>, -c <config>, or place svnmerge.yaml in the current/parent directory.',
      '错误：缺少 from（来源分支 URL）。请使用 -f <url>、-c <config>，或在当前/父目录放置 svnmerge.yaml。'
    )));
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
    runTimedStep(tr(lang, 'Validate SVN working copy (svn info)', '校验 SVN 工作副本 (svn info)'), () => svnInfo(workspace));
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
  let hasConfirmedMerge = false;

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

  // ─── Print resolved parameters ───────────────────────────────────────────────
  {
    const cliIgnorePaths = opts.ignore ? opts.ignore.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const allIgnore = [...rcConfig.globalIgnore, ...configIgnoreMerge, ...cliIgnorePaths];
    console.log(CYAN(tr(lang, '─── Parameters ───────────────────────────────────────', '─── 参数 ─────────────────────────────────────────────')));
    console.log(CYAN(`  workspace : ${workspace}`));
    console.log(CYAN(`  from      : ${rawFromUrl}`));
    console.log(CYAN(`  output    : ${outputDir}`));
    if (allIgnore.length === 0) {
      console.log(CYAN(tr(lang, '  ignore    : (none)', '  ignore    : （无）')));
    } else {
      console.log(CYAN(`  ignore    : ${allIgnore[0]}`));
      for (let i = 1; i < allIgnore.length; i++) {
        console.log(CYAN(`              ${allIgnore[i]}`));
      }
    };
    console.log(CYAN(`  verbose   : ${!!(opts.verbose || configVerbose)}`));
    console.log(CYAN(`  commit    : ${!!(opts.commit || configCommit)}`));
    console.log(CYAN(`  revisions : ${revisions.length ? compressRevisions(revisions) : tr(lang, '(auto — all eligible)', '（自动 — 全部可合并）')}`));
    console.log(CYAN(tr(lang, '──────────────────────────────────────────────────────', '──────────────────────────────────────────────────────')));
  }

  // ─── Check for local modifications ──────────────────────────────────────────
  let dirtyLines = runTimedStep(tr(lang, 'Scan working copy status (svn status)', '扫描工作副本状态 (svn status)'), () => svnStatusDirty(workspace));
  if (dirtyLines.length > 0) {
    console.error(YELLOW(tr(lang, 'Warning: SVN working copy has uncommitted changes or unversioned files:', '警告：SVN 工作副本存在未提交或未入库文件：')));
    for (const line of dirtyLines) {
      console.error(RED(`  ${line}`));
    }

    const autoClean = promptYN(YELLOW(tr(
      lang,
      'Auto-clean workspace now? This will revert local changes and delete unversioned files. [y/N] ',
      '是否立即自动清理工作副本？将回滚本地改动并删除未入库文件。[y/N] '
    )));
    if (!autoClean) {
      console.error(RED(tr(lang, 'Aborted. Please clean the workspace and retry.', '已取消。请先清理工作副本后重试。')));
      process.exit(1);
    }

    try {
      const result = svnCleanWorkspace(workspace);
      console.log(CYAN(tr(
        lang,
        `Workspace cleaned: reverted ${result.reverted}, removed ${result.removed}.`,
        `工作副本已清理：已回滚 ${result.reverted}，已删除 ${result.removed}。`
      )));
      if (result.failed.length > 0) {
        console.error(RED(`Cleanup failed for ${result.failed.length} path(s):`));
        for (const item of result.failed) {
          console.error(RED(`  ${item}`));
        }
        process.exit(1);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(RED(`Error during auto-clean: ${msg}`));
      process.exit(1);
    }

    dirtyLines = runTimedStep(tr(lang, 'Re-scan working copy status (svn status)', '重新扫描工作副本状态 (svn status)'), () => svnStatusDirty(workspace));
    if (dirtyLines.length > 0) {
      console.error(RED('Workspace is still dirty after auto-clean. Remaining paths:'));
      for (const line of dirtyLines) {
        console.error(RED(`  ${line}`));
      }
      process.exit(1);
    }

    console.log(CYAN(tr(lang, 'Workspace is clean. Continue merging...', '工作副本已干净，继续合并...')));
  }

  // ─── If no -r provided, discover eligible revisions ──────────────────────────
  if (revisions.length === 0) {
    let eligible: number[];
    try {
      eligible = runTimedStep(
        tr(lang, 'Query eligible revisions (svn mergeinfo --show-revs eligible)', '查询可合并修订 (svn mergeinfo --show-revs eligible)'),
        () => svnEligibleRevisions(rawFromUrl, workspace)
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(RED(`Error querying eligible revisions: ${msg}`));
      process.exit(1);
    }

    if (eligible.length === 0) {
      console.log(CYAN(tr(lang, 'No eligible revisions to merge. Working copy is up to date.', '没有可合并的修订，工作副本已是最新。')));
      process.exit(0);
    }

    const compressed = compressRevisions(eligible);
    console.log(CYAN(tr(lang, `Found ${eligible.length} eligible revision(s): ${compressed}`, `找到 ${eligible.length} 个可合并修订：${compressed}`)));

    // Fetch log previews (one batch call)
    process.stdout.write(CYAN('Fetching revision logs...\r'));
    const fetchStart = Date.now();
    const logMap = svnLogBatch(eligible, rawFromUrl);
    process.stdout.write(' '.repeat(40) + '\r');
    console.log(CYAN(tr(lang, `[Startup] Revision logs fetched (${Date.now() - fetchStart} ms)`, `[启动] 修订日志获取完成（${Date.now() - fetchStart} ms）`)));
    for (const rev of eligible) {
      const body = logMap.get(rev) ?? '';
      const firstLine = body.split('\n')[0].trim();
      console.log(CYAN(`  r${rev}  ${firstLine || tr(lang, '(no message)', '（无消息）')}`));
    }

    if (!promptYN(YELLOW(tr(lang, `\nMerge all ${eligible.length} revision(s)? [y/N] `, `\n确认合并全部 ${eligible.length} 个修订吗？[y/N] `)))) {
      console.log(RED(tr(lang, 'Aborted.', '已取消。')));
      process.exit(0);
    }
    hasConfirmedMerge = true;
    revisions.push(...eligible);
  }


  // ─── Preview + confirm for explicit -r ──────────────────────────────────────
  if (opts.revisions && revisions.length > 0) {
    console.log(CYAN(tr(lang, `Revisions to merge (${revisions.length}): ${compressRevisions(revisions)}`, `待合并修订（${revisions.length}）：${compressRevisions(revisions)}`)));
    process.stdout.write(CYAN('Fetching revision logs...\r'));
    const fetchStart = Date.now();
    const logMap = svnLogBatch(revisions, rawFromUrl);
    process.stdout.write(' '.repeat(40) + '\r');
    console.log(CYAN(tr(lang, `[Startup] Revision logs fetched (${Date.now() - fetchStart} ms)`, `[启动] 修订日志获取完成（${Date.now() - fetchStart} ms）`)));
    for (const rev of revisions) {
      const body = logMap.get(rev) ?? '';
      const firstLine = body.split('\n')[0].trim();
      console.log(CYAN(`  r${rev}  ${firstLine || tr(lang, '(no message)', '（无消息）')}`));
    }
    if (!hasConfirmedMerge) {
      if (!promptYN(YELLOW(tr(lang, `\nMerge ${revisions.length} revision(s)? [y/N] `, `\n确认合并 ${revisions.length} 个修订吗？[y/N] `)))) {
        console.log(RED(tr(lang, 'Aborted.', '已取消。')));
        process.exit(0);
      }
      hasConfirmedMerge = true;
    }
  }

  // ─── Merge ignore paths: CLI -i appends to config ignore list ───────────────
  const cliIgnorePaths = opts.ignore
    ? opts.ignore.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const ignorePaths = [...rcConfig.globalIgnore, ...configIgnoreMerge, ...cliIgnorePaths];

  // ─── Run pipeline ─────────────────────────────────────────────────────────────
  const DONE_RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

  const logger = new Logger(outputDir, startTs);
  const cliLogger: RunLogger = {
    log(text: string) { console.log(text); logger.log(text); },
    appendRaw(text: string) { process.stdout.write(text); logger.appendRaw(text); },
    sectionStart(title: string) {
      const sep = '\u2500'.repeat(54);
      console.log(CYAN(`\n${sep}\n  ${title}`));
      logger.log(`\n${sep}\n  ${title}`);
    },
    sectionEnd(_ok?: boolean) { /* separator shown at next sectionStart */ },
  };

  let pipelineResult;
  try {
    pipelineResult = runMergePipeline(
      {
        workspace,
        fromUrl: rawFromUrl,
        revisions,
        ignorePaths,
        lang,
        verbose: opts.verbose ?? configVerbose,
        autoCommit: (opts.commit ?? false) || configCommit,
        copyToClipboard: rcConfig.copyToClipboard,
      },
      cliLogger,
      copyToClipboard,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(DONE_RED(`\nError: ${msg}`));
    logger.log(`Error: ${msg}`);
    logger.close();
    process.exit(1);
  }

  console.log(CYAN(`\nLog: ${logger.getLogPath()}`));
  logger.close();
  process.exit(pipelineResult.summary.failed > 0 ? 1 : 0);

} // end runMain

runMain();
