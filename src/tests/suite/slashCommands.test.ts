import * as assert from 'assert';
import { AcpClient, SlashCommand } from '../../acp/AcpClient';

/**
 * Exercises the ACP `available_commands_update` path that powers the
 * slash-command picker in the webview. The server advertises supported
 * slash commands (help, model, tools, ...) and the client must parse them
 * into SlashCommand records and forward them via the onSlashCommands handler.
 */
describe('AcpClient available_commands_update', () => {
    function makeClient(onSlashCommands: (c: SlashCommand[]) => void): any {
        const client = new AcpClient(
            () => {},
            () => {},
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            onSlashCommands
        );
        return client;
    }

    it('parses advertised commands into name/description/inputHint', () => {
        let received: SlashCommand[] = [];
        const client = makeClient((c) => { received = c; });

        (client as any)._handleSessionUpdate({
            sessionId: 'sess-1',
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: [
                    { name: 'help', description: 'List available commands', input: null },
                    { name: 'model', description: 'Show or change model', input: { hint: 'model name' } },
                    { name: 'tools', description: 'List available tools', input: null },
                ],
            },
        });

        assert.strictEqual(received.length, 3);
        assert.deepStrictEqual(received[0], { name: 'help', description: 'List available commands', inputHint: null });
        assert.deepStrictEqual(received[1], { name: 'model', description: 'Show or change model', inputHint: 'model name' });
    });

    it('filters out entries missing a name', () => {
        let received: SlashCommand[] = [];
        const client = makeClient((c) => { received = c; });

        (client as any)._handleSessionUpdate({
            sessionId: 'sess-1',
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: [
                    { name: 'reset', description: 'Clear history', input: null },
                    { description: 'no name', input: null },
                    null,
                ],
            },
        });

        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].name, 'reset');
    });

    it('ignores non-array payloads without throwing', () => {
        let called = false;
        const client = makeClient(() => { called = true; });

        assert.doesNotThrow(() => {
            (client as any)._handleSessionUpdate({
                sessionId: 'sess-1',
                update: {
                    sessionUpdate: 'available_commands_update',
                    availableCommands: 'not-an-array',
                },
            });
        });
        assert.strictEqual(called, false);
    });

    it('does not treat regular agent messages as commands', () => {
        let called = false;
        const client = makeClient(() => { called = true; });

        (client as any)._handleSessionUpdate({
            sessionId: 'sess-1',
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'hello' },
            },
        });

        assert.strictEqual(called, false);
    });
});
