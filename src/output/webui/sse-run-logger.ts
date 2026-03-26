import { MergeProgressEvent } from '../../logger';
import { RunLogger, SectionKind } from '../run-logger-types';

export class SseRunLogger implements RunLogger {
  constructor(
    private readonly postLog: (text: string) => void,
    private readonly postSection: (title: string, kind?: SectionKind) => void,
    private readonly postSectionEnd: (ok?: boolean) => void,
    private readonly verbose: boolean,
  ) {}

  log(text: string): void {
    this.postLog(text);
  }

  appendRaw(text: string): void {
    text.split('\n').map((l) => l.trimEnd()).filter(Boolean).forEach((line) => this.postLog(line));
  }

  sectionStart(title: string, kind?: SectionKind): void {
    this.postSection(title, kind);
  }

  sectionEnd(ok?: boolean): void {
    this.postSectionEnd(ok);
  }

  emitMergeProgress(event: MergeProgressEvent): void {
    if (event.type === 'revision-start') {
      this.postLog(event.label);
      return;
    }

    if (event.type === 'revision-result') {
      if (!event.ok) {
        this.postLog(`${event.label}  FAILED`);
        return;
      }

      if (event.hasConflicts || event.ignoredCount > 0) {
        const parts: string[] = [];
        if (event.activeConflictCount > 0) parts.push(`${event.activeConflictCount} conflict(s)`);
        if (event.ignoredCount > 0) parts.push(`${event.ignoredCount} ignored`);
        this.postLog(`${event.label}  (${parts.join(', ')})`);
        return;
      }

      this.postLog(`${event.label}  ✓`);
      return;
    }

    if (this.verbose && event.type === 'revision-detail') {
      this.postLog(event.text);
    }
  }
}

