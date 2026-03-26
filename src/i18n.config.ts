export type AppLang = 'zh-CN' | 'en';

export interface I18nMessages {
  encodingFallbackWarning: string;
  mergedRevisionsHeader(args: { revisions: string; branch: string }): string;
  fetchingRevisionLogs: string;
  noLogMessageForRevision(args: { revision: number }): string;
  svnUpdateWorkingCopy: string;
  svnUpdateFailed(args: { error: string }): string;
  svnUpdateTitle: string;
  mergingRevisionCount(args: { count: number }): string;
  summaryTitle: string;
  revisionFailed(args: { revision: number; error: string }): string;
  treeConflictsTitle: string;
  textConflictsTitle: string;
  propertyConflictsTitle: string;
  ignoredCountLabel(args: { active: number; ignored: number }): string;
  revertedIgnoredTitle(args: { count: number }): string;
  revertedEntry(args: { kindTag: string; rel: string }): string;
  incomingTreeConflictsNotice(args: { count: number }): string;
  incomingTreeConflictEntry(args: { rel: string }): string;
  summaryTotal(args: { total: number }): string;
  summaryOk(args: { count: number }): string;
  summaryConflicts(args: { count: number }): string;
  summaryFailed(args: { count: number }): string;
  mergeMessageTitle: string;
  mergeMessageCopied: string;
  autoCommitTitle: string;
  failedRevisionsReason(args: { count: number; revisions: string }): string;
  unresolvedConflictsReason(args: { revisions: string }): string;
  autoCommitSkipped(args: { reasons: string }): string;
  autoCommitSkippedNoSuccess: string;
  autoCommitSuccessful: string;
  autoCommitFailed(args: { error: string }): string;
  updateAvailable(args: { currentVersion: string; latestVersion: string }): string;
  runNpmInstallNow(args: { packageName: string }): string;
  runningNpmInstall(args: { packageName: string }): string;
  updateSuccessfulRestart: string;
  updateFailedRunManually(args: { packageName: string }): string;
  workerDirtyError(args: { count: number }): string;
  workerCleanRetryError: string;
  workerPrepareMergeTitle: string;
  workerPrepareMergeCheckingWorkspace: string;
  workerPrepareMergeCreateLog: string;
  workerPrepareMergeReady: string;
  workerWorkspace(args: { workspace: string }): string;
  workerFrom(args: { fromUrl: string }): string;
  workerRevisions(args: { revisions: string }): string;
  workerWorkingCopyClean: string;
  workerGenericError(args: { error: string }): string;
  workerCancelMergeTitle: string;
  workerCancelMergeRequested: string;
  workerCancelMergeNoActiveTask: string;
  workerCancelMergeTerminated: string;
  workerCleanupWorkspaceTitle: string;
  workerCleanupWorkspaceStarting: string;
  workerCleanupWorkspaceResult(args: { reverted: number; removed: number }): string;
  workerCleanupWorkspaceFailed(args: { count: number }): string;
  workerCleanupWorkspaceStillDirty(args: { count: number }): string;
  workerCleanupWorkspaceDone: string;
  workerCleanupWorkspaceError(args: { error: string }): string;
  startupStepRunning(args: { label: string }): string;
  startupStepDone(args: { label: string; elapsedMs: number }): string;
  startupStepFailed(args: { label: string; elapsedMs: number }): string;
  uiUsage: string;
  unknownOptionHelp: string;
  fromRequired: string;
  uiUsageShort: string;
  loadUserConfig: string;
  checkForUpdates: string;
  scanWorkingCopyStatus: string;
  warningDirtyCount(args: { count: number }): string;
  autoCleanPrompt: string;
  abortedCleanRetry: string;
  workspaceCleaned(args: { reverted: number; removed: number }): string;
  cleanupFailedCount(args: { count: number }): string;
  autoCleanError(args: { error: string }): string;
  rescanWorkingCopyStatus: string;
  workspaceStillDirty: string;
  workspaceCleanOpeningUi: string;
  svnMergeUiTitle: string;
  workspaceNoneReadOnly: string;
  userCanceled: string;
  noRevisionsSelected: string;
  uiFinishedRevisions(args: { count: number; revisions: string }): string;
}

export const I18N_MESSAGES: Record<AppLang, I18nMessages> = {
  en: {
    encodingFallbackWarning: 'Detected non-UTF8 console encoding on Windows. To avoid garbled Chinese text, CLI output falls back to English. You can set SVN_MERGE_LANG=en explicitly.',
    mergedRevisionsHeader: ({ revisions, branch }) => `Merged revision(s) ${revisions} from ${branch}:`,
    fetchingRevisionLogs: '  Fetching revision logs...\r',
    noLogMessageForRevision: ({ revision }) => `(no log message for r${revision})`,
    svnUpdateWorkingCopy: 'Updating working copy... ',
    svnUpdateFailed: ({ error }) => `svn update failed:\n${error}`,
    svnUpdateTitle: 'SVN Update',
    mergingRevisionCount: ({ count }) => `Merging ${count} revision(s)`,
    summaryTitle: 'Summary',
    revisionFailed: ({ revision, error }) => `  r${revision}  FAILED  ${error}`,
    treeConflictsTitle: 'Tree Conflicts',
    textConflictsTitle: 'Text Conflicts',
    propertyConflictsTitle: 'Property Conflicts',
    ignoredCountLabel: ({ active, ignored }) => `${active} + ${ignored} ignored`,
    revertedIgnoredTitle: ({ count }) => `  Reverted (${count} Ignored):`,
    revertedEntry: ({ kindTag, rel }) => `    ${kindTag}  ${rel}  (reverted)`,
    incomingTreeConflictsNotice: ({ count }) => `  Notice: ${count} non-ignored tree conflict(s) accepted incoming changes from source branch (theirs-full).`,
    incomingTreeConflictEntry: ({ rel }) => `    [TREE][INCOMING]  ${rel}`,
    summaryTotal: ({ total }) => `Total: ${total}`,
    summaryOk: ({ count }) => `OK: ${count}`,
    summaryConflicts: ({ count }) => `Conflicts: ${count}`,
    summaryFailed: ({ count }) => `Failed: ${count}`,
    mergeMessageTitle: 'Merge Message',
    mergeMessageCopied: 'Merge message copied to clipboard.',
    autoCommitTitle: 'Auto-commit',
    failedRevisionsReason: ({ count, revisions }) => `${count} revision(s) failed (${revisions})`,
    unresolvedConflictsReason: ({ revisions }) => `unresolved conflicts (${revisions})`,
    autoCommitSkipped: ({ reasons }) => `Auto-commit skipped: ${reasons}.`,
    autoCommitSkippedNoSuccess: 'Auto-commit skipped: no revisions were successfully merged.',
    autoCommitSuccessful: 'Auto-commit successful.',
    autoCommitFailed: ({ error }) => `Auto-commit failed: ${error}`,
    updateAvailable: ({ currentVersion, latestVersion }) => `\nUpdate available: v${currentVersion} → v${latestVersion}`,
    runNpmInstallNow: ({ packageName }) => `Run "npm install -g ${packageName}" now? [y/N] `,
    runningNpmInstall: ({ packageName }) => `\nRunning: npm install -g ${packageName} ...`,
    updateSuccessfulRestart: '\nUpdate successful! Please restart the command.\n',
    updateFailedRunManually: ({ packageName }) => `\nUpdate failed. Please run manually:\n  npm install -g ${packageName}\n`,
    workerDirtyError: ({ count }) => `ERROR: Working copy has ${count} uncommitted change(s):`,
    workerCleanRetryError: 'SVN repository must have no modifications or unversioned files. Please clean up and try again.',
    workerPrepareMergeTitle: 'Prepare Merge',
    workerPrepareMergeCheckingWorkspace: 'Checking working copy status...',
    workerPrepareMergeCreateLog: 'Preparing merge log output...',
    workerPrepareMergeReady: 'Preparation complete.',
    workerWorkspace: ({ workspace }) => `Workspace: ${workspace}`,
    workerFrom: ({ fromUrl }) => `From: ${fromUrl}`,
    workerRevisions: ({ revisions }) => `Revisions: ${revisions}`,
    workerWorkingCopyClean: 'Working copy is clean.',
    workerGenericError: ({ error }) => `ERROR: ${error}`,
    workerCancelMergeTitle: 'Cancel Merge',
    workerCancelMergeRequested: 'Cancellation requested. Stopping active merge worker...',
    workerCancelMergeNoActiveTask: 'No active merge task was running.',
    workerCancelMergeTerminated: 'Active merge worker stopped.',
    workerCleanupWorkspaceTitle: 'Clean Workspace',
    workerCleanupWorkspaceStarting: 'Cleaning workspace to a no-modifications state...',
    workerCleanupWorkspaceResult: ({ reverted, removed }) => `Cleanup result: reverted ${reverted}, removed ${removed}.`,
    workerCleanupWorkspaceFailed: ({ count }) => `Cleanup failed for ${count} path(s):`,
    workerCleanupWorkspaceStillDirty: ({ count }) => `Workspace is still dirty after cleanup (${count} remaining path(s)).`,
    workerCleanupWorkspaceDone: 'Workspace is clean again.',
    workerCleanupWorkspaceError: ({ error }) => `Cleanup failed: ${error}`,
    startupStepRunning: ({ label }) => `[Startup] ${label}...`,
    startupStepDone: ({ label, elapsedMs }) => `[Startup] ${label} done (${elapsedMs} ms)`,
    startupStepFailed: ({ label, elapsedMs }) => `[Startup] ${label} failed (${elapsedMs} ms)`,
    uiUsage: `Usage: svnmerge ui [options]

Options:
  -f, --from <url>          Source branch URL (required unless found in config)
  -w, --workspace <path>    SVN working copy (required for actual merge)
  -c, --config <path>       YAML config file
  -r, --revisions <list>    Revisions/ranges, e.g. 1001,1002-1005
  -i, --ignore <paths>      Comma-separated paths to ignore
  -o, --output <path>       Output directory for log file
  -V, --verbose             Show ignored/reverted details
  -C, --commit              Auto-commit after successful merge
      --copy-to-clipboard   Force enable merge-message clipboard copy
      --no-copy-to-clipboard Force disable merge-message clipboard copy
  -h, --help                Show this help
`,
    unknownOptionHelp: 'Use --help to see supported options.',
    fromRequired: 'Error: --from <url> is required (or set via config file).',
    uiUsageShort: 'Usage: svnmerge ui -f <branch-url> [-w <workspace>]',
    loadUserConfig: 'Load user config',
    checkForUpdates: 'Check for updates',
    scanWorkingCopyStatus: 'Scan working copy status (svn status)',
    warningDirtyCount: ({ count }) => `Warning: SVN working copy has ${count} uncommitted change(s):`,
    autoCleanPrompt: 'Auto-clean workspace now? This will revert local changes and delete unversioned files. [y/N] ',
    abortedCleanRetry: 'Aborted. Please clean the workspace and retry.',
    workspaceCleaned: ({ reverted, removed }) => `Workspace cleaned: reverted ${reverted}, removed ${removed}.`,
    cleanupFailedCount: ({ count }) => `Cleanup failed for ${count} path(s):`,
    autoCleanError: ({ error }) => `Error during auto-clean: ${error}`,
    rescanWorkingCopyStatus: 'Re-scan working copy status (svn status)',
    workspaceStillDirty: 'Workspace is still dirty after auto-clean. Remaining paths:',
    workspaceCleanOpeningUi: 'Workspace is clean. Opening UI merge mode...',
    svnMergeUiTitle: 'SVN Merge UI',
    workspaceNoneReadOnly: '  workspace : (none, read-only mode)',
    userCanceled: 'User canceled.',
    noRevisionsSelected: 'No revisions selected.',
    uiFinishedRevisions: ({ count, revisions }) => `\nUI finished for ${count} revision(s): ${revisions}`,
  },
  'zh-CN': {
    encodingFallbackWarning: 'Detected non-UTF8 console encoding on Windows. To avoid garbled Chinese text, CLI output falls back to English. You can set SVN_MERGE_LANG=en explicitly.',
    mergedRevisionsHeader: ({ revisions, branch }) => `从 ${branch} 合并修订 ${revisions}：`,
    fetchingRevisionLogs: '  正在获取修订日志...\r',
    noLogMessageForRevision: ({ revision }) => `（r${revision} 无日志消息）`,
    svnUpdateWorkingCopy: '正在更新工作副本... ',
    svnUpdateFailed: ({ error }) => `svn update 失败：\n${error}`,
    svnUpdateTitle: 'SVN 更新',
    mergingRevisionCount: ({ count }) => `正在合并 ${count} 个修订`,
    summaryTitle: '汇总',
    revisionFailed: ({ revision, error }) => `  r${revision}  失败  ${error}`,
    treeConflictsTitle: '树冲突',
    textConflictsTitle: '文本冲突',
    propertyConflictsTitle: '属性冲突',
    ignoredCountLabel: ({ active, ignored }) => `${active} + ${ignored} 已忽略`,
    revertedIgnoredTitle: ({ count }) => `  已回退（${count} 个已忽略）：`,
    revertedEntry: ({ kindTag, rel }) => `    ${kindTag}  ${rel}  （已回退）`,
    incomingTreeConflictsNotice: ({ count }) => `  提示：${count} 个非忽略树冲突已接受来源分支改动（theirs-full）。`,
    incomingTreeConflictEntry: ({ rel }) => `    [树冲突][接受来源]  ${rel}`,
    summaryTotal: ({ total }) => `总计: ${total}`,
    summaryOk: ({ count }) => `成功: ${count}`,
    summaryConflicts: ({ count }) => `冲突: ${count}`,
    summaryFailed: ({ count }) => `失败: ${count}`,
    mergeMessageTitle: '合并信息',
    mergeMessageCopied: '合并信息已复制到剪贴板。',
    autoCommitTitle: '自动提交',
    failedRevisionsReason: ({ count, revisions }) => `${count} 个修订失败（${revisions}）`,
    unresolvedConflictsReason: ({ revisions }) => `存在未解决冲突（${revisions}）`,
    autoCommitSkipped: ({ reasons }) => `自动提交已跳过：${reasons}。`,
    autoCommitSkippedNoSuccess: '自动提交已跳过：没有成功合并的修订。',
    autoCommitSuccessful: '自动提交成功。',
    autoCommitFailed: ({ error }) => `自动提交失败：${error}`,
    updateAvailable: ({ currentVersion, latestVersion }) => `\n发现新版本：v${currentVersion} → v${latestVersion}`,
    runNpmInstallNow: ({ packageName }) => `是否现在执行 "npm install -g ${packageName}"？[y/N] `,
    runningNpmInstall: ({ packageName }) => `\n正在执行：npm install -g ${packageName} ...`,
    updateSuccessfulRestart: '\n更新成功！请重新执行命令。\n',
    updateFailedRunManually: ({ packageName }) => `\n更新失败。请手动执行：\n  npm install -g ${packageName}\n`,
    workerDirtyError: ({ count }) => `错误：工作副本存在 ${count} 项未提交变更：`,
    workerCleanRetryError: 'SVN 工作副本必须无修改且无未入库文件。请先清理后重试。',
    workerPrepareMergeTitle: '准备合并',
    workerPrepareMergeCheckingWorkspace: '正在检查工作副本状态...',
    workerPrepareMergeCreateLog: '正在准备合并日志输出...',
    workerPrepareMergeReady: '准备完成。',
    workerWorkspace: ({ workspace }) => `工作目录: ${workspace}`,
    workerFrom: ({ fromUrl }) => `来源: ${fromUrl}`,
    workerRevisions: ({ revisions }) => `修订: ${revisions}`,
    workerWorkingCopyClean: '工作副本干净。',
    workerGenericError: ({ error }) => `错误：${error}`,
    workerCancelMergeTitle: '取消合并',
    workerCancelMergeRequested: '已请求取消，正在停止当前合并任务...',
    workerCancelMergeNoActiveTask: '当前没有正在执行的合并任务。',
    workerCancelMergeTerminated: '当前合并任务已停止。',
    workerCleanupWorkspaceTitle: '清理工作副本',
    workerCleanupWorkspaceStarting: '正在清理工作副本到无修改状态...',
    workerCleanupWorkspaceResult: ({ reverted, removed }) => `清理结果：已回滚 ${reverted}，已删除 ${removed}。`,
    workerCleanupWorkspaceFailed: ({ count }) => `清理失败，共 ${count} 个路径：`,
    workerCleanupWorkspaceStillDirty: ({ count }) => `清理后工作副本仍有修改（剩余 ${count} 个路径）。`,
    workerCleanupWorkspaceDone: '工作副本已恢复为干净状态。',
    workerCleanupWorkspaceError: ({ error }) => `清理失败：${error}`,
    startupStepRunning: ({ label }) => `[启动] ${label}...`,
    startupStepDone: ({ label, elapsedMs }) => `[启动] ${label} 完成（${elapsedMs} ms）`,
    startupStepFailed: ({ label, elapsedMs }) => `[启动] ${label} 失败（${elapsedMs} ms）`,
    uiUsage: `用法: svnmerge ui [选项]

选项:
  -f, --from <url>          来源分支 URL（若配置文件未提供则必填）
  -w, --workspace <path>    SVN 工作副本路径（执行合并时必填）
  -c, --config <path>       YAML 配置文件
  -r, --revisions <list>    修订或范围，例如 1001,1002-1005
  -i, --ignore <paths>      逗号分隔的忽略路径
  -o, --output <path>       日志输出目录
  -V, --verbose             显示 ignored/reverted 详情
  -C, --commit              合并成功后自动提交
      --copy-to-clipboard   强制开启复制合并消息到剪贴板
      --no-copy-to-clipboard 强制关闭复制合并消息到剪贴板
  -h, --help                显示帮助
`,
    unknownOptionHelp: '使用 --help 查看支持的选项。',
    fromRequired: '错误：必须提供 --from <url>（或在配置文件中设置）。',
    uiUsageShort: '用法: svnmerge ui -f <branch-url> [-w <workspace>]',
    loadUserConfig: '加载用户配置',
    checkForUpdates: '检查更新',
    scanWorkingCopyStatus: '扫描工作副本状态 (svn status)',
    warningDirtyCount: ({ count }) => `警告：SVN 工作副本存在 ${count} 项未提交变更：`,
    autoCleanPrompt: '是否立即自动清理工作副本？将回滚本地改动并删除未入库文件。[y/N] ',
    abortedCleanRetry: '已取消。请先清理工作副本后重试。',
    workspaceCleaned: ({ reverted, removed }) => `工作副本已清理：已回滚 ${reverted}，已删除 ${removed}。`,
    cleanupFailedCount: ({ count }) => `清理失败，共 ${count} 个路径：`,
    autoCleanError: ({ error }) => `自动清理出错：${error}`,
    rescanWorkingCopyStatus: '重新扫描工作副本状态 (svn status)',
    workspaceStillDirty: '自动清理后工作副本仍不干净，剩余路径：',
    workspaceCleanOpeningUi: '工作副本已干净，正在打开 UI 合并模式...',
    svnMergeUiTitle: 'SVN 合并 UI',
    workspaceNoneReadOnly: '  workspace : （无，只读模式）',
    userCanceled: '用户已取消。',
    noRevisionsSelected: '未选择修订。',
    uiFinishedRevisions: ({ count, revisions }) => `\nUI 已完成，共 ${count} 个修订：${revisions}`,
  },
};
