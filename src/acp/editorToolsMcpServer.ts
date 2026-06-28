import * as http from 'http';
import * as vscode from 'vscode';
import { getRegisteredTools, type AcpToolDef } from './acpToolRegistration';

/**
 * Minimal MCP Streamable-HTTP server that exposes the VS Code editor tools
 * to the Hermes agent.
 *
 * The Hermes agent already supports `McpServerHttp` / `McpServerSse` in its
 * `_register_session_mcp_servers`. By advertising an `http`-transport MCP
 * server pointing at this local HTTP endpoint, the agent discovers and calls
 * the 14 editor context tools through its existing MCP client infrastructure —
 * no ACP-transport MCP support required from the agent.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST. Each request body is a single
 * JSON-RPC request. The response is `application/json`.
 *
 * Supported MCP methods:
 *   `tools/list`  → return all registered tool schemas
 *   `tools/call`  → execute a tool via VS Code commands, return the result
 */
export class EditorToolsMcpServer {
    private server: http.Server | null = null;
    private port = 0;

    get url(): string {
        return `http://127.0.0.1:${this.port}/mcp`;
    }

    async start(): Promise<void> {
        if (this.server) return;

        const tools = getRegisteredTools();

        this.server = http.createServer(async (req, res) => {
            if (req.method !== 'POST' || req.url !== '/mcp') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(chunk as Buffer);
            }
            const body = Buffer.concat(chunks).toString('utf-8');

            let msg: any;
            try {
                msg = JSON.parse(body);
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }));
                return;
            }

            const id = msg.id;
            const method = msg.method as string;
            const params = msg.params || {};

            try {
                const result = await this._handleMethod(method, params, tools);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
            } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32603, message: err?.message || String(err) },
                }));
            }
        });

        await new Promise<void>((resolve) => {
            this.server!.listen(0, '127.0.0.1', () => {
                const addr = this.server!.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                resolve();
            });
        });
    }

    private async _handleMethod(method: string, params: any, tools: AcpToolDef[]): Promise<any> {
        switch (method) {
            case 'tools/list':
                return {
                    tools: tools.map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.parameters,
                    })),
                };

            case 'tools/call': {
                const name = params.name as string;
                const args = (params.arguments ?? {}) as Record<string, unknown>;
                const tool = tools.find(t => t.name === name);
                if (!tool) {
                    throw new Error(`Unknown tool: ${name}`);
                }
                const result = await tool.handler(args);
                const text = result === undefined || result === null
                    ? 'ok'
                    : typeof result === 'string'
                        ? result
                        : JSON.stringify(result);
                return { content: [{ type: 'text', text }] };
            }

            default:
                throw new Error(`Unsupported MCP method: ${method}`);
        }
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.port = 0;
        }
    }
}
