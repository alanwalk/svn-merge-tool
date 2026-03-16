/**
 * svn-mock.ts — Module-level spawnSync interceptor for automated SVN tests.
 *
 * Since Node.js spawnSync cannot run .cmd files on Windows without shell:true,
 * we mock child_process.spawnSync directly at the module level.
 *
 * Usage:
 *   mockSvn(scenario, workspace)   — install the mock
 *   restoreSvn()                   — remove the mock
 *   getSvnCallLog()                — inspect which svn calls were made
 */

import type * as childProcess from 'child_process';

// Get the REAL child_process module object (not TypeScript's __importStar wrapper
// which creates non-configurable getters).  This IS directly patchable.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const realCP: typeof childProcess = require('child_process');

export interface SvnResponse {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

/** Each entry is one response, or an array cycled on successive calls to the same subcommand. */
export type SvnScenario = {
  [subcmd: string]: SvnResponse | SvnResponse[];
};

export interface SvnCallRecord {
  subcmd: string;
  args: string[];
}

// ── Internal state ────────────────────────────────────────────────────────────

const callCounts: Record<string, number> = {};
let currentScenario: SvnScenario = {};
let currentWorkspace = '';
let callLog: SvnCallRecord[] = [];

// Save original once at module load time.
const originalSpawnSync: typeof childProcess.spawnSync = realCP.spawnSync;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchSpawnSync(fn: any): void {
  (realCP as any).spawnSync = fn;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

function substitute(text: string, workspace: string): string {
  return text
    .replace(/\{\{workspace\}\}/g, workspace)
    .replace(/\{\{workspace_fwd\}\}/g, workspace.replace(/\\/g, '/'));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Install the SVN mock. Every spawnSync('svn', ...) call will be handled
 * by the scenario map instead of the real SVN binary.
 *
 * @param scenario  Response map keyed by SVN subcommand ('merge', 'status', …)
 * @param workspace Substituted for {{workspace}} placeholders in stdout/stderr
 */
export function mockSvn(scenario: SvnScenario, workspace = '/fake/workspace'): void {
  // Reset state
  Object.keys(callCounts).forEach((k) => delete callCounts[k]);
  callLog = [];
  currentScenario = scenario;
  currentWorkspace = workspace;

  patchSpawnSync((
    cmd: string,
    args: string[],
    _opts: unknown,
  ) => {
    // Pass-through anything that is not 'svn'
    if (cmd !== 'svn') {
      return originalSpawnSync(cmd, args as string[], _opts as Parameters<typeof realCP.spawnSync>[2]);
    }

    const subcmd = (args as string[])[0] ?? '';
    callLog.push({ subcmd, args: args as string[] });

    // Pick response
    const entry = currentScenario[subcmd];
    let response: SvnResponse = { exitCode: 0, stdout: '', stderr: '' };

    if (entry !== undefined) {
      if (Array.isArray(entry)) {
        const idx = callCounts[subcmd] ?? 0;
        callCounts[subcmd] = idx + 1;
        response = entry[Math.min(idx, entry.length - 1)];
      } else {
        response = entry;
      }
    }

    const stdout = substitute(response.stdout ?? '', currentWorkspace);
    const stderr = substitute(response.stderr ?? '', currentWorkspace);

    return {
      pid: 99999,
      output: [null, makeBuffer(stdout), makeBuffer(stderr)],
      stdout: makeBuffer(stdout),
      stderr: makeBuffer(stderr),
      status: response.exitCode,
      signal: null,
    };
  });
}

/** Remove the SVN mock and restore the original spawnSync. */
export function restoreSvn(): void {
  patchSpawnSync(originalSpawnSync);
}

/** Return a snapshot of all SVN calls made since the last mockSvn() call. */
export function getSvnCallLog(): SvnCallRecord[] {
  return [...callLog];
}
