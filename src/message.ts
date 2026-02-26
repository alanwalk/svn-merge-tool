import * as fs from 'fs';
import * as path from 'path';

import { svnLogBatch } from './svn';
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
  startTs: string,
): void {
  const outPath = path.join(outputDir, `${startTs}-message.txt`);
  const branch = branchName(fromUrl);

  // Only include successfully merged revisions
  const mergedRevisions = summary.results
    .filter((r) => r.success)
    .map((r) => r.revision)
    .sort((a, b) => a - b);

  const header = `Merged revision(s) ${compressRevisions(mergedRevisions)} from ${branch}:`;
  const lines: string[] = [header];

  process.stdout.write('  Fetching revision logs...\r');
  const logMap = svnLogBatch(mergedRevisions, fromUrl);
  process.stdout.write(' '.repeat(40) + '\r');

  for (const rev of mergedRevisions) {
    const body = logMap.get(rev) ?? '';
    if (body) {
      lines.push(body);
    } else {
      lines.push(`(no log message for r${rev})`);
    }
    lines.push(ENTRY_SEP);
  }

  try {
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Warning: could not write message file "${outPath}": ${msg}\n`);
  }

  return;
}

export function getMessageFilePath(outputDir: string, startTs: string): string {
  return path.join(outputDir, `${startTs}-message.txt`);
}
