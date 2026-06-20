import { describe, it } from 'mocha';
import assert from 'assert';
import { formatLocaleString } from '../../i18n/format';
import { initI18n, resolveLocale, resolveLocaleFromLanguage, t } from '../../i18n';

describe('i18n', () => {
    it('resolveLocaleFromLanguage maps zh-cn variants', () => {
        assert.strictEqual(resolveLocaleFromLanguage('zh-cn'), 'zh-cn');
        assert.strictEqual(resolveLocaleFromLanguage('zh-CN'), 'zh-cn');
        assert.strictEqual(resolveLocaleFromLanguage('zh-hans'), 'zh-cn');
    });

    it('resolveLocaleFromLanguage defaults to en', () => {
        assert.strictEqual(resolveLocaleFromLanguage('en'), 'en');
        assert.strictEqual(resolveLocaleFromLanguage('ja'), 'en');
    });

    it('resolveLocale accepts explicit language without vscode', () => {
        assert.strictEqual(resolveLocale('zh-cn'), 'zh-cn');
        assert.strictEqual(resolveLocale('en'), 'en');
    });

    it('t interpolates placeholders', () => {
        initI18n('en');
        assert.strictEqual(t('couldNotOpenFile', '/tmp/a.ts'), 'Could not open file: /tmp/a.ts');
    });

    it('formatLocaleString matches t() interpolation', () => {
        assert.strictEqual(formatLocaleString('Hello {0}, count {1}', 'world', 3), 'Hello world, count 3');
    });

    it('zh-cn translations load', () => {
        initI18n('zh-cn');
        assert.strictEqual(t('selectCodeFirst'), '请先选中一些代码。');
        assert.strictEqual(t('send'), '发送');
    });
});
