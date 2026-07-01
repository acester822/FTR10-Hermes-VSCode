import * as http from 'http';
import * as vscode from 'vscode';
import { getRegisteredTools, type AcpToolDef } from './acpToolRegistration';
import { logToFile } from './fileLogger';

export class EditorToolsMcpServer {
    private server: http.Server | null = null;
    private port = 0;
    private sseConnections: http.ServerResponse[] = [];

    get url(): string {
        return `http://127.0.0.1:${this.port}/mcp`;
    }

    async start(): Promise<void> {
        if (this.server) return;

        const tools = getRegisteredTools();
        logToFile(`[Hermes ACP] MCP Server starting with ${tools.length} tools`);

        this.server = http.createServer(async (req, res) => {
            try {
                if (req.method === 'GET' && req.url === '/mcp') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    });

                    res.write('event: endpoint\ndata: /mcp\n\n');

                    this.sseConnections.push(res);
                    req.on('close', () => {
                        const index = this.sseConnections.indexOf(res);
                        if (index !== -1) this.sseConnections.splice(index, 1);
                        res.end();
                    });
                    return;
                }

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

                try {
                    const result = await this._handleJsonRpc(msg, tools);

                    res.writeHead(202);
                    res.end();

                    if (msg.id !== undefined) {
                        const response = JSON.stringify({ jsonrpc: '2.0', result, id: msg.id });
                        for (const sseRes of this.sseConnections) {
                            sseRes.write(`event: message\ndata: ${response}\n\n`);
                        }
                    }
                } catch (err) {
                    logToFile(`[Hermes ACP] MCP Server JSON-RPC error: ${err}`);

                    res.writeHead(202);
                    res.end();

                    if (msg.id !== undefined) {
                        const errorResponse = JSON.stringify({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal error' },
                            id: msg.id,
                        });
                        for (const sseRes of this.sseConnections) {
                            sseRes.write(`event: message\ndata: ${errorResponse}\n\n`);
                        }
                    }
                }
            } catch (err) {
                logToFile('[Hermes ACP] MCP Server error: ' + (err instanceof Error ? err.message : String(err)));
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.listen(0, '127.0.0.1', () => {
                const addr = this.server!.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    logToFile(`[Hermes ACP] MCP Server listening on port ${this.port}`);
                }
                resolve();
            });
            this.server!.on('error', (err) => {
                logToFile('[Hermes ACP] MCP Server failed to start: ' + (err instanceof Error ? err.message : String(err)));
                reject(err);
            });
        });
    }

    private async _handleJsonRpc(msg: any, tools: AcpToolDef[]): Promise<any> {
        const method = msg.method as string;
        const params = msg.params || {};

        switch (method) {
            case 'initialize':
                return {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {
                            listChanged: false,
                        },
                    },
                    serverInfo: {
                        name: 'vscode-editor-tools',
                        version: '1.0.0',
                    },
                };

            case 'notifications/initialized':
                return null;

            case 'ping':
                return {};

            case 'tools/list':
                logToFile(`[Hermes ACP] tools/list called, returning ${tools.length} tools`);
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
                logToFile(`[Hermes ACP] tools/call: ${name}`);
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
            for (const sseRes of this.sseConnections) {
                try { sseRes.end(); } catch { /* ignore */ }
            }
            this.sseConnections = [];
            this.server.close();
            this.server = null;
            this.port = 0;
        }
    }
}
