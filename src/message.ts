import { svnLogBatch } from './svn';
import { MergeSummary } from './types';
import { branchName, compressRevisions } from './utils';

const ENTRY_SEP = '........';

/**
 * Build the merge message string (to be appended to the log file).
 *
 * Format:
 *   Merged revision(s) 83247, 84556, 84587-84588 from trunk:
 *   #88279 Ticket title
 *   https://ones.example.com/...
 *   ........
 *   ...
 */
export function buildMessage(
  summary: MergeSummary,
  fromUrl: string,
): string {
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

  return lines.join('\n') + '\n';
}
