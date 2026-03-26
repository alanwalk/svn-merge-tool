import { MergeProgressEvent } from '../logger';

export type SectionKind = 'info' | 'merge' | 'summary' | 'message' | 'commit';

export interface RunLogger {
  log(text: string): void;
  appendRaw(text: string): void;
  emitMergeProgress?(event: MergeProgressEvent): void;
  sectionStart(title: string, kind?: SectionKind): void;
  sectionEnd(ok?: boolean): void;
}

