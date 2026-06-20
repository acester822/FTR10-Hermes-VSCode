/** Shared placeholder interpolation for Extension Host t() and WebView localeText(). */
export function formatLocaleString(text: string, ...args: (string | number)[]): string {
    let result = text;
    args.forEach((arg, index) => {
        result = result.replace(`{${index}}`, String(arg));
    });
    return result;
}

/** Injected into WebView HTML — must stay in sync with formatLocaleString(). */
export const WEBVIEW_LOCALE_HELPER = `function localeText(key) {
  var text = locale[key] || '';
  for (var i = 1; i < arguments.length; i++) {
    text = text.replace('{' + (i - 1) + '}', String(arguments[i]));
  }
  return text;
}`;
