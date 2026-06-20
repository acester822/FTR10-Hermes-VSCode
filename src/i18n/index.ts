import { en } from './locales/en';
import { zhCn } from './locales/zh-cn';
import { formatLocaleString } from './format';
import { LocaleKey, LocaleStrings, SupportedLocale } from './types';

const LOCALES: Record<SupportedLocale, LocaleStrings> = {
    en,
    'zh-cn': zhCn,
};

let currentLocale: SupportedLocale = 'en';
let strings: LocaleStrings = en;

/** Pure locale resolution — safe for standalone unit tests without vscode. */
export function resolveLocaleFromLanguage(language: string): SupportedLocale {
    const lang = language.toLowerCase();
    if (lang === 'zh-cn' || lang === 'zh-hans' || lang.startsWith('zh-cn')) {
        return 'zh-cn';
    }
    return 'en';
}

export function resolveLocale(language?: string): SupportedLocale {
    if (language !== undefined) {
        return resolveLocaleFromLanguage(language);
    }
    // Lazy require so standalone mocha tests can import this module without vscode.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require('vscode') as typeof import('vscode');
    return resolveLocaleFromLanguage(vscode.env.language);
}

export function initI18n(language?: string): SupportedLocale {
    currentLocale = resolveLocale(language);
    strings = LOCALES[currentLocale];
    return currentLocale;
}

export function getLocale(): SupportedLocale {
    return currentLocale;
}

export function getWebviewLocale(): LocaleStrings {
    return strings;
}

export function t(key: LocaleKey, ...args: (string | number)[]): string {
    const text = strings[key] ?? en[key] ?? key;
    return formatLocaleString(text, ...args);
}

/** Map ACP status messages (English from AcpClient) to localized strings. */
export function localizeStatusMessage(msg: string): string {
    if (msg === 'Starting Hermes ACP...') {
        return t('statusStartingAcp');
    }
    if (msg === 'Hermes is thinking...') {
        return t('statusHermesThinking');
    }

    let match = msg.match(/^Process error: (.+)$/);
    if (match) {
        return t('statusProcessError', match[1]);
    }

    match = msg.match(/^Process exited \(code: ([^,]+), signal: ([^)]+)\)$/);
    if (match) {
        return t('statusProcessExited', match[1], match[2]);
    }

    match = msg.match(/^Connection failed: (.+)$/);
    if (match) {
        return t('statusConnectionFailed', match[1]);
    }

    match = msg.match(/^New session failed: (.+)$/);
    if (match) {
        return t('statusNewSessionFailed', match[1]);
    }

    return msg;
}
