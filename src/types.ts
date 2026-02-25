/**
 * CLI options parsed from command line arguments
 */
export interface MergeOptions {
  workspace: string;
  fromUrl: string;
  revisions: number[];
  /** Workspace-relative paths to ignore during merge (files or folders) */
  ignorePaths?: string[];
}

/**
 * Type of SVN conflict detected
 */
export type ConflictType = 'text' | 'tree' | 'property';

/**
 * Details about a specific conflict
 */
export interface ConflictInfo {
  path: string;
  type: ConflictType;
  resolution: 'working' | 'theirs-full';
  isDirectory: boolean;
  /** True when this conflict was silently discarded due to ignore-merge config */
  ignored: boolean;
}

/**
 * A path that was modified by the merge but discarded via svn revert
 * because it matched an ignore-merge rule (no actual conflict).
 */
export interface RevertedInfo {
  path: string;
  isDirectory: boolean;
}

/**
 * Result of merging a single revision
 */
export interface RevisionMergeResult {
  revision: number;
  success: boolean;
  conflicts: ConflictInfo[];
  /** Paths silently reverted because they matched ignore-merge but had no conflict */
  reverted: RevertedInfo[];
  errorMessage?: string;
}

/**
 * Overall summary of the entire merge operation
 */
export interface MergeSummary {
  total: number;
  succeeded: number;
  withConflicts: number;
  failed: number;
  results: RevisionMergeResult[];
}
