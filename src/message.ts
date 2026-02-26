import * as fs from 'fs';
import * as path from 'path';

import { svnLog } from './svn';
import { MergeSummary } from './types';
import { branchName, compressRevisions } from './utils';

const ENTRY_SEP = '........';

/**
 * Generate and write svn-merge-message.txt to the current working directory.
 *
 * Format:
 *   Merged revision(s) 83247, 84556, 84587-84588 from trunk:
 *   #88279 Ticket title
 *   https://ones.example.com/...
 *   ........
 *   ...
 */
export function writeMessageFile(
  summary: MergeSummary,
  fromUrl: string,
  outputDir: string,
): void {
  const outPath = path.join(outputDir, 'svn-merge-message.txt');
  const branch = branchName(fromUrl);

  // Only include successfully merged revisions
  const mergedRevisions = summary.results
    .filter((r) => r.success)
    .map((r) => r.revision)
    .sort((a, b) => a - b);

  const header = `Merged revision(s) ${compressRevisions(mergedRevisions)} from ${branch}:`;
  const lines: string[] = [header];

  for (const rev of mergedRevisions) {
    process.stdout.write(`  Fetching log r${rev}...\r`);
    const body = svnLog(rev, fromUrl);
    if (body) {
      lines.push(body);
    } else {
      lines.push(`(no log message for r${rev})`);
    }
    lines.push(ENTRY_SEP);
  }
  // Clear the status line
  process.stdout.write(' '.repeat(40) + '\r');

  try {
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Warning: could not write message file "${outPath}": ${msg}\n`);
  }

  return;
}

export function getMessageFilePath(outputDir: string): string {
  return path.join(outputDir, 'svn-merge-message.txt');
}
