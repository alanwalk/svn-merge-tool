import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import * as os from 'os';
import * as path from 'path';

const RC_PATH = path.join(os.homedir(), '.svnmergerc');
const STATE_PATH = path.join(os.homedir(), '.svnmergerc.state.json');
const PACKAGE_NAME = 'svn-merge-tool';
const NPM_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;

const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;

const DEFAULT_RC = `# svn-merge-tool user configuration
# https://github.com/alanwalk/svn-merge-tool

# Check for updates on startup
# Set to false to disable update checks
checkUpdate: true

# Update check interval in seconds
# 86400 = 24 hours (default), 3600 = 1 hour, 0 = check every startup
checkInterval: 86400
`;

// ─── RC Config ────────────────────────────────────────────────────────────────

interface RcConfig {
  checkUpdate: boolean;
  checkInterval: number;
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
    return {
      checkUpdate: parsed['checkUpdate'] !== false,
      checkInterval:
        typeof parsed['checkInterval'] === 'number' ? parsed['checkInterval'] : 86400,
    };
  } catch {
    return { checkUpdate: true, checkInterval: 86400 };
  }
}

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
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [ca, cb, cc] = parse(current);
  const [la, lb, lc] = parse(latest);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
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
export function checkForUpdate(currentVersion: string): void {
  const rc = loadOrCreateRc();
  if (!rc.checkUpdate) return;

  const state = loadState();
  const now = Date.now();
  const intervalMs = rc.checkInterval * 1000;

  if (intervalMs > 0 && now - state.lastCheckTime < intervalMs) return;

  // Persist timestamp before network call to avoid hammering on slow connections
  saveState({ lastCheckTime: now });

  const latest = fetchLatestVersionSync();
  if (!latest) return;

  if (!isNewer(currentVersion, latest)) return;

  console.log(CYAN(`\nUpdate available: v${currentVersion} → v${latest}`));
  console.log(CYAN(`  ${NPM_URL}\n`));

  if (promptYN(YELLOW(`Run "npm install -g ${PACKAGE_NAME}" now? [y/N] `))) {
    console.log(CYAN(`\nRunning: npm install -g ${PACKAGE_NAME} ...`));
    const result = spawnSync('npm', ['install', '-g', PACKAGE_NAME], {
      stdio: 'inherit',
      shell: true,
    });
    if (result.status === 0) {
      console.log(GREEN('\nUpdate successful! Please restart the command.\n'));
      process.exit(0);
    } else {
      console.log(YELLOW(`\nUpdate failed. Please run manually:\n  npm install -g ${PACKAGE_NAME}\n`));
    }
  } else {
    console.log();
  }
}
