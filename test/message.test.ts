/**
 * message.test.ts — Tests for src/message.ts buildMessage()
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { buildMessage } from '../src/message';
import { MergeSummary } from '../src/types';
import { mockSvn, restoreSvn } from './svn-mock';

const FROM = 'http://svn.example.com/repos/project/trunk';
const WS   = path.join(os.tmpdir(), 'svn-message-test-ws');

afterEach(() => restoreSvn());

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEP = '------------------------------------------------------------------------';

function makeLogEntry(rev: number, body: string): string {
  return [
    SEP,
    `r${rev} | dev | 2024-01-01 10:00:00 +0800 (Mon, 01 Jan 2024) | 1 line`,
    '',
    body,
  ].join('\n');
}

function makeSuccessSummary(revisions: number[]): MergeSummary {
  return {
    total:         revisions.length,
    succeeded:     revisions.length,
    withConflicts: 0,
    failed:        0,
    results: revisions.map((revision) => ({
      revision,
      success:      true,
      conflicts:    [],
      reverted:     [],
      modified:     [],
    })),
  };
}

// ── buildMessage ──────────────────────────────────────────────────────────────

describe('buildMessage', () => {
  test('includes header with branch name and compressed revision list', () => {
    mockSvn({
      log: { exitCode: 0, stdout: makeLogEntry(1001, 'Fix bug #123') + '\n' + SEP + '\n' },
    }, WS);

    const msg = buildMessage(makeSuccessSummary([1001]), FROM);

    assert.ok(msg.includes('trunk'), 'Should contain branch name');
    assert.ok(msg.includes('1001'),  'Should contain revision number');
    assert.ok(msg.startsWith('Merged revision(s)'), 'Should start with Merged header');
  });

  test('includes log message body for each revision', () => {
    const logOutput = [
      makeLogEntry(1001, 'Fix important bug'),
      makeLogEntry(1002, 'Add new feature'),
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);

    const msg = buildMessage(makeSuccessSummary([1001, 1002]), FROM);

    assert.ok(msg.includes('Fix important bug'));
    assert.ok(msg.includes('Add new feature'));
  });

  test('uses (no log message) placeholder when svn log returns nothing', () => {
    mockSvn({ log: { exitCode: 0, stdout: '' } }, WS);

    const msg = buildMessage(makeSuccessSummary([1001]), FROM);

    assert.ok(msg.includes('(no log message for r1001)'));
  });

  test('excludes failed revisions from the message', () => {
    const logOutput = makeLogEntry(1001, 'Successful commit') + '\n' + SEP + '\n';
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);

    const summary: MergeSummary = {
      total:         2,
      succeeded:     1,
      withConflicts: 0,
      failed:        1,
      results: [
        { revision: 1001, success: true,  conflicts: [], reverted: [], modified: [] },
        { revision: 1002, success: false, conflicts: [], reverted: [], modified: [], errorMessage: 'fatal' },
      ],
    };

    const msg = buildMessage(summary, FROM);

    // Only r1001 should appear in the header
    assert.ok(msg.includes('1001'));
    assert.ok(!msg.includes('1002'), 'Failed revisions must not appear in message');
  });

  test('separates log body entries with the entry separator (........)', () => {
    const logOutput = [
      makeLogEntry(1001, 'Entry one'),
      makeLogEntry(1002, 'Entry two'),
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);

    const msg = buildMessage(makeSuccessSummary([1001, 1002]), FROM);

    assert.ok(msg.includes('........'), 'Should use entry separator between log bodies');
  });

  test('compresses consecutive revisions in the header', () => {
    const logOutput = [
      makeLogEntry(1001, 'A'),
      makeLogEntry(1002, 'B'),
      makeLogEntry(1003, 'C'),
      SEP,
    ].join('\n');
    mockSvn({ log: { exitCode: 0, stdout: logOutput } }, WS);

    const msg = buildMessage(makeSuccessSummary([1001, 1002, 1003]), FROM);

    assert.ok(msg.includes('1001-1003'), 'Consecutive revisions should be compressed to a range');
  });
});
