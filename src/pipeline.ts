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
import { RunLogger, SectionKind } from './output/run-logger-types';
import { svnCommit, svnUpdate } from './svn';
import { MergeSummary } from './types';
import { compressRevisions, groupSummaryByType, relPath } from './utils';

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
    autoCommitSkipped: boolean;
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
    logger.sectionStart(tr(lang, 'svnUpdateTitle'), 'info');
    logger.log(tr(lang, 'svnUpdateWorkingCopy').trimEnd());
    const updateLine = svnUpdate(workspace, lang);
    if (updateLine.trim()) {
        logger.log(updateLine);
    }
    logger.sectionEnd(true);

    // ── 2. Merge ───────────────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'mergingRevisionCount', { count: revisions.length }), 'merge');
    const summary = mergerRun(
        { fromUrl, workspace, revisions, ignorePaths, verbose, lang },
        logger,   // ILogger — structurally compatible with merger's requirement
    );
    logger.sectionEnd(summary.failed === 0);

    // ── 3. Summary ─────────────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'summaryTitle'), 'summary');
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
                logger.log(tr(lang, 'revisionFailed', { revision: result.revision, error: result.errorMessage ?? '' }));
            }
        }

        if (
            hasActiveConflicts ||
            summary.failed > 0 ||
            (verbose && (uniqueReverted.length > 0 || summary.withConflicts > 0 || hasIgnoredConflicts))
        ) {
            const groups = groupSummaryByType(summary.results, workspace);
            const typeLabels: Record<string, string> = {
                    tree: tr(lang, 'treeConflictsTitle'),
                    text: tr(lang, 'textConflictsTitle'),
                    property: tr(lang, 'propertyConflictsTitle'),
            };

            for (const [type, entries] of groups) {
                if (entries.length === 0) continue;
                const activeEntries = entries.filter((e) => !e.ignored);
                const ignoredEntries = entries.filter((e) => e.ignored);
                if (!verbose && activeEntries.length === 0) continue;
                const countLabel =
                    verbose && ignoredEntries.length > 0
                        ? tr(lang, 'ignoredCountLabel', { active: activeEntries.length, ignored: ignoredEntries.length })
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
                logger.log(tr(lang, 'revertedIgnoredTitle', { count: uniqueReverted.length }));
                for (const r of uniqueReverted) {
                    const rel = relPath(r.path, workspace);
                    logger.log(tr(lang, 'revertedEntry', { kindTag: r.isDirectory ? '[D]' : '[F]', rel }));
                }
            }

            const incomingTreePaths = [...new Set(
                summary.results
                    .flatMap((r) => r.conflicts)
                    .filter((c) => c.type === 'tree' && !c.ignored && c.resolution === 'theirs-full')
                    .map((c) => relPath(c.path, workspace))
            )].sort((a, b) => a.localeCompare(b));

            if (incomingTreePaths.length > 0) {
                logger.log(tr(lang, 'incomingTreeConflictsNotice', { count: incomingTreePaths.length }));
                for (const rel of incomingTreePaths) {
                    logger.log(tr(lang, 'incomingTreeConflictEntry', { rel }));
                }
            }
        }

        const parts = [
            tr(lang, 'summaryTotal', { total: summary.total }),
            tr(lang, 'summaryOk', { count: summary.succeeded }),
            ...(summary.withConflicts > 0 ? [tr(lang, 'summaryConflicts', { count: summary.withConflicts })] : []),
            ...(summary.failed > 0 ? [tr(lang, 'summaryFailed', { count: summary.failed })] : []),
        ];
        logger.log('');
        logger.log(parts.join('  '));
    }
    logger.sectionEnd(summary.failed === 0);

    // ── 4. Merge Message ───────────────────────────────────────────────────────
    logger.sectionStart(tr(lang, 'mergeMessageTitle'), 'message');
    const mergeMessage = buildMessage(summary, fromUrl, lang, logger);
    logger.appendRaw('\n' + '='.repeat(72) + '\n');
    logger.appendRaw(mergeMessage);
    logger.appendRaw('='.repeat(72) + '\n');
    if (opts.copyToClipboard && mergeMessage.trim() && copyFn) {
        copyFn(mergeMessage);
        logger.log(tr(lang, 'mergeMessageCopied'));
    }
    logger.sectionEnd(true);

    // ── 5. Auto-commit ─────────────────────────────────────────────────────────
    let autoCommitAttempted = false;
    let autoCommitSkipped = false;
    let autoCommitOk = false;
    let autoCommitOutput = '';
    let autoCommitError = '';

    if (autoCommit) {
        logger.sectionStart(tr(lang, 'autoCommitTitle'), 'commit');
        autoCommitAttempted = true;
        const hasActiveConflicts = summary.results.some((r) => r.conflicts.some((c) => !c.ignored));

        if (summary.failed > 0 || hasActiveConflicts) {
            const reasons: string[] = [];
            if (summary.failed > 0) {
                const failedRevs = summary.results
                    .filter((r) => !r.success)
                    .map((r) => `r${r.revision}`)
                    .join(', ');
                reasons.push(tr(lang, 'failedRevisionsReason', { count: summary.failed, revisions: failedRevs }));
            }
            if (hasActiveConflicts) {
                const conflictRevs = summary.results
                    .filter((r) => r.conflicts.some((c) => !c.ignored))
                    .map((r) => `r${r.revision}`)
                    .join(', ');
                reasons.push(tr(lang, 'unresolvedConflictsReason', { revisions: conflictRevs }));
            }
            autoCommitOk = false;
            autoCommitSkipped = true;
            autoCommitError = tr(lang, 'autoCommitSkipped', { reasons: reasons.join(', ') });
            logger.log(autoCommitError);
        } else if (summary.succeeded === 0) {
            autoCommitOk = false;
            autoCommitSkipped = true;
            autoCommitError = tr(lang, 'autoCommitSkippedNoSuccess');
            logger.log(autoCommitError);
        } else {
            try {
                const allModifiedPaths = [
                    ...new Map(
                        summary.results
                            .filter((r) => r.success)
                            .flatMap((r) => r.modified.map((m) => [m.path, m]))
                    ).values(),
                ].map((m) => m.path);
                autoCommitOutput = svnCommit(
                    workspace,
                    mergeMessage,
                    allModifiedPaths.length > 0 ? allModifiedPaths : undefined,
                );
                autoCommitOk = true;
                logger.log(tr(lang, 'autoCommitSuccessful'));
                if (autoCommitOutput.trim()) {
                    logger.appendRaw(autoCommitOutput + '\n');
                }
            } catch (e) {
                autoCommitOk = false;
                autoCommitError = tr(lang, 'autoCommitFailed', { error: (e as Error).message });
                logger.log(autoCommitError);
            }
        }
        logger.sectionEnd(autoCommitOk);
    }

    return {
        summary,
        mergeMessage,
        autoCommitAttempted,
        autoCommitSkipped,
        autoCommitOk,
        autoCommitOutput,
        autoCommitError,
    };
}
