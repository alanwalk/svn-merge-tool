/**
 * SQLite-backed cache for SVN log entries.
 * DB file is stored at <cacheDir>/logcache.db.
 * Uses Node.js built-in `node:sqlite` (available since Node 22.5, stable in Node 24).
 */

import * as fs from 'fs';
import * as path from 'path';

import { LogEntry } from './types';

// ─── Load node:sqlite, suppressing the ExperimentalWarning ──────────────────
// We use require() (not import) so we can install a warning filter first.
type DatabaseSync = import('node:sqlite').DatabaseSync;
type StatementSync = import('node:sqlite').StatementSync;

interface SqliteModule {
  DatabaseSync: new (dbPath: string) => DatabaseSync;
}

function loadSqlite(): SqliteModule {
  // Temporarily suppress the SQLite experimental warning (just noise)
  const origEmitWarning = process.emitWarning;
  process.emitWarning = function suppressSqlite(warning, ...rest) {
    const msg = typeof warning === 'string' ? warning : (warning as Error).message ?? '';
    if (msg.includes('SQLite')) return;
    // @ts-expect-error — forward all original arguments as-is
    return origEmitWarning.call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:sqlite') as SqliteModule;
  } finally {
    process.emitWarning = origEmitWarning;
  }
}

// ─── LogCache class ───────────────────────────────────────────────────────────

export class LogCache {
  private db: DatabaseSync;
  private readonly fromUrl: string;

  constructor(cacheDir: string, fromUrl: string) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const dbPath = path.join(cacheDir, 'logcache.db');

    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(dbPath);
    this.fromUrl = fromUrl;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS log_entries (
        from_url  TEXT    NOT NULL,
        revision  INTEGER NOT NULL,
        author    TEXT    NOT NULL DEFAULT '',
        date      TEXT    NOT NULL DEFAULT '',
        message   TEXT    NOT NULL DEFAULT '',
        paths     TEXT    NOT NULL DEFAULT '[]',
        PRIMARY KEY (from_url, revision)
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_url_rev ON log_entries(from_url, revision DESC)`
    );
  }

  /**
   * Try to load a page of entries from cache.
   * Returns LogEntry[] if the cache has at least `limit` entries with revision <= startRev.
   * Returns null if not enough data is cached (caller should fetch from SVN).
   *
   * @param startRev  The upper bound revision (inclusive)
   * @param limit     How many entries to return
   * @param allowPartial  If true, return whatever is cached even if < limit
   *                      (used when we know we're near the beginning of history)
   */
  getPage(startRev: number, limit: number, allowPartial = false): LogEntry[] | null {
    const stmt: StatementSync = this.db.prepare(
      `SELECT revision, author, date, message, paths
       FROM log_entries
       WHERE from_url = ? AND revision <= ?
       ORDER BY revision DESC
       LIMIT ?`
    );
    const rows = stmt.all(this.fromUrl, startRev, limit) as Array<{
      revision: number;
      author: string;
      date: string;
      message: string;
      paths: string;
    }>;

    if (!allowPartial && rows.length < limit) {
      return null; // cache miss — need to fetch from SVN
    }
    if (rows.length === 0) return null;

    return rows.map((r) => ({
      revision: r.revision,
      author: r.author,
      date: r.date,
      message: r.message,
      paths: (() => { try { return JSON.parse(r.paths) as string[]; } catch { return []; } })(),
    }));
  }

  /**
   * Upsert a batch of log entries into the cache.
   */
  saveEntries(entries: LogEntry[]): void {
    if (entries.length === 0) return;
    const stmt: StatementSync = this.db.prepare(
      `INSERT OR REPLACE INTO log_entries (from_url, revision, author, date, message, paths)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    // Wrap in a manual transaction for performance
    this.db.exec('BEGIN');
    try {
      for (const e of entries) {
        stmt.run(
          this.fromUrl,
          e.revision,
          e.author,
          e.date,
          e.message,
          JSON.stringify(e.paths ?? [])
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Return the lowest cached revision for this URL, or null if nothing is cached.
   */
  getMinCachedRevision(): number | null {
    const stmt: StatementSync = this.db.prepare(
      `SELECT MIN(revision) as min_rev FROM log_entries WHERE from_url = ?`
    );
    const row = stmt.get(this.fromUrl) as { min_rev: number | null } | undefined;
    return row?.min_rev ?? null;
  }

  /**
   * Return the total count of cached entries for this URL.
   */
  getCachedCount(): number {
    const stmt: StatementSync = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM log_entries WHERE from_url = ?`
    );
    const row = stmt.get(this.fromUrl) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
