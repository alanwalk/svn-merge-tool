import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import {
  isMainThread, parentPort as _workerParent, Worker, workerData as _workerData
} from 'worker_threads';

import { resolveCommandConfig } from './cli-config';
import { resolveConsoleLanguage, tr } from './i18n';
import { LogCache } from './logcache';
import { Logger } from './logger';
import { RunLogger, runMergePipeline, SectionKind } from './pipeline';
import {
  svnBranchCreationRevision, svnCleanWorkspace, svnCommit, svnEligibleRevisions,
  svnLogPage, svnStatusDirty, svnWorkspaceUrl
} from './svn';
import { LogEntry, MergeSummary } from './types';
import { loadOrCreateRc } from './updater';
import { compressRevisions, term } from './utils';

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

/** Copy text to system clipboard (best-effort). */
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

function parseRevisionsArg(input: string): number[] {
  const rawRevisions = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawRevisions.length === 0) {
    throw new Error('No revisions specified. Use -r 1001,1002,1003');
  }

  const revisions: number[] = [];
  for (const raw of rawRevisions) {
    const rangeMatch = raw.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from <= 0 || to <= 0) {
        throw new Error(`Invalid revision range "${raw}". Revisions must be positive integers.`);
      }
      if (from > to) {
        throw new Error(`Invalid revision range "${raw}": start must be <= end.`);
      }
      for (let rev = from; rev <= to; rev++) {
        revisions.push(rev);
      }
    } else {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n <= 0) {
        throw new Error(`Invalid revision "${raw}". Use integers or ranges like 1001-1005.`);
      }
      revisions.push(n);
    }
  }

  return revisions;
}

// ─── Worker mode (spawned by /api/run-merge) ─────────────────────────────────
if (!isMainThread) {
  const wd = _workerData as {
    fromUrl: string; workspace: string | null;
    revisions: number[];
    runOptions: UiRunOptions;
  };
  const postLog = (text: string) => _workerParent!.postMessage({ type: 'log', text });
  const origWrite = (process.stdout.write as (...a: unknown[]) => boolean).bind(process.stdout);

  let summary: MergeSummary = { total: 0, succeeded: 0, withConflicts: 0, failed: 0, results: [] };
  let mergeMessage = '';
  let logPath = '';
  let autoCommitAttempted = false;
  let autoCommitOk = false;
  let autoCommitOutput = '';
  let autoCommitError = '';

  let fileLogger: Logger | null = null;

  const sseLogger: RunLogger = {
    log(text: string) {
      postLog(text);
      fileLogger?.log(text);
    },
    appendRaw(text: string) {
      fileLogger?.appendRaw(text);
      text.split('\n').map((l) => l.trimEnd()).filter(Boolean).forEach(postLog);
    },
    sectionStart(title: string, kind?: SectionKind) {
      _workerParent!.postMessage({ type: 'section-start', title, kind });
      fileLogger?.log(`\n${'\u2500'.repeat(60)}`);
      fileLogger?.log(`  ${title}`);
    },
    sectionEnd(ok?: boolean) {
      _workerParent!.postMessage({ type: 'section-end', ok: ok !== false });
    },
  };

  (process.stdout as NodeJS.WriteStream & { write: (...a: unknown[]) => boolean }).write = (s: unknown) => {
    if (typeof s === 'string') {
      const clean = term.stripAnsi(s).trimEnd();
      if (clean) postLog(clean);
    }
    return true;
  };

  let prepSectionOpen = false;
  try {
    if (wd.revisions.length > 0 && wd.workspace) {
      sseLogger.sectionStart(tr(wd.runOptions.lang, 'workerPrepareMergeTitle'), 'info');
      prepSectionOpen = true;
      sseLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeCheckingWorkspace'));

      // Dirty check first, before creating output files under workspace
      const dirtyLines = svnStatusDirty(wd.workspace);
      if (dirtyLines.length > 0) {
        sseLogger.log(tr(wd.runOptions.lang, 'workerDirtyError', { count: dirtyLines.length }));
        for (const dl of dirtyLines) sseLogger.log(`  ${dl}`);
        throw new Error(tr(wd.runOptions.lang, 'workerCleanRetryError'));
      }

      sseLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeCreateLog'));
      const outputDir = wd.runOptions.outputDir && wd.runOptions.outputDir.trim()
        ? wd.runOptions.outputDir.trim()
        : path.join(wd.workspace ?? process.cwd(), '.svnmerge');
      fileLogger = new Logger(outputDir, makeStartTs());
      logPath = fileLogger.getLogPath();

      // Pre-merge info
      sseLogger.log('\u2500'.repeat(60));
      sseLogger.log(tr(wd.runOptions.lang, 'workerWorkspace', { workspace: wd.workspace }));
      sseLogger.log(tr(wd.runOptions.lang, 'workerFrom', { fromUrl: wd.fromUrl }));
      sseLogger.log(tr(wd.runOptions.lang, 'workerRevisions', { revisions: compressRevisions(wd.revisions) }));
      sseLogger.log(`auto-commit=${wd.runOptions.autoCommit}  verbose=${wd.runOptions.verbose}`);
      sseLogger.log(tr(wd.runOptions.lang, 'workerWorkingCopyClean'));
      sseLogger.log(tr(wd.runOptions.lang, 'workerPrepareMergeReady'));
      sseLogger.sectionEnd(true);
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
        sseLogger,
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
      sseLogger.sectionEnd(false);
      prepSectionOpen = false;
    }
    postLog(tr(wd.runOptions.lang, 'workerGenericError', { error: (e as Error).message }));
    summary = { total: 0, succeeded: 0, withConflicts: 0, failed: 0, results: [] };
  } finally {
    if (fileLogger) fileLogger.close();
    (process.stdout as NodeJS.WriteStream & { write: (...a: unknown[]) => boolean }).write = origWrite;
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

            sendEvent({ type: 'section-start', title: tr(state.runOptions.lang, 'workerCleanupWorkspaceTitle'), kind: 'info' });
            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceStarting') });
            const result = svnCleanWorkspace(workspace);
            sendEvent({
              type: 'log',
              text: tr(state.runOptions.lang, 'workerCleanupWorkspaceResult', {
                reverted: result.reverted,
                removed: result.removed,
              }),
            });
            if (result.failed.length > 0) {
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceFailed', { count: result.failed.length }) });
              for (const item of result.failed) {
                sendEvent({ type: 'log', text: `  ${item}` });
              }
              sendEvent({ type: 'section-end', ok: false });
              sendEvent({ type: 'cleanup-done', ok: false });
              finishCancelStream();
              return;
            }

            const remainingDirty = svnStatusDirty(workspace);
            if (remainingDirty.length > 0) {
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceStillDirty', { count: remainingDirty.length }) });
              for (const item of remainingDirty) {
                sendEvent({ type: 'log', text: `  ${item}` });
              }
              sendEvent({ type: 'section-end', ok: false });
              sendEvent({ type: 'cleanup-done', ok: false });
              finishCancelStream();
              return;
            }

            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceDone') });
            sendEvent({ type: 'section-end', ok: true });
            sendEvent({ type: 'cleanup-done', ok: true });
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

            sendEvent({ type: 'section-start', title: tr(state.runOptions.lang, 'workerCleanupWorkspaceTitle'), kind: 'info' });
            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceStarting') });
            const result = svnCleanWorkspace(workspace);
            sendEvent({
              type: 'log',
              text: tr(state.runOptions.lang, 'workerCleanupWorkspaceResult', {
                reverted: result.reverted,
                removed: result.removed,
              }),
            });
            if (result.failed.length > 0) {
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceFailed', { count: result.failed.length }) });
              for (const item of result.failed) {
                sendEvent({ type: 'log', text: `  ${item}` });
              }
              state.dirtyWorkspaceLines = svnStatusDirty(workspace);
              sendEvent({ type: 'section-end', ok: false });
              sendEvent({ type: 'cleanup-done', ok: false });
              finishCleanStream();
              return;
            }

            const remainingDirty = svnStatusDirty(workspace);
            state.dirtyWorkspaceLines = remainingDirty;
            if (remainingDirty.length > 0) {
              sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceStillDirty', { count: remainingDirty.length }) });
              for (const item of remainingDirty) {
                sendEvent({ type: 'log', text: `  ${item}` });
              }
              sendEvent({ type: 'section-end', ok: false });
              sendEvent({ type: 'cleanup-done', ok: false });
              finishCleanStream();
              return;
            }

            sendEvent({ type: 'log', text: tr(state.runOptions.lang, 'workerCleanupWorkspaceDone') });
            sendEvent({ type: 'section-end', ok: true });
            sendEvent({ type: 'cleanup-done', ok: true });
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

// ─── ui subcommand entry point ────────────────────────────────────────────────
export async function uiCommand(args: string[]): Promise<void> {
  const { lang, fallbackWarning } = resolveConsoleLanguage();
  if (fallbackWarning) console.log(term.yellow(fallbackWarning));

  // Parse args manually: keep behavior aligned with main CLI options.
  let fromUrl: string | undefined;
  let workspace: string | undefined;
  let configPath: string | undefined;
  let configIgnorePaths: string[] = [];
  let configOutputDir: string | undefined;
  let configVerbose = false;
  let configCommit = false;

  let cliIgnoreArg: string | undefined;
  let cliOutput: string | undefined;
  let cliRevisionsArg: string | undefined;
  let cliVerbose = false;
  let cliCommit = false;
  let cliCopyToClipboard: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-f' || a === '--from') && args[i + 1]) { fromUrl = args[++i]; continue; }
    if ((a === '-w' || a === '--workspace') && args[i + 1]) { workspace = args[++i]; continue; }
    if ((a === '-c' || a === '--config') && args[i + 1]) { configPath = args[++i]; continue; }
    if ((a === '-i' || a === '--ignore') && args[i + 1]) { cliIgnoreArg = args[++i]; continue; }
    if ((a === '-o' || a === '--output') && args[i + 1]) { cliOutput = args[++i]; continue; }
    if ((a === '-r' || a === '--revisions') && args[i + 1]) { cliRevisionsArg = args[++i]; continue; }
    if (a === '-V' || a === '--verbose') { cliVerbose = true; continue; }
    if (a === '-C' || a === '--commit') { cliCommit = true; continue; }
    if (a === '--copy-to-clipboard') { cliCopyToClipboard = true; continue; }
    if (a === '--no-copy-to-clipboard') { cliCopyToClipboard = false; continue; }
    if (a === '--help' || a === '-h') {
      console.log(tr(lang, 'uiUsage'));
      return;
    }

    if (a.startsWith('-')) {
      console.error(term.red(`Error: unknown option ${a}`));
      console.error(tr(lang, 'unknownOptionHelp'));
      process.exit(1);
    }
  }

  try {
    const resolvedConfig = resolveCommandConfig({
      configPath,
      workspace,
      fromUrl,
    });
    fromUrl = resolvedConfig.fromUrl;
    workspace = resolvedConfig.workspace;
    configIgnorePaths = resolvedConfig.configIgnorePaths;
    configOutputDir = resolvedConfig.configOutputDir;
    configVerbose = resolvedConfig.configVerbose;
    configCommit = resolvedConfig.configCommit;
  } catch (e) {
    console.error(term.red(`Config error: ${(e as Error).message}`));
    process.exit(1);
  }

  if (!fromUrl) {
    console.error(term.red(tr(lang, 'fromRequired')));
    console.error(tr(lang, 'uiUsageShort'));
    process.exit(1);
  }

  const resolvedWorkspace = workspace ? path.resolve(workspace) : null;

  const rcConfig = loadOrCreateRc();

  const cliIgnorePaths = cliIgnoreArg
    ? cliIgnoreArg.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  let preselectedRevisions: number[] = [];
  if (cliRevisionsArg) {
    try {
      preselectedRevisions = parseRevisionsArg(cliRevisionsArg);
    } catch (e) {
      console.error(term.red(`Error: ${(e as Error).message}`));
      process.exit(1);
    }
  }

  let outputDir = '';
  const rawOutputDir = cliOutput ?? configOutputDir;
  if (resolvedWorkspace) {
    outputDir = rawOutputDir
      ? (path.isAbsolute(rawOutputDir)
        ? rawOutputDir
        : path.resolve(resolvedWorkspace, rawOutputDir))
      : path.join(resolvedWorkspace, '.svnmerge');
  }

  const runOptions: UiRunOptions = {
    lang,
    ignorePaths: [...rcConfig.globalIgnore, ...configIgnorePaths, ...cliIgnorePaths],
    verbose: cliVerbose || configVerbose,
    autoCommit: cliCommit || configCommit,
    outputDir,
    copyToClipboard: cliCopyToClipboard ?? rcConfig.copyToClipboard,
    preselectedRevisions,
  };

  const selected = await openLogUI(fromUrl, resolvedWorkspace, runOptions);

  if (selected === null) {
    console.log(tr(lang, 'userCanceled'));
    process.exit(0);
  }

  if (selected.length === 0) {
    console.log(tr(lang, 'noRevisionsSelected'));
    process.exit(0);
  }

  const sorted = [...selected].sort((a, b) => a - b);
  console.log(term.cyan(tr(lang, 'uiFinishedRevisions', {
    count: sorted.length,
    revisions: sorted.map((r) => `r${r}`).join(', '),
  })));
  process.exit(0);
}
