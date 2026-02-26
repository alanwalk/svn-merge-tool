import * as fs from 'fs';
import { load as yamlLoad } from 'js-yaml';
import * as path from 'path';

/**
 * Values that can be loaded from a YAML config file.
 * All fields are optional — CLI arguments always take precedence.
 *
 * Config file format (svn-merge-tool.yaml):
 *
 *   workspace: /path/to/working-copy
 *   fromUrl: http://svn.example.com/branches/feature
 *   ignoreMerge:
 *     - src/thirdparty/generated
 *     - assets/auto-generated/catalog.json
 */
export interface ConfigFile {
  workspace?: string;
  fromUrl?: string;
  /** Workspace-relative paths (files or folders) to silently discard on conflict */
  ignoreMerge?: string[];
  /**
   * Directory where log and message files are written.
   * Absolute path, or relative to the workspace directory.
   * Defaults to the workspace directory.
   */
  outputDir?: string;
  /** Mirror of the -v / --verbose CLI flag. */
  verbose?: boolean;
  /**
   * Automatically run `svn commit` after a successful merge.
   * Mirror of the --commit CLI flag.
   */
  autoCommit?: boolean;
}

/**
 * Load and parse a YAML config file.
 * workspace paths are resolved relative to the config file's directory.
 * Throws if the file cannot be read or is malformed.
 */
export function loadConfig(configPath: string): ConfigFile {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: "${resolved}"`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot read config file "${resolved}": ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = yamlLoad(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse YAML config "${resolved}": ${msg}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config file "${resolved}" is empty or not a YAML mapping.`);
  }

  const doc = parsed as Record<string, unknown>;
  const config: ConfigFile = {};
  const dir = path.dirname(resolved);

  // workspace: resolve relative paths against the config file's directory
  const ws = doc['workspace'];
  if (typeof ws === 'string' && ws.trim()) {
    const trimmed = ws.trim();
    config.workspace = path.isAbsolute(trimmed) ? trimmed : path.resolve(dir, trimmed);
  }

  // fromUrl
  const fromUrl = doc['fromUrl'];
  if (typeof fromUrl === 'string' && fromUrl.trim()) {
    config.fromUrl = fromUrl.trim();
  }

  // ignoreMerge: list of workspace-relative paths
  const ignoreMerge = doc['ignoreMerge'];
  if (Array.isArray(ignoreMerge)) {
    config.ignoreMerge = ignoreMerge
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => (item as string).trim());
  }

  // outputDir: stored as-is (absolute or workspace-relative), resolved later
  const outputDir = doc['outputDir'];
  if (typeof outputDir === 'string' && outputDir.trim()) {
    config.outputDir = outputDir.trim();
  }

  // verbose
  const verbose = doc['verbose'];
  if (typeof verbose === 'boolean') {
    config.verbose = verbose;
  }

  // autoCommit
  const autoCommit = doc['autoCommit'];
  if (typeof autoCommit === 'boolean') {
    config.autoCommit = autoCommit;
  }

  return config;
}

/**
 * Walk up the directory tree from `startDir`, looking for `svn-merge-tool.yaml` or `.yml`.
 * Returns the absolute path to the first match found, or undefined if none exists.
 */
export function findDefaultConfig(startDir: string = process.cwd()): string | undefined {
  const filenames = ['svnmerge.yaml', 'svnmerge.yml'];
  let current = path.resolve(startDir);

  while (true) {
    for (const filename of filenames) {
      const candidate = path.join(current, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
