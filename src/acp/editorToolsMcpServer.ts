import * as http from 'http';
import * as vscode from 'vscode';
import { getRegisteredTools, type AcpToolDef } from './acpToolRegistration';

/**
 * Minimal MCP Streamable-HTTP server that exposes the VS Code editor tools
 * to the Hermes agent.
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
            // 1. Handle GET for SSE stream (Required by MCP Streamable HTTP spec)
            if (req.method === 'GET' && req.url === '/mcp') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                // Send a comment to keep the connection alive
                res.write(': connected\n\n');
                
                // Keep the connection open until the client disconnects
                req.on('close', () => {
                    res.end();
                });
                return;
            }

            // 2. Handle POST for JSON-RPC requests
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
            const isNotification = id === undefined || id === null;

            try {
                const result = await this._handleMethod(method, params, tools);
                
                // JSON-RPC 2.0: Server MUST NOT reply with a body to a Notification
                if (isNotification) {
                    res.writeHead(202); // 202 Accepted is standard for notifications in HTTP
                    res.end();
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
            } catch (err: any) {
                if (isNotification) {
                    res.writeHead(200);
                    res.end();
                    return;
                }
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
            // 3. Add the missing 'initialize' handshake!
            case 'initialize':
                return {
                    protocolVersion: '2024-11-05', // Latest stable MCP protocol version
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
                // Handled by the isNotification check above, but good to have explicit case
                return null;

            case 'ping':
                return {};

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