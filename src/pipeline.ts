/**
 * Shared merge execution pipeline used by both CLI and WebUI.
 *
 * All output is delegated to a RunLogger, so the same logic runs identically
 * in both contexts — the only difference is how log lines are displayed.
 *
 *   CLI    → writes to stdout + log file
 *   WebUI  → streams SSE events (section-start / log / section-end / done)
 */

import { tr } from './i18n';
import { run as mergerRun } from './merger';
import { buildMessage } from './message';
import { svnCommit, svnUpdate } from './svn';
import { MergeSummary } from './types';
import { compressRevisions, groupSummaryByType, relPath } from './utils';

export type SectionKind = 'info' | 'merge' | 'summary' | 'message' | 'commit';

/**
 * Abstract logger interface.
 * CLI adapter:   sectionStart/End → visual separator in terminal
 * WebUI adapter: sectionStart/End → SSE section-start/section-end events
 */
export interface RunLogger {
    log(text: string): void;
    appendRaw(text: string): void;
    /** Called when a major step begins. */
    sectionStart(title: string, kind?: SectionKind): void;
    /** Called when the current step finishes. ok=false → failure, else success. */
    sectionEnd(ok?: boolean): void;
}

export interface PipelineOptions {
    workspace: string;
    fromUrl: string;
    revisions: number[];
    lang?: 'zh-CN' | 'en';
    ignorePaths: string[];
    verbose: boolean;
    autoCommit: boolean;
    copyToClipboard: boolean;
}

export interface PipelineResult {
    summary: MergeSummary;
    mergeMessage: string;
    autoCommitAttempted: boolean;
    autoCommitOk: boolean;
    autoCommitOutput: string;
    autoCommitError: string;
}

/**
 * Execute the full merge pipeline:
 *   1. SVN Update
 *   2. Merge all revisions (via merger.run)
 *   3. Print conflict/revert summary
 *   4. Build & emit the merge commit message
 *   5. Auto-commit (if enabled)
 *
 * @param copyFn  Optional clipboard copy function. Called with merge message
 *                text when copyToClipboard=true.
 */
export function runMergePipeline(
    opts: PipelineOptions,
    logger: RunLogger,
    copyFn?: (text: string) => void,
): PipelineResult {
    const { workspace, fromUrl, revisions, ignorePaths, verbose, autoCommit } = opts;
    const lang = opts.lang ?? 'en';

    // ── 1. SVN Update ──────────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'SVN Update', 'SVN 更新'), 'info');
    svnUpdate(workspace, lang);
    logger.sectionEnd(true);

    // ── 2. Merge ───────────────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, `Merging ${revisions.length} revision(s)`, `正在合并 ${revisions.length} 个修订`), 'merge');
    const summary = mergerRun(
        { fromUrl, workspace, revisions, ignorePaths, verbose, lang },
        logger,   // ILogger — structurally compatible with merger's requirement
    );
    logger.sectionEnd(summary.failed === 0);

    // ── 3. Summary ─────────────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'Summary', '汇总'), 'summary');
    {
        const allReverted = summary.results.flatMap((r) => r.reverted ?? []);
        const uniqueReverted = [...new Map(allReverted.map((r) => [r.path, r])).values()];
        uniqueReverted.sort((a, b) =>
            relPath(a.path, workspace).localeCompare(relPath(b.path, workspace))
        );

        const hasActiveConflicts = summary.results.some((r) => r.conflicts.some((c) => !c.ignored));
        const hasIgnoredConflicts = summary.results.some((r) => r.conflicts.some((c) => c.ignored));

        // Failed revisions
        for (const result of summary.results) {
            if (!result.success) {
                logger.log(tr(lang, `  r${result.revision}  FAILED  ${result.errorMessage ?? ''}`, `  r${result.revision}  失败  ${result.errorMessage ?? ''}`));
            }
        }

        if (
            hasActiveConflicts ||
            summary.failed > 0 ||
            (verbose && (uniqueReverted.length > 0 || summary.withConflicts > 0 || hasIgnoredConflicts))
        ) {
            const groups = groupSummaryByType(summary.results, workspace);
            const typeLabels: Record<string, string> = {
                tree: tr(lang, 'Tree Conflicts', '树冲突'),
                text: tr(lang, 'Text Conflicts', '文本冲突'),
                property: tr(lang, 'Property Conflicts', '属性冲突'),
            };

            for (const [type, entries] of groups) {
                if (entries.length === 0) continue;
                const activeEntries = entries.filter((e) => !e.ignored);
                const ignoredEntries = entries.filter((e) => e.ignored);
                if (!verbose && activeEntries.length === 0) continue;
                const countLabel =
                    verbose && ignoredEntries.length > 0
                        ? tr(lang, `${activeEntries.length} + ${ignoredEntries.length} ignored`, `${activeEntries.length} + ${ignoredEntries.length} 已忽略`)
                        : `${activeEntries.length}`;
                logger.log(`  ${typeLabels[type]} (${countLabel}):`);
                for (const e of activeEntries) {
                    logger.log(`    ${e.isDirectory ? '[D]' : '[F]'}  ${e.relPath}  (${e.resolution})`);
                }
                if (verbose) {
                    for (const e of ignoredEntries) {
                        logger.log(`    ${e.isDirectory ? '[D]' : '[F]'}  ${e.relPath}  (${e.resolution})`);
                    }
                }
            }

            if (verbose && uniqueReverted.length > 0) {
                logger.log(tr(lang, `  Reverted (${uniqueReverted.length} Ignored):`, `  已回退（${uniqueReverted.length} 个已忽略）：`));
                for (const r of uniqueReverted) {
                    const rel = relPath(r.path, workspace);
                    logger.log(tr(
                        lang,
                        `    ${r.isDirectory ? '[D]' : '[F]'}  ${rel}  (reverted)`,
                        `    ${r.isDirectory ? '[D]' : '[F]'}  ${rel}  （已回退）`
                    ));
                }
            }

            const incomingTreePaths = [...new Set(
                summary.results
                    .flatMap((r) => r.conflicts)
                    .filter((c) => c.type === 'tree' && !c.ignored && c.resolution === 'theirs-full')
                    .map((c) => relPath(c.path, workspace))
            )].sort((a, b) => a.localeCompare(b));

            if (incomingTreePaths.length > 0) {
                logger.log(tr(
                    lang,
                    `  Notice: ${incomingTreePaths.length} non-ignored tree conflict(s) accepted incoming changes from source branch (theirs-full).`,
                    `  提示：${incomingTreePaths.length} 个非忽略树冲突已接受来源分支改动（theirs-full）。`
                ));
                for (const rel of incomingTreePaths) {
                    logger.log(tr(lang, `    [TREE][INCOMING]  ${rel}`, `    [树冲突][接受来源]  ${rel}`));
                }
            }
        }

        const parts = [
            tr(lang, `Total: ${summary.total}`, `总计: ${summary.total}`),
            tr(lang, `OK: ${summary.succeeded}`, `成功: ${summary.succeeded}`),
            ...(summary.withConflicts > 0 ? [tr(lang, `Conflicts: ${summary.withConflicts}`, `冲突: ${summary.withConflicts}`)] : []),
            ...(summary.failed > 0 ? [tr(lang, `Failed: ${summary.failed}`, `失败: ${summary.failed}`)] : []),
        ];
        logger.log('');
        logger.log(parts.join('  '));
    }
    logger.sectionEnd(summary.failed === 0);

    // ── 4. Merge Message ───────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'Merge Message', '合并信息'), 'message');
    const mergeMessage = buildMessage(summary, fromUrl, lang);
    logger.appendRaw('\n' + '='.repeat(72) + '\n');
    logger.appendRaw(mergeMessage);
    logger.appendRaw('='.repeat(72) + '\n');
    if (opts.copyToClipboard && mergeMessage.trim() && copyFn) {
        copyFn(mergeMessage);
        logger.log(tr(lang, 'Merge message copied to clipboard.', '合并信息已复制到剪贴板。'));
    }
    logger.sectionEnd(true);

    // ── 5. Auto-commit ─────────────────────────────────────────────────────────
    let autoCommitAttempted = false;
    let autoCommitOk = false;
    let autoCommitOutput = '';
    let autoCommitError = '';

    if (autoCommit) {
        logger.sectionStart(tr(lang, 'Auto-commit', '自动提交'), 'commit');
        autoCommitAttempted = true;
        const hasActiveConflicts = summary.results.some((r) => r.conflicts.some((c) => !c.ignored));

        if (summary.failed > 0 || hasActiveConflicts) {
            const reasons: string[] = [];
            if (summary.failed > 0) {
                const failedRevs = summary.results
                    .filter((r) => !r.success)
                    .map((r) => `r${r.revision}`)
                    .join(', ');
                reasons.push(tr(lang, `${summary.failed} revision(s) failed (${failedRevs})`, `${summary.failed} 个修订失败（${failedRevs}）`));
            }
            if (hasActiveConflicts) {
                const conflictRevs = summary.results
                    .filter((r) => r.conflicts.some((c) => !c.ignored))
                    .map((r) => `r${r.revision}`)
                    .join(', ');
                reasons.push(tr(lang, `unresolved conflicts (${conflictRevs})`, `存在未解决冲突（${conflictRevs}）`));
            }
            autoCommitOk = false;
            autoCommitError = tr(lang, `Auto-commit skipped: ${reasons.join(', ')}.`, `自动提交已跳过：${reasons.join(', ')}。`);
            logger.log(autoCommitError);
        } else if (summary.succeeded === 0) {
            autoCommitOk = false;
            autoCommitError = tr(lang, 'Auto-commit skipped: no revisions were successfully merged.', '自动提交已跳过：没有成功合并的修订。');
            logger.log(autoCommitError);
        } else {
            try {
                autoCommitOutput = svnCommit(workspace, mergeMessage);
                autoCommitOk = true;
                logger.log(tr(lang, 'Auto-commit successful.', '自动提交成功。'));
                if (autoCommitOutput.trim()) {
                    logger.appendRaw(autoCommitOutput + '\n');
                }
            } catch (e) {
                autoCommitOk = false;
                autoCommitError = tr(lang, `Auto-commit failed: ${(e as Error).message}`, `自动提交失败：${(e as Error).message}`);
                logger.log(autoCommitError);
            }
        }
        logger.sectionEnd(autoCommitOk);
    }

    return {
        summary,
        mergeMessage,
        autoCommitAttempted,
        autoCommitOk,
        autoCommitOutput,
        autoCommitError,
    };
}
