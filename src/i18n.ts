import { spawnSync } from 'child_process';

export type AppLang = 'zh-CN' | 'en';

const ENCODING_FALLBACK_WARNING =
    'Detected non-UTF8 console encoding on Windows. To avoid garbled Chinese text, CLI output falls back to English. You can set SVN_MERGE_LANG=en explicitly.';

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
        return { lang: 'en', fallbackWarning: ENCODING_FALLBACK_WARNING };
    }

    return { lang: preferred, fallbackWarning: '' };
}

export function tr(lang: AppLang, en: string, zhCN: string): string {
    return lang === 'zh-CN' ? zhCN : en;
}
