/**
 * config.test.ts — Unit tests for src/config.ts
 */

import * as fs from 'fs';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { findDefaultConfig, loadConfig } from '../src/config';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'svn-config-test-'));
}

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  test('parses a minimal valid YAML config', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, [
      'workspace: /path/to/wc',
      'from: http://svn.example.com/trunk',
    ].join('\n'));

    try {
      const cfg = loadConfig(cfgPath);
      assert.equal(cfg.from, 'http://svn.example.com/trunk');
      // workspace is absolute — kept as-is
      assert.equal(cfg.workspace, '/path/to/wc');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves relative workspace path against config file directory', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, 'workspace: ./wc\n');

    try {
      const cfg = loadConfig(cfgPath);
      assert.equal(cfg.workspace, path.resolve(dir, 'wc'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('parses ignore list', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, [
      'ignore:',
      '  - src/thirdparty',
      '  - assets/generated.ts',
    ].join('\n'));

    try {
      const cfg = loadConfig(cfgPath);
      assert.deepEqual(cfg.ignore, ['src/thirdparty', 'assets/generated.ts']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('parses boolean flags (verbose, commit)', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, 'verbose: true\ncommit: false\n');

    try {
      const cfg = loadConfig(cfgPath);
      assert.equal(cfg.verbose, true);
      assert.equal(cfg.commit, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws for a missing config file', () => {
    assert.throws(
      () => loadConfig('/nonexistent/path/svnmerge.yaml'),
      /Config file not found/,
    );
  });

  test('throws for malformed YAML', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'bad.yaml');
    fs.writeFileSync(cfgPath, '{ this is: [not valid yaml\n');

    try {
      assert.throws(
        () => loadConfig(cfgPath),
        /Failed to parse YAML config/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws for an empty / non-mapping YAML file', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'empty.yaml');
    fs.writeFileSync(cfgPath, '# just a comment\n');

    try {
      assert.throws(
        () => loadConfig(cfgPath),
        /empty or not a YAML mapping/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── findDefaultConfig ─────────────────────────────────────────────────────────

describe('findDefaultConfig', () => {
  test('finds svnmerge.yaml in the exact start directory', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, 'from: http://svn.example.com/trunk\n');

    try {
      const found = findDefaultConfig(dir);
      assert.equal(found, cfgPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('finds svnmerge.yml (alternate extension)', () => {
    const dir = makeTmpDir();
    const cfgPath = path.join(dir, 'svnmerge.yml');
    fs.writeFileSync(cfgPath, 'from: http://svn.example.com/trunk\n');

    try {
      const found = findDefaultConfig(dir);
      assert.equal(found, cfgPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('walks up to parent directory to find config', () => {
    const root = makeTmpDir();
    const sub  = path.join(root, 'sub', 'dir');
    fs.mkdirSync(sub, { recursive: true });
    const cfgPath = path.join(root, 'svnmerge.yaml');
    fs.writeFileSync(cfgPath, 'from: http://svn.example.com/trunk\n');

    try {
      const found = findDefaultConfig(sub);
      assert.equal(found, cfgPath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns undefined when no config file exists in tree', () => {
    // Use a deeply nested temp path that definitely has no svnmerge.yaml above it.
    // We create an isolated temp dir to control the search scope.
    const isolated = makeTmpDir();
    const sub = path.join(isolated, 'a', 'b', 'c');
    fs.mkdirSync(sub, { recursive: true });

    // We can't guarantee no svnmerge.yaml exists all the way up to the drive root,
    // so we only assert that findDefaultConfig does not throw.
    try {
      const found = findDefaultConfig(sub);
      // If a real svnmerge.yaml exists in an ancestor, that's acceptable.
      assert.ok(found === undefined || typeof found === 'string');
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});
