import * as path from 'path';

import { findDefaultConfig, loadConfig } from './config';

export interface ResolvedCommandConfig {
  resolvedConfigPath?: string;
  workspace?: string;
  fromUrl?: string;
  configIgnorePaths: string[];
  configOutputDir?: string;
  configVerbose: boolean;
  configCommit: boolean;
}

export function resolveCommandConfig(params: {
  configPath?: string;
  workspace?: string;
  fromUrl?: string;
}): ResolvedCommandConfig {
  let workspace = params.workspace;
  let fromUrl = params.fromUrl;
  let resolvedConfigPath = params.configPath;
  let configIgnorePaths: string[] = [];
  let configOutputDir: string | undefined;
  let configVerbose = false;
  let configCommit = false;

  if (!resolvedConfigPath && workspace) {
    resolvedConfigPath = findDefaultConfig(path.resolve(workspace));
  }
  if (!resolvedConfigPath) {
    resolvedConfigPath = findDefaultConfig();
  }

  if (resolvedConfigPath) {
    const cfg = loadConfig(resolvedConfigPath);
    if (!fromUrl && cfg.from) fromUrl = cfg.from;
    if (!workspace && cfg.workspace) workspace = path.resolve(cfg.workspace);
    if (cfg.ignore && cfg.ignore.length > 0) configIgnorePaths = cfg.ignore;
    configOutputDir = cfg.output;
    configVerbose = !!cfg.verbose;
    configCommit = !!cfg.commit;
    resolvedConfigPath = path.resolve(resolvedConfigPath);
  }

  return {
    resolvedConfigPath,
    workspace: workspace ? path.resolve(workspace) : undefined,
    fromUrl,
    configIgnorePaths,
    configOutputDir,
    configVerbose,
    configCommit,
  };
}
