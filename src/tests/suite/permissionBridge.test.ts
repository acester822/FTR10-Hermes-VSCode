import { describe, it } from 'mocha';
import assert from 'assert';
import {
    PermissionBridge,
    extractPermissionDetail,
    normalizePermissionOptions,
} from '../../acp/permissionBridge';

describe('PermissionBridge', () => {
    it('resolves with selected optionId', async () => {
        const bridge = new PermissionBridge(0);
        const view = {
            requestId: 'perm-1',
            toolCallId: 'tc-1',
            title: 'Run command',
            options: [
                { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
                { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' as const },
            ],
        };

        const pending = bridge.waitForChoice(view);
        const event = bridge.submitSelected('perm-1', 'allow_once');
        assert.ok(event);
        assert.strictEqual(event!.outcome, 'selected');
        assert.strictEqual(event!.optionId, 'allow_once');

        const response = await pending;
        assert.deepStrictEqual(response.response, {
            outcome: { outcome: 'selected', optionId: 'allow_once' },
        });
        assert.strictEqual(bridge.pendingCount, 0);
    });

    it('cancelAll resolves pending with cancelled', async () => {
        const bridge = new PermissionBridge(0);
        const view = {
            requestId: 'perm-2',
            toolCallId: 'tc-2',
            title: 'Delete files',
            options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' as const }],
        };

        const pending = bridge.waitForChoice(view);
        const events = bridge.cancelAll();
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].outcome, 'cancelled');

        const response = await pending;
        assert.deepStrictEqual(response.response, { outcome: { outcome: 'cancelled' } });
    });

    it('submitSelected returns null for unknown requestId', () => {
        const bridge = new PermissionBridge(0);
        assert.strictEqual(bridge.submitSelected('missing', 'allow_once'), null);
    });

    it('times out with reject_once when available', async () => {
        const bridge = new PermissionBridge(20);
        const view = {
            requestId: 'perm-3',
            toolCallId: 'tc-3',
            title: 'Timeout test',
            options: [
                { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' as const },
                { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' as const },
            ],
        };

        const settled = await bridge.waitForChoice(view);
        assert.deepStrictEqual(settled.response, {
            outcome: { outcome: 'selected', optionId: 'reject_once' },
        });
    });
});

describe('normalizePermissionOptions', () => {
    it('returns defaults when options empty', () => {
        const opts = normalizePermissionOptions([]);
        assert.strictEqual(opts.length, 3);
        assert.strictEqual(opts[0].optionId, 'allow_once');
    });

    it('maps agent options', () => {
        const opts = normalizePermissionOptions([
            { optionId: 'allow_session', name: 'Allow for session', kind: 'allow_once' },
        ]);
        assert.strictEqual(opts[0].optionId, 'allow_session');
        assert.strictEqual(opts[0].name, 'Allow for session');
    });
});

describe('extractPermissionDetail', () => {
    it('returns string rawInput', () => {
        assert.strictEqual(
            extractPermissionDetail({ rawInput: 'rm -rf node_modules' }),
            'rm -rf node_modules'
        );
    });

    it('stringifies object rawInput', () => {
        const detail = extractPermissionDetail({ rawInput: { command: 'npm test' } });
        assert.ok(detail?.includes('npm test'));
    });
});
