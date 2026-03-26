import { MergeProgressEvent } from '../logger';
import { RunLogger, SectionKind } from './run-logger-types';

export class CompositeRunLogger implements RunLogger {
  constructor(private readonly loggers: RunLogger[]) {}

  log(text: string): void {
    for (const logger of this.loggers) logger.log(text);
  }

  appendRaw(text: string): void {
    for (const logger of this.loggers) logger.appendRaw(text);
  }

  emitMergeProgress(event: MergeProgressEvent): void {
    for (const logger of this.loggers) logger.emitMergeProgress?.(event);
  }

  sectionStart(title: string, kind?: SectionKind): void {
    for (const logger of this.loggers) logger.sectionStart(title, kind);
  }

  sectionEnd(ok?: boolean): void {
    for (const logger of this.loggers) logger.sectionEnd(ok);
  }
}

