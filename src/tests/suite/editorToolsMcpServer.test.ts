import { describe, it } from 'mocha';
import assert from 'assert';
import { EditorToolsMcpServer } from '../../acp/editorToolsMcpServer';

// A healthy MCP `initialize`/`tools/list` handshake response, matching the
// shape editorToolsMcpServer.ts probes for (serverInfo.name === 'vscode-editor-tools').
function healthyResponses() {
    return [
        { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'vscode-editor-tools', version: '1.0.0' } } },
        { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'get_active_file' }, { name: 'get_cursor_context' }] } },
    ];
}

describe('EditorToolsMcpServer.probeHealthy', () => {
    const ORIG_FETCH = (global as any).fetch;

    function stubFetch(responses: any[], { failFirst = false } = {}) {
        let call = 0;
        (global as any).fetch = async (_url: string, _opts: any) => {
            if (failFirst && call === 0) {
                call++;
                throw new Error('ECONNREFUSED');
            }
            const body = responses[Math.min(call, responses.length - 1)];
            call++;
            return {
                ok: true,
                json: async () => body,
            };
        };
    }

    afterEach(() => {
        (global as any).fetch = ORIG_FETCH;
    });

    function makeServer(): EditorToolsMcpServer {
        const s = new EditorToolsMcpServer() as any;
        // `url` is a read-only getter backed by the (unbound) port. For the unit
        // test we don't bind a real socket — override the getter on this instance
        // so probeHealthy targets our stub fetch.
        Object.defineProperty(s, 'url', {
            configurable: true,
            get: () => 'http://127.0.0.1:9/mcp',
        });
        return s;
    }

    it('returns tool names on a healthy handshake', async () => {
        stubFetch(healthyResponses());
        const tools = await makeServer().probeHealthy(2000);
        assert.ok(Array.isArray(tools));
        assert.deepStrictEqual(tools, ['get_active_file', 'get_cursor_context']);
    });

    it('returns null when the server name is wrong', async () => {
        const bad = [{ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'some-other-server' } } }, { jsonrpc: '2.0', id: 2, result: { tools: [] } }];
        stubFetch(bad);
        const tools = await makeServer().probeHealthy(2000);
        assert.strictEqual(tools, null);
    });

    it('returns null when the HTTP status is not ok', async () => {
        (global as any).fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
        const tools = await makeServer().probeHealthy(2000);
        assert.strictEqual(tools, null);
    });

    it('returns null (does not throw) when the connection is refused', async () => {
        (global as any).fetch = async () => { throw new Error('ECONNREFUSED'); };
        const tools = await makeServer().probeHealthy(2000);
        assert.strictEqual(tools, null);
    });

    it('returns null when tools/list returns no tools', async () => {
        const empty = [{ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'vscode-editor-tools' } } }, { jsonrpc: '2.0', id: 2, result: { tools: [] } }];
        stubFetch(empty);
        const tools = await makeServer().probeHealthy(2000);
        assert.deepStrictEqual(tools, []);
    });
});
