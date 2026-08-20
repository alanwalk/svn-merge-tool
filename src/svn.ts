import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConflictInfo, ConflictType } from './types';
import { isDir } from './utils';

let cachedWindowsConsoleEncoding: string | null | undefined;

function windowsCodePageToEncoding(codePage: number): string | null {
  switch (codePage) {
    case 65001:
      return 'utf-8';
    case 936:
    case 54936:
      return 'gb18030';
    case 950:
      return 'big5';
    case 932:
      return 'shift_jis';
    case 949:
      return 'euc-kr';
    default:
      return null;
  }
}

function getWindowsConsoleEncoding(): string | null {
  if (process.platform !== 'win32') return null;
  if (cachedWindowsConsoleEncoding !== undefined) return cachedWindowsConsoleEncoding;

  try {
    const result = spawnSync('cmd', ['/c', 'chcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const match = output.match(/:\s*(\d+)/) ?? output.match(/(\d+)/);
    const codePage = match ? parseInt(match[1], 10) : NaN;
    cachedWindowsConsoleEncoding = Number.isFinite(codePage)
      ? windowsCodePageToEncoding(codePage)
      : null;
  } catch {
    cachedWindowsConsoleEncoding = null;
  }

  return cachedWindowsConsoleEncoding;
}

function decodeWithEncoding(buf: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/** Decode svn output using UTF-8 first, then the active Windows console code page. */
function decodeOutput(buf: Buffer): string {
  const utf8 = decodeWithEncoding(buf, 'utf-8');
  if (utf8 !== null) {
    return utf8;
  }

  if (process.platform === 'win32') {
    const consoleEncoding = getWindowsConsoleEncoding() ?? 'gb18030';
    const decoded = decodeWithEncoding(buf, consoleEncoding);
    if (decoded !== null) {
      return decoded;
    }

    if (consoleEncoding !== 'gb18030') {
      const gb18030 = decodeWithEncoding(buf, 'gb18030');
      if (gb18030 !== null) {
        return gb18030;
      }
    }
  }

  return buf.toString('utf8');
}

/** Run an SVN command synchronously, returning { stdout, stderr, exitCode } */
function runSvn(args: string[], cwd?: string, maxBuffer?: number): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('svn', args, {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: maxBuffer ?? 64 * 1024 * 1024, // 64 MB default
  });

  const stdout = result.stdout ? decodeOutput(result.stdout) : '';
  const stderr = result.stderr ? decodeOutput(result.stderr) : '';
  const exitCode = result.status ?? 1;

  if (result.error) {
    throw new Error(`Failed to spawn svn: ${result.error.message}`);
  }

  return { stdout, stderr, exitCode };
}

/**
 * Check for local modifications or unversioned files in the workspace.
 * Returns an array of status lines that indicate dirty state.
 * Status lines starting with '?' (unversioned) or any non-space first column
 * (modified, added, deleted, missing, conflicted, etc.) are included.
 * Lines starting with 'X' (external) or ' ' (clean) are excluded.
 */
export function svnStatusDirty(workspace: string): string[] {
  const { stdout, exitCode } = runSvn(['status', workspace]);
  if (exitCode !== 0 || !stdout.trim()) return [];

  return stdout
    .split(/\r?\n/)
    .filter((line) => {
      if (line.length < 2) return false;
      const col0 = line[0];
      // Ignore clean lines and svn:externals markers
      return col0 !== ' ' && col0 !== 'X';
    });
}

/**
 * Run svn update on the workspace.
 * Throws if the update fails.
 */
export function svnUpdate(workspace: string): void {
  process.stdout.write('Updating working copy... ');
  const { stdout, stderr, exitCode } = runSvn(['update', workspace], workspace);
  if (exitCode !== 0) {
    process.stdout.write('\n');
    throw new Error(`svn update failed:\n${stderr.trim()}`);
  }
  // Print the last non-empty line (usually "Updated to revision NNNN." or "At revision NNNN.")
  const lastLine = stdout.split(/\r?\n/).filter((l) => l.trim()).pop() ?? '';
  process.stdout.write(`${lastLine}\n`);
}

/**
 * Verify that the given directory is a valid SVN working copy.
 * Throws if not valid.
 */
export function svnInfo(workspace: string): void {
  const { exitCode, stderr } = runSvn(['info', workspace]);
  if (exitCode !== 0) {
    throw new Error(`"${workspace}" is not a valid SVN working copy:\n${stderr.trim()}`);
  }
}

/**
 * Merge a single revision from fromUrl into workspace.
 * Uses --accept postpone to defer conflict resolution.
 */
export function svnMerge(
  revision: number,
  fromUrl: string,
  workspace: string
): { stdout: string; stderr: string; exitCode: number } {
  return runSvn(
    ['merge', '-c', String(revision), '--accept', 'postpone', fromUrl, workspace],
    workspace
  );
}

/**
 * Combined parse of `svn status` — returns conflicts AND non-conflict
 * modifications in a single SVN call.
 * Replaces calling svnStatusConflicts + svnStatusModifications separately.
 */
export function svnStatusAfterMerge(workspace: string): {
  conflicts: ConflictInfo[];
  modifications: { path: string; isDirectory: boolean }[];
} {
  const { stdout } = runSvn(['status', workspace]);
  const conflicts: ConflictInfo[] = [];
  const modifications: { path: string; isDirectory: boolean }[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 2) continue;
    const col0 = line[0];
    const col1 = line[1];
    const col6 = line.length > 6 ? line[6] : ' ';
    const filePath = line.slice(8).trim();
    if (!filePath) continue;

    if (col6 === 'C') {
      conflicts.push({ path: filePath, type: 'tree', resolution: 'working', isDirectory: isDir(filePath), ignored: false });
    } else if (col0 === 'C') {
      conflicts.push({ path: filePath, type: 'text', resolution: 'theirs-full', isDirectory: isDir(filePath), ignored: false });
    } else if (col1 === 'C') {
      conflicts.push({ path: filePath, type: 'property', resolution: 'theirs-full', isDirectory: isDir(filePath), ignored: false });
    } else {
      // Non-conflict modified paths (skip entirely clean / unversioned / external)
      // Keep entries where col1='M' (property-only change, e.g. svn:mergeinfo on the workspace folder)
      if ((col0 === ' ' && col1 === ' ') || col0 === '?' || col0 === 'X') continue;
      modifications.push({ path: filePath, isDirectory: isDir(filePath) });
    }
  }

  return { conflicts, modifications };
}

/**
 * Revert a path (and all children if it is a directory).
 */
export function svnRevert(
  filePath: string,
  workspace: string
): { success: boolean; message: string } {
  const { exitCode, stderr } = runSvn(['revert', '--depth', 'infinity', filePath], workspace);
  if (exitCode !== 0) {
    return { success: false, message: stderr.trim() };
  }
  return { success: true, message: '' };
}

/**
 * Resolve a conflicted file using the specified accept strategy.
 */
export function svnResolve(
  filePath: string,
  accept: 'working' | 'theirs-full',
  workspace: string
): { success: boolean; message: string } {
  const { exitCode, stderr } = runSvn(['resolve', '--accept', accept, filePath], workspace);
  if (exitCode !== 0) {
    return { success: false, message: stderr.trim() };
  }
  return { success: true, message: '' };
}

/**
 * Return all revisions from fromUrl that are eligible to be merged into workspace.
 * Uses `svn mergeinfo --show-revs eligible`.
 */
export function svnEligibleRevisions(fromUrl: string, workspace: string): number[] {
  const { stdout, exitCode } = runSvn(
    ['mergeinfo', '--show-revs', 'eligible', fromUrl, workspace],
    workspace
  );
  if (exitCode !== 0 || !stdout.trim()) return [];
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseInt(l.replace(/^r/, ''), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

/**
 * Fetch the commit log message body for a single revision.
 * Returns the trimmed message body, or an empty string on failure.
 *
 * svn log output structure:
 *   -------...-------
 *   rNNNN | author | date | N lines
 *   <blank line>
 *   <message body>
 *   -------...-------
 */
export function svnLog(revision: number, fromUrl: string): string {
  const { stdout, exitCode } = runSvn(['log', '-c', String(revision), '--limit', '1', fromUrl]);
  if (exitCode !== 0 || !stdout.trim()) return '';

  const lines = stdout.split(/\r?\n/);
  // Find the first separator line
  const sepIdx = lines.findIndex((l) => /^-{10,}/.test(l));
  if (sepIdx === -1) return '';

  // Header line is right after the separator
  const headerIdx = sepIdx + 1;
  // Message body starts after header + one blank line
  const bodyStart = headerIdx + 2;
  // Find the closing separator
  const closeSepIdx = lines.findIndex((l, i) => i > headerIdx && /^-{10,}/.test(l));
  const bodyEnd = closeSepIdx === -1 ? lines.length : closeSepIdx;

  const body = lines.slice(bodyStart, bodyEnd);

  // Trim leading and trailing blank lines
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();

  return body.join('\n');
}

/**
 * Fetch log message bodies for multiple revisions in a single `svn log` call.
 * Returns a Map<revision, body>; revisions with no message map to ''.
 */
/** Parse `svn log` stdout text into a Map<revision, body>. */
function parseSvnLogOutput(stdout: string, resultMap: Map<number, string>): void {
  const sepRe = /^-{10,}$/;
  const headerRe = /^r(\d+)\s*\|/;
  const lines = stdout.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    if (!sepRe.test(lines[i])) { i++; continue; }
    i++; // advance past separator to header
    if (i >= lines.length) break;
    const headerMatch = lines[i].match(headerRe);
    if (!headerMatch) { i++; continue; }
    const rev = parseInt(headerMatch[1], 10);
    i++; // advance past header
    if (i < lines.length && lines[i].trim() === '') i++; // skip blank line after header
    const bodyLines: string[] = [];
    while (i < lines.length && !sepRe.test(lines[i])) {
      bodyLines.push(lines[i]);
      i++;
    }
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
    if (resultMap.has(rev)) resultMap.set(rev, bodyLines.join('\n'));
  }
}

/**
 * Run `svn commit` on the workspace with the given message.
 * If targets are provided, only those paths are committed; otherwise the whole workspace.
 *
 * The commit message and target list are written to temporary files instead of
 * being expanded into the child-process argument list. This is important on
 * Windows, where a merge with many changed paths can exceed the command-line
 * length limit before `svn` even starts (spawnSync ENAMETOOLONG).
 * Throws on non-zero exit code.
 */
export function svnCommit(workspace: string, message: string, targets?: string[]): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svn-merge-tool-'));
  const messageFile = path.join(tempDir, 'commit-message.txt');
  const targetFile = targets && targets.length > 0
    ? path.join(tempDir, 'commit-targets.txt')
    : undefined;

  try {
    fs.writeFileSync(messageFile, message, 'utf8');

    const args = ['commit', '--file', messageFile, '--encoding', 'utf-8'];
    if (targetFile) {
      const absoluteTargets = targets!.map((target) =>
        path.isAbsolute(target) ? target : path.resolve(workspace, target)
      );
      fs.writeFileSync(targetFile, `${absoluteTargets.join('\n')}\n`, 'utf8');
      args.push('--targets', targetFile);
    } else {
      args.push(workspace);
    }

    const { stdout, stderr, exitCode } = runSvn(args, workspace);
    if (exitCode !== 0) {
      throw new Error(`svn commit failed (exit ${exitCode}):\n${stderr || stdout}`);
    }
    return stdout.trim();
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // A failed cleanup must not hide the SVN result.
    }
  }
}

/**
 * Fetch log message bodies for multiple revisions in batched `svn log` calls.
 * Splits revisions into chunks to avoid buffer overflow on large revision sets.
 * Returns a Map<revision, body>; revisions with no message map to ''.
 */
export function svnLogBatch(revisions: number[], fromUrl: string): Map<number, string> {
  const resultMap = new Map<number, string>(revisions.map((r) => [r, '']));
  if (revisions.length === 0) return resultMap;

  const CHUNK_SIZE = 200;
  const sorted = [...revisions].sort((a, b) => a - b);

  for (let start = 0; start < sorted.length; start += CHUNK_SIZE) {
    const chunk = sorted.slice(start, start + CHUNK_SIZE);
    const min = chunk[0];
    const max = chunk[chunk.length - 1];
    const { stdout, exitCode } = runSvn(['log', fromUrl, '-r', `${min}:${max}`]);
    if (exitCode !== 0 || !stdout.trim()) continue;
    parseSvnLogOutput(stdout, resultMap);
  }

  return resultMap;
}
