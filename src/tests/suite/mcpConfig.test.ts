import { describe, it } from 'mocha';
import assert from 'assert';
import {
    mergeMcpServerMaps,
    substituteMcpVariables,
    toSessionMcpServer,
} from '../../acp/mcpConfig';

describe('mcpConfig', () => {
    it('substituteMcpVariables resolves workspaceFolder and env', () => {
        process.env.TEST_MCP_VAR = 'resolved';
        assert.strictEqual(
            substituteMcpVariables('${workspaceFolder}/x', '/proj'),
            '/proj/x'
        );
        assert.strictEqual(
            substituteMcpVariables('${env:TEST_MCP_VAR}', '/proj'),
            'resolved'
        );
        delete process.env.TEST_MCP_VAR;
    });

    it('toSessionMcpServer converts stdio config', () => {
        const server = toSessionMcpServer('codegraph', {
            type: 'stdio',
            command: 'codegraph',
            args: ['serve', '--path', '${workspaceFolder}'],
        }, '/abs/ws');
        assert.ok(server);
        assert.strictEqual('command' in server && server.command, 'codegraph');
        assert.deepStrictEqual('args' in server ? server.args : [], ['serve', '--path', '/abs/ws']);
    });

    it('toSessionMcpServer converts http config', () => {
        const server = toSessionMcpServer('obsidian', {
            url: 'http://127.0.0.1:27123/mcp/',
            headers: { Authorization: 'Bearer token' },
        }, '/abs/ws');
        assert.ok(server);
        assert.strictEqual('type' in server && server.type, 'http');
        assert.strictEqual('url' in server && server.url, 'http://127.0.0.1:27123/mcp/');
    });

    it('toSessionMcpServer skips disabled servers', () => {
        assert.strictEqual(
            toSessionMcpServer('off', { disabled: true, command: 'x' }, '/abs/ws'),
            null
        );
    });

    it('mergeMcpServerMaps lets later maps override names', () => {
        const merged = mergeMcpServerMaps(
            { a: { command: 'one' } },
            { a: { command: 'two' }, b: { command: 'three' } }
        );
        assert.strictEqual(merged.a.command, 'two');
        assert.strictEqual(merged.b.command, 'three');
    });
});
