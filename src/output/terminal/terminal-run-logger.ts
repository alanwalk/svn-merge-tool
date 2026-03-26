import { MergeProgressEvent } from '../../logger';
import { term } from '../../utils';
import { RunLogger, SectionKind } from '../run-logger-types';

export class TerminalRunLogger implements RunLogger {
  private currentSection: SectionKind | null = null;

  constructor(private readonly verbose: boolean) {}

  log(text: string): void {
    if (this.currentSection && this.currentSection !== 'merge') {
      console.log(text);
    }
  }

  appendRaw(text: string): void {
    if (!this.currentSection || this.currentSection === 'message') {
      const trimmed = text.replace(/\s+$/, '');
      if (trimmed) console.log(trimmed);
    }
  }

  sectionStart(title: string, kind?: SectionKind): void {
    this.currentSection = kind ?? 'info';
    console.log();
    console.log(term.bold(title));
  }

  sectionEnd(): void {
    this.currentSection = null;
  }

  emitMergeProgress(event: MergeProgressEvent): void {
    if (event.type === 'revision-start') {
      process.stdout.write(event.label + '\n');
      return;
    }

    if (event.type === 'revision-result') {
      if (!event.ok) {
        process.stdout.write(`${term.rewritePreviousLine(term.red(event.label + '  FAILED'))}\n`);
        return;
      }

      if (event.hasConflicts || event.ignoredCount > 0) {
        const parts: string[] = [];
        if (event.activeConflictCount > 0) parts.push(`${event.activeConflictCount} conflict(s)`);
        if (event.ignoredCount > 0) parts.push(`${event.ignoredCount} ignored`);
        const labelColor = event.hasTreeConflict ? term.red : term.yellow;
        process.stdout.write(`${term.rewritePreviousLine(labelColor(event.label + `  (${parts.join(', ')})`))}\n`);
        return;
      }

      process.stdout.write(`${term.rewritePreviousLine(term.green(event.label + '  ✓'))}\n`);
      return;
    }

    if (event.type === 'revision-detail') {
      if (event.level === 'active-tree-conflict') {
        process.stdout.write(term.red(`${event.text}\n`));
        return;
      }
      if (event.level === 'active-conflict') {
        process.stdout.write(term.yellow(`${event.text}\n`));
        return;
      }
      if (this.verbose) {
        process.stdout.write(term.gray(`${event.text}\n`));
      }
    }
  }
}

