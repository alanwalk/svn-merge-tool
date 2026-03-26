const __INITIAL_STATE__ = window.__INITIAL_STATE__ || {};
const __INITIAL_RUN_OPTIONS__ = window.__INITIAL_RUN_OPTIONS__ || {};
// -- State ---------------------------------------------------------------
let _confirmed = false;       // true after Confirm - suppresses beforeunload cancel
let allEntries = [];          // LogEntry[]
let eligibleSet = new Set();  // Set<number>
let hasMore = false;
let canMerge = false;
let selectedRevs = new Set(); // Set<number>
let lastClickedIdx = -1;      // for Shift+Click range selection
let expandedRevs = new Set(); // Set<number> - expanded detail rows
let revToRowMap = new Map();  // rev -> tr element, for fast selection updates
let activeSearchTerm = '';    // current filter term (updated in real-time)
let searchDebounceTimer = null;
let visibleEntriesCache = [];
let filterTaskToken = 0;
let runOptionsExpanded = false;
let autoLoadingRecent = false;
let stopAutoLoadRecent = false;
let autoLoadRecentPromise = null;
let activeMergeAbortController = null;
let mergeRunFinished = false;
let mergeCleanupFinished = false;
let mergeFinalized = false;
let currentUiMode = 'list';
const RECENT_LOAD_PAGES_PER_REQUEST = 5;
const MESSAGE_PREVIEW_MAX_CHARS = 42;
let runOptions = {
    ignorePaths: [],
    verbose: false,
    autoCommit: false,
    outputDir: '',
    copyToClipboard: true,
    preselectedRevisions: [],
};
const workspacePathForSummary = (function () {
    var el = document.querySelector('#workspace-row .info-value');
    if (!el) return '';
    return (el.getAttribute('title') || el.textContent || '').trim();
})();
const MERGE_VIEW_TEMPLATE_HTML = (function () {
    var tpl = document.getElementById('merge-view-template');
    if (!tpl) return '';
    return tpl.innerHTML || '';
})();

const I18N = {
    'zh-CN': {
        language: '语言',
        from: '来源:',
        workspace: '工作目录:',
        logRange: '日志范围:',
        logRangeSinceCreation: 'HEAD -> r{rev}（自分支创建起）',
        advancedOptions: '高级选项',
        autoCommitAfterMerge: '合并后自动提交',
        verboseConflictDetails: '显示冲突详细信息',
        copyMergeMessage: '复制合并消息到剪贴板',
        outputDirectory: '输出目录:',
        outputPlaceholder: '默认: workspace/.svnmerge',
        ignorePaths: '忽略路径（逗号分隔）:',
        ignorePlaceholder: '例如: src/gen,assets/auto',
        safetyReady: '准备就绪。开始前请确认选中的 revisions。',
        safetyWorkspaceMissing: '缺少工作目录：执行合并需要 -w 指定 working copy。',
        safetyAutoCommit: '已启用自动提交。请仔细检查选中的 revisions 和提交信息。',
        searchPlaceholder: '按日志消息、变更路径、作者、Revision 过滤...',
        searchPlaceholderEmpty: '请先选择至少一个搜索规则...',
        filterOptions: '过滤选项',
        messages: '日志消息',
        paths: '变更路径',
        authors: '作者',
        revisions: 'Revision',
        useRegex: '使用正则表达式',
        caseSensitive: '区分大小写',
        hideMerged: '隐藏已合并 revisions',
        refresh: '刷新',
        toggleAllEligibleVisible: '切换所有可选可见项',
        revision: 'Revision',
        author: '作者',
        date: '日期',
        logMessage: '日志消息',
        noResults: '没有匹配当前过滤条件的 revisions。',
        loading: '加载中...',
        loaded: '已加载: {count}{suffix}',
        loadedMoreSuffix: '（还有更多...）',
        loadedAllSuffix: '（全部）',
        showAll: '显示全部',
        allLoaded: '已全部加载',
        loadingBtn: '加载中...',
        selected: '已选择: {count}',
        start: '开始',
        startStarting: '启动中...',
        statusShowing: '显示 {visible}',
        statusLoadedPart: ' / {loaded} 已加载',
        statusEligible: '{count} 可选',
        statusMerged: '{count} 已合并',
        loadingRecentEntries: '正在加载近期提交...',
        loadingAllEntries: '正在加载全部提交...',
        connectingToServer: '正在连接服务器...',
        parsingResponse: '正在解析响应...',
        searchingPct: '搜索中... {pct}%',
        invalidRegex: '无效正则表达式: {msg}',
        pleaseSelectOne: '请至少选择一个可合并 revision。',
        invalidRunOptions: '运行参数无效: {msg}',
        workspaceNotConfigured: '未配置工作目录。请使用 -w <workspace> 重新启动。',
        canceling: '取消中...',
        alreadyMerged: '已合并',
        toggleDetail: '切换详情',
        changedPaths: '变更路径 ({count}):',
        noMessage: '(无消息)',
        noMessageShort: '(无消息)',
        revisionPrefix: 'r',
        mergeTitle: 'SVN 合并',
        pendingStatus: '待执行 — {count} 个 revision 待合并',
        commitsToMerge: '待合并提交 ({count})',
        mergedFromSourceBranch: '{revs} 从来源分支合并',
        continue: '继续',
        cancel: '取消',
        back: '返回',
        running: '执行中...',
        cancelMerge: '取消合并',
        confirmCancelMergeTitle: '确认取消合并',
        confirmCancelMergeText: '确定要取消当前合并吗？这会中断当前任务，并清理工作副本到无修改状态。',
        confirmAction: '确定',
        mergeCanceledClean: '已取消合并，工作副本已清理完成。',
        mergeCanceledDirty: '取消完成，但工作副本尚未完全清理，请查看上方阶段日志。',
        workspaceDirtyTitle: '工作副本清理',
        workspaceDirtyStatus: '当前工作副本存在未提交或未入库文件，清理后才能继续。',
        workspaceDirtySectionTitle: '检测到工作副本有变更',
        workspaceDirtyPrompt: '请先清理以下文件，再继续后续操作。',
        cleanWorkspaceNow: '立即清理',
        closePage: '关闭',
        continueToLog: '继续',
        workspaceCleanReady: '工作副本已清理完成，可以继续进入日志选择。',
        cleanupRunning: '正在清理工作副本...',
        cleanupStartingHint: '正在启动清理流程，请稍候。',
        doneNoCommit: '完成（不提交）',
        commit: '提交',
        committing: '提交中...',
        doneCloseTab: '完成。可关闭此页面。',
        committedCloseTab: '已提交。可关闭此页面。',
        commitFailed: '提交失败: {err}',
        autoCommitSucceeded: '自动提交成功。',
        logPrefix: '日志: {path}',
        failedToStartMerge: '启动合并失败: HTTP {code}',
        errorPrefix: '错误: {msg}',
        completeFailed: '完成 — {count} 个 revision 失败',
        completeConflicts: '完成 — {count} 个 revision 有冲突（已自动处理）',
        completeAllClean: '完成 — 全部 {count} 个 revision 合并成功',
        autoCommitEnabledHint: '已启用自动提交。合并后将禁用手动提交按钮。',
        commitMessageTitle: 'SVN 提交信息',
        mergeSummaryTitle: '合并摘要:',
        okCount: '成功: {count}',
        conflictsCount: '冲突: {count}',
        failedCount: '失败: {count}',
        totalCount: '总计: {count}',
        treeConflicts: '树冲突',
        textConflicts: '文本冲突',
        propertyConflicts: '属性冲突',
        revertedIgnored: '已回退（{count} 个已忽略）',
        revertedTag: '已回退',
        failedTag: '失败',
        ignoredTag: '已忽略',
        calculating: '计算中…',
        noConflictsOrFailures: '无冲突或失败。',
        jsErrorAt: 'JS 错误: {msg} ({file}:{line})',
        initError: '初始化错误: {msg}',
        renderError: '渲染错误: {msg}',
        loadedEntriesError: '错误。已加载条目: {count}',
    },
    en: {
        language: 'Language',
        from: 'From:',
        workspace: 'Workspace:',
        logRange: 'Log range:',
        logRangeSinceCreation: 'HEAD -> r{rev} (since branch creation)',
        advancedOptions: 'Advanced Options',
        autoCommitAfterMerge: 'Auto commit after merge',
        verboseConflictDetails: 'Verbose conflict details',
        copyMergeMessage: 'Copy merge message to clipboard',
        outputDirectory: 'Output directory:',
        outputPlaceholder: 'Default: workspace/.svnmerge',
        ignorePaths: 'Ignore paths (comma-separated):',
        ignorePlaceholder: 'e.g. src/gen,assets/auto',
        safetyReady: 'Ready to merge. Review selected revisions before proceeding.',
        safetyWorkspaceMissing: 'Workspace missing: a working copy is required for merge. Relaunch with -w.',
        safetyAutoCommit: 'Auto-commit is enabled. Please verify selected revisions and commit message carefully.',
        searchPlaceholder: 'Filter by Messages, Paths, Authors, Revisions...',
        searchPlaceholderEmpty: 'Select at least one search rule...',
        filterOptions: 'Filter options',
        messages: 'Messages',
        paths: 'Paths',
        authors: 'Authors',
        revisions: 'Revisions',
        useRegex: 'Use regular expression',
        caseSensitive: 'Case-sensitive',
        hideMerged: 'Hide merged revisions',
        refresh: 'Refresh',
        toggleAllEligibleVisible: 'Toggle all eligible visible',
        revision: 'Revision',
        author: 'Author',
        date: 'Date',
        logMessage: 'Log Message',
        noResults: 'No revisions match the current filter.',
        loading: 'Loading...',
        loaded: 'Loaded: {count}{suffix}',
        loadedMoreSuffix: ' (and more...)',
        loadedAllSuffix: ' (all)',
        showAll: 'Show All',
        allLoaded: 'All Loaded',
        loadingBtn: 'Loading...',
        selected: 'Selected: {count}',
        start: 'Start',
        startStarting: 'Starting...',
        statusShowing: 'Showing {visible}',
        statusLoadedPart: ' / {loaded} loaded',
        statusEligible: '{count} eligible',
        statusMerged: '{count} merged',
        loadingRecentEntries: 'Loading recent entries...',
        loadingAllEntries: 'Loading all entries...',
        connectingToServer: 'Connecting to server...',
        parsingResponse: 'Parsing response...',
        searchingPct: 'Searching... {pct}%',
        invalidRegex: 'Invalid regular expression: {msg}',
        pleaseSelectOne: 'Please select at least one eligible revision.',
        invalidRunOptions: 'Invalid run options: {msg}',
        workspaceNotConfigured: 'Workspace is not configured. Relaunch with -w <workspace>.',
        canceling: 'Cancelling...',
        alreadyMerged: 'Already merged',
        toggleDetail: 'Toggle detail',
        changedPaths: 'Changed paths ({count}):',
        noMessage: '(no message)',
        noMessageShort: '(no message)',
        revisionPrefix: 'r',
        mergeTitle: 'SVN Merge',
        pendingStatus: 'Pending — {count} revision(s) to merge',
        commitsToMerge: 'Commits to merge ({count})',
        mergedFromSourceBranch: '{revs} merged from source branch',
        continue: 'Continue',
        cancel: 'Cancel',
        back: 'Back',
        running: 'Running...',
        cancelMerge: 'Cancel Merge',
        confirmCancelMergeTitle: 'Confirm Cancel Merge',
        confirmCancelMergeText: 'Are you sure you want to cancel the current merge? This will stop the task and clean the workspace back to a no-modifications state.',
        confirmAction: 'Confirm',
        mergeCanceledClean: 'Merge canceled and workspace cleanup finished.',
        mergeCanceledDirty: 'Cancellation finished, but workspace cleanup still needs attention. Check the pipeline above.',
        workspaceDirtyTitle: 'Workspace Cleanup',
        workspaceDirtyStatus: 'This workspace has local or unversioned changes. Clean it before continuing.',
        workspaceDirtySectionTitle: 'Detected workspace changes',
        workspaceDirtyPrompt: 'Clean the following paths before proceeding.',
        cleanWorkspaceNow: 'Clean Now',
        closePage: 'Close',
        continueToLog: 'Continue',
        workspaceCleanReady: 'Workspace cleanup finished. You can continue to the log selection view.',
        cleanupRunning: 'Cleaning workspace...',
        cleanupStartingHint: 'Starting cleanup pipeline, please wait.',
        doneNoCommit: 'Done (no commit)',
        commit: 'Commit',
        committing: 'Committing...',
        doneCloseTab: 'Done. You can close this tab.',
        committedCloseTab: 'Committed. You can close this tab.',
        commitFailed: 'Commit failed: {err}',
        autoCommitSucceeded: 'Auto-commit succeeded.',
        logPrefix: 'Log: {path}',
        failedToStartMerge: 'Failed to start merge: HTTP {code}',
        errorPrefix: 'Error: {msg}',
        completeFailed: 'Complete — {count} revision(s) FAILED',
        completeConflicts: 'Complete — {count} revision(s) with conflicts (auto-resolved)',
        completeAllClean: 'Complete — all {count} revision(s) merged cleanly',
        autoCommitEnabledHint: 'Auto-commit is enabled. Manual commit button will be disabled after merge.',
        commitMessageTitle: 'SVN Commit Message',
        mergeSummaryTitle: 'Merge Summary:',
        okCount: 'OK: {count}',
        conflictsCount: 'Conflicts: {count}',
        failedCount: 'Failed: {count}',
        totalCount: 'Total: {count}',
        treeConflicts: 'Tree Conflicts',
        textConflicts: 'Text Conflicts',
        propertyConflicts: 'Property Conflicts',
        revertedIgnored: 'Reverted ({count} Ignored)',
        revertedTag: 'reverted',
        failedTag: 'FAILED',
        ignoredTag: 'ignored',
        calculating: 'Calculating…',
        noConflictsOrFailures: 'No conflicts or failures.',
        jsErrorAt: 'JS Error: {msg} ({file}:{line})',
        initError: 'Init error: {msg}',
        renderError: 'Render error: {msg}',
        loadedEntriesError: 'Error. Loaded entries: {count}',
    }
};

let currentLang = 'en';

function normalizeLang(lang) {
    const s = String(lang || '').toLowerCase();
    return s.startsWith('zh') ? 'zh-CN' : 'en';
}

function getPreferredLanguage() {
    try {
        const saved = localStorage.getItem('svn-log-lang');
        if (saved && I18N[saved]) return saved;
    } catch (_) { }
    return normalizeLang(navigator.language || 'en');
}

function t(key, params) {
    const dict = I18N[currentLang] || I18N.en;
    let text = (dict[key] != null ? dict[key] : I18N.en[key]) || key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (_, k) {
        return params[k] != null ? String(params[k]) : '';
    });
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function getSelectedSearchLabels(opts) {
    const labels = [];
    if (opts.messages) labels.push(t('messages'));
    if (opts.paths) labels.push(t('paths'));
    if (opts.authors) labels.push(t('authors'));
    if (opts.revisions) labels.push(t('revisions'));
    return labels;
}

function buildSearchPlaceholder(opts) {
    const labels = getSelectedSearchLabels(opts);
    if (labels.length === 0) return t('searchPlaceholderEmpty');
    if (currentLang === 'zh-CN') {
        return '按' + labels.join('、') + '过滤...';
    }
    return 'Filter by ' + labels.join(', ') + '...';
}

function updateSearchPlaceholder() {
    const searchInputEl = document.getElementById('search-input');
    if (searchInputEl) searchInputEl.placeholder = buildSearchPlaceholder(getFilterOptions());
}

function applyLanguage() {
    document.documentElement.lang = currentLang;
    setText('lang-label', t('language'));
    setText('label-from', t('from'));
    setText('label-workspace', t('workspace'));
    setText('label-log-range', t('logRange'));
    setText('run-options-toggle-text', t('advancedOptions'));
    setText('label-opt-auto-commit', t('autoCommitAfterMerge'));
    setText('label-opt-verbose', t('verboseConflictDetails'));
    setText('label-opt-copy', t('copyMergeMessage'));
    setText('label-opt-output', t('outputDirectory'));
    setText('label-opt-ignore', t('ignorePaths'));
    setText('label-f-messages', t('messages'));
    setText('label-f-paths', t('paths'));
    setText('label-f-authors', t('authors'));
    setText('label-f-revisions', t('revisions'));
    setText('label-f-regex', t('useRegex'));
    setText('label-f-case', t('caseSensitive'));
    setText('label-hide-merged', t('hideMerged'));
    setText('refresh-btn-text', t('refresh'));
    setText('th-revision', t('revision'));
    setText('th-author', t('author'));
    setText('th-date', t('date'));
    setText('th-message', t('logMessage'));
    setText('no-results', t('noResults'));
    setText('confirm-btn', t('start'));
    setText('mv-title', t('mergeTitle'));
    setText('mv-overlay-title', t('commitMessageTitle'));
    setText('mv-cancel-overlay-title', t('confirmCancelMergeTitle'));
    setText('mv-cancel-overlay-text', t('confirmCancelMergeText'));

    updateSearchPlaceholder();
    const optOutputEl = document.getElementById('opt-output');
    if (optOutputEl) optOutputEl.placeholder = t('outputPlaceholder');
    const optIgnoreEl = document.getElementById('opt-ignore');
    if (optIgnoreEl) optIgnoreEl.placeholder = t('ignorePlaceholder');
    const searchBtn = document.getElementById('search-icon-btn');
    if (searchBtn) searchBtn.title = t('filterOptions');
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.title = t('refresh');
    const headerCb = document.getElementById('header-cb');
    if (headerCb) headerCb.title = t('toggleAllEligibleVisible');

    if (__INITIAL_STATE__.stopRev > 1) {
        const stopRevInfo = document.getElementById('stop-rev-info');
        if (stopRevInfo) stopRevInfo.textContent = t('logRangeSinceCreation', { rev: __INITIAL_STATE__.stopRev });
    }

    updateSafetyTip();
    updateLoadedInfo();
    updateStatusBar(getVisibleEntries());
}

function setLanguage(lang, persist) {
    currentLang = I18N[lang] ? lang : normalizeLang(lang);
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = currentLang;
    if (persist !== false) {
        try { localStorage.setItem('svn-log-lang', currentLang); } catch (_) { }
    }
    applyLanguage();
    renderTable();
}

// -- Init ----------------------------------------------------------------
window.addEventListener('error', function (e) {
    try {
        document.getElementById('status-info').textContent = t('jsErrorAt', {
            msg: e.message,
            file: e.filename || '',
            line: e.lineno || ''
        });
    } catch (_) { }
    console.error('[svn-log] window error:', e.message);
});

function init() {
    try {
        currentLang = getPreferredLanguage();
        var langSelect = document.getElementById('lang-select');
        if (langSelect) {
            langSelect.value = currentLang;
            langSelect.addEventListener('change', function (e) {
                setLanguage(e.target.value, true);
            });
        }
        runOptions = Object.assign({}, runOptions, __INITIAL_RUN_OPTIONS__ || {});
        setRunOptionsExpanded(false);
        applyRunOptionsToUI();
        applyLanguage();
        applyServerState(__INITIAL_STATE__);
        if (Array.isArray(__INITIAL_STATE__.dirtyWorkspaceLines) && __INITIAL_STATE__.dirtyWorkspaceLines.length > 0) {
            showDirtyWorkspaceGate(__INITIAL_STATE__.dirtyWorkspaceLines);
            return;
        }
        setUiMode('list');
        if (__INITIAL_STATE__.stopRev > 1) {
            document.getElementById('stop-rev-row').style.display = '';
            document.getElementById('stop-rev-info').textContent =
                t('logRangeSinceCreation', { rev: __INITIAL_STATE__.stopRev });
        }
        if (Array.isArray(runOptions.preselectedRevisions) && runOptions.preselectedRevisions.length > 0) {
            preselectRevisions(runOptions.preselectedRevisions);
        }
        autoLoadRecentPromise = loadRecentEntriesIncremental();
    } catch (err) {
        try { document.getElementById('status-info').textContent = t('initError', { msg: (err && err.message ? err.message : String(err)) }); } catch (_) { }
        console.error('[svn-log] init error:', err);
    }
}

function waitTick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function getRecentCutoffIso(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString();
}

async function loadRecentEntriesIncremental() {
    if (autoLoadingRecent) return;
    autoLoadingRecent = true;
    stopAutoLoadRecent = false;
    const cutoffIso = getRecentCutoffIso(3);

    try {
        while (hasMore && !stopAutoLoadRecent) {
            const oldest = allEntries.length > 0 ? allEntries[allEntries.length - 1] : null;
            if (oldest && oldest.date && oldest.date < cutoffIso) break;

            setLoadingProgress(true, t('loadingRecentEntries'), -1);
            const res = await fetch('/api/loadMore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pages: RECENT_LOAD_PAGES_PER_REQUEST })
            });
            if (!res.ok) break;
            const data = await res.json();
            applyServerState(data);

            // Yield between pages so UI remains responsive while streaming rows.
            await waitTick();
        }
    } catch (e) {
        console.error('[svn-log] incremental recent-load failed:', e);
    } finally {
        autoLoadingRecent = false;
        if (!stopAutoLoadRecent) {
            setLoadingProgress(false);
        }
    }
}

function setRunOptionsExpanded(expanded) {
    runOptionsExpanded = !!expanded;
    var wrap = document.getElementById('run-options');
    var content = document.getElementById('run-options-content');
    var toggle = document.getElementById('run-options-toggle');
    if (!wrap || !content || !toggle) return;

    wrap.classList.toggle('collapsed', !runOptionsExpanded);
    content.classList.toggle('collapsed', !runOptionsExpanded);
    toggle.setAttribute('aria-expanded', runOptionsExpanded ? 'true' : 'false');
    content.setAttribute('aria-hidden', runOptionsExpanded ? 'false' : 'true');
}
init();

// -- Heartbeat & lifecycle ------------------------------------------------
window.addEventListener('beforeunload', function () {
    if (!_confirmed) { navigator.sendBeacon('/api/cancel'); }
});
setInterval(function () {
    fetch('/api/ping', { method: 'POST' }).catch(function () { });
}, 3000);

// -- API helpers ----------------------------------------------------------
async function fetchState() {
    document.getElementById('loaded-info').textContent = t('connectingToServer');
    const res = await fetch('/api/state');
    document.getElementById('loaded-info').textContent = t('parsingResponse');
    const text = await res.text();
    if (!res.ok) {
        throw new Error('GET /api/state ' + res.status + ': ' + text.slice(0, 200));
    }
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('JSON parse error: ' + e.message + ' - body: ' + text.slice(0, 200));
    }
    applyServerState(data);
}

function setLoadingProgress(show, label, pct) {
    const wrap = document.getElementById('progress-wrap');
    const fill = document.getElementById('progress-fill');
    const lbl = document.getElementById('progress-label');
    if (!show) {
        wrap.style.display = 'none';
        fill.classList.remove('indeterminate');
        fill.style.width = '0%';
        return;
    }
    wrap.style.display = 'flex';
    lbl.textContent = label || '';
    if (pct == null || pct < 0) {
        fill.classList.add('indeterminate');
    } else {
        fill.classList.remove('indeterminate');
        fill.style.width = pct + '%';
    }
}

function applyServerState(data) {
    try {
        allEntries = data.entries || [];
        eligibleSet = new Set(data.eligibleRevisions || []);
        hasMore = !!data.hasMore;
        canMerge = !!data.canMerge;
        if (data.runOptions) {
            runOptions = Object.assign({}, runOptions, data.runOptions);
            applyRunOptionsToUI();
        }
        refreshVisibleEntriesAsync(false);
        updateLoadedInfo();
        updateSafetyTip();
    } catch (err) {
        document.getElementById('status-info').textContent = t('renderError', { msg: (err && err.message ? err.message : String(err)) });
        document.getElementById('loaded-info').textContent = t('loadedEntriesError', { count: (allEntries ? allEntries.length : '?') });
        console.error('[svn-log] applyServerState error:', err);
    }
}

function parseRevisionExpr(input) {
    var text = String(input || '').trim();
    if (!text) return [];
    var out = [];
    var parts = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
        var raw = parts[i];
        var m = raw.match(/^(\d+)-(\d+)$/);
        if (m) {
            var from = parseInt(m[1], 10);
            var to = parseInt(m[2], 10);
            if (from <= 0 || to <= 0 || from > to) {
                throw new Error('Invalid revision range: ' + raw);
            }
            for (var r = from; r <= to; r++) out.push(r);
        } else {
            var n = parseInt(raw, 10);
            if (!n || n <= 0) {
                throw new Error('Invalid revision: ' + raw);
            }
            out.push(n);
        }
    }
    return out;
}

function uniqueSorted(list) {
    return Array.from(new Set(list || [])).sort(function (a, b) { return a - b; });
}

function preselectRevisions(revs) {
    var sorted = uniqueSorted(revs);
    for (var i = 0; i < sorted.length; i++) {
        var rev = sorted[i];
        if (eligibleSet.has(rev)) {
            selectedRevs.add(rev);
        }
    }
    renderTable();
}

function applyRunOptionsToUI() {
    document.getElementById('opt-auto-commit').checked = !!runOptions.autoCommit;
    document.getElementById('opt-verbose').checked = !!runOptions.verbose;
    document.getElementById('opt-copy').checked = !!runOptions.copyToClipboard;
    document.getElementById('opt-output').value = runOptions.outputDir || '';
    document.getElementById('opt-ignore').value = (runOptions.ignorePaths || []).join(',');
}

function collectRunOptionsFromUI() {
    var ignoreRaw = document.getElementById('opt-ignore').value || '';
    var ignorePaths = ignoreRaw
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

    return {
        ignorePaths: ignorePaths,
        verbose: !!document.getElementById('opt-verbose').checked,
        autoCommit: !!document.getElementById('opt-auto-commit').checked,
        outputDir: (document.getElementById('opt-output').value || '').trim(),
        copyToClipboard: !!document.getElementById('opt-copy').checked,
        preselectedRevisions: Array.isArray(runOptions.preselectedRevisions)
            ? runOptions.preselectedRevisions.slice()
            : [],
    };
}

function updateSafetyTip() {
    var tip = document.getElementById('safety-tip');
    if (!tip) return;
    var autoCommitEl = document.getElementById('opt-auto-commit');
    var autoCommit = !!autoCommitEl.checked;
    autoCommitEl.disabled = false;

    if (!canMerge) {
        tip.textContent = t('safetyWorkspaceMissing');
        tip.style.background = '#ffe8e8';
        tip.style.borderColor = '#efb5b5';
        tip.style.color = '#8a1f1f';
        return;
    }
    if (autoCommit) {
        tip.textContent = t('safetyAutoCommit');
        tip.style.background = '#fff6dc';
        tip.style.borderColor = '#f0d27a';
        tip.style.color = '#775d00';
        return;
    }
    tip.textContent = t('safetyReady');
    tip.style.background = '#fff6dc';
    tip.style.borderColor = '#f0d27a';
    tip.style.color = '#775d00';
}

// -- Filter & search ------------------------------------------------------
function getFilterOptions() {
    function isChecked(id) {
        var el = document.getElementById(id);
        return !!(el && el.checked);
    }
    return {
        messages: isChecked('f-messages'),
        paths: isChecked('f-paths'),
        authors: isChecked('f-authors'),
        revisions: isChecked('f-revisions'),
        regex: isChecked('f-regex'),
        caseSensitive: isChecked('f-case'),
    };
}

function getHideMerged() {
    return document.getElementById('hide-merged').checked;
}

function matchesFilter(entry, optsOverride) {
    if (!activeSearchTerm) return true;
    const opts = optsOverride || getFilterOptions();
    const term = activeSearchTerm;
    const fullMessage = String(entry.message || '');
    // If the term looks like a revision expression (e.g. "1001,1002-1005"),
    // apply strict revision filtering so non-matching revisions are hidden.
    if (opts.revisions && !opts.regex && /^[\d,\-\s]+$/.test(term)) {
        try {
            const revs = parseRevisionExpr(term);
            if (revs.length > 0) {
                return revs.includes(entry.revision);
            }
        } catch {
            // fall back to generic text matching below
        }
    }
    let pattern;
    if (opts.regex) {
        try {
            pattern = new RegExp(term, opts.caseSensitive ? '' : 'i');
        } catch {
            return false;
        }
    }
    const test = (str) => {
        if (!str) return false;
        if (opts.regex) return pattern.test(str);
        if (opts.caseSensitive) return str.includes(term);
        return str.toLowerCase().includes(term.toLowerCase());
    };
    if (opts.messages && test(fullMessage)) return true;
    if (opts.authors && test(entry.author)) return true;
    if (opts.revisions && test(String(entry.revision))) return true;
    if (opts.paths && entry.paths && entry.paths.some(p => test(p))) return true;
    return false;
}

function getVisibleEntries() {
    return visibleEntriesCache;
}

async function refreshVisibleEntriesAsync(showProgress) {
    const token = ++filterTaskToken;
    const hideMerged = getHideMerged();
    const opts = getFilterOptions();

    // Fast path: no search and no hide-merged filter.
    if (!activeSearchTerm && !hideMerged) {
        visibleEntriesCache = allEntries.slice();
        renderTable();
        if (showProgress) setLoadingProgress(false);
        return;
    }

    const total = allEntries.length;
    const chunkSize = 300;
    const out = [];

    for (let i = 0; i < total; i += chunkSize) {
        if (token !== filterTaskToken) return;
        const end = Math.min(i + chunkSize, total);
        for (let j = i; j < end; j++) {
            const e = allEntries[j];
            const merged = !eligibleSet.has(e.revision);
            if (hideMerged && merged) continue;
            if (matchesFilter(e, opts)) out.push(e);
        }

        if (showProgress) {
            const pct = Math.floor((end / Math.max(total, 1)) * 100);
            setLoadingProgress(true, t('searchingPct', { pct: pct }), pct);
        }
        await waitTick();
    }

    if (token !== filterTaskToken) return;
    visibleEntriesCache = out;
    renderTable();
    if (showProgress) setLoadingProgress(false);
}

// -- Render table ---------------------------------------------------------
function formatDate(iso) {
    try {
        const d = new Date(iso);
        const pad = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch { return iso; }
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function highlightHtml(str, term, opts) {
    const s = str == null ? '' : String(str);
    if (!term || !s) return escHtml(s);
    let pattern;
    try {
        const flags = opts.caseSensitive ? 'g' : 'gi';
        pattern = opts.regex
            ? new RegExp(term, flags)
            : new RegExp(term.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&'), flags);
    } catch {
        return escHtml(s);
    }
    let result = '';
    let lastIndex = 0;
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(s)) !== null) {
        result += escHtml(s.slice(lastIndex, m.index));
        result += '<mark class="hl">' + escHtml(m[0]) + '</mark>';
        lastIndex = pattern.lastIndex;
        if (m[0].length === 0) { pattern.lastIndex++; if (pattern.lastIndex > s.length) break; }
    }
    result += escHtml(s.slice(lastIndex));
    return result;
}

function matchesText(str, term, opts) {
    const s = str == null ? '' : String(str);
    if (!term || !s) return false;
    if (opts.regex) {
        try {
            const r = new RegExp(term, opts.caseSensitive ? '' : 'i');
            return r.test(s);
        } catch {
            return false;
        }
    }
    if (opts.caseSensitive) return s.includes(term);
    return s.toLowerCase().includes(term.toLowerCase());
}

function buildMessagePreviewHtml(rawMessage, term, opts, enableHighlight, forceMarkerHighlight) {
    const raw = String(rawMessage || '');
    const firstLine = (raw.split('\n')[0] || '').trim() || t('noMessageShort');
    const hasExtraLines = raw.includes('\n');
    const truncatedByLen = firstLine.length > MESSAGE_PREVIEW_MAX_CHARS;
    const visibleText = truncatedByLen ? firstLine.slice(0, MESSAGE_PREVIEW_MAX_CHARS) : firstLine;

    let msgHtml = enableHighlight ? highlightHtml(visibleText, term, opts) : escHtml(visibleText);
    if (hasExtraLines || truncatedByLen) {
        let hiddenTail = '';
        if (truncatedByLen) hiddenTail += firstLine.slice(MESSAGE_PREVIEW_MAX_CHARS);
        if (hasExtraLines) hiddenTail += '\n' + raw.slice(raw.indexOf('\n') + 1);
        const markerMatched = (enableHighlight && matchesText(hiddenTail, term, opts)) || !!forceMarkerHighlight;
        msgHtml += markerMatched ? '<mark class="hl">↩︎...</mark>' : '<span class="msg-trunc-marker">↩︎...</span>';
    }
    return msgHtml;
}

function renderTable() {
    const visible = getVisibleEntries();
    const tbody = document.getElementById('log-body');
    const noResults = document.getElementById('no-results');
    revToRowMap.clear();

    if (visible.length === 0) {
        tbody.innerHTML = '';
        noResults.style.display = '';
        updateStatusBar(visible);
        return;
    }
    noResults.style.display = 'none';

    const frag = document.createDocumentFragment();
    const hlOpts = getFilterOptions();
    const hlTerm = activeSearchTerm;
    const hlMsg = hlTerm && hlOpts.messages;
    const hlPath = hlTerm && hlOpts.paths;
    const hlAuth = hlTerm && hlOpts.authors;
    const hlRev = hlTerm && hlOpts.revisions;

    visible.forEach((entry, visIdx) => {
        const merged = !eligibleSet.has(entry.revision);
        const checked = selectedRevs.has(entry.revision);
        const expanded = expandedRevs.has(entry.revision);

        const tr = document.createElement('tr');
        revToRowMap.set(entry.revision, tr);
        tr.className = 'data-row' + (merged ? ' merged' : '') + (checked ? ' selected' : '');
        tr.dataset.rev = entry.revision;
        tr.dataset.visIdx = visIdx;

        const cbTd = document.createElement('td');
        cbTd.className = 'col-cb';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.disabled = merged;
        cb.title = merged ? t('alreadyMerged') : '';
        cb.addEventListener('click', e => { e.stopPropagation(); onCheckboxClick(entry, visIdx, e); });
        cbTd.appendChild(cb);
        tr.appendChild(cbTd);

        const pathMatched = !!(hlPath && entry.paths && entry.paths.some(p => matchesText(p, hlTerm, hlOpts)));
        const msgPreviewHtml = buildMessagePreviewHtml(entry.message || '', hlTerm, hlOpts, !!hlMsg, pathMatched);
        const revStr = String(entry.revision);
        tr.insertAdjacentHTML('beforeend',
            '<td class="col-rev" title="' + escHtml(t('revisionPrefix')) + escHtml(revStr) + '">' + escHtml(t('revisionPrefix')) + (hlRev ? highlightHtml(revStr, hlTerm, hlOpts) : escHtml(revStr)) + '</td>' +
            '<td title="' + escHtml(entry.author) + '">' + (hlAuth ? highlightHtml(entry.author, hlTerm, hlOpts) : escHtml(entry.author)) + '</td>' +
            '<td title="' + escHtml(formatDate(entry.date)) + '">' + escHtml(formatDate(entry.date)) + '</td>' +
            '<td title="' + escHtml(entry.message) + '">' + msgPreviewHtml + '</td>' +
            '<td class="col-expand"><button class="expand-btn" title="' + escHtml(t('toggleDetail')) + '">' + (expanded ? '▼' : '▶') + '</button></td>'
        );

        const expandBtn = tr.querySelector('.expand-btn');
        expandBtn.addEventListener('click', e => { e.stopPropagation(); toggleExpand(entry.revision); });

        tr.addEventListener('click', e => {
            if (e.target.type === 'checkbox' || e.target.classList.contains('expand-btn')) return;
            if (!eligibleSet.has(entry.revision)) return;
            let changed;
            if (e.shiftKey && lastClickedIdx >= 0) {
                changed = rangeSelect(Math.min(visIdx, lastClickedIdx), Math.max(visIdx, lastClickedIdx), !selectedRevs.has(entry.revision));
            } else {
                toggleSelect(entry.revision);
                changed = [entry.revision];
            }
            lastClickedIdx = visIdx;
            updateSelectionUI(changed);
        });

        tr.addEventListener('dblclick', e => {
            if (e.target.type === 'checkbox' || e.target.classList.contains('expand-btn')) return;
            toggleExpand(entry.revision);
        });

        frag.appendChild(tr);

        const dtr = document.createElement('tr');
        dtr.className = 'detail-row';
        dtr.dataset.detailRev = entry.revision;
        dtr.style.display = expanded ? '' : 'none';
        const dtd = document.createElement('td');
        dtd.colSpan = 6;
        let pathsHtml = '';
        if (entry.paths && entry.paths.length > 0) {
            const highlightedPaths = hlTerm
                ? entry.paths.map(p => '<li>' + highlightHtml(p, hlTerm, hlOpts) + '</li>').join('')
                : entry.paths.map(p => '<li>' + escHtml(p) + '</li>').join('');
            pathsHtml = '<div class="detail-paths"><div class="detail-paths-title">' + t('changedPaths', { count: entry.paths.length }) + '</div>'
                + '<ul class="detail-path-list">'
                + highlightedPaths
                + '</ul></div>';
        }
        const detailMsgHtml = hlTerm
            ? highlightHtml(entry.message || t('noMessage'), hlTerm, hlOpts)
            : escHtml(entry.message || t('noMessage'));
        dtd.innerHTML = '<div class="detail-inner"><div class="detail-msg">' + detailMsgHtml + '</div>' + pathsHtml + '</div>';
        dtr.appendChild(dtd);
        frag.appendChild(dtr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(frag);
    updateStatusBar(visible);
    syncHeaderCheckbox(visible);
}

// Fast-path selection update: only patch affected rows, no full re-render
function updateSelectionUI(changedRevs) {
    for (const rev of changedRevs) {
        const selected = selectedRevs.has(rev);
        const tr = revToRowMap.get(rev);
        if (!tr) continue;
        tr.classList.toggle('selected', selected);
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb) cb.checked = selected;
    }
    const visible = getVisibleEntries();
    updateStatusBar(visible);
    syncHeaderCheckbox(visible);
}

function updateStatusBar(visible) {
    const hideMerged = getHideMerged();
    const eligibleVisible = visible.filter(e => eligibleSet.has(e.revision));
    const mergedVisible = visible.filter(e => !eligibleSet.has(e.revision));
    let info = t('statusShowing', { visible: visible.length });
    if (allEntries.length > 0) info += t('statusLoadedPart', { loaded: allEntries.length });
    const parts = [];
    if (eligibleVisible.length > 0) parts.push(t('statusEligible', { count: eligibleVisible.length }));
    if (!hideMerged && mergedVisible.length > 0) parts.push(t('statusMerged', { count: mergedVisible.length }));
    if (parts.length) info += '  (' + parts.join(', ') + ')';
    document.getElementById('status-info').textContent = info;

    const selCount = selectedRevs.size;
    document.getElementById('selected-info').textContent = t('selected', { count: selCount });
    var blockedByWorkspace = !canMerge;
    document.getElementById('confirm-btn').disabled = selCount === 0 || blockedByWorkspace;
}

function updateLoadedInfo() {
    const el = document.getElementById('loaded-info');
    el.textContent = t('loaded', {
        count: allEntries.length,
        suffix: hasMore ? t('loadedMoreSuffix') : t('loadedAllSuffix')
    });
    const showAllBtn = document.getElementById('show-all-btn');
    showAllBtn.style.display = '';
    if (hasMore) {
        showAllBtn.disabled = false;
        showAllBtn.textContent = t('showAll');
    } else {
        showAllBtn.disabled = true;
        showAllBtn.textContent = t('allLoaded');
    }
}

document.getElementById('show-all-btn').addEventListener('click', async () => {
    const btn = document.getElementById('show-all-btn');
    stopAutoLoadRecent = true;
    if (autoLoadRecentPromise) {
        try { await autoLoadRecentPromise; } catch (_) { }
    }
    btn.disabled = true;
    btn.textContent = t('loadingBtn');
    setLoadingProgress(true, t('loadingAllEntries'), -1);
    try {
        const res = await fetch('/api/loadAll', { method: 'POST' });
        const data = await res.json();
        applyServerState(data);
    } catch (e) {
        btn.disabled = false;
        btn.textContent = t('showAll');
    } finally {
        setLoadingProgress(false);
    }
});

function syncHeaderCheckbox(visible) {
    const eligibleVisible = visible.filter(e => eligibleSet.has(e.revision));
    const allSelected = eligibleVisible.length > 0 && eligibleVisible.every(e => selectedRevs.has(e.revision));
    document.getElementById('header-cb').checked = allSelected;
    document.getElementById('header-cb').indeterminate = !allSelected && eligibleVisible.some(e => selectedRevs.has(e.revision));
}

// -- Selection ------------------------------------------------------------
function onCheckboxClick(entry, visIdx, e) {
    if (!eligibleSet.has(entry.revision)) return;
    let changed;
    if (e.shiftKey && lastClickedIdx >= 0) {
        changed = rangeSelect(Math.min(visIdx, lastClickedIdx), Math.max(visIdx, lastClickedIdx), !selectedRevs.has(entry.revision));
    } else {
        toggleSelect(entry.revision);
        changed = [entry.revision];
    }
    lastClickedIdx = visIdx;
    updateSelectionUI(changed);
}

function toggleExpand(rev) {
    if (expandedRevs.has(rev)) {
        expandedRevs.delete(rev);
    } else {
        expandedRevs.add(rev);
    }
    const detailRow = document.querySelector('tr[data-detail-rev="' + rev + '"]');
    if (detailRow) detailRow.style.display = expandedRevs.has(rev) ? '' : 'none';
    const dataRow = document.querySelector('tr[data-rev="' + rev + '"]');
    if (dataRow) {
        const btn = dataRow.querySelector('.expand-btn');
        if (btn) btn.textContent = expandedRevs.has(rev) ? '▼' : '▶';
    }
}

function toggleSelect(rev) {
    if (selectedRevs.has(rev)) selectedRevs.delete(rev);
    else selectedRevs.add(rev);
}

function rangeSelect(fromIdx, toIdx, select) {
    const visible = getVisibleEntries();
    const changed = [];
    for (let i = fromIdx; i <= toIdx; i++) {
        const e = visible[i];
        if (!e || !eligibleSet.has(e.revision)) continue;
        if (select) selectedRevs.add(e.revision);
        else selectedRevs.delete(e.revision);
        changed.push(e.revision);
    }
    return changed;
}

document.getElementById('header-cb').addEventListener('click', (e) => {
    const visible = getVisibleEntries();
    const eligible = visible.filter(en => eligibleSet.has(en.revision));
    if (e.target.checked) {
        eligible.forEach(en => selectedRevs.add(en.revision));
    } else {
        eligible.forEach(en => selectedRevs.delete(en.revision));
    }
    updateSelectionUI(eligible.map(en => en.revision));
});

// -- Search / filter controls --------------------------------------------
const searchInput = document.getElementById('search-input');
const regexError = document.getElementById('regex-error');

function validateAndApply() {
    const opts = getFilterOptions();
    const term = searchInput.value;
    updateSearchPlaceholder();
    if (opts.regex && term) {
        try {
            new RegExp(term);
            searchInput.classList.remove('invalid');
            regexError.style.display = 'none';
        } catch (err) {
            searchInput.classList.add('invalid');
            regexError.textContent = t('invalidRegex', { msg: err.message });
            regexError.style.display = '';
            return;
        }
    } else {
        searchInput.classList.remove('invalid');
        regexError.style.display = 'none';
    }
    activeSearchTerm = term;
    refreshVisibleEntriesAsync(true).catch(err => {
        console.error('[svn-log] search refresh failed:', err);
        setLoadingProgress(false);
    });
}

function scheduleFilter(delayMs) {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(validateAndApply, typeof delayMs === 'number' ? delayMs : 200);
}

searchInput.addEventListener('input', function () { scheduleFilter(200); });
document.querySelectorAll('#filter-dropdown input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', function () { scheduleFilter(0); });
});
document.querySelectorAll('#filter-dropdown .filter-item').forEach(item => {
    item.addEventListener('click', function (e) {
        var target = e.target;
        if (target && target.closest && (target.closest('label') || target.closest('input'))) return;
        var checkbox = item.querySelector('input[type=checkbox]');
        if (!checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
});
document.getElementById('hide-merged').addEventListener('change', function () { scheduleFilter(0); });

document.getElementById('refresh-btn').addEventListener('click', () => {
    window.location.reload();
});

const filterDropdown = document.getElementById('filter-dropdown');
document.getElementById('search-icon-btn').addEventListener('click', e => {
    e.stopPropagation();
    filterDropdown.classList.toggle('hidden');
});
document.addEventListener('click', e => {
    if (!filterDropdown.contains(e.target) && e.target.id !== 'search-icon-btn') {
        filterDropdown.classList.add('hidden');
    }
});

document.getElementById('run-options-toggle').addEventListener('click', function () {
    setRunOptionsExpanded(!runOptionsExpanded);
});

// -- Run options / safety guards ----------------------------------------
function setRunControlsDisabled(disabled) {
    [
        'opt-auto-commit', 'opt-verbose', 'opt-copy',
        'opt-output', 'opt-ignore',
    ].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = !!disabled;
    });
}

['opt-auto-commit', 'opt-verbose', 'opt-copy', 'opt-output', 'opt-ignore'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () { updateSafetyTip(); renderTable(); });
    el.addEventListener('input', function () { updateSafetyTip(); renderTable(); });
});

// -- Pagination -----------------------------------------------------------
document.getElementById('load-cancel-btn').addEventListener('click', () => {
    document.getElementById('load-cancel-btn').disabled = true;
    document.getElementById('load-cancel-btn').textContent = t('canceling');
});

// -- Confirm / Cancel -----------------------------------------------------
document.getElementById('confirm-btn').addEventListener('click', async () => {
    const revisions = Array.from(selectedRevs).sort((a, b) => a - b);
    if (revisions.length === 0) {
        alert(t('pleaseSelectOne'));
        return;
    }

    let options;
    try {
        options = collectRunOptionsFromUI();
    } catch (err) {
        alert(t('invalidRunOptions', { msg: (err && err.message ? err.message : String(err)) }));
        return;
    }

    if (!canMerge) {
        alert(t('workspaceNotConfigured'));
        return;
    }

    document.getElementById('confirm-btn').disabled = true;
    document.getElementById('confirm-btn').textContent = t('startStarting');
    setRunControlsDisabled(true);
    try {
        await fetch('/api/options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options),
        });
        await fetch('/api/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revisions }),
        });
        _confirmed = true;
        showMergeView(revisions, options);
    } catch (e) {
        document.getElementById('confirm-btn').disabled = false;
        document.getElementById('confirm-btn').textContent = t('start');
        setRunControlsDisabled(false);
    }
});

// -- Merge progress view --------------------------------------------------
function htmlEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toForwardSlashes(s) {
    return String(s || '').replace(/\\/g, '/');
}

function relPathForSummary(absPath) {
    var absNorm = toForwardSlashes(absPath || '').replace(/\/+$/, '');
    var wsNorm = toForwardSlashes(workspacePathForSummary || '').replace(/\/+$/, '');
    if (!wsNorm) return absNorm;

    var absLower = absNorm.toLowerCase();
    var wsLower = wsNorm.toLowerCase();
    if (absLower === wsLower) return '.';
    if (absLower.startsWith(wsLower + '/')) {
        return absNorm.slice(wsNorm.length + 1);
    }
    return absNorm;
}

function createMergeSectionController(sectionsEl) {
    var currentSection = null;

    function startSection(title, kind) {
        if (currentSection) finalizeSection(null);
        var el = document.createElement('div');
        el.className = 'mv-section mv-section-' + (kind || 'info');
        el.dataset.kind = kind || 'info';
        var logOrPh = (kind === 'summary')
            ? '<div class="mv-section-summary-ph">' + htmlEsc(t('calculating')) + '</div>'
            : '<pre class="mv-section-log"></pre>';
        el.innerHTML =
            '<div class="mv-section-hd">' +
            '<span class="mv-section-icon">\u23F3</span>' +
            '<span class="mv-section-title">' + htmlEsc(title) + '</span>' +
            '<span class="mv-section-fold">\u25BC</span>' +
            '</div>' +
            '<div class="mv-section-bd">' + logOrPh + '</div>';
        el.querySelector('.mv-section-hd').addEventListener('click', function () {
            el.classList.toggle('mv-section-folded');
            el.querySelector('.mv-section-fold').textContent = el.classList.contains('mv-section-folded') ? '\u25B6' : '\u25BC';
        });
        sectionsEl.appendChild(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        currentSection = { element: el, logEl: el.querySelector('.mv-section-log'), kind: kind || 'info' };
    }

    function finalizeSection(ok) {
        if (!currentSection) return;
        var el = currentSection.element;
        var icon = el.querySelector('.mv-section-icon');
        if (ok === false) {
            el.classList.add('mv-section-failed');
            icon.textContent = '\u2717';
        } else {
            el.classList.add('mv-section-done');
            icon.textContent = '\u2713';
        }
        if (currentSection.kind !== 'summary') {
            el.classList.add('mv-section-folded');
            el.querySelector('.mv-section-fold').textContent = '\u25B6';
        }
        currentSection = null;
    }

    function appendLog(text) {
        if (currentSection && currentSection.logEl) {
            currentSection.logEl.textContent += text + '\n';
            currentSection.logEl.scrollTop = currentSection.logEl.scrollHeight;
        }
    }

    return {
        startSection: startSection,
        finalizeSection: finalizeSection,
        appendLog: appendLog,
    };
}

function setUiMode(mode) {
    currentUiMode = mode;
}

function createPipelineView(title, statusText, statusColor) {
    if (!MERGE_VIEW_TEMPLATE_HTML) {
        throw new Error('Missing merge-view-template');
    }

    document.body.innerHTML = MERGE_VIEW_TEMPLATE_HTML;

    var statusEl = document.getElementById('mv-status');
    document.getElementById('mv-title').textContent = title;
    statusEl.textContent = statusText || '';
    if (statusColor) statusEl.style.color = statusColor;

    return {
        statusEl: statusEl,
        sectionsEl: document.getElementById('mv-sections'),
        previewBar: document.getElementById('mv-preview-bar'),
        mergeBar: document.getElementById('mv-merge-bar'),
        sectionController: createMergeSectionController(document.getElementById('mv-sections')),
    };
}

function setMergeCancelAvailable(available) {
    var btn = document.getElementById('mv-run-cancel-btn');
    if (!btn) return;
    btn.disabled = !available;
    btn.style.display = available ? '' : 'none';
}

async function runWorkspaceCleanupPipeline(statusEl, sectionController, onDone) {
    try {
        var res = await fetch('/api/clean-workspace', { method: 'POST' });
        await consumeEventStream(res, function (evt) {
            if (evt.type === 'log') {
                sectionController.appendLog(evt.text);
            } else if (evt.type === 'section-start') {
                sectionController.startSection(evt.title, evt.kind);
            } else if (evt.type === 'section-end') {
                sectionController.finalizeSection(evt.ok === false ? false : null);
            } else if (evt.type === 'cleanup-done') {
                onDone(!!evt.ok);
            }
        });
    } catch (err) {
        if (statusEl) {
            statusEl.style.color = '#c42b1c';
            statusEl.textContent = t('errorPrefix', { msg: (err.message || String(err)) });
        }
        onDone(false);
    }
}

function showCleanupPipelineView(options) {
    setUiMode('cleanup');
    var view = createPipelineView(
        t('workspaceDirtyTitle'),
        options.statusText || t('workspaceDirtyStatus'),
        options.statusColor || '#9a5c00'
    );
    var statusEl = view.statusEl;
    var sectionsEl = view.sectionsEl;
    var previewBar = view.previewBar;
    var mergeBar = view.mergeBar;
    var sectionController = view.sectionController;

    previewBar.style.display = '';
    mergeBar.style.display = 'none';
    document.getElementById('mv-cancel-btn').textContent = options.cancelLabel || t('closePage');
    document.getElementById('mv-continue-btn').textContent = options.continueLabel || t('cleanWorkspaceNow');
    document.getElementById('mv-commit-btn').style.display = 'none';
    document.getElementById('mv-done-btn').style.display = 'none';
    document.getElementById('mv-run-cancel-btn').style.display = 'none';
    document.getElementById('mv-back-btn').style.display = 'none';
    document.getElementById('mv-commit-status').textContent = '';

    if (Array.isArray(options.dirtyLines) && options.dirtyLines.length > 0) {
        var dirtySection = document.createElement('div');
        dirtySection.className = 'mv-section';
        dirtySection.style.borderLeftColor = '#9a5c00';
        dirtySection.innerHTML =
            '<div class="mv-section-hd" style="cursor:default">' +
            '<span class="mv-section-icon">\u26A0</span>' +
            '<span class="mv-section-title">' + htmlEsc(t('workspaceDirtySectionTitle')) + '</span>' +
            '</div>' +
            '<div class="mv-section-bd">' +
            '<div style="padding:12px 14px;color:#444;">' + htmlEsc(t('workspaceDirtyPrompt')) + '</div>' +
            '<pre class="mv-section-log">' + htmlEsc(options.dirtyLines.join('\n')) + '</pre>' +
            '</div>';
        sectionsEl.appendChild(dirtySection);
    }

    document.getElementById('mv-cancel-btn').addEventListener('click', async function () {
        if (typeof options.onCancel === 'function') {
            await options.onCancel();
            return;
        }
        await fetch('/api/cancel', { method: 'POST' }).catch(function () { });
        window.close();
    });

    document.getElementById('mv-continue-btn').addEventListener('click', async function () {
        document.getElementById('mv-cancel-btn').disabled = true;
        document.getElementById('mv-continue-btn').disabled = true;
        previewBar.style.display = 'none';
        mergeBar.style.display = '';
        sectionsEl.innerHTML = '';
        statusEl.style.color = '#9a5c00';
        statusEl.textContent = options.runningStatusText || t('cleanupRunning');
        sectionController.startSection(options.runningSectionTitle || t('workspaceDirtyTitle'), 'info');
        sectionController.appendLog(options.runningHintText || t('cleanupStartingHint'));

        await options.runPipeline(statusEl, sectionController, function (ok) {
            var backBtn = document.getElementById('mv-back-btn');
            backBtn.style.display = '';
            backBtn.textContent = options.backLabel || t('continueToLog');
            backBtn.disabled = false;
            backBtn.addEventListener('click', function () {
                if (typeof options.onBack === 'function') {
                    options.onBack(ok);
                    return;
                }
                window.location.href = '/';
            });
            if (ok) {
                statusEl.style.color = '#107c10';
                statusEl.textContent = options.successStatusText || t('workspaceCleanReady');
            } else {
                statusEl.style.color = '#c42b1c';
                statusEl.textContent = options.failureStatusText || t('mergeCanceledDirty');
            }
        });
    });
}

function showDirtyWorkspaceGate(dirtyLines) {
    showCleanupPipelineView({
        dirtyLines: dirtyLines,
        runPipeline: runWorkspaceCleanupPipeline,
        onBack: function () {
            window.location.href = '/';
        }
    });
}

async function consumeEventStream(res, onEvent) {
    if (!res.ok || !res.body) {
        throw new Error(t('failedToStartMerge', { code: res.status }));
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.startsWith('data: ')) continue;
            var payload = line.slice(6);
            if (payload === '[DONE]') continue;
            try {
                onEvent(JSON.parse(payload));
            } catch (_) { }
        }
    }
}

function showMergeView(revisions, options) {
    setUiMode('merge');
    var view = createPipelineView(t('mergeTitle'), t('pendingStatus', { count: revisions.length }));

    // Build a rev -> entry map from allEntries for showing commit messages
    var entryMap = {};
    for (var i = 0; i < allEntries.length; i++) {
        entryMap[allEntries[i].revision] = allEntries[i];
    }

    var statusEl = view.statusEl;
    mergeRunFinished = false;
    mergeCleanupFinished = false;
    mergeFinalized = false;
    activeMergeAbortController = null;
    var sectionController = view.sectionController;

    // Build preview section listing all pending commits
    var sectionsEl = view.sectionsEl;
    var previewDiv = document.createElement('div');
    previewDiv.className = 'mv-section';
    previewDiv.style.borderLeftColor = '#0078d4';

    var rowsHtml = '';
    revisions.forEach(function (rev) {
        var entry = entryMap[rev];
        var msg = entry ? (entry.message || t('noMessageShort')).split('\n')[0].trim() : t('noMessageShort');
        rowsHtml += '<div style="padding:3px 0 3px 4px;font-family:Consolas,monospace;font-size:12px;">' +
            '<span style="color:#0078d4;font-weight:600;display:inline-block;min-width:72px;">' + htmlEsc(t('revisionPrefix')) + htmlEsc(String(rev)) + '</span>' +
            htmlEsc(msg) + '</div>';
    });

    previewDiv.innerHTML =
        '<div class="mv-section-hd" style="cursor:default">' +
        '<span class="mv-section-icon">\uD83D\uDCCB</span>' +
        '<span class="mv-section-title">' + htmlEsc(t('commitsToMerge', { count: revisions.length })) + '</span>' +
        '</div>' +
        '<div class="mv-section-bd"><div style="padding:8px 14px;">' + rowsHtml + '</div></div>';
    sectionsEl.appendChild(previewDiv);

    // Set commit message textarea (for when user commits after merge)
    var revLabel = revisions.map(function (r) { return t('revisionPrefix') + r; }).join(' ');
    document.getElementById('mv-commit-msg').value = t('mergedFromSourceBranch', { revs: revLabel });

    // Show preview bottombar (Continue/Cancel), hide merge bottombar
    view.previewBar.style.display = '';
    view.mergeBar.style.display = 'none';
    document.getElementById('mv-cancel-btn').textContent = t('cancel');
    document.getElementById('mv-continue-btn').textContent = t('continue');
    document.getElementById('mv-title').textContent = t('mergeTitle');
    document.getElementById('mv-run-cancel-btn').textContent = t('cancelMerge');
    document.getElementById('mv-back-btn').textContent = t('back');
    document.getElementById('mv-commit-btn').textContent = t('commit');
    document.getElementById('mv-done-btn').textContent = t('doneNoCommit');
    document.getElementById('mv-overlay-title').textContent = t('commitMessageTitle');
    document.getElementById('mv-overlay-cancel').textContent = t('cancel');
    document.getElementById('mv-overlay-ok').textContent = t('commit');
    document.getElementById('mv-cancel-overlay-title').textContent = t('confirmCancelMergeTitle');
    document.getElementById('mv-cancel-overlay-text').textContent = t('confirmCancelMergeText');
    document.getElementById('mv-cancel-overlay-dismiss').textContent = t('cancel');
    document.getElementById('mv-cancel-overlay-confirm').textContent = t('confirmAction');

    function hideCancelOverlay() {
        document.getElementById('mv-cancel-overlay').style.display = 'none';
    }

    function showCancelOverlay() {
        document.getElementById('mv-cancel-overlay').style.display = 'flex';
    }

    document.getElementById('mv-cancel-btn').addEventListener('click', function () {
        window.location.reload();
    });

    document.getElementById('mv-continue-btn').addEventListener('click', function () {
        var continueBtn = document.getElementById('mv-continue-btn');
        var cancelBtn = document.getElementById('mv-cancel-btn');
        continueBtn.disabled = true;
        cancelBtn.disabled = true;

        // Remove preview section
        previewDiv.remove();

        // Switch to merge bottombar
        view.previewBar.style.display = 'none';
        view.mergeBar.style.display = '';

        if (options && options.autoCommit) {
            document.getElementById('mv-commit-status').textContent = t('autoCommitEnabledHint');
        }

        statusEl.textContent = t('running');
        setMergeCancelAvailable(true);

        document.getElementById('mv-run-cancel-btn').addEventListener('click', function () {
            if (mergeCleanupFinished || mergeFinalized) return;
            showCancelOverlay();
        });

        document.getElementById('mv-back-btn').addEventListener('click', function () {
            window.location.reload();
        });

        document.getElementById('mv-done-btn').addEventListener('click', async function () {
            mergeFinalized = true;
            document.getElementById('mv-done-btn').disabled = true;
            document.getElementById('mv-commit-btn').disabled = true;
            setMergeCancelAvailable(false);
            await fetch('/api/done', { method: 'POST' }).catch(function () { });
            document.getElementById('mv-commit-status').textContent = t('doneCloseTab');
        });

        document.getElementById('mv-commit-btn').addEventListener('click', function () {
            document.getElementById('mv-overlay').style.display = 'flex';
            document.getElementById('mv-commit-msg').focus();
        });
        document.getElementById('mv-overlay-cancel').addEventListener('click', function () {
            document.getElementById('mv-overlay').style.display = 'none';
        });
        document.getElementById('mv-cancel-overlay-dismiss').addEventListener('click', hideCancelOverlay);
        document.getElementById('mv-cancel-overlay-confirm').addEventListener('click', async function () {
            hideCancelOverlay();
            setMergeCancelAvailable(false);
            if (activeMergeAbortController) {
                activeMergeAbortController.abort();
                activeMergeAbortController = null;
            }
            showCleanupPipelineView({
                statusText: t('canceling'),
                statusColor: '#9a5c00',
                cancelLabel: t('back'),
                continueLabel: t('confirmAction'),
                backLabel: t('back'),
                successStatusText: t('mergeCanceledClean'),
                failureStatusText: t('mergeCanceledDirty'),
                onCancel: async function () {
                    window.location.reload();
                },
                onBack: function () {
                    window.location.reload();
                },
                runPipeline: async function (cleanupStatusEl, cleanupSectionController, onDone) {
                    await cancelMergeRun(cleanupStatusEl, cleanupSectionController, onDone);
                }
            });
        });
        document.getElementById('mv-overlay-ok').addEventListener('click', async function () {
            var msg = (document.getElementById('mv-commit-msg').value || '').trim();
            if (!msg) return;
            var okBtn = document.getElementById('mv-overlay-ok');
            okBtn.disabled = true; okBtn.textContent = t('committing');
            try {
                var r2 = await fetch('/api/commit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg }),
                });
                var d2 = await r2.json();
                document.getElementById('mv-overlay').style.display = 'none';
                var st = document.getElementById('mv-commit-status');
                if (d2.ok) {
                    mergeFinalized = true;
                    st.style.color = '#107c10';
                    st.textContent = t('committedCloseTab');
                    document.getElementById('mv-commit-btn').disabled = true;
                    document.getElementById('mv-done-btn').disabled = true;
                    setMergeCancelAvailable(false);
                } else {
                    st.style.color = '#c42b1c';
                    st.textContent = t('commitFailed', { err: htmlEsc(d2.error || 'unknown') });
                    okBtn.disabled = false; okBtn.textContent = t('commit');
                }
            } catch (err) {
                okBtn.disabled = false; okBtn.textContent = t('commit');
            }
        });

        runMerge(revisions, options || {}, statusEl, sectionController);
    }); // end mv-continue-btn click
}

async function runMerge(revisions, options, statusEl, sectionController) {
    var sectionsEl = document.getElementById('mv-sections');
    try {
        activeMergeAbortController = new AbortController();
        var res = await fetch('/api/run-merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revisions, runOptions: options || {} }),
            signal: activeMergeAbortController.signal,
        });
        await consumeEventStream(res, function (evt) {
                    if (evt.type === 'log') {
                        sectionController.appendLog(evt.text);
                    } else if (evt.type === 'section-start') {
                        sectionController.startSection(evt.title, evt.kind);
                    } else if (evt.type === 'section-end') {
                        sectionController.finalizeSection(evt.ok === false ? false : null);
                    } else if (evt.type === 'done') {
                        mergeRunFinished = true;
                        sectionController.finalizeSection(null);
                        // Always use the full merge message generated by backend pipeline
                        // so manual commit submits exactly the same content.
                        if (typeof evt.mergeMessage === 'string' && evt.mergeMessage.trim()) {
                            var commitMsgEl = document.getElementById('mv-commit-msg');
                            if (commitMsgEl) {
                                commitMsgEl.value = evt.mergeMessage;
                            }
                        }
                        // Inject rich summary into the summary section card
                        var sumSection = sectionsEl.querySelector('.mv-section[data-kind="summary"]');
                        if (sumSection) {
                            var ph = sumSection.querySelector('.mv-section-summary-ph');
                            if (ph) {
                                var rich = document.createElement('div');
                                renderMergeSummaryInto(rich, evt.summary);
                                ph.parentNode.replaceChild(rich, ph);
                            }
                            sumSection.classList.remove('mv-section-folded');
                            var fold = sumSection.querySelector('.mv-section-fold');
                            if (fold) fold.textContent = '\u25BC';
                        }
                        var s = evt.summary || {};
                        if (statusEl) {
                            if (s.failed > 0) { statusEl.style.color = '#c42b1c'; statusEl.textContent = t('completeFailed', { count: s.failed }); }
                            else if (s.withConflicts > 0) { statusEl.style.color = '#9a5c00'; statusEl.textContent = t('completeConflicts', { count: s.withConflicts }); }
                            else { statusEl.style.color = '#107c10'; statusEl.textContent = t('completeAllClean', { count: (s.succeeded || 0) }); }
                        }
                        var commitStatus = document.getElementById('mv-commit-status');
                        if (commitStatus) {
                            var extra = [];
                            if (evt.logPath) extra.push(t('logPrefix', { path: evt.logPath }));
                            if (evt.autoCommitAttempted) {
                                if (evt.autoCommitOk) { extra.push(t('autoCommitSucceeded')); commitStatus.style.color = '#107c10'; }
                                else if (evt.autoCommitError) { extra.push(evt.autoCommitError); commitStatus.style.color = '#c42b1c'; }
                            }
                            commitStatus.textContent = extra.join('  ');
                        }
                        if (evt.hasWorkspace && !evt.autoCommitAttempted) {
                            var cb = document.getElementById('mv-commit-btn');
                            cb.disabled = false; cb.style.opacity = '1';
                        } else {
                            document.getElementById('mv-commit-btn').disabled = true;
                        }
                        setMergeCancelAvailable(!(evt.autoCommitAttempted && evt.autoCommitOk));
                        var db = document.getElementById('mv-done-btn');
                        db.disabled = false; db.style.opacity = '1';
                    }
        });
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (statusEl) { statusEl.style.color = '#c42b1c'; statusEl.textContent = t('errorPrefix', { msg: (err.message || String(err)) }); }
        setMergeCancelAvailable(false);
    }
}

async function cancelMergeRun(statusEl, sectionController, onDone) {
    mergeCleanupFinished = false;
    if (activeMergeAbortController) {
        activeMergeAbortController.abort();
        activeMergeAbortController = null;
    }

    try {
        var res = await fetch('/api/cancel-merge', { method: 'POST' });
        await consumeEventStream(res, function (evt) {
            if (evt.type === 'log') {
                sectionController.appendLog(evt.text);
            } else if (evt.type === 'section-start') {
                sectionController.startSection(evt.title, evt.kind);
            } else if (evt.type === 'section-end') {
                sectionController.finalizeSection(evt.ok === false ? false : null);
            } else if (evt.type === 'cleanup-done') {
                mergeCleanupFinished = true;
                setMergeCancelAvailable(false);
                onDone(!!evt.ok);
                if (evt.ok) {
                    statusEl.style.color = '#107c10';
                    statusEl.textContent = t('mergeCanceledClean');
                } else {
                    statusEl.style.color = '#c42b1c';
                    statusEl.textContent = t('mergeCanceledDirty');
                }
            }
        });
    } catch (err) {
        statusEl.style.color = '#c42b1c';
        statusEl.textContent = t('errorPrefix', { msg: (err.message || String(err)) });
        onDone(false);
    }
}

function renderMergeSummaryInto(el, s) {
    if (!s || !el) return;
    var results = s.results || [];
    var html = '';

    html += '<div style="padding:8px 12px;border-bottom:1px solid #eee;background:#fafafa;display:flex;gap:16px;">';
    html += '<span style="color:#107c10;font-weight:600;">' + htmlEsc(t('okCount', { count: (s.succeeded || 0) })) + '</span>';
    if ((s.withConflicts || 0) > 0) {
        html += '<span style="color:#9a5c00;font-weight:600;">' + htmlEsc(t('conflictsCount', { count: (s.withConflicts || 0) })) + '</span>';
    }
    if ((s.failed || 0) > 0) {
        html += '<span style="color:#c42b1c;font-weight:600;">' + htmlEsc(t('failedCount', { count: (s.failed || 0) })) + '</span>';
    }
    html += '<span style="color:#888;margin-left:auto;">' + htmlEsc(t('totalCount', { count: (s.total || 0) })) + '</span>';
    html += '</div>';

    var groups = {
        tree: [],
        text: [],
        property: []
    };
    var seenConflict = new Set();
    var seenReverted = new Set();
    var reverted = [];

    for (var i = 0; i < results.length; i++) {
        var result = results[i];
        var conflicts = result.conflicts || [];
        for (var j = 0; j < conflicts.length; j++) {
            var c = conflicts[j];
            var rel = relPathForSummary(c.path || '');
            var key = String(c.type) + ':' + rel;
            if (seenConflict.has(key)) continue;
            seenConflict.add(key);
            if (!groups[c.type]) continue;
            groups[c.type].push({
                isDirectory: !!c.isDirectory,
                relPath: rel,
                resolution: c.ignored ? 'ignored' : c.resolution,
                ignored: !!c.ignored
            });
        }

        var revertedItems = result.reverted || [];
        for (var k = 0; k < revertedItems.length; k++) {
            var r = revertedItems[k];
            var relRev = relPathForSummary(r.path || '');
            if (seenReverted.has(relRev)) continue;
            seenReverted.add(relRev);
            reverted.push({
                isDirectory: !!r.isDirectory,
                relPath: relRev
            });
        }
    }

    function sortEntries(arr) {
        arr.sort(function (a, b) {
            if (a.ignored !== b.ignored) return a.ignored ? 1 : -1;
            return a.relPath.localeCompare(b.relPath);
        });
    }
    sortEntries(groups.tree);
    sortEntries(groups.text);
    sortEntries(groups.property);
    reverted.sort(function (a, b) { return a.relPath.localeCompare(b.relPath); });

    html += '<div style="padding:10px 12px 4px;font-weight:600;color:#333;">' + htmlEsc(t('mergeSummaryTitle')) + '</div>';

    for (var f = 0; f < results.length; f++) {
        var failed = results[f];
        if (failed.success) continue;
        var msg = failed.errorMessage ? ('  ' + htmlEsc(failed.errorMessage)) : '';
        html += '<div style="padding:2px 12px;color:#c42b1c;">' + htmlEsc(t('revisionPrefix')) + failed.revision + '  ' + htmlEsc(t('failedTag')) + msg + '</div>';
    }

    function renderGroup(typeKey, title, color) {
        var entries = groups[typeKey] || [];
        if (entries.length === 0) return;
        var active = entries.filter(function (e) { return !e.ignored; });
        var ignored = entries.filter(function (e) { return e.ignored; });
        var countLabel = ignored.length > 0
            ? (active.length + ' + ' + ignored.length + ' ' + t('ignoredTag'))
            : String(active.length);
        html += '<div style="padding:6px 12px 2px;font-weight:600;color:' + color + ';">' + title + ' (' + countLabel + '):</div>';

        for (var n = 0; n < active.length; n++) {
            var e = active[n];
            var kind = e.isDirectory ? '[D]' : '[F]';
            html += '<div style="padding:1px 12px 1px 20px;color:' + color + ';font-family:Consolas,monospace;">' +
                kind + '  ' + htmlEsc(e.relPath) + '  (' + htmlEsc(e.resolution) + ')</div>';
        }
        for (var m = 0; m < ignored.length; m++) {
            var ig = ignored[m];
            var igKind = ig.isDirectory ? '[D]' : '[F]';
            html += '<div style="padding:1px 12px 1px 20px;color:#888;font-family:Consolas,monospace;">' +
                igKind + '  ' + htmlEsc(ig.relPath) + '  (' + htmlEsc(ig.resolution) + ')</div>';
        }
    }

    renderGroup('tree', t('treeConflicts'), '#c42b1c');
    renderGroup('text', t('textConflicts'), '#9a5c00');
    renderGroup('property', t('propertyConflicts'), '#9a5c00');

    if (reverted.length > 0) {
        html += '<div style="padding:6px 12px 2px;font-weight:600;color:#888;">' + htmlEsc(t('revertedIgnored', { count: reverted.length })) + ':</div>';
        for (var q = 0; q < reverted.length; q++) {
            var rv = reverted[q];
            var rvKind = rv.isDirectory ? '[D]' : '[F]';
            html += '<div style="padding:1px 12px 1px 20px;color:#888;font-family:Consolas,monospace;">' +
                rvKind + '  ' + htmlEsc(rv.relPath) + '  (' + htmlEsc(t('revertedTag')) + ')</div>';
        }
    }

    if ((s.failed || 0) === 0 && groups.tree.length === 0 && groups.text.length === 0 && groups.property.length === 0 && reverted.length === 0) {
        html += '<div style="padding:10px 12px;color:#107c10;">' + htmlEsc(t('noConflictsOrFailures')) + '</div>';
    }

    el.innerHTML = html;
}
