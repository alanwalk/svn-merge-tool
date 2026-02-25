import * as fs from 'fs';
import * as path from 'path';

import { ConflictType } from './types';

/**
 * Return a workspace-relative path, using forward slashes.
 * If the path is not under workspace, return the original absolute path.
 */
export function relPath(absPath: string, workspace: string): string {
  const rel = path.relative(workspace, absPath);
  // path.relative returns absolute if on different Windows drive
  if (path.isAbsolute(rel)) return absPath.replace(/\\/g, '/');
  return rel.replace(/\\/g, '/');
}

/**
 * Detect whether a path refers to a directory.
 * Tries fs.stat first; falls back to absence of file extension as heuristic
 * (handles tree-conflict paths that may no longer exist on disk).
 */
export function isDir(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    // Path doesn't exist — use extension heuristic
    return path.extname(absPath) === '';
  }
}

/**
 * Normalise a path to forward-slash lowercase for comparison.
 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Check whether `absPath` matches any entry in `ignorePaths`.
 * `ignorePaths` contains workspace-relative paths (files or folders).
 * A folder entry also matches any file/folder nested inside it.
 */
export function isIgnored(absPath: string, workspace: string, ignorePaths: string[]): boolean {
  if (ignorePaths.length === 0) return false;
  const rel = normPath(relPath(absPath, workspace));
  for (const pattern of ignorePaths) {
    const norm = normPath(pattern);
    // Exact match or absPath is inside the ignored directory
    if (rel === norm || rel.startsWith(norm + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Compress a sorted list of revision numbers into a human-readable string.
 * Consecutive sequences become ranges: [1,2,3,5,6] → "1-3, 5-6"
 */
export function compressRevisions(revisions: number[]): string {
  if (revisions.length === 0) return '';
  const sorted = [...revisions].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      parts.push(start === end ? `${start}` : `${start}-${end}`);
      start = sorted[i];
      end = sorted[i];
    }
  }
  parts.push(start === end ? `${start}` : `${start}-${end}`);
  return parts.join(', ');
}

/**
 * Extract the last path segment of a URL to use as branch label.
 * e.g. "https://svn.example.com/repos/project/trunk" → "trunk"
 */
export function branchName(url: string): string {
  return url.replace(/\/$/, '').split('/').pop() ?? url;
}

/** Sort order for conflict types: tree first, then text, then property */
function typeOrder(type: ConflictType): number {
  switch (type) {
    case 'tree':     return 0;
    case 'text':     return 1;
    case 'property': return 2;
  }
}

/**
 * Sort conflict entries by:
 *   1. revision ascending
 *   2. conflict type (tree → text → property)
 *   3. relative path ascending
 */
export function sortConflicts<T extends { revision: number; type: ConflictType; relPath: string }>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    if (a.revision !== b.revision) return a.revision - b.revision;
    const td = typeOrder(a.type) - typeOrder(b.type);
    if (td !== 0) return td;
    return a.relPath.localeCompare(b.relPath);
  });
}

export interface SummaryEntry {
  type: ConflictType;
  isDirectory: boolean;
  relPath: string;
  resolution: string;
  ignored: boolean;
}

/**
 * Collect all conflicts from results, deduplicate by relPath,
 * group by type (tree → text → property), and sort by path within each group.
 */
export function groupSummaryByType(
  results: Array<{ conflicts: Array<{ type: ConflictType; isDirectory: boolean; path: string; resolution: string; ignored: boolean }> }>,
  workspace: string
): Map<ConflictType, SummaryEntry[]> {
  const seen = new Set<string>();
  const groups: Map<ConflictType, SummaryEntry[]> = new Map([
    ['tree', []],
    ['text', []],
    ['property', []],
  ]);

  for (const result of results) {
    for (const c of result.conflicts) {
      const rel = relPath(c.path, workspace);
      const key = `${c.type}:${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.get(c.type)!.push({
        type: c.type,
        isDirectory: c.isDirectory,
        relPath: rel,
        resolution: c.ignored ? 'ignored' : c.resolution,
        ignored: c.ignored,
      });
    }
  }

  // Sort each group: non-ignored first (by path), then ignored (by path)
  for (const [, entries] of groups) {
    entries.sort((a, b) => {
      if (a.ignored !== b.ignored) return a.ignored ? 1 : -1;
      return a.relPath.localeCompare(b.relPath);
    });
  }

  return groups;
}

/**
 * Format a single conflict line for display:
 *   [TREE][D] src/module/foo/bar   (working)
 *   [TEXT][F] src/config/hero/buff.xlsx   (theirs-full)
 */
export function formatConflictLine(
  type: ConflictType,
  directory: boolean,
  rel: string,
  resolution: string
): string {
  const typeTag = `[${type.toUpperCase().padEnd(8)}]`;
  const kindTag = directory ? '[D]' : '[F]';
  return `${typeTag}${kindTag}  ${rel}  (${resolution})`;
}
