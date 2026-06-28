import * as vscode from 'vscode';
import { getToolManifest } from './acpToolRegistration';

/**
 * Unique ACP-side ID for the in-process VS Code Editor Tools MCP server.
 * The agent uses this ID when sending `mcp/connect` to reach us.
 */
export const VSCODE_MCP_SERVER_ID = 'vscode-editor-tools';
export const VSCODE_MCP_SERVER_NAME = 'VS Code Editor Tools';

/** ACP connection ID → metadata. */
interface McpConnection {
  id: string;
}

const _connections = new Map<string, McpConnection>();

function _genConnectionId(): string {
  return `vscode-mcp-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Public handlers called from AcpClient's onRequest registrations
// ---------------------------------------------------------------------------

/**
 * Handle `mcp/connect` from the agent.
 * Expects `params.acpId` to match VSCODE_MCP_SERVER_ID.
 */
export function handleMcpConnect(params: unknown): { connectionId: string } {
  const p = params as Record<string, unknown> | null | undefined;
  if (p?.acpId !== VSCODE_MCP_SERVER_ID) {
    throw new Error(`Unknown ACP MCP server: ${String(p?.acpId)}`);
  }
  const id = _genConnectionId();
  _connections.set(id, { id });
  return { connectionId: id };
}

/**
 * Handle `mcp/message` from the agent.
 * Routes inner MCP methods (`tools/list`, `tools/call`) to the editor tools.
 */
export async function handleMcpMessage(params: unknown): Promise<unknown> {
  const p = params as Record<string, unknown> | null | undefined;
  const connectionId = p?.connectionId as string | undefined;
  const method = p?.method as string | undefined;
  const mcpParams = p?.params as Record<string, unknown> | undefined;

  if (!connectionId || !_connections.has(connectionId)) {
    throw new Error(`Unknown MCP connection: ${connectionId}`);
  }
  if (!method) {
    throw new Error('mcp/message requires a "method" field');
  }

  switch (method) {
    case 'tools/list':
      return _handleToolsList();
    case 'tools/call':
      return _handleToolsCall(mcpParams);
    default:
      throw new Error(`Unsupported MCP method from VS Code tools: ${method}`);
  }
}

/**
 * Handle `mcp/disconnect` from the agent.
 */
export function handleMcpDisconnect(params: unknown): Record<string, never> {
  const p = params as Record<string, unknown> | null | undefined;
  const connectionId = p?.connectionId as string | undefined;
  if (connectionId) {
    _connections.delete(connectionId);
  }
  return {};
}

// ---------------------------------------------------------------------------
// Internal MCP protocol handlers
// ---------------------------------------------------------------------------

function _handleToolsList(): { tools: Array<Record<string, unknown>> } {
  const manifest = getToolManifest();
  const tools = manifest.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }));
  return { tools };
}

async function _handleToolsCall(
  mcpParams: Record<string, unknown> | undefined,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const name = mcpParams?.name as string | undefined;
  const args = (mcpParams?.arguments ?? {}) as Record<string, unknown>;

  if (!name) {
    throw new Error('tools/call requires a "name" field');
  }

  const result = await vscode.commands.executeCommand(
    'hermes-agent.invokeTool',
    name,
    args,
  );

  // Serialise the result to a single text block
  const text =
    result === undefined || result === null
      ? 'ok'
      : typeof result === 'string'
        ? result
        : JSON.stringify(result);

  return {
    content: [{ type: 'text', text }],
  };
}