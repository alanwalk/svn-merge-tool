import { Logger } from '../../logger';
import { RunLogger, SectionKind } from '../run-logger-types';

export class FileRunLogger implements RunLogger {
  constructor(private readonly fileLogger: Logger) {}

  log(text: string): void {
    this.fileLogger.log(text);
  }

  appendRaw(text: string): void {
    this.fileLogger.appendRaw(text);
  }

  sectionStart(title: string, _kind?: SectionKind): void {
    this.fileLogger.log(`\n${'\u2500'.repeat(60)}`);
    this.fileLogger.log(`  ${title}`);
  }

  sectionEnd(): void {
    // no-op
  }
}

