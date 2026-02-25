import { Logger } from './logger';
import { svnMerge, svnResolve, svnRevert, svnStatusConflicts, svnStatusModifications } from './svn';
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
  logger: Logger,
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
    return { revision, success: false, conflicts: [], reverted: [], errorMessage: stderr.trim() };
  }

  if (stderr.trim()) {
    logger.log(`[r${revision}] Warning: ${stderr.trim()}`);
  }

  const conflicts: ConflictInfo[] = svnStatusConflicts(workspace).map((c) => ({
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
  const modifications = svnStatusModifications(workspace);
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

  return { revision, success: true, conflicts, reverted };
}

/**
 * Run the full merge for all revisions specified in options.
 * Returns a MergeSummary.
 */
export function run(options: MergeOptions, logger: Logger): MergeSummary {
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

    // Minimal console progress
    process.stdout.write(label + '\n');

    const result = mergeRevision(rev, fromUrl, workspace, logger, ignorePaths);
    results.push(result);

    // Overwrite progress line with colored result; then print conflicts below
    if (!result.success) {
      process.stdout.write(`\x1b[1A\x1b[2K${RED(label + '  FAILED')}\n`);
    } else if (result.conflicts.length > 0 || result.reverted.length > 0) {
      const activeConflicts = result.conflicts.filter((c) => !c.ignored);
      const ignoredConflicts = result.conflicts.filter((c) => c.ignored);
      const parts: string[] = [];
      if (activeConflicts.length > 0) parts.push(`${activeConflicts.length} conflict(s)`);
      if (ignoredConflicts.length > 0) parts.push(`${ignoredConflicts.length} ignored`);
      if (result.reverted.length > 0) parts.push(`${result.reverted.length} reverted`);
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
        if (verbose) process.stdout.write(GRAY(`  [NONE    ]${kindTag}  ${rel}  (reverted)\n`));
      }
    } else {
      process.stdout.write(`\x1b[1A\x1b[2K${GREEN(label + '  ✓')}\n`);
    }
  }

  logger.log(`\n${'─'.repeat(60)}`);
  logger.log('Merge completed.');

  let succeeded = 0;
  let withConflicts = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.success) failed++;
    else if (r.conflicts.length > 0) withConflicts++;
    else succeeded++;
  }

  return { total, succeeded, withConflicts, failed, results };
}
