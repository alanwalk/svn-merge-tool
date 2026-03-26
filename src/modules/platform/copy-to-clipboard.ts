import { spawnSync } from 'child_process';

export function copyToClipboard(text: string): void {
  try {
    if (process.platform === 'win32') {
      spawnSync(
        'powershell',
        ['-noprofile', '-sta', '-command',
          '[Console]::InputEncoding=[Text.Encoding]::UTF8;Set-Clipboard([Console]::In.ReadToEnd())'],
        { input: text, encoding: 'utf8', timeout: 5000 },
      );
    } else if (process.platform === 'darwin') {
      spawnSync('pbcopy', [], { input: text, encoding: 'utf8', timeout: 5000 });
    } else {
      spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8', timeout: 5000 });
    }
  } catch {
    // ignore clipboard errors
  }
}

