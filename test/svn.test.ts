/**
 * svn.test.ts — Tests for each svn.ts wrapper function using the SVN mock.
 *
 * Every test follows the pattern:
 *   1. mockSvn(scenario, workspace)
 *   2. call the function under test
 *   3. assert on the result
 *   4. restoreSvn() in afterEach
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import {
    svnCommit, svnEligibleRevisions, svnInfo, svnLog, svnLogBatch, svnMerge, svnResolve, svnRevert,
    svnStatusAfterMerge, svnStatusDirty, svnUpdate
} from '../src/svn';
import { getSvnCallLog, mockSvn, restoreSvn } from './svn-mock';

const WS = path.join(os.tmpdir(), 'svn-test-ws');
const FROM = 'http://svn.example.com/repos/project/trunk';

// Restore the real spawnSync after every test
afterEach(() => restoreSvn());

// ── Helper: build a SVN status line (8-char prefix + absolute path) ───────────

/** Build a properly formatted SVN status line. Columns 0..6 are flags, col7 space, then path. */
function statusLine(col0 = ' ', col1 = ' ', col2 = ' ', col3 = ' ', col4 = ' ', col5 = ' ', col6 = ' ', filePath = ''): string {
  return `${col0}${col1}${col2}${col3}${col4}${col5}${col6} ${filePath}\n`;
}

function textConflict(p: string)     { return statusLine('C', ' ', ' ', ' ', ' ', ' ', ' ', p); }
function propConflict(p: string)     { return statusLine(' ', 'C', ' ', ' ', ' ', ' ', ' ', p); }
function treeConflict(p: string)     { return statusLine(' ', ' ', ' ', ' ', ' ', ' ', 'C', p); }
function modified(p: string)         { return statusLine('M', ' ', ' ', ' ', ' ', ' ', ' ', p); }
function unversioned(p: string)      { return statusLine('?', ' ', ' ', ' ', ' ', ' ', ' ', p); }
function external(p: string)         { return statusLine('X', ' ', ' ', ' ', ' ', ' ', ' ', p); }

// ── svnInfo ───────────────────────────────────────────────────────────────────

describe('svnInfo', () => {
  test('does not throw for a valid working copy (exit 0)', () => {
    mockSvn({ info: { exitCode: 0, stdout: `Path: ${WS}\n` } }, WS);
    assert.doesNotThrow(() => svnInfo(WS));
  });

  test('throws for an invalid working copy (exit 1)', () => {
    mockSvn({ info: { exitCode: 1, stdout: '', stderr: 'svn: E155007: not a working copy' } }, WS);
    assert.throws(() => svnInfo(WS), /not a valid SVN working copy/);
  });
});

// ── svnStatusDirty ────────────────────────────────────────────────────────────

describe('svnStatusDirty', () => {
  test('returns empty array for clean working copy', () => {
    mockSvn({ status: { exitCode: 0, stdout: '' } }, WS);
    assert.deepEqual(svnStatusDirty(WS), []);
  });

  test('returns dirty lines for modified files', () => {
    const stdout = modified(path.join(WS, 'src', 'app.ts'));
    mockSvn({ status: { exitCode: 0, stdout } }, WS);
    const result = svnStatusDirty(WS);
    assert.equal(result.length, 1);
    assert.ok(result[0].startsWith('M'));
  });

  test('includes unversioned files (?) as dirty', () => {
    const stdout = unversioned(path.join(WS, 'newfile.ts'));
    mockSvn({ status: { exitCode: 0, stdout } }, WS);
    const result = svnStatusDirty(WS);
    assert.equal(result.length, 1);
    assert.ok(result[0].startsWith('?'));
  });

  test('excludes externals (X) and clean lines', () => {
    const stdout = external(path.join(WS, 'vendor')) +
                   statusLine(' ', ' ', ' ', ' ', ' ', ' ', ' ', path.join(WS, 'clean.ts'));
    mockSvn({ status: { exitCode: 0, stdout } }, WS);
    assert.deepEqual(svnStatusDirty(WS), []);
  });

  test('returns empty array when svn exits non-zero', () => {
    mockSvn({ status: { exitCode: 1, stdout: '', stderr: 'error' } }, WS);
    assert.deepEqual(svnStatusDirty(WS), []);
  });
});

// ── svnUpdate ─────────────────────────────────────────────────────────────────

describe('svnUpdate', () => {
  test('writes last progress line to console and does not throw on success', () => {
    mockSvn({ update: { exitCode: 0, stdout: 'Updating .\nAt revision 5678.\n' } }, WS);
    assert.doesNotThrow(() => svnUpdate(WS));
  });

  test('throws with stderr message on failure', () => {
    mockSvn({ update: { exitCode: 1, stdout: '', stderr: 'svn: E155004: Working copy locked' } }, WS);
    assert.throws(() => svnUpdate(WS), /svn update failed/);
  });
});

// ── svnMerge ──────────────────────────────────────────────────────────────────

describe('svnMerge', () => {
  test('returns stdout and exit 0 for clean merge', () => {
    const stdout = `U  ${path.join(WS, 'src', 'app.ts')}\n`;
    mockSvn({ merge: { exitCode: 0, stdout } }, WS);
    const result = svnMerge(1001, FROM, WS);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('app.ts'));
  });

  test('returns exit code 1 and stderr for a conflict merge with no fatal output', () => {
    // Merge exits 0 but prints conflict marker (typical SVN behaviour with postpone)
    const stdout = `C  ${path.join(WS, 'src', 'file.ts')}\n`;
    mockSvn({ merge: { exitCode: 0, stdout } }, WS);
    const result = svnMerge(1002, FROM, WS);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('C  '));
  });

  test('passes the correct revision to svn merge', () => {
    mockSvn({ merge: { exitCode: 0, stdout: '' } }, WS);
    svnMerge(9999, FROM, WS);
    const log = getSvnCallLog();
    assert.ok(log.some((c) => c.subcmd === 'merge' && c.args.includes('9999')));
  });
});

// ── svnStatusAfterMerge ───────────────────────────────────────────────────────

describe('svnStatusAfterMerge', () => {
  test('returns empty conflicts and modifications for blank output', () => {
    mockSvn({ status: { exitCode: 0, stdout: '' } }, WS);
    const { conflicts, modifications } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 0);
    assert.equal(modifications.length, 0);
  });

  test('detects text conflict (col0 = C)', () => {
    const p = path.join(WS, 'src', 'file.ts');
    mockSvn({ status: { exitCode: 0, stdout: textConflict(p) } }, WS);
    const { conflicts } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'text');
    assert.equal(conflicts[0].resolution, 'theirs-full');
    assert.equal(conflicts[0].path, p);
  });

  test('detects property conflict (col1 = C)', () => {
    const p = path.join(WS, 'src', 'props.ts');
    mockSvn({ status: { exitCode: 0, stdout: propConflict(p) } }, WS);
    const { conflicts } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'property');
    assert.equal(conflicts[0].resolution, 'theirs-full');
  });

  test('detects tree conflict (col6 = C)', () => {
    const p = path.join(WS, 'src', 'somedir');
    mockSvn({ status: { exitCode: 0, stdout: treeConflict(p) } }, WS);
    const { conflicts } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].type, 'tree');
    assert.equal(conflicts[0].resolution, 'working');
  });

  test('detects mixed conflicts and modifications together', () => {
    const fileA = path.join(WS, 'src', 'a.ts');
    const fileB = path.join(WS, 'src', 'b.ts');
    const fileC = path.join(WS, 'src', 'c.ts');
    const stdout = textConflict(fileA) + propConflict(fileB) + modified(fileC);
    mockSvn({ status: { exitCode: 0, stdout } }, WS);
    const { conflicts, modifications } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 2);
    assert.equal(modifications.length, 1);
    assert.equal(modifications[0].path, fileC);
  });

  test('skips unversioned and external lines', () => {
    const stdout = unversioned(path.join(WS, 'x.ts')) + external(path.join(WS, 'vendor'));
    mockSvn({ status: { exitCode: 0, stdout } }, WS);
    const { conflicts, modifications } = svnStatusAfterMerge(WS);
    assert.equal(conflicts.length, 0);
    assert.equal(modifications.length, 0);
  });
});

// ── svnRevert ─────────────────────────────────────────────────────────────────

describe('svnRevert', () => {
  test('returns success=true on exit 0', () => {
    mockSvn({ revert: { exitCode: 0, stdout: `Reverted '${path.join(WS, 'src', 'file.ts')}'\n` } }, WS);
    const result = svnRevert(path.join(WS, 'src', 'file.ts'), WS);
    assert.equal(result.success, true);
  });

  test('returns success=false with message on exit non-zero', () => {
    mockSvn({ revert: { exitCode: 1, stdout: '', stderr: 'svn: E200009: Failed to revert' } }, WS);
    const result = svnRevert(path.join(WS, 'src', 'file.ts'), WS);
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Failed to revert'));
  });
});

// ── svnResolve ────────────────────────────────────────────────────────────────

describe('svnResolve', () => {
  test('returns success=true for theirs-full resolution', () => {
    mockSvn({ resolve: { exitCode: 0, stdout: '' } }, WS);
    const result = svnResolve(path.join(WS, 'src', 'file.ts'), 'theirs-full', WS);
    assert.equal(result.success, true);
  });

  test('returns success=false on exit non-zero', () => {
    mockSvn({ resolve: { exitCode: 1, stdout: '', stderr: 'svn: E155016: conflict not resolved' } }, WS);
    const result = svnResolve(path.join(WS, 'src', 'file.ts'), 'working', WS);
    assert.equal(result.success, false);
    assert.ok(result.message.length > 0);
  });
});

// ── svnEligibleRevisions ──────────────────────────────────────────────────────

describe('svnEligibleRevisions', () => {
  test('returns parsed revision numbers', () => {
    mockSvn({ mergeinfo: { exitCode: 0, stdout: 'r1001\nr1002\nr1003\n' } }, WS);
    const revs = svnEligibleRevisions(FROM, WS);
    assert.deepEqual(revs, [1001, 1002, 1003]);
  });

  test('returns empty array when no eligible revisions', () => {
    mockSvn({ mergeinfo: { exitCode: 0, stdout: '' } }, WS);
    assert.deepEqual(svnEligibleRevisions(FROM, WS), []);
  });

  test('returns empty array on non-zero exit', () => {
    mockSvn({ mergeinfo: { exitCode: 1, stdout: '', stderr: 'svn error' } }, WS);
    assert.deepEqual(svnEligibleRevisions(FROM, WS), []);
  });
});

// ── svnLog ────────────────────────────────────────────────────────────────────

describe('svnLog', () => {
  const SEP = '------------------------------------------------------------------------\n';

  test('parses a well-formed log entry body', () => {
    const logOutput = [
      SEP,
      'r1001 | dev | 2024-01-01 10:00:00 +0800 (Mon, 01 Jan 2024) | 2 lines',
      '',
      'Fix important bug #123',
      'Details here.',
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);
    const body = svnLog(1001, FROM);
    assert.ok(body.includes('Fix important bug #123'));
    assert.ok(body.includes('Details here.'));
  });

  test('returns empty string when SVN exits non-zero', () => {
    mockSvn({ log: { exitCode: 1, stdout: '', stderr: 'svn error' } }, WS);
    assert.equal(svnLog(1001, FROM), '');
  });

  test('returns empty string when log output is empty', () => {
    mockSvn({ log: { exitCode: 0, stdout: '' } }, WS);
    assert.equal(svnLog(1001, FROM), '');
  });
});

// ── svnLogBatch ───────────────────────────────────────────────────────────────

describe('svnLogBatch', () => {
  const SEP = '------------------------------------------------------------------------';

  function makeLogEntry(rev: number, body: string): string {
    return [
      SEP,
      `r${rev} | dev | 2024-01-01 10:00:00 +0800 (Mon, 01 Jan 2024) | 1 line`,
      '',
      body,
    ].join('\n');
  }

  test('returns empty map for empty revisions list', () => {
    mockSvn({}, WS);
    const result = svnLogBatch([], FROM);
    assert.equal(result.size, 0);
  });

  test('fetches and parses log for multiple revisions in one batch', () => {
    const logOutput = [
      makeLogEntry(1001, 'First commit message'),
      makeLogEntry(1002, 'Second commit message'),
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);
    const result = svnLogBatch([1001, 1002], FROM);
    assert.ok(result.get(1001)!.includes('First commit message'));
    assert.ok(result.get(1002)!.includes('Second commit message'));
  });

  test('maps missing revisions to empty string when only some have log entries', () => {
    const logOutput = [
      makeLogEntry(1001, 'Only one entry returned'),
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);
    const result = svnLogBatch([1001, 1099], FROM);
    assert.ok(result.has(1001));
    assert.ok(result.has(1099));
    assert.equal(result.get(1099), '');
  });
});

// ── svnCommit ─────────────────────────────────────────────────────────────────

describe('svnCommit', () => {
  test('returns stdout on successful commit', () => {
    mockSvn({ commit: { exitCode: 0, stdout: 'Committed revision 5000.\n' } }, WS);
    const out = svnCommit(WS, 'Merge message');
    assert.ok(out.includes('5000'));
  });

  test('throws on non-zero exit code', () => {
    mockSvn({ commit: { exitCode: 1, stdout: '', stderr: 'svn: E200009: locked' } }, WS);
    assert.throws(() => svnCommit(WS, 'Merge message'), /svn commit failed/);
  });

  test('commits specific target paths when provided', () => {
    mockSvn({ commit: { exitCode: 0, stdout: 'Committed revision 5001.\n' } }, WS);
    const targets = [path.join(WS, 'src', 'a.ts'), path.join(WS, 'src', 'b.ts')];
    assert.doesNotThrow(() => svnCommit(WS, 'msg', targets));
    const log = getSvnCallLog();
    const commitCall = log.find((c) => c.subcmd === 'commit')!;
    assert.ok(commitCall.args.includes(targets[0]));
    assert.ok(commitCall.args.includes(targets[1]));
  });
});
