import { describe, it } from 'mocha';
import assert from 'assert';
import { en } from '../../i18n/locales/en';
import { zhCn } from '../../i18n/locales/zh-cn';
import { resolvePermissionOptionLabel } from '../../i18n/permissionOptions';

describe('permissionOptions', () => {
    it('maps standard ACP kinds to locale labels', () => {
        assert.strictEqual(
            resolvePermissionOptionLabel(en, { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }),
            'Allow once'
        );
        assert.strictEqual(
            resolvePermissionOptionLabel(zhCn, { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }),
            '允许一次'
        );
        assert.strictEqual(
            resolvePermissionOptionLabel(en, { optionId: 'reject-always', kind: 'reject_always', name: 'Reject always' }),
            'Always deny'
        );
        assert.strictEqual(
            resolvePermissionOptionLabel(zhCn, { optionId: 'deny_always', kind: 'deny_always', name: 'Deny always' }),
            '始终拒绝'
        );
    });

    it('maps Hermes allow_session and deny', () => {
        assert.strictEqual(
            resolvePermissionOptionLabel(en, { optionId: 'allow_session', kind: 'allow_session', name: 'Allow for session' }),
            'Allow for session'
        );
        assert.strictEqual(
            resolvePermissionOptionLabel(zhCn, { optionId: 'deny', kind: 'deny', name: 'Deny' }),
            '拒绝'
        );
    });

    it('prefers optionId over mismatched kind for allow_session', () => {
        assert.strictEqual(
            resolvePermissionOptionLabel(zhCn, {
                optionId: 'allow_session',
                kind: 'allow_always',
                name: 'Always allow',
            }),
            '本会话允许'
        );
    });

    it('falls back to agent name when kind is unknown', () => {
        assert.strictEqual(
            resolvePermissionOptionLabel(en, { optionId: 'custom', name: 'Custom action' }),
            'Custom action'
        );
    });
});
