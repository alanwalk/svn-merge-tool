import { spawnSync } from 'child_process';

import { AppLang, I18N_MESSAGES, I18nMessages } from './i18n.config';

type MessageArgs<K extends keyof I18nMessages> =
  I18nMessages[K] extends (...args: infer A) => string ? A : [];

function normalizeLang(input: string): AppLang {
  const s = String(input || '').toLowerCase();
  return s.indexOf('zh') === 0 ? 'zh-CN' : 'en';
}

function getSystemLocale(): string {
  const envLocale = process.env['SVN_MERGE_LANG'] || process.env['LC_ALL'] || process.env['LC_MESSAGES'] || process.env['LANG'];
  if (envLocale && envLocale.trim()) return envLocale;

  if (process.platform === 'win32') {
    try {
      const ps = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', '[System.Globalization.CultureInfo]::CurrentUICulture.Name'],
        { encoding: 'utf8', windowsHide: true, timeout: 3000 }
      );
      const uiCulture = `${ps.stdout || ''}`.trim();
      if (uiCulture) return uiCulture;
    } catch {
      // ignore and continue fallback chain
    }
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

function isWindowsUtf8Console(): boolean {
  if (process.platform !== 'win32') return true;
  try {
    const result = spawnSync('cmd', ['/c', 'chcp'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const output = `${result.stdout || ''} ${result.stderr || ''}`;
    return /65001/.test(output);
  } catch {
    return false;
  }
}

export function resolveConsoleLanguage(): { lang: AppLang; fallbackWarning: string } {
  const preferred = normalizeLang(getSystemLocale());

  if (preferred === 'zh-CN' && !isWindowsUtf8Console()) {
    return { lang: 'en', fallbackWarning: I18N_MESSAGES.en.encodingFallbackWarning };
  }

  return { lang: preferred, fallbackWarning: '' };
}

export function tr<K extends keyof I18nMessages>(lang: AppLang, key: K, ...args: MessageArgs<K>): string {
  const message = I18N_MESSAGES[lang][key];
  return typeof message === 'function'
    ? (message as unknown as (...fnArgs: MessageArgs<K>) => string)(...args)
    : message;
}

export type { AppLang };
