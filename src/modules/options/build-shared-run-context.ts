import * as path from 'path';

import { resolveCommandConfig } from '../../cli-config';
import { parseRevisionExpression } from '../revisions/parse-revision-expression';
import { loadOrCreateRc } from '../../updater';

export interface SharedRunContextInput {
  configPath?: string;
  workspace?: string;
  fromUrl?: string;
  cliIgnorePaths?: string[];
  cliOutput?: string;
  cliVerbose?: boolean;
  cliCommit?: boolean;
  cliCopyToClipboard?: boolean;
  cliRevisionsArg?: string;
}

export interface SharedRunContext {
  resolvedConfigPath?: string;
  workspace: string | null;
  fromUrl?: string;
  ignorePaths: string[];
  outputDir: string;
  verbose: boolean;
  autoCommit: boolean;
  copyToClipboard: boolean;
  preselectedRevisions: number[];
}

export function buildSharedRunContext(input: SharedRunContextInput): SharedRunContext {
  const resolvedConfig = resolveCommandConfig({
    configPath: input.configPath,
    workspace: input.workspace,
    fromUrl: input.fromUrl,
  });
  const rcConfig = loadOrCreateRc();
  const cliIgnorePaths = input.cliIgnorePaths ?? [];
  const workspace = resolvedConfig.workspace ?? null;
  const rawOutputDir = input.cliOutput ?? resolvedConfig.configOutputDir;
  const outputDir = workspace
    ? (rawOutputDir
      ? (path.isAbsolute(rawOutputDir) ? rawOutputDir : path.resolve(workspace, rawOutputDir))
      : path.join(workspace, '.svnmerge'))
    : '';

  let preselectedRevisions: number[] = [];
  if (input.cliRevisionsArg) {
    preselectedRevisions = parseRevisionExpression(input.cliRevisionsArg);
  }

  return {
    resolvedConfigPath: resolvedConfig.resolvedConfigPath,
    workspace,
    fromUrl: resolvedConfig.fromUrl,
    ignorePaths: [...rcConfig.globalIgnore, ...resolvedConfig.configIgnorePaths, ...cliIgnorePaths],
    outputDir,
    verbose: !!(input.cliVerbose || resolvedConfig.configVerbose),
    autoCommit: !!(input.cliCommit || resolvedConfig.configCommit),
    copyToClipboard: input.cliCopyToClipboard ?? rcConfig.copyToClipboard,
    preselectedRevisions,
  };
}

