import * as path from 'path';

import { mapExitCode } from '../core/exit-codes';
import { resolveConsoleLanguage, tr } from '../i18n';
import { buildSharedRunContext } from '../modules/options/build-shared-run-context';
import { term } from '../utils';
import { openLogUI } from '../webui';

export async function runUiCommand(args: string[]): Promise<number> {
  const { lang, fallbackWarning } = resolveConsoleLanguage();
  if (fallbackWarning) console.log(term.yellow(fallbackWarning));

  let fromUrl: string | undefined;
  let workspace: string | undefined;
  let configPath: string | undefined;
  let cliIgnoreArg: string | undefined;
  let cliOutput: string | undefined;
  let cliRevisionsArg: string | undefined;
  let cliVerbose = false;
  let cliCommit = false;
  let cliCopyToClipboard: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-f' || a === '--from') && args[i + 1]) { fromUrl = args[++i]; continue; }
    if ((a === '-w' || a === '--workspace') && args[i + 1]) { workspace = args[++i]; continue; }
    if ((a === '-c' || a === '--config') && args[i + 1]) { configPath = args[++i]; continue; }
    if ((a === '-i' || a === '--ignore') && args[i + 1]) { cliIgnoreArg = args[++i]; continue; }
    if ((a === '-o' || a === '--output') && args[i + 1]) { cliOutput = args[++i]; continue; }
    if ((a === '-r' || a === '--revisions') && args[i + 1]) { cliRevisionsArg = args[++i]; continue; }
    if (a === '-V' || a === '--verbose') { cliVerbose = true; continue; }
    if (a === '-C' || a === '--commit') { cliCommit = true; continue; }
    if (a === '--copy-to-clipboard') { cliCopyToClipboard = true; continue; }
    if (a === '--no-copy-to-clipboard') { cliCopyToClipboard = false; continue; }
    if (a === '--help' || a === '-h') {
      console.log(tr(lang, 'uiUsage'));
      return mapExitCode('success');
    }

    if (a.startsWith('-')) {
      console.error(term.red(`Error: unknown option ${a}`));
      console.error(tr(lang, 'unknownOptionHelp'));
      return mapExitCode('invalid-usage');
    }
  }

  let sharedContext;
  try {
    sharedContext = buildSharedRunContext({
      configPath,
      workspace,
      fromUrl,
      cliIgnorePaths: cliIgnoreArg ? cliIgnoreArg.split(',').map((s) => s.trim()).filter(Boolean) : [],
      cliOutput,
      cliVerbose,
      cliCommit,
      cliCopyToClipboard,
      cliRevisionsArg,
    });
  } catch (e) {
    console.error(term.red(`Config error: ${(e as Error).message}`));
    return mapExitCode('invalid-usage');
  }

  fromUrl = sharedContext.fromUrl;
  workspace = sharedContext.workspace ?? undefined;
  if (!fromUrl) {
    console.error(term.red(tr(lang, 'fromRequired')));
    console.error(tr(lang, 'uiUsageShort'));
    return mapExitCode('invalid-usage');
  }

  const resolvedWorkspace = workspace ? path.resolve(workspace) : null;
  const selected = await openLogUI(fromUrl, resolvedWorkspace, {
    lang,
    ignorePaths: sharedContext.ignorePaths,
    verbose: sharedContext.verbose,
    autoCommit: sharedContext.autoCommit,
    outputDir: sharedContext.outputDir,
    copyToClipboard: sharedContext.copyToClipboard,
    preselectedRevisions: sharedContext.preselectedRevisions,
  });

  if (selected === null) {
    console.log(tr(lang, 'userCanceled'));
    return mapExitCode('canceled');
  }

  if (selected.length === 0) {
    console.log(tr(lang, 'noRevisionsSelected'));
    return mapExitCode('canceled');
  }

  const sorted = [...selected].sort((a, b) => a - b);
  console.log(term.cyan(tr(lang, 'uiFinishedRevisions', {
    count: sorted.length,
    revisions: sorted.map((r) => `r${r}`).join(', '),
  })));
  return mapExitCode('success');
}
