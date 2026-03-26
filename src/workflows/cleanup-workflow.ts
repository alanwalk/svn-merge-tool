import { tr } from '../i18n';
import { CleanupSummary } from '../core/models';
import { RunLogger } from '../output/run-logger-types';
import { svnCleanWorkspace, svnStatusDirty } from '../svn';

export interface CleanupWorkflowOptions {
  workspace: string;
  lang?: 'zh-CN' | 'en';
}

export function runCleanupWorkflow(
  opts: CleanupWorkflowOptions,
  logger: RunLogger,
): CleanupSummary {
  const lang = opts.lang ?? 'en';
  logger.sectionStart(tr(lang, 'workerCleanupWorkspaceTitle'), 'info');
  logger.log(tr(lang, 'workerCleanupWorkspaceStarting'));

  const result = svnCleanWorkspace(opts.workspace);
  logger.log(tr(lang, 'workerCleanupWorkspaceResult', {
    reverted: result.reverted,
    removed: result.removed,
  }));

  if (result.failed.length > 0) {
    logger.log(tr(lang, 'workerCleanupWorkspaceFailed', { count: result.failed.length }));
    for (const item of result.failed) logger.log(`  ${item}`);
  }

  const remainingDirty = svnStatusDirty(opts.workspace);
  if (remainingDirty.length > 0) {
    logger.log(tr(lang, 'workerCleanupWorkspaceStillDirty', { count: remainingDirty.length }));
    for (const item of remainingDirty) logger.log(`  ${item}`);
  } else if (result.failed.length === 0) {
    logger.log(tr(lang, 'workerCleanupWorkspaceDone'));
  }

  const summary: CleanupSummary = {
    revertedCount: result.reverted,
    removedCount: result.removed,
    failedCount: result.failed.length,
    failedItems: result.failed,
    workspaceCleanAfterCleanup: remainingDirty.length === 0,
  };

  logger.sectionEnd(summary.failedCount === 0 && summary.workspaceCleanAfterCleanup);
  return summary;
}

