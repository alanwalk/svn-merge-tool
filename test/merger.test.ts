/**
 * merger.test.ts — Integration tests for src/merger.ts run() function.
 *
 * We exercise the full merge loop for each scenario:
 *   clean merge, text conflict, tree conflict, ignored-path conflict,
 *   ignored-path modification (reverted), fatal failure, multi-revision.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { Logger } from '../src/logger';
import { run } from '../src/merger';
import { MergeOptions } from '../src/types';
import { getSvnCallLog, mockSvn, restoreSvn } from './svn-mock';

const FROM = 'http://svn.example.com/repos/project/trunk';
const WS   = path.join(os.tmpdir(), 'svn-merger-test-ws');

afterEach(() => restoreSvn());

// ── Null logger (suppresses all file I/O during tests) ────────────────────────

function makeNullLogger(): Logger {
  return {
    log:        () => {},
    appendRaw:  () => {},
    close:      () => {},
    getLogPath: () => '/dev/null',
  } as unknown as Logger;
}

// ── Status-line helpers (same format as svn.test.ts) ─────────────────────────

function statusLine(col0 = ' ', col1 = ' ', col2 = ' ', col3 = ' ', col4 = ' ', col5 = ' ', col6 = ' ', filePath = ''): string {
  return `${col0}${col1}${col2}${col3}${col4}${col5}${col6} ${filePath}\n`;
}

function textConflict(p: string) { return statusLine('C', ' ', ' ', ' ', ' ', ' ', ' ', p); }
function treeConflict(p: string) { return statusLine(' ', ' ', ' ', ' ', ' ', ' ', 'C', p); }
function propConflict(p: string) { return statusLine(' ', 'C', ' ', ' ', ' ', ' ', ' ', p); }
function modified(p: string)     { return statusLine('M', ' ', ' ', ' ', ' ', ' ', ' ', p); }

function makeOptions(revisions: number[], ignorePaths: string[] = []): MergeOptions {
  return { workspace: WS, fromUrl: FROM, revisions, ignorePaths };
}

// ── Scenario: clean merge ─────────────────────────────────────────────────────

describe('run — clean merge', () => {
  test('single revision with no conflicts returns 1 succeeded', () => {
    const modFile = path.join(WS, 'src', 'app.ts');
    mockSvn({
      merge:  { exitCode: 0, stdout: `U  ${modFile}\n` },
      status: { exitCode: 0, stdout: modified(modFile) },
    }, WS);

    const summary = run(makeOptions([1001]), makeNullLogger());

    assert.equal(summary.total, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.withConflicts, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.results[0].revision, 1001);
    assert.equal(summary.results[0].success, true);
    assert.equal(summary.results[0].conflicts.length, 0);
    assert.equal(summary.results[0].modified.length, 1);
  });

  test('three clean revisions all succeed', () => {
    const modFile = path.join(WS, 'src', 'app.ts');
    mockSvn({
      merge:  { exitCode: 0, stdout: `U  ${modFile}\n` },
      status: { exitCode: 0, stdout: modified(modFile) },
    }, WS);

    const summary = run(makeOptions([1001, 1002, 1003]), makeNullLogger());

    assert.equal(summary.total, 3);
    assert.equal(summary.succeeded, 3);
    assert.equal(summary.failed, 0);
  });
});

// ── Scenario: text conflict ───────────────────────────────────────────────────

describe('run — text conflict', () => {
  test('text conflict is auto-resolved with theirs-full; counted as withConflicts', () => {
    const conflictFile = path.join(WS, 'src', 'conflict.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: `C  ${conflictFile}\n` },
      status:  { exitCode: 0, stdout: textConflict(conflictFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001]), makeNullLogger());

    assert.equal(summary.succeeded, 0);
    assert.equal(summary.withConflicts, 1);
    assert.equal(summary.failed, 0);

    const result = summary.results[0];
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'text');
    assert.equal(result.conflicts[0].resolution, 'theirs-full');
    assert.equal(result.conflicts[0].ignored, false);
  });

  test('resolve is called with theirs-full for text conflicts', () => {
    const conflictFile = path.join(WS, 'src', 'conflict.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: textConflict(conflictFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    run(makeOptions([1001]), makeNullLogger());

    const log = getSvnCallLog();
    const resolveCall = log.find((c) => c.subcmd === 'resolve')!;
    assert.ok(resolveCall, 'svn resolve should have been called');
    assert.ok(resolveCall.args.includes('theirs-full'));
  });
});

// ── Scenario: property conflict ───────────────────────────────────────────────

describe('run — property conflict', () => {
  test('property conflict is resolved with theirs-full', () => {
    const propFile = path.join(WS, 'src', 'props.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: propConflict(propFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001]), makeNullLogger());

    const result = summary.results[0];
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'property');
    assert.equal(result.conflicts[0].resolution, 'theirs-full');
  });
});

// ── Scenario: tree conflict ───────────────────────────────────────────────────

describe('run — tree conflict', () => {
  test('tree conflict is resolved with working strategy', () => {
    const dir = path.join(WS, 'src', 'module');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: treeConflict(dir) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001]), makeNullLogger());

    const result = summary.results[0];
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].type, 'tree');
    assert.equal(result.conflicts[0].resolution, 'working');
  });
});

// ── Scenario: ignored-path conflict ───────────────────────────────────────────

describe('run — ignored-path conflict', () => {
  test('conflict on ignored path is resolved with working and flagged ignored', () => {
    const ignoredFile = path.join(WS, 'vendor', 'lib.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: textConflict(ignoredFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001], ['vendor']), makeNullLogger());

    const result = summary.results[0];
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].ignored, true);
    // resolution is overridden to 'working' for ignored paths
    assert.equal(result.conflicts[0].resolution, 'working');
    // ignored conflict → revision counted as succeeded (not withConflicts)
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.withConflicts, 0);
  });

  test('auto-commit would NOT be blocked by an ignored conflict (ignored=true)', () => {
    // This test documents the gate logic: ignored=true means the conflict
    // should not block auto-commit; that check lives in index.ts but the
    // ConflictInfo.ignored flag is set here in merger.ts.
    const ignoredFile = path.join(WS, 'vendor', 'lib.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: textConflict(ignoredFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001], ['vendor']), makeNullLogger());
    const hasActiveConflict = summary.results[0].conflicts.some((c) => !c.ignored);
    assert.equal(hasActiveConflict, false, 'No active (non-ignored) conflicts should remain');
  });
});

// ── Scenario: ignored-path modification (reverted without conflict) ───────────

describe('run — ignored-path modification reverted', () => {
  test('modified file on ignored path is reverted and listed in result.reverted', () => {
    const ignoredFile = path.join(WS, 'vendor', 'lib.ts');
    mockSvn({
      merge:  { exitCode: 0, stdout: `M  ${ignoredFile}\n` },
      status: { exitCode: 0, stdout: modified(ignoredFile) },
      revert: { exitCode: 0, stdout: `Reverted '${ignoredFile}'\n` },
    }, WS);

    const summary = run(makeOptions([1001], ['vendor']), makeNullLogger());

    const result = summary.results[0];
    assert.equal(result.reverted.length, 1);
    assert.ok(result.reverted[0].path.includes('lib.ts'));
    // Reverted path should NOT appear in result.modified
    const modifiedPaths = result.modified.map((m) => m.path);
    assert.ok(!modifiedPaths.includes(ignoredFile));
  });

  test('svn revert is called for ignored modifications', () => {
    const ignoredFile = path.join(WS, 'vendor', 'lib.ts');
    mockSvn({
      merge:  { exitCode: 0, stdout: '' },
      status: { exitCode: 0, stdout: modified(ignoredFile) },
      revert: { exitCode: 0, stdout: '' },
    }, WS);

    run(makeOptions([1001], ['vendor']), makeNullLogger());

    const revertCalls = getSvnCallLog().filter((c) => c.subcmd === 'revert');
    assert.ok(revertCalls.length > 0, 'svn revert should have been called');
  });
});

// ── Scenario: fatal merge failure ────────────────────────────────────────────

describe('run — fatal merge failure', () => {
  test('non-zero exit with empty stdout is recorded as failed', () => {
    mockSvn({
      merge: { exitCode: 1, stdout: '', stderr: 'svn: E195016: merge source not specified' },
    }, WS);

    const summary = run(makeOptions([1001]), makeNullLogger());

    assert.equal(summary.failed, 1);
    assert.equal(summary.succeeded, 0);
    const result = summary.results[0];
    assert.equal(result.success, false);
    assert.ok(result.errorMessage!.includes('merge source not specified'));
  });

  test('failed revision does not call svn status or resolve', () => {
    mockSvn({
      merge: { exitCode: 1, stdout: '', stderr: 'fatal error' },
    }, WS);

    run(makeOptions([1001]), makeNullLogger());

    const log = getSvnCallLog();
    assert.ok(!log.some((c) => c.subcmd === 'status' || c.subcmd === 'resolve'),
      'status/resolve should not be called after fatal merge failure');
  });
});

// ── Scenario: mixed multi-revision merge ────────────────────────────────────

describe('run — mixed multi-revision', () => {
  test('correctly tallies succeeded, withConflicts, failed for three revisions', () => {
    const modFile      = path.join(WS, 'src', 'app.ts');
    const conflictFile = path.join(WS, 'src', 'conflict.ts');

    // Revision 1001: clean
    // Revision 1002: text conflict
    // Revision 1003: fatal failure
    mockSvn({
      merge: [
        { exitCode: 0, stdout: `U  ${modFile}\n` },            // r1001
        { exitCode: 0, stdout: `C  ${conflictFile}\n` },       // r1002
        { exitCode: 1, stdout: '', stderr: 'fatal svn error' }, // r1003
      ],
      status: [
        { exitCode: 0, stdout: modified(modFile) },            // after r1001
        { exitCode: 0, stdout: textConflict(conflictFile) },   // after r1002
        // r1003 fails at merge — status never called
      ],
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001, 1002, 1003]), makeNullLogger());

    assert.equal(summary.total, 3);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.withConflicts, 1);
    assert.equal(summary.failed, 1);
  });

  test('results array preserves order of revisions', () => {
    const modFile = path.join(WS, 'src', 'app.ts');
    mockSvn({
      merge:  { exitCode: 0, stdout: `U  ${modFile}\n` },
      status: { exitCode: 0, stdout: modified(modFile) },
    }, WS);

    const summary = run(makeOptions([3001, 3002, 3003]), makeNullLogger());

    assert.equal(summary.results[0].revision, 3001);
    assert.equal(summary.results[1].revision, 3002);
    assert.equal(summary.results[2].revision, 3003);
  });
});

// ── Scenario: non-ignored conflicts block withConflicts counter ───────────────

describe('run — summary counting edge cases', () => {
  test('revision with only ignored conflicts is counted as succeeded', () => {
    const ignoredFile = path.join(WS, 'vendor', 'x.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: textConflict(ignoredFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001], ['vendor']), makeNullLogger());

    assert.equal(summary.succeeded, 1);
    assert.equal(summary.withConflicts, 0);
  });

  test('revision with mixed ignored + active conflicts is counted as withConflicts', () => {
    const ignoredFile = path.join(WS, 'vendor', 'x.ts');
    const activeFile  = path.join(WS, 'src', 'active.ts');
    mockSvn({
      merge:   { exitCode: 0, stdout: '' },
      status:  { exitCode: 0, stdout: textConflict(ignoredFile) + textConflict(activeFile) },
      resolve: { exitCode: 0, stdout: '' },
    }, WS);

    const summary = run(makeOptions([1001], ['vendor']), makeNullLogger());

    assert.equal(summary.withConflicts, 1);
    assert.equal(summary.succeeded, 0);
  });
});
