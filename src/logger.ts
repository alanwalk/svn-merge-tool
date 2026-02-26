import * as fs from 'fs';
import * as path from 'path';

/** Strip ANSI escape codes for clean log file output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Timestamp prefix: [YYYY-MM-DD HH:MM:SS] */
function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`
  );
}

export class Logger {
  private logPath: string;
  private fd: number;

  constructor(outputDir: string, startTs: string) {
    fs.mkdirSync(outputDir, { recursive: true });
    this.logPath = path.join(outputDir, `svnmerge-${startTs}.log`);
    // Open (create or truncate) the log file immediately
    this.fd = fs.openSync(this.logPath, 'w');
  }

  /** Append a line to the log file immediately (ANSI codes are stripped). */
  log(message: string): void {
    const clean = stripAnsi(message);
    let line: string;
    if (clean.trim() === '' || clean.startsWith('\u2500') || clean.startsWith('\u2550')) {
      line = clean + '\n';
    } else {
      line = `${timestamp()} ${clean}\n`;
    }
    try {
      fs.writeSync(this.fd, line);
    } catch {
      // best-effort
    }
  }

  /** Append raw text to the log file as-is (no timestamp, no ANSI stripping). */
  appendRaw(text: string): void {
    try {
      fs.writeSync(this.fd, text);
    } catch {
      // best-effort
    }
  }

  /** Close the log file handle. Call once after all merges are done. */
  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // ignore
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}
