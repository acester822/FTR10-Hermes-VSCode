import * as http from 'http';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { getRegisteredTools, type AcpToolDef } from './acpToolRegistration';
import { logToFile } from './fileLogger';

// Preferred loopback port for the editor-tools MCP server. A static port is
// used because the extension is a single process per VS Code window and the
// server is created exactly once per activation. A fixed port:
//   - removes the session-init race where the tool-definition file was written
//     with port 0 (http://127.0.0.1:0/mcp) before bind() resolved;
//   - avoids "port already in use" surprises on reload when an old process
//     briefly holds the prior random port;
//   - makes the mcp_url the agent receives deterministic.
// If the preferred port is unavailable we fall back to a random free port.
const PREFERRED_PORT = 39517;

export class EditorToolsMcpServer {
    private server: http.Server | null = null;
    private port = 0;

    get url(): string {
        return `http://127.0.0.1:${this.port}/mcp`;
    }

    async start(): Promise<void> {
        if (this.server) return;

        const tools = getRegisteredTools();
        logToFile(`[Hermes ACP] MCP Server starting with ${tools.length} tools`);

        this.server = http.createServer(async (req, res) => {
            try {
                // The Hermes agent uses the new Streamable HTTP transport.
                // It sends POST requests to /mcp and expects the JSON-RPC response in the HTTP body.
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

                    if (msg.id !== undefined) {
                        const headers: any = { 'Content-Type': 'application/json' };
                        let jsonResult = result;

                        // If it's the initialize request, add the Mcp-Session-Id header
                        // This is required by the new Streamable HTTP spec for session management
                        if (msg.method === 'initialize' && result.sessionId) {
                            headers['Mcp-Session-Id'] = result.sessionId;
                            // Remove sessionId from the JSON body so it's only in the header
                            const { sessionId, ...rest } = result;
                            jsonResult = rest;
                        }

                        // CRITICAL FIX: Return the JSON-RPC response directly in the HTTP body
                        const response = JSON.stringify({ jsonrpc: '2.0', result: jsonResult, id: msg.id });
                        res.writeHead(200, headers);
                        res.end(response);
                    } else {
                        // It's a notification (no id). Return 202 Accepted with no body.
                        res.writeHead(202);
                        res.end();
                    }
                } catch (err) {
                    logToFile(`[Hermes ACP] MCP Server JSON-RPC error: ${err}`);

                    if (msg.id !== undefined) {
                        const errorResponse = JSON.stringify({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal error' },
                            id: msg.id,
                        });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(errorResponse);
                    } else {
                        res.writeHead(202);
                        res.end();
                    }
                }
            } catch (err) {
                logToFile('[Hermes ACP] MCP Server error: ' + (err instanceof Error ? err.message : String(err)));
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });

        // Try the preferred static port first; fall back to a random free
        // port (0) if it is already taken (e.g. a surviving old process).
        const candidatePorts = [PREFERRED_PORT, 0];
        for (const candidate of candidatePorts) {
            let bound = false;
            try {
                await new Promise<void>((resolve, reject) => {
                    const onError = (err: NodeJS.ErrnoException) => {
                        if (candidate !== 0 && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
                            // Preferred port unavailable — try a random port next.
                            logToFile(`[Hermes ACP] Preferred port ${candidate} unavailable (${err.code}); falling back to random port`);
                            resolve();
                            return;
                        }
                        logToFile('[Hermes ACP] MCP Server failed to start: ' + (err instanceof Error ? err.message : String(err)));
                        reject(err);
                    };
                    this.server!.once('error', onError);
                    this.server!.listen(candidate, '127.0.0.1', () => {
                        this.server!.removeListener('error', onError);
                        const addr = this.server!.address();
                        if (addr && typeof addr === 'object') {
                            this.port = addr.port;
                            logToFile(`[Hermes ACP] MCP Server listening on port ${this.port}`);
                        }
                        bound = true;
                        resolve();
                    });
                });
                if (bound) break;
            } catch (err) {
                logToFile('[Hermes ACP] MCP Server failed to start: ' + (err instanceof Error ? err.message : String(err)));
                throw err;
            }
        }

        // Write inline tool definitions AFTER the server is listening (and the
        // port is known) so the mcp_url is always valid. Writing this BEFORE
        // bind() resolved previously produced http://127.0.0.1:0/mcp, which
        // the agent could not connect to — causing the editor tools to be
        // skipped on session init.
        try {
            const schemas = tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                toolset: 'mcp-vscode',
            }));
            fs.writeFileSync('/tmp/vscode-editor-tools.json', JSON.stringify({
                mcp_url: this.url,
                tools: schemas,
            }, null, 2));
            logToFile(`[Hermes ACP] Wrote inline tool definitions to /tmp/vscode-editor-tools.json (${schemas.length} tools, mcp_url=${this.url})`);
        } catch (err) {
            logToFile(`[Hermes ACP] Failed to write inline tool definitions: ${err}`);
        }
    }

    private async _handleJsonRpc(msg: any, tools: AcpToolDef[]): Promise<any> {
        const method = msg.method as string;
        const params = msg.params || {};

        switch (method) {
            case 'initialize':
                return {
                    // Generate a random session ID for the Mcp-Session-Id header
                    sessionId: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
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
            this.server.close();
            this.server = null;
            this.port = 0;
        }
    }
}
