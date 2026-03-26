import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import {
  isMainThread, parentPort as _workerParent, Worker, workerData as _workerData
} from 'worker_threads';

import { tr } from './i18n';
import { LogCache } from './logcache';
import { Logger } from './logger';
import { copyToClipboard } from './modules/platform/copy-to-clipboard';
import { CompositeRunLogger } from './output/composite-run-logger';
import { FileRunLogger } from './output/file/file-run-logger';
import { RunLogger } from './output/run-logger-types';
import { SseRunLogger } from './output/webui/sse-run-logger';
import { TerminalRunLogger } from './output/terminal/terminal-run-logger';
import { runMergePipeline } from './pipeline';
import {
  svnBranchCreationRevision, svnCommit, svnEligibleRevisions,
  svnLogPage, svnStatusDirty, svnWorkspaceUrl
} from './svn';
import { LogEntry, MergeSummary } from './types';
import { compressRevisions, term } from './utils';
import { runCleanupWorkflow } from './workflows/cleanup-workflow';

const PAGE_SIZE = 100;

interface UiRunOptions {
  lang: 'zh-CN' | 'en';
  ignorePaths: string[];
  verbose: boolean;
  autoCommit: boolean;
  outputDir: string;
  copyToClipboard: boolean;
  preselectedRevisions: number[];
}

const DEFAULT_UI_RUN_OPTIONS: UiRunOptions = {
  lang: 'en',
  ignorePaths: [],
  verbose: false,
  autoCommit: false,
  outputDir: '',
  copyToClipboard: true,
  preselectedRevisions: [],
};

function normalizeUiRunOptions(partial: Partial<UiRunOptions>): UiRunOptions {
  const merged = { ...DEFAULT_UI_RUN_OPTIONS, ...partial };
  return {
    ...merged,
    ignorePaths: Array.isArray(merged.ignorePaths) ? merged.ignorePaths : [],
    preselectedRevisions: Array.isArray(merged.preselectedRevisions) ? merged.preselectedRevisions : [],
  };
}

interface WorkerDonePayload {
  type: 'done';
  summary: MergeSummary;
  hasWorkspace: boolean;
  mergeMessage: string;
  logPath: string;
  autoCommitAttempted: boolean;
  autoCommitOk: boolean;
  autoCommitOutput: string;
  autoCommitError: string;
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

// ─── Worker mode (spawned by /api/run-merge) ─────────────────────────────────
if (!isMainThread) {
  const wd = _workerData as {
    fromUrl: string; workspace: string | null;
    revisions: number[];
    runOptions: UiRunOptions;
  };
  const postLog = (text: string) => _workerParent!.postMessage({ type: 'log', text });

  let summary: MergeSummary = { total: 0, succeeded: 0, withConflicts: 0, failed: 0, results: [] };
  let mergeMessage = '';
  let logPath = '';
  let autoCommitAttempted = false;
  let autoCommitOk = false;
  let autoCommitOutput = '';
  let autoCommitError = '';

  let fileLogger: Logger | null = null;
  const prepLogger: RunLogger = new CompositeRunLogger([
    new TerminalRunLogger(!!wd.runOptions.verbose),
    new SseRunLogger(
      postLog,
      (title, kind) => _workerParent!.postMessage({ type: 'section-start', title, kind }),
      (ok) => _workerParent!.postMessage({ type: 'section-end', ok: ok !== false }),
      !!wd.runOptions.verbose,
    ),
  ]);

  let compositeLogger: RunLogger = prepLogger;

  let prepSectionOpen = false;
  try {
    if (wd.revisions.length > 0 && wd.workspace) {
      prepLogger.sectionStart(tr(wd.runOptions.lang, 'workerPrepareMergeTitle'), 'info');
      prepSectionOpen = true;
      prepLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeCheckingWorkspace'));

      // Dirty check first, before creating output files under workspace
      const dirtyLines = svnStatusDirty(wd.workspace);
      if (dirtyLines.length > 0) {
        prepLogger.log(tr(wd.runOptions.lang, 'workerDirtyError', { count: dirtyLines.length }));
        for (const dl of dirtyLines) prepLogger.log(`  ${dl}`);
        throw new Error(tr(wd.runOptions.lang, 'workerCleanRetryError'));
      }

      prepLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeCreateLog'));
      const outputDir = wd.runOptions.outputDir && wd.runOptions.outputDir.trim()
        ? wd.runOptions.outputDir.trim()
        : path.join(wd.workspace ?? process.cwd(), '.svnmerge');
      fileLogger = new Logger(outputDir, makeStartTs());
      logPath = fileLogger.getLogPath();
      compositeLogger = new CompositeRunLogger([
        new FileRunLogger(fileLogger),
        new TerminalRunLogger(!!wd.runOptions.verbose),
        new SseRunLogger(
          postLog,
          (title, kind) => _workerParent!.postMessage({ type: 'section-start', title, kind }),
          (ok) => _workerParent!.postMessage({ type: 'section-end', ok: ok !== false }),
          !!wd.runOptions.verbose,
        ),
      ]);

      // Pre-merge info
      compositeLogger.log('\u2500'.repeat(60));
      compositeLogger.log(tr(wd.runOptions.lang, 'workerWorkspace', { workspace: wd.workspace }));
      compositeLogger.log(tr(wd.runOptions.lang, 'workerFrom', { fromUrl: wd.fromUrl }));
      compositeLogger.log(tr(wd.runOptions.lang, 'workerRevisions', { revisions: compressRevisions(wd.revisions) }));
      compositeLogger.log(`auto-commit=${wd.runOptions.autoCommit}  verbose=${wd.runOptions.verbose}`);
      compositeLogger.log(tr(wd.runOptions.lang, 'workerWorkingCopyClean'));
      compositeLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeReady'));
      compositeLogger.sectionEnd(true);
      prepSectionOpen = false;

      const pipelineResult = runMergePipeline(
        {
          workspace: wd.workspace,
          fromUrl: wd.fromUrl,
          revisions: wd.revisions,
          lang: wd.runOptions.lang,
          ignorePaths: wd.runOptions.ignorePaths,
          verbose: wd.runOptions.verbose,
          autoCommit: wd.runOptions.autoCommit,
          copyToClipboard: wd.runOptions.copyToClipboard,
        },
        compositeLogger,
        copyToClipboard,
      );

      summary = pipelineResult.summary;
      mergeMessage = pipelineResult.mergeMessage;
      autoCommitAttempted = pipelineResult.autoCommitAttempted;
      autoCommitOk = pipelineResult.autoCommitOk;
      autoCommitOutput = pipelineResult.autoCommitOutput;
      autoCommitError = pipelineResult.autoCommitError;
    }
  } catch (e) {
    if (prepSectionOpen) {
      prepLogger.sectionEnd(false);
      prepSectionOpen = false;
    }
    postLog(tr(wd.runOptions.lang, 'workerGenericError', { error: (e as Error).message }));
    summary = { total: 0, succeeded: 0, withConflicts: 0, failed: 0, results: [] };
  } finally {
    if (fileLogger) fileLogger.close();
  }

  const donePayload: WorkerDonePayload = {
    type: 'done',
    summary,
    hasWorkspace: !!wd.workspace,
    mergeMessage,
    logPath,
    autoCommitAttempted,
    autoCommitOk,
    autoCommitOutput,
    autoCommitError,
  };
  _workerParent!.postMessage(donePayload);
  process.exit(0);
}

// ─── Open browser helper ──────────────────────────────────────────────────────
function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawnSync('cmd', ['/c', 'start', '', url], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      spawnSync('open', [url]);
    } else {
      spawnSync('xdg-open', [url]);
    }
  } catch {
    // silently ignore
  }
}

// ─── Server state ─────────────────────────────────────────────────────────────
interface ServerState {
  fromUrl: string;
  workspace: string | null;
  dirtyWorkspaceLines: string[];
  loadedEntries: LogEntry[];
  eligibleSet: Set<number>;
  nextStartRev: number;   // next revision to start loading from (going backwards)
  stopRev: number;        // oldest revision to load (branch creation point, or 1)
  hasMore: boolean;
  loading: boolean;
  cache: LogCache | null;
  runOptions: UiRunOptions;
}

function buildClientState(s: ServerState) {
  return {
    fromUrl: s.fromUrl,
    workspace: s.workspace,
    dirtyWorkspaceLines: s.dirtyWorkspaceLines,
    entries: s.loadedEntries,
    eligibleRevisions: Array.from(s.eligibleSet),
    hasMore: s.hasMore,
    loadedCount: s.loadedEntries.length,
    nextStartRev: s.nextStartRev,
    stopRev: s.stopRev,
    canMerge: !!s.workspace,
    runOptions: s.runOptions,
  };
}

function loadNextPage(state: ServerState): void {
  if (!state.hasMore || state.loading) return;
  state.loading = true;
  try {
    // ── Try cache first (only when nextStartRev is a known integer > 0) ──────
    if (state.cache && state.nextStartRev > 0) {
      const cached = state.cache.getPage(state.nextStartRev, PAGE_SIZE);
      if (cached !== null) {
        state.loadedEntries.push(...cached);
        state.nextStartRev = cached[cached.length - 1].revision - 1;
        if (cached.length < PAGE_SIZE || state.nextStartRev < state.stopRev) {
          state.hasMore = false;
        }
        return; // served from cache, no SVN call needed
      }
    }

    // ── Cache miss → fetch from SVN, then save to cache ─────────────────────
    const entries = svnLogPage(state.fromUrl, String(state.nextStartRev), PAGE_SIZE, state.stopRev);
    if (entries.length === 0) {
      state.hasMore = false;
    } else {
      state.loadedEntries.push(...entries);
      state.nextStartRev = entries[entries.length - 1].revision - 1;
      if (entries.length < PAGE_SIZE || state.nextStartRev < state.stopRev) {
        state.hasMore = false;
      }
      state.cache?.saveEntries(entries);
    }
  } finally {
    state.loading = false;
  }
}

function loadAll(state: ServerState): void {
  while (state.hasMore) {
    loadNextPage(state);
  }
}

function loadMoreBatch(state: ServerState, pages: number): void {
  const n = Math.max(1, Math.min(20, pages || 1));
  for (let i = 0; i < n && state.hasMore; i++) {
    loadNextPage(state);
  }
}

/** Load pages until the oldest loaded entry is older than cutoffDate (ISO string). */
function loadUntilDate(state: ServerState, cutoffDate: string): void {
  while (state.hasMore) {
    const oldest = state.loadedEntries[state.loadedEntries.length - 1];
    if (oldest && oldest.date < cutoffDate) break;
    loadNextPage(state);
  }
}

// ─── HTML template ────────────────────────────────────────────────────────────
// Legacy inline HTML builder removed after static-asset refactor.
function escHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlFromTemplate(
  branchName: string,
  fromUrl: string,
  workspace: string | null,
  initialStateJson: string,
  initialRunOptionsJson: string,
): string {
  const tplPath = path.join(__dirname, 'ui', 'logui.html');
  const template = fs.readFileSync(tplPath, 'utf8');
  const safeJson = initialStateJson.replace(/<\/script/gi, '<\\/script');
  const safeRunOptionsJson = initialRunOptionsJson.replace(/<\/script/gi, '<\\/script');
  const workspaceText = workspace ?? '';
  return template
    .split('__BRANCH_NAME__').join(escHtmlText(branchName))
    .split('__FROM_URL__').join(escHtmlText(fromUrl))
    .split('__WORKSPACE__').join(escHtmlText(workspaceText))
    .replace('__WORKSPACE_STYLE__', workspace ? '' : 'display:none')
    .replace('__INITIAL_RUN_OPTIONS_JSON__', safeRunOptionsJson)
    .replace('__INITIAL_STATE_JSON__', safeJson);
}

function sendStaticUiAsset(res: http.ServerResponse, filename: 'logui.css' | 'logui.js'): void {
  const fullPath = path.join(__dirname, 'ui', filename);
  try {
    const content = fs.readFileSync(fullPath);
    const contentType = filename.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'application/javascript; charset=utf-8';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.byteLength,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Launch the log browser GUI.
 * Returns a promise that resolves with the selected revision list,
 * or null if the user cancelled.
 */
export function openLogUI(
  fromUrl: string,
  workspace: string | null,
  initialRunOptions: Partial<UiRunOptions> = {},
): Promise<number[] | null> {
  const branchName = fromUrl.split('/').filter(Boolean).pop() ?? fromUrl;

  // Fetch eligible revisions (need workspace, may be null)
  let eligibleRevs: number[] = [];
  try {
    eligibleRevs = workspace ? svnEligibleRevisions(fromUrl, workspace) : [];
  } catch { /* ignore */ }
  const eligibleSet = new Set(eligibleRevs);

  // ── Open cache (stored in workspace/.svnmerge/logcache.db) ────────────────
  const cacheDir = workspace ? path.join(workspace, '.svnmerge') : null;
  let cache: LogCache | null = null;
  if (cacheDir) {
    try {
      cache = new LogCache(cacheDir, fromUrl);
    } catch {
      cache = null;
    }
  }

  // ── Compute stop revision: workspace branch creation point ─────────────────────
  let stopRev = 1;
  if (workspace) {
    const wsUrl = svnWorkspaceUrl(workspace);
    if (wsUrl) {
      stopRev = svnBranchCreationRevision(wsUrl);
    }
  }

  // Load initial page
  const state: ServerState = {
    fromUrl,
    workspace,
    dirtyWorkspaceLines: workspace ? svnStatusDirty(workspace) : [],
    loadedEntries: [],
    eligibleSet,
    nextStartRev: -1, // will use HEAD
    stopRev,
    hasMore: true,
    loading: false,
    cache,
    runOptions: normalizeUiRunOptions(initialRunOptions),
  };

  try {
    const initialEntries = svnLogPage(fromUrl, 'HEAD', PAGE_SIZE, stopRev);
    if (initialEntries.length > 0) {
      state.loadedEntries = initialEntries;
      state.nextStartRev = initialEntries[initialEntries.length - 1].revision - 1;
      state.hasMore = initialEntries.length === PAGE_SIZE && state.nextStartRev >= stopRev;
      cache?.saveEntries(initialEntries);
    } else {
      state.hasMore = false;
    }
  } catch {
    state.hasMore = false;
  }

  // Do not pre-load additional pages here.
  // The browser loads more pages incrementally to avoid blocking startup.

  let selectedRevisions: number[] = [];

  return new Promise((resolve) => {
    let activeMergeWorker: Worker | null = null;
    let mergeStreamResponse: http.ServerResponse | null = null;
    let mergeCancellationInProgress = false;

    function resumeHeartbeat(): void {
      lastPing = Date.now();
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(heartbeatTick, 3000);
      }
    }

    function stopHeartbeat(): void {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function finishMergeStream(): void {
      if (mergeStreamResponse && !mergeStreamResponse.writableEnded) {
        mergeStreamResponse.write('data: [DONE]\n\n');
        mergeStreamResponse.end();
      }
      mergeStreamResponse = null;
      activeMergeWorker = null;
      mergeCancellationInProgress = false;
      resumeHeartbeat();
    }

    const server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      // ── GET / ────────────────────────────────────────────────────────────────
      if (method === 'GET' && url === '/') {
        const html = buildHtmlFromTemplate(
          branchName,
          fromUrl,
          workspace,
          JSON.stringify(buildClientState(state)),
          JSON.stringify(state.runOptions),
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
        res.end(html);
        return;
      }

      // -- GET /ui/* ---------------------------------------------------------
      if (method === 'GET' && url === '/ui/logui.css') {
        sendStaticUiAsset(res, 'logui.css');
        return;
      }
      if (method === 'GET' && url === '/ui/logui.js') {
        sendStaticUiAsset(res, 'logui.js');
        return;
      }

      // ── GET /api/state ────────────────────────────────────────────────────────
      if (method === 'GET' && url === '/api/state') {
        sendJson(res, buildClientState(state));
        return;
      }

      // ── POST /api/loadMore ────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/loadMore') {
        readBody(req).then((body) => {
          let pages = 1;
          try {
            const parsed = JSON.parse(body || '{}') as { pages?: number };
            if (typeof parsed.pages === 'number' && isFinite(parsed.pages)) {
              pages = Math.trunc(parsed.pages);
            }
          } catch {
            // ignore malformed body, keep default pages=1
          }
          loadMoreBatch(state, pages);
          sendJson(res, buildClientState(state));
        }).catch(() => {
          loadNextPage(state);
          sendJson(res, buildClientState(state));
        });
        return;
      }

      // ── POST /api/loadAll ─────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/loadAll') {
        loadAll(state);
        sendJson(res, buildClientState(state));
        return;
      }

      // ── POST /api/select ──────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/select') {
        readBody(req).then((body) => {
          try {
            const parsed = JSON.parse(body) as { revisions: number[] };
            selectedRevisions = parsed.revisions ?? [];
          } catch { /* ignore */ }
          sendJson(res, { ok: true });
          // Do NOT resolve here — wait for /api/done or /api/commit
        }).catch(() => sendJson(res, { ok: false }, 400));
        return;
      }

      // ── POST /api/options ─────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/options') {
        readBody(req).then((body) => {
          try {
            const parsed = JSON.parse(body) as Partial<UiRunOptions>;
            state.runOptions = normalizeUiRunOptions(parsed ?? {});
            sendJson(res, { ok: true, runOptions: state.runOptions });
          } catch {
            sendJson(res, { ok: false, error: 'Bad request body' }, 400);
          }
        }).catch(() => sendJson(res, { ok: false, error: 'Bad request' }, 400));
        return;
      }

      // ── POST /api/run-merge ──────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/run-merge') {
        readBody(req).then((body) => {
          stopHeartbeat();
          let revisions: number[] = [];
          let runOptions: UiRunOptions = state.runOptions;
          try {
            const parsed = JSON.parse(body) as { revisions: number[]; runOptions?: Partial<UiRunOptions> };
            revisions = parsed.revisions ?? [];
            runOptions = normalizeUiRunOptions(parsed.runOptions ?? state.runOptions);
            state.runOptions = runOptions;
          } catch { /* ignore */ }

          // SSE stream — Worker thread runs the blocking merge, main thread streams events
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Transfer-Encoding': 'chunked',
          });
          const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

          mergeStreamResponse = res;
          const worker = new Worker(__filename, {
            execArgv: ['-r', 'ts-node/register'],
            workerData: { fromUrl, workspace, revisions, runOptions },
          });
          activeMergeWorker = worker;
          mergeCancellationInProgress = false;

          worker.on('message', (msg) => { sendEvent(msg); });
          worker.on('error', (e) => {
            if (!mergeCancellationInProgress) {
              sendEvent({ type: 'log', text: `Worker error: ${e.message}` });
              sendEvent({ type: 'done', summary: { total: 0, succeeded: 0, withConflicts: 0, failed: 0, results: [] }, hasWorkspace: !!workspace });
            }
            finishMergeStream();
          });
          worker.on('exit', () => {
            finishMergeStream();
          });
        }).catch((e) => { try { res.end(); } catch { /**/ } console.error('run-merge:', (e as Error).message); });
        return;
      }

      // ── POST /api/cancel-merge ───────────────────────────────────────────────
      if (method === 'POST' && url === '/api/cancel-merge') {
        stopHeartbeat();

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Transfer-Encoding': 'chunked',
        });
        const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        const finishCancelStream = () => {
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
          resumeHeartbeat();
        };

        Promise.resolve().then(async () => {
          try {
            sendEvent({ type: 'section-start', title: tr(state.runOptions.lang, 'workerCancelMergeTitle'), kind: 'info' });
            if (activeMergeWorker) {
              mergeCancellationInProgress = true;
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCancelMergeRequested') });
              const worker = activeMergeWorker;
              activeMergeWorker = null;
              if (mergeStreamResponse && !mergeStreamResponse.writableEnded) {
                mergeStreamResponse.end();
              }
              mergeStreamResponse = null;
              await worker.terminate();
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCancelMergeTerminated') });
            } else {
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCancelMergeNoActiveTask') });
            }
            sendEvent({ type: 'section-end', ok: true });

            if (!workspace) {
              throw new Error('No workspace configured');
            }

            const cleanupLogger = new CompositeRunLogger([
              new TerminalRunLogger(!!state.runOptions.verbose),
              new SseRunLogger(
                (text) => sendEvent({ type: 'log', text }),
                (title, kind) => sendEvent({ type: 'section-start', title, kind }),
                (ok) => sendEvent({ type: 'section-end', ok: ok !== false }),
                !!state.runOptions.verbose,
              ),
            ]);
            const summary = runCleanupWorkflow({ workspace, lang: state.runOptions.lang }, cleanupLogger);
            sendEvent({ type: 'cleanup-done', ok: summary.failedCount === 0 && summary.workspaceCleanAfterCleanup });
            if (summary.failedCount > 0 || !summary.workspaceCleanAfterCleanup) {
              finishCancelStream();
              return;
            }
          } catch (e) {
            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceError', { error: (e as Error).message }) });
            sendEvent({ type: 'cleanup-done', ok: false });
          } finally {
            mergeCancellationInProgress = false;
            finishCancelStream();
          }
        }).catch(() => finishCancelStream());
        return;
      }

      // ── POST /api/clean-workspace ───────────────────────────────────────────
      if (method === 'POST' && url === '/api/clean-workspace') {
        stopHeartbeat();

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Transfer-Encoding': 'chunked',
        });
        const sendEvent = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        const finishCleanStream = () => {
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
          resumeHeartbeat();
        };

        Promise.resolve().then(() => {
          try {
            if (!workspace) {
              throw new Error('No workspace configured');
            }

            const cleanupLogger = new CompositeRunLogger([
              new TerminalRunLogger(!!state.runOptions.verbose),
              new SseRunLogger(
                (text) => sendEvent({ type: 'log', text }),
                (title, kind) => sendEvent({ type: 'section-start', title, kind }),
                (ok) => sendEvent({ type: 'section-end', ok: ok !== false }),
                !!state.runOptions.verbose,
              ),
            ]);
            const summary = runCleanupWorkflow({ workspace, lang: state.runOptions.lang }, cleanupLogger);
            state.dirtyWorkspaceLines = svnStatusDirty(workspace);
            sendEvent({ type: 'cleanup-done', ok: summary.failedCount === 0 && summary.workspaceCleanAfterCleanup });
            if (summary.failedCount > 0 || !summary.workspaceCleanAfterCleanup) {
              finishCleanStream();
              return;
            }
          } catch (e) {
            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceError', { error: (e as Error).message }) });
            sendEvent({ type: 'cleanup-done', ok: false });
          } finally {
            finishCleanStream();
          }
        }).catch(() => finishCleanStream());
        return;
      }

      // ── POST /api/commit ──────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/commit') {
        readBody(req).then((body) => {
          if (!workspace) { sendJson(res, { ok: false, error: 'No workspace configured' }); return; }
          let message = '';
          try { message = (JSON.parse(body) as { message: string }).message ?? ''; } catch { /* ignore */ }
          try {
            const output = svnCommit(workspace, message);
            sendJson(res, { ok: true, output });
            setTimeout(() => { clearInterval(heartbeatTimer!); server.close(); resolve(selectedRevisions); }, 300);
          } catch (e) {
            sendJson(res, { ok: false, error: (e as Error).message });
          }
        }).catch(() => sendJson(res, { ok: false, error: 'Bad request' }, 400));
        return;
      }

      // ── POST /api/done ────────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/done') {
        stopHeartbeat();
        sendJson(res, { ok: true });
        setTimeout(() => { server.close(); resolve(selectedRevisions); }, 200);
        return;
      }

      // ── POST /api/ping ───────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/ping') {
        lastPing = Date.now();
        res.writeHead(204);
        res.end();
        return;
      }

      // ── POST /api/cancel ──────────────────────────────────────────────────────
      if (method === 'POST' && url === '/api/cancel') {
        stopHeartbeat();
        sendJson(res, { ok: true });
        setTimeout(() => { server.close(); resolve(null); }, 200);
        return;
      }

      // ── GET /api/dump ─────────────────────────────────────────────────────
      if (method === 'GET' && url === '/api/dump') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(JSON.stringify(buildClientState(state), null, 2));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    let lastPing = Date.now();
    const HEARTBEAT_TIMEOUT = 10_000; // 10s without ping = browser closed
    function heartbeatTick() {
      if (Date.now() - lastPing > HEARTBEAT_TIMEOUT) {
        stopHeartbeat();
        server.close();
        resolve(null);
      }
    }
    let heartbeatTimer: NodeJS.Timeout | null = setInterval(heartbeatTick, 3000);

    server.on('close', () => {
      cache?.close();
    });

    const PREFERRED_PORT = 26325;
    server.listen(PREFERRED_PORT, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      const url = `http://127.0.0.1:${addr.port}/`;
      console.log(`\nOpening SVN Merge UI → ${url}`);
      console.log('Select revisions in the browser, configure options, then click Start.');
      openBrowser(url);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Preferred port is in use — fall back to a random available port
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          const url = `http://127.0.0.1:${addr.port}/`;
          console.log(`\nPort ${PREFERRED_PORT} in use, using ${addr.port} instead.`);
          console.log(`Opening SVN Merge UI → ${url}`);
          console.log('Select revisions in the browser, configure options, then click Start.');
          openBrowser(url);
        });
      } else {
        console.error(`Log UI server error: ${err.message}`);
        resolve(null);
      }
    });
  });
}

