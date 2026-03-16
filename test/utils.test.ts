/**
 * utils.test.ts — Unit tests for src/utils.ts (pure functions, no SVN required)
 */

import * as fs from 'fs';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import {
    branchName, compressRevisions, formatConflictLine, groupSummaryByType, isDir, isIgnored,
    relPath, sortConflicts
} from '../src/utils';

// ── relPath ───────────────────────────────────────────────────────────────────

describe('relPath', () => {
  const ws = path.join(os.tmpdir(), 'svn-test-workspace');

  test('returns workspace-relative path with forward slashes', () => {
    const abs = path.join(ws, 'src', 'app.ts');
    assert.equal(relPath(abs, ws), 'src/app.ts');
  });

  test('handles nested paths', () => {
    const abs = path.join(ws, 'src', 'sub', 'deep', 'file.ts');
    assert.equal(relPath(abs, ws), 'src/sub/deep/file.ts');
  });

  test('returns path with forward slashes when not under workspace', () => {
    const abs = path.join(os.tmpdir(), 'other', 'file.ts');
    const result = relPath(abs, ws);
    // On different drives (Windows) or different roots, should not throw
    assert.ok(typeof result === 'string');
    assert.ok(!result.includes('\\'));
  });

  test('returns empty string for workspace root itself (same path)', () => {
    // path.relative(ws, ws) returns '' on all platforms
    const result = relPath(ws, ws);
    assert.equal(result, '');
  });
});

// ── isDir ─────────────────────────────────────────────────────────────────────

describe('isDir', () => {
  test('returns true for an existing directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isdir-test-'));
    try {
      assert.equal(isDir(dir), true);
    } finally {
      fs.rmdirSync(dir);
    }
  });

  test('returns false for an existing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isdir-test-'));
    const file = path.join(dir, 'test.ts');
    try {
      fs.writeFileSync(file, '');
      assert.equal(isDir(file), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns false for non-existent path with extension (heuristic)', () => {
    assert.equal(isDir('/nonexistent/path/file.ts'), false);
  });

  test('returns true for non-existent path without extension (heuristic)', () => {
    assert.equal(isDir('/nonexistent/path/dirname'), true);
  });
});

// ── isIgnored ─────────────────────────────────────────────────────────────────

describe('isIgnored', () => {
  const ws = path.join(os.tmpdir(), 'svn-test-ws');

  test('returns false when ignore list is empty', () => {
    assert.equal(isIgnored(path.join(ws, 'src', 'app.ts'), ws, []), false);
  });

  test('returns true for exact file match', () => {
    const abs = path.join(ws, 'src', 'generated.ts');
    assert.equal(isIgnored(abs, ws, ['src/generated.ts']), true);
  });

  test('returns true for file inside ignored directory', () => {
    const abs = path.join(ws, 'thirdparty', 'lib', 'module.js');
    assert.equal(isIgnored(abs, ws, ['thirdparty']), true);
  });

  test('returns false for unrelated path', () => {
    const abs = path.join(ws, 'src', 'app.ts');
    assert.equal(isIgnored(abs, ws, ['thirdparty', 'vendor']), false);
  });

  test('matching is case-insensitive (Windows paths)', () => {
    const abs = path.join(ws, 'Thirdparty', 'Lib.ts');
    assert.equal(isIgnored(abs, ws, ['thirdparty/lib.ts']), true);
  });

  test('directory prefix does not match different directory with same prefix', () => {
    const abs = path.join(ws, 'srcgen', 'file.ts');
    // 'src' should NOT match 'srcgen/file.ts'
    assert.equal(isIgnored(abs, ws, ['src']), false);
  });
});

// ── compressRevisions ─────────────────────────────────────────────────────────

describe('compressRevisions', () => {
  test('returns empty string for empty input', () => {
    assert.equal(compressRevisions([]), '');
  });

  test('returns single number as string', () => {
    assert.equal(compressRevisions([42]), '42');
  });

  test('compresses consecutive sequence into range', () => {
    assert.equal(compressRevisions([1, 2, 3, 4, 5]), '1-5');
  });

  test('preserves gaps between ranges', () => {
    assert.equal(compressRevisions([1, 2, 3, 5, 6]), '1-3, 5-6');
  });

  test('handles mixed singles and ranges', () => {
    assert.equal(compressRevisions([1, 3, 4, 5, 7, 9, 10]), '1, 3-5, 7, 9-10');
  });

  test('sorts unsorted input before compressing', () => {
    assert.equal(compressRevisions([5, 3, 1, 2, 4]), '1-5');
  });
});

// ── branchName ────────────────────────────────────────────────────────────────

describe('branchName', () => {
  test('extracts last path segment from URL', () => {
    assert.equal(branchName('http://svn.example.com/repos/project/trunk'), 'trunk');
  });

  test('handles trailing slash', () => {
    assert.equal(branchName('http://svn.example.com/repos/branches/feature/'), 'feature');
  });

  test('works for branch names', () => {
    assert.equal(branchName('svn+ssh://svn.example.com/repos/branches/release-1.0'), 'release-1.0');
  });

  test('returns full URL if no slash', () => {
    assert.equal(branchName('trunk'), 'trunk');
  });
});

// ── sortConflicts ─────────────────────────────────────────────────────────────

describe('sortConflicts', () => {
  test('sorts by revision ascending', () => {
    const input = [
      { revision: 200, type: 'text' as const, relPath: 'a.ts' },
      { revision: 100, type: 'text' as const, relPath: 'a.ts' },
    ];
    const result = sortConflicts(input);
    assert.equal(result[0].revision, 100);
    assert.equal(result[1].revision, 200);
  });

  test('sorts by type order within same revision (tree → text → property)', () => {
    const input = [
      { revision: 100, type: 'property' as const, relPath: 'a.ts' },
      { revision: 100, type: 'text'     as const, relPath: 'a.ts' },
      { revision: 100, type: 'tree'     as const, relPath: 'a.ts' },
    ];
    const result = sortConflicts(input);
    assert.equal(result[0].type, 'tree');
    assert.equal(result[1].type, 'text');
    assert.equal(result[2].type, 'property');
  });

  test('sorts by relPath within same revision and type', () => {
    const input = [
      { revision: 100, type: 'text' as const, relPath: 'src/z.ts' },
      { revision: 100, type: 'text' as const, relPath: 'src/a.ts' },
    ];
    const result = sortConflicts(input);
    assert.equal(result[0].relPath, 'src/a.ts');
    assert.equal(result[1].relPath, 'src/z.ts');
  });
});

// ── groupSummaryByType ────────────────────────────────────────────────────────

describe('groupSummaryByType', () => {
  const ws = path.join(os.tmpdir(), 'svn-group-test');

  test('groups conflicts by type', () => {
    const results = [
      {
        conflicts: [
          { type: 'text'     as const, isDirectory: false, path: path.join(ws, 'a.ts'), resolution: 'theirs-full', ignored: false },
          { type: 'tree'     as const, isDirectory: true,  path: path.join(ws, 'dir'),  resolution: 'working',     ignored: false },
          { type: 'property' as const, isDirectory: false, path: path.join(ws, 'b.ts'), resolution: 'theirs-full', ignored: false },
        ],
      },
    ];
    const groups = groupSummaryByType(results, ws);
    assert.equal(groups.get('text')!.length, 1);
    assert.equal(groups.get('tree')!.length, 1);
    assert.equal(groups.get('property')!.length, 1);
  });

  test('deduplicates conflicts with the same type and relPath', () => {
    const results = [
      { conflicts: [{ type: 'text' as const, isDirectory: false, path: path.join(ws, 'dup.ts'), resolution: 'theirs-full', ignored: false }] },
      { conflicts: [{ type: 'text' as const, isDirectory: false, path: path.join(ws, 'dup.ts'), resolution: 'theirs-full', ignored: false }] },
    ];
    const groups = groupSummaryByType(results, ws);
    assert.equal(groups.get('text')!.length, 1);
  });

  test('ignored entries appear as resolution=ignored', () => {
    const results = [
      { conflicts: [{ type: 'text' as const, isDirectory: false, path: path.join(ws, 'ignored.ts'), resolution: 'working', ignored: true }] },
    ];
    const groups = groupSummaryByType(results, ws);
    assert.equal(groups.get('text')![0].resolution, 'ignored');
  });
});

// ── formatConflictLine ────────────────────────────────────────────────────────

describe('formatConflictLine', () => {
  test('formats text conflict on a file', () => {
    const line = formatConflictLine('text', false, 'src/app.ts', 'theirs-full');
    assert.equal(line, '[TEXT    ][F]  src/app.ts  (theirs-full)');
  });

  test('formats tree conflict on a directory', () => {
    const line = formatConflictLine('tree', true, 'src/dir', 'working');
    assert.equal(line, '[TREE    ][D]  src/dir  (working)');
  });

  test('formats property conflict', () => {
    const line = formatConflictLine('property', false, 'src/file.xml', 'theirs-full');
    assert.equal(line, '[PROPERTY][F]  src/file.xml  (theirs-full)');
  });

  test('shows ignored resolution label', () => {
    const line = formatConflictLine('text', false, 'vendor/lib.ts', 'ignored');
    assert.equal(line, '[TEXT    ][F]  vendor/lib.ts  (ignored)');
  });
});
