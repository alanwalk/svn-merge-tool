import { ILogger } from './logger';
import { svnMerge, svnResolve, svnRevert, svnStatusAfterMerge } from './svn';
import {
    ConflictInfo, MergeOptions, MergeSummary, RevertedInfo, RevisionMergeResult
} from './types';
import { formatConflictLine, isIgnored, relPath } from './utils';

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
): RevisionMergeResult {
  logger.log(`\n${'─'.repeat(60)}`);
  logger.log(`[r${revision}] Merging -c ${revision} from ${fromUrl}`);

  const { stdout, stderr, exitCode } = svnMerge(revision, fromUrl, workspace);

  if (stdout.trim()) {
    logger.log(stdout.trim());
  }

  const isFatalError = exitCode !== 0 && !stdout.trim() && stderr.trim();

  if (isFatalError) {
    logger.log(`[r${revision}] FAILED: ${stderr.trim()}`);
    return { revision, success: false, conflicts: [], reverted: [], modified: [], errorMessage: stderr.trim() };
  }

  if (stderr.trim()) {
    logger.log(`[r${revision}] Warning: ${stderr.trim()}`);
  }

  const { conflicts: rawConflicts, modifications } = svnStatusAfterMerge(workspace);

  const conflicts: ConflictInfo[] = rawConflicts.map((c) => ({
    ...c,
    // Ignored paths always resolve with 'working' (discard incoming changes)
    resolution: isIgnored(c.path, workspace, ignorePaths)
      ? 'working'
      : c.resolution,
    ignored: isIgnored(c.path, workspace, ignorePaths),
  }));

  if (conflicts.length > 0) {
    logger.log(`[r${revision}] ${conflicts.length} conflict(s) detected, auto-resolving:`);
    for (const conflict of conflicts) {
      const { success, message } = svnResolve(conflict.path, conflict.resolution, workspace);
      const rel = relPath(conflict.path, workspace);
      if (success) {
        const logLine = formatConflictLine(conflict.type, conflict.isDirectory, rel, conflict.ignored ? 'ignored' : conflict.resolution);
        logger.log(`  ${logLine} → resolved`);
      } else {
        const logLine = formatConflictLine(conflict.type, conflict.isDirectory, rel, conflict.resolution);
        logger.log(`  ${logLine} → resolve FAILED: ${message}`);
      }
    }
  } else {
    logger.log(`[r${revision}] Merged cleanly (no conflicts).`);
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
        logger.log(`  [NONE    ]${kindTag}  ${rel}  → reverted (ignored)`);
      } else {
        logger.log(`  ${kindTag}  ${rel}  → revert FAILED: ${message}`);
      }
    }
  }

  const revertedPaths = new Set(reverted.map((r) => r.path));
  const modified: { path: string; isDirectory: boolean }[] = [
    ...conflicts.map((c) => ({ path: c.path, isDirectory: c.isDirectory })),
    ...modifications.filter((m) => !revertedPaths.has(m.path)),
  ];

  return { revision, success: true, conflicts, reverted, modified };
}

/**
 * Run the full merge for all revisions specified in options.
 * Returns a MergeSummary.
 */
export function run(options: MergeOptions, logger: ILogger): MergeSummary {
  const { workspace, fromUrl, revisions, ignorePaths = [], verbose = false } = options;
  const results: RevisionMergeResult[] = [];
  const total = revisions.length;

  logger.log('SVN Merge Tool');
  logger.log(`Workspace : ${workspace}`);
  logger.log(`Source URL: ${fromUrl}`);
  logger.log(`Revisions : ${revisions.join(', ')}`);

  for (let i = 0; i < total; i++) {
    const rev = revisions[i];
    const pct = Math.round(((i + 1) / total) * 100);
    const label = `[${i + 1}/${total}] r${rev}  ${pct}%`;

    logger.emitMergeProgress?.({
      type: 'revision-start',
      index: i,
      total,
      revision: rev,
      percent: pct,
      label,
    });

    const result = mergeRevision(rev, fromUrl, workspace, logger, ignorePaths);
    results.push(result);

    const activeConflicts = result.conflicts.filter((c) => !c.ignored);
    const ignoredConflicts = result.conflicts.filter((c) => c.ignored);
    const ignoredCount = ignoredConflicts.length + result.reverted.length;
    const hasTreeConflict = activeConflicts.some((c) => c.type === 'tree');

    logger.emitMergeProgress?.({
      type: 'revision-result',
      index: i,
      total,
      revision: rev,
      label,
      ok: result.success,
      hasConflicts: result.conflicts.length > 0 || result.reverted.length > 0,
      hasTreeConflict,
      activeConflictCount: activeConflicts.length,
      ignoredCount,
    });

    for (const c of activeConflicts) {
      const rel = relPath(c.path, workspace);
      const line = formatConflictLine(c.type, c.isDirectory, rel, c.resolution);
      logger.emitMergeProgress?.({
        type: 'revision-detail',
        level: c.type === 'tree' ? 'active-tree-conflict' : 'active-conflict',
        text: `  ${line}`,
      });
    }
    if (verbose) {
      for (const c of ignoredConflicts) {
        const rel = relPath(c.path, workspace);
        const line = formatConflictLine(c.type, c.isDirectory, rel, 'ignored');
        logger.emitMergeProgress?.({
          type: 'revision-detail',
          level: 'ignored-conflict',
          text: `  ${line}`,
        });
      }
      for (const r of result.reverted) {
        const rel = relPath(r.path, workspace);
        const kindTag = r.isDirectory ? '[D]' : '[F]';
        logger.emitMergeProgress?.({
          type: 'revision-detail',
          level: 'ignored-reverted',
          text: `  [NONE    ]${kindTag}  ${rel}  (ignored)`,
        });
      }
    }
  }

  logger.log(`\n${'─'.repeat(60)}`);
  logger.log('Merge completed.');

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
