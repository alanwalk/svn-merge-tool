#!/usr/bin/env node
/**
 * fake-svn.js — Fake SVN command for testing
 *
 * Usage:
 *   1. Set FAKE_SVN_SCENARIO to the path of a JSON scenario file
 *   2. Set FAKE_SVN_WORKSPACE to the workspace path (used for {{workspace}} substitution)
 *   3. Invoke as "svn" by prepending the fake-svn-bin/ directory to PATH
 *
 * Scenario file format (JSON):
 * {
 *   "info":      { "exitCode": 0, "stdout": "...", "stderr": "" },
 *   "status":    { "exitCode": 0, "stdout": "M       {{workspace}}/src/app.ts\n" },
 *   "merge":     { "exitCode": 0, "stdout": "U  {{workspace}}/src/app.ts\n" },
 *   "resolve":   { "exitCode": 0, "stdout": "" },
 *   "revert":    { "exitCode": 0, "stdout": "" },
 *   "update":    { "exitCode": 0, "stdout": "At revision 1234.\n" },
 *   "mergeinfo": { "exitCode": 0, "stdout": "r1001\nr1002\nr1003\n" },
 *   "log":       { "exitCode": 0, "stdout": "..." },
 *   "commit":    { "exitCode": 0, "stdout": "Committed revision 2000.\n" }
 * }
 *
 * Each value may also be an array of responses (cycled through on successive calls):
 * {
 *   "status": [
 *     { "exitCode": 0, "stdout": "" },
 *     { "exitCode": 0, "stdout": "C       {{workspace}}/src/file.ts\n" }
 *   ]
 * }
 *
 * Placeholders in stdout/stderr:
 *   {{workspace}}      → replaced with FAKE_SVN_WORKSPACE (OS path separators)
 *   {{workspace_fwd}}  → replaced with FAKE_SVN_WORKSPACE (forward slashes)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Environment ──────────────────────────────────────────────────────────────

const scenarioFile = process.env.FAKE_SVN_SCENARIO;
const workspace = process.env.FAKE_SVN_WORKSPACE || process.cwd();

if (!scenarioFile) {
    process.stderr.write('[fake-svn] Error: FAKE_SVN_SCENARIO environment variable is not set.\n');
    process.stderr.write('[fake-svn] Set it to the path of a JSON scenario file.\n');
    process.exit(1);
}

// ── Load scenario ─────────────────────────────────────────────────────────────

let scenario;
try {
    scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
} catch (e) {
    process.stderr.write(`[fake-svn] Failed to read/parse scenario file "${scenarioFile}":\n${e.message}\n`);
    process.exit(1);
}

// ── Parse SVN arguments ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const subcmd = args[0] || '(none)';

// ── Call counter (for array-of-responses scenarios) ───────────────────────────
// We track the call count per subcommand using a separate counter file next to the scenario.

const counterFile = scenarioFile + '.' + subcmd + '.counter';
let callCount = 0;
try {
    const raw = fs.readFileSync(counterFile, 'utf8').trim();
    callCount = parseInt(raw, 10) || 0;
} catch {
    // First call — start at 0
}

try {
    fs.writeFileSync(counterFile, String(callCount + 1));
} catch {
    // Best-effort; don't fail the fake command
}

// ── Resolve response ───────────────────────────────────────────────────────────

const entry = scenario[subcmd];
let response = { exitCode: 0, stdout: '', stderr: '' };

if (entry !== undefined) {
    if (Array.isArray(entry)) {
        // Use call count to pick the right response; clamp to last entry
        response = entry[Math.min(callCount, entry.length - 1)];
    } else {
        response = entry;
    }
}

// ── Placeholder substitution ───────────────────────────────────────────────────

function substitute(text) {
    if (!text) return '';
    return text
        .replace(/\{\{workspace\}\}/g, workspace)
        .replace(/\{\{workspace_fwd\}\}/g, workspace.replace(/\\/g, '/'));
}

// ── Emit output ────────────────────────────────────────────────────────────────

const stdout = substitute(response.stdout || '');
const stderr = substitute(response.stderr || '');

if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

process.exit(typeof response.exitCode === 'number' ? response.exitCode : 0);
