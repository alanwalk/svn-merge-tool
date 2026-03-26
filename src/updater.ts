import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import * as os from 'os';
import * as path from 'path';

import { tr } from './i18n';
import { term } from './utils';

const RC_PATH = path.join(os.homedir(), '.svnmergerc');

function getStateDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? os.homedir(), 'svnmerge');
  }
  return path.join(os.homedir(), '.local', 'share', 'svnmerge');
}
const STATE_PATH = path.join(getStateDir(), 'state.json');
const PACKAGE_NAME = 'svn-merge-tool';
const NPM_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;

const DEFAULT_RC = `# svn-merge-tool user configuration
# https://github.com/alanwalk/svn-merge-tool

# Check for updates on startup
# Set to false to disable update checks
checkUpdate: true

# Update check interval in seconds
# 86400 = 24 hours (default), 3600 = 1 hour, 0 = check every startup
checkInterval: 86400

# Global ignore paths applied to every project (workspace-relative or absolute)
# These are merged with per-project ignore paths in svnmerge.yaml
# global-ignore:
#   - ResProject/ExternalConfig
#   - path/to/generated

# Copy merge message to clipboard after each run
# Set to false to disable
copyToClipboard: true
`;

// ─── RC Config ────────────────────────────────────────────────────────────────

export interface RcConfig {
  checkUpdate: boolean;
  checkInterval: number;
  globalIgnore: string[];
  copyToClipboard: boolean;
}

function loadOrCreateRc(): RcConfig {
  if (!fs.existsSync(RC_PATH)) {
    try {
      fs.writeFileSync(RC_PATH, DEFAULT_RC, 'utf8');
    } catch {
      // ignore write errors (e.g. read-only home directory)
    }
  }

  try {
    const raw = fs.readFileSync(RC_PATH, 'utf8');
    const parsed = (yamlLoad(raw) ?? {}) as Record<string, unknown>;
    const gi = parsed['global-ignore'];
    const globalIgnore: string[] = Array.isArray(gi)
      ? gi.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim())
      : [];
    return {
      checkUpdate: parsed['checkUpdate'] !== false,
      checkInterval:
        typeof parsed['checkInterval'] === 'number' ? parsed['checkInterval'] : 86400,
      globalIgnore,
      copyToClipboard: parsed['copyToClipboard'] !== false,
    };
  } catch {
    return { checkUpdate: true, checkInterval: 86400, globalIgnore: [], copyToClipboard: true };
  }
}

export { loadOrCreateRc };

// ─── State (last check timestamp) ────────────────────────────────────────────

interface StateData {
  lastCheckTime: number;
}

function loadState(): StateData {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as StateData;
    }
  } catch { /* ignore */ }
  return { lastCheckTime: 0 };
}

function saveState(state: StateData): void {
  try {
    fs.mkdirSync(getStateDir(), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state), 'utf8');
  } catch { /* ignore */ }
}

// ─── Version fetch (synchronous via spawned node script) ─────────────────────

function fetchLatestVersionSync(): string | null {
  const script = `
    const https = require('https');
    const req = https.get(
      'https://registry.npmjs.org/${PACKAGE_NAME}/latest',
      { headers: { 'User-Agent': 'svn-merge-tool-update-check' } },
      (res) => {
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
          try { process.stdout.write(JSON.parse(d).version || ''); } catch {}
        });
      }
    );
    req.on('error', () => {});
    req.setTimeout(5000, () => req.destroy());
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      timeout: 7000,
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.stdout?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Version comparison ───────────────────────────────────────────────────────

function isNewer(current: string, latest: string): boolean {
  const parse = (v: string): { major: number; minor: number; patch: number; prerelease: boolean } => {
    const clean = v.trim().replace(/^v/, '');
    const [core, prerelease] = clean.split('-', 2);
    const [major, minor, patch] = core.split('.').map((part) => parseInt(part, 10));
    return {
      major: Number.isFinite(major) ? major : 0,
      minor: Number.isFinite(minor) ? minor : 0,
      patch: Number.isFinite(patch) ? patch : 0,
      prerelease: !!prerelease,
    };
  };

  const c = parse(current);
  const l = parse(latest);
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  if (l.patch !== c.patch) return l.patch > c.patch;
  return !l.prerelease && c.prerelease;
}

// ─── Sync stdin prompt ────────────────────────────────────────────────────────

function promptYN(question: string): boolean {
  process.stdout.write(question);
  const buf = Buffer.alloc(16);
  try {
    const n = fs.readSync(0, buf, 0, buf.length, null);
    return buf.slice(0, n).toString().trim().toLowerCase() === 'y';
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check for a newer version on npm.
 * - Reads (or creates) ~/.svnmergerc for user preferences.
 * - Skips check if checkUpdate is false or interval has not elapsed.
 * - If a newer version is found, prints the npmjs URL and prompts to update.
 */
export function checkForUpdate(currentVersion: string, rc?: RcConfig, lang: 'zh-CN' | 'en' = 'en'): void {
  const resolvedRc = rc ?? loadOrCreateRc();
  if (!resolvedRc.checkUpdate) return;
  const effectiveRc = resolvedRc;

  const state = loadState();
  const now = Date.now();
  const intervalMs = effectiveRc.checkInterval * 1000;

  if (intervalMs > 0 && now - state.lastCheckTime < intervalMs) return;

  // Persist timestamp before network call to avoid hammering on slow connections
  saveState({ lastCheckTime: now });

  const latest = fetchLatestVersionSync();
  if (!latest) return;

  if (!isNewer(currentVersion, latest)) return;

  console.log(term.cyan(tr(lang, 'updateAvailable', { currentVersion, latestVersion: latest })));
  console.log(term.cyan(`  ${NPM_URL}\n`));

  if (promptYN(term.yellow(tr(lang, 'runNpmInstallNow', { packageName: PACKAGE_NAME })))) {
    console.log(term.cyan(tr(lang, 'runningNpmInstall', { packageName: PACKAGE_NAME })));
    const result = spawnSync('npm', ['install', '-g', PACKAGE_NAME], {
      stdio: 'inherit',
      shell: true,
    });
    if (result.status === 0) {
      console.log(term.green(tr(lang, 'updateSuccessfulRestart')));
      process.exit(0);
    } else {
      console.log(term.yellow(tr(lang, 'updateFailedRunManually', { packageName: PACKAGE_NAME })));
    }
  } else {
    console.log();
  }
}
