export interface SelectionSnapshot {
  workspace: string;
  fromUrl: string;
  revisions: number[];
  ignorePaths: string[];
  outputDir: string;
  verbose: boolean;
  autoCommit: boolean;
  copyToClipboard: boolean;
  lang?: 'zh-CN' | 'en';
}

export interface CleanupSummary {
  revertedCount: number;
  removedCount: number;
  failedCount: number;
  failedItems: string[];
  workspaceCleanAfterCleanup: boolean;
}

