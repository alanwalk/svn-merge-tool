import { tr } from './i18n';
import { ILogger } from './logger';
import { svnMerge, svnResolve, svnRevert, svnStatusAfterMerge } from './svn';
import {
  ConflictInfo, MergeOptions, MergeSummary, RevertedInfo, RevisionMergeResult
} from './types';
import { formatConflictLine, isIgnored, relPath } from './utils';

/** ANSI color helpers (console only) */
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const GRAY = (s: string) => `\x1b[90m${s}\x1b[0m`;

/**
 * Merge a single revision and auto-resolve conflicts.
 * All detail goes to logger; console only receives the progress line.
 */
function mergeRevision(
  revision: number,
  fromUrl: string,
  workspace: string,
  logger: ILogger,
  ignorePaths: string[],
  lang: 'zh-CN' | 'en',
): RevisionMergeResult {
  logger.log(`\n${'─'.repeat(60)}`);
  logger.log(tr(lang, `[r${revision}] Merging -c ${revision} from ${fromUrl}`, `[r${revision}] 正在从 ${fromUrl} 合并 -c ${revision}`));

  const { stdout, stderr, exitCode } = svnMerge(revision, fromUrl, workspace);

  if (stdout.trim()) {
    logger.log(stdout.trim());
  }

  const isFatalError = exitCode !== 0 && !stdout.trim() && stderr.trim();

  if (isFatalError) {
    logger.log(tr(lang, `[r${revision}] FAILED: ${stderr.trim()}`, `[r${revision}] 失败：${stderr.trim()}`));
    return { revision, success: false, conflicts: [], reverted: [], errorMessage: stderr.trim() };
  }

  if (stderr.trim()) {
    logger.log(tr(lang, `[r${revision}] Warning: ${stderr.trim()}`, `[r${revision}] 警告：${stderr.trim()}`));
  }

  const { conflicts: rawConflicts, modifications } = svnStatusAfterMerge(workspace);

  const conflicts: ConflictInfo[] = rawConflicts.map((c) => ({
    ...c,
    // Ignored paths always resolve with 'working' (discard incoming changes).
    // For non-ignored tree conflicts, prefer incoming changes from source branch.
    resolution: isIgnored(c.path, workspace, ignorePaths)
      ? 'working'
      : (c.type === 'tree' ? 'theirs-full' : c.resolution),
    ignored: isIgnored(c.path, workspace, ignorePaths),
  }));

  if (conflicts.length > 0) {
    logger.log(tr(lang, `[r${revision}] ${conflicts.length} conflict(s) detected, auto-resolving:`, `[r${revision}] 检测到 ${conflicts.length} 处冲突，正在自动解决：`));
    for (const conflict of conflicts) {
      const { success, message } = svnResolve(conflict.path, conflict.resolution, workspace);
      const rel = relPath(conflict.path, workspace);
      if (success) {
        const logLine = formatConflictLine(conflict.type, conflict.isDirectory, rel, conflict.ignored ? 'ignored' : conflict.resolution);
        logger.log(tr(lang, `  ${logLine} → resolved`, `  ${logLine} → 已解决`));
      } else {
        const logLine = formatConflictLine(conflict.type, conflict.isDirectory, rel, conflict.resolution);
        logger.log(tr(lang, `  ${logLine} → resolve FAILED: ${message}`, `  ${logLine} → 解决失败：${message}`));
      }
    }
  } else {
    logger.log(tr(lang, `[r${revision}] Merged cleanly (no conflicts).`, `[r${revision}] 合并完成（无冲突）。`));
  }

  // ── Revert ignored paths that were modified without a conflict ──────────────
  const conflictPaths = new Set(conflicts.map((c) => c.path));
  const reverted: RevertedInfo[] = [];
  for (const mod of modifications) {
    if (!conflictPaths.has(mod.path) && isIgnored(mod.path, workspace, ignorePaths)) {
      const { success, message } = svnRevert(mod.path, workspace);
      const rel = relPath(mod.path, workspace);
      const kindTag = mod.isDirectory ? '[D]' : '[F]';
      if (success) {
        reverted.push(mod);
        logger.log(tr(lang, `  [NONE    ]${kindTag}  ${rel}  → reverted (ignored)`, `  [NONE    ]${kindTag}  ${rel}  → 已回退（已忽略）`));
      } else {
        logger.log(tr(lang, `  ${kindTag}  ${rel}  → revert FAILED: ${message}`, `  ${kindTag}  ${rel}  → 回退失败：${message}`));
      }
    }
  }

  return { revision, success: true, conflicts, reverted };
}

/**
 * Run the full merge for all revisions specified in options.
 * Returns a MergeSummary.
 */
export function run(options: MergeOptions, logger: ILogger): MergeSummary {
  const { workspace, fromUrl, revisions, ignorePaths = [], verbose = false, lang = 'en' } = options;
  const results: RevisionMergeResult[] = [];
  const total = revisions.length;

  logger.log(tr(lang, 'SVN Merge Tool', 'SVN 合并工具'));
  logger.log(tr(lang, `Workspace : ${workspace}`, `工作目录 : ${workspace}`));
  logger.log(tr(lang, `Source URL: ${fromUrl}`, `来源 URL: ${fromUrl}`));
  logger.log(tr(lang, `Revisions : ${revisions.join(', ')}`, `修订列表 : ${revisions.join(', ')}`));

  for (let i = 0; i < total; i++) {
    const rev = revisions[i];
    const pct = Math.round(((i + 1) / total) * 100);
    const label = `[${i + 1}/${total}] r${rev}  ${pct}%`;

    // Minimal console progress
    process.stdout.write(label + '\n');

    const result = mergeRevision(rev, fromUrl, workspace, logger, ignorePaths, lang);
    results.push(result);

    // Overwrite progress line with colored result; then print conflicts below
    if (!result.success) {
      process.stdout.write(`\x1b[1A\x1b[2K${RED(label + tr(lang, '  FAILED', '  失败'))}\n`);
    } else if (result.conflicts.length > 0 || result.reverted.length > 0) {
      const activeConflicts = result.conflicts.filter((c) => !c.ignored);
      const ignoredConflicts = result.conflicts.filter((c) => c.ignored);
      const parts: string[] = [];
      if (activeConflicts.length > 0) parts.push(tr(lang, `${activeConflicts.length} conflict(s)`, `${activeConflicts.length} 个冲突`));
      if (ignoredConflicts.length > 0) parts.push(tr(lang, `${ignoredConflicts.length} ignored`, `${ignoredConflicts.length} 个已忽略`));
      if (result.reverted.length > 0) parts.push(tr(lang, `${result.reverted.length} reverted`, `${result.reverted.length} 个已回退`));
      const hasTreeConflict = activeConflicts.some((c) => c.type === 'tree');
      const labelColor = hasTreeConflict ? RED : YELLOW;
      process.stdout.write(`\x1b[1A\x1b[2K${labelColor(label + `  (${parts.join(', ')})`)}\n`);
      for (const c of activeConflicts) {
        const rel = relPath(c.path, workspace);
        const line = formatConflictLine(c.type, c.isDirectory, rel, c.resolution);
        process.stdout.write((c.type === 'tree' ? RED : YELLOW)(`  ${line}\n`));
      }
      for (const c of ignoredConflicts) {
        const rel = relPath(c.path, workspace);
        const line = formatConflictLine(c.type, c.isDirectory, rel, 'ignored');
        if (verbose) process.stdout.write(GRAY(`  ${line}\n`));
      }
      for (const r of result.reverted) {
        const rel = relPath(r.path, workspace);
        const kindTag = r.isDirectory ? '[D]' : '[F]';
        if (verbose) process.stdout.write(GRAY(tr(lang, `  [NONE    ]${kindTag}  ${rel}  (reverted)\n`, `  [NONE    ]${kindTag}  ${rel}  （已回退）\n`)));
      }
    } else {
      process.stdout.write(`\x1b[1A\x1b[2K${GREEN(label + '  ✓')}\n`);
    }
  }

  logger.log(`\n${'─'.repeat(60)}`);
  logger.log(tr(lang, 'Merge completed.', '合并完成。'));

  let succeeded = 0;
  let withConflicts = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.success) failed++;
    else if (r.conflicts.some((c) => !c.ignored)) withConflicts++;
    else succeeded++;
  }

  return { total, succeeded, withConflicts, failed, results };
}
