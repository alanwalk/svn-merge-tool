import { tr } from './i18n';
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
  lang: 'zh-CN' | 'en' = 'en',
): string {
  const branch = branchName(fromUrl);

  // Only include successfully merged revisions
  const mergedRevisions = summary.results
    .filter((r) => r.success)
    .map((r) => r.revision)
    .sort((a, b) => a - b);

  const header = tr(
    lang,
    `Merged revision(s) ${compressRevisions(mergedRevisions)} from ${branch}:`,
    `从 ${branch} 合并修订 ${compressRevisions(mergedRevisions)}：`
  );
  const lines: string[] = [header];

  process.stdout.write(tr(lang, '  Fetching revision logs...\r', '  正在获取修订日志...\r'));
  const logMap = svnLogBatch(mergedRevisions, fromUrl);
  process.stdout.write(' '.repeat(40) + '\r');

  for (const rev of mergedRevisions) {
    const body = logMap.get(rev) ?? '';
    if (body) {
      lines.push(body);
    } else {
      lines.push(tr(lang, `(no log message for r${rev})`, `（r${rev} 无日志消息）`));
    }
    lines.push(ENTRY_SEP);
  }

  return lines.join('\n') + '\n';
}
