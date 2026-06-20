import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Cursor / VS Code mcp.json entry shape (per-server object). */
export interface EditorMcpServerConfig {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    disabled?: boolean;
}

export interface EditorMcpFile {
    mcpServers?: Record<string, EditorMcpServerConfig>;
}

/** ACP session/new MCP server — mirrors @agentclientprotocol/sdk schema. */
export type SessionMcpServer =
    | {
          type: 'http';
          name: string;
          url: string;
          headers: Array<{ name: string; value: string }>;
      }
    | {
          type: 'sse';
          name: string;
          url: string;
          headers: Array<{ name: string; value: string }>;
      }
    | {
          name: string;
          command: string;
          args: string[];
          env: Array<{ name: string; value: string }>;
      };

function recordToPairs(record: Record<string, string> | undefined): Array<{ name: string; value: string }> {
    if (!record) {
        return [];
    }
    return Object.entries(record).map(([name, value]) => ({ name, value: String(value) }));
}

/** Substitute Cursor/VS Code MCP config variables in strings. */
export function substituteMcpVariables(text: string, cwd: string): string {
    const home = os.homedir();
    return text
        .replace(/\$\{workspaceFolder\}/g, cwd)
        .replace(/\$\{userHome\}/g, home)
        .replace(/\$\{env:([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

function substituteArgs(args: string[] | undefined, cwd: string): string[] {
    return (args ?? []).map(arg => substituteMcpVariables(arg, cwd));
}

function substituteEnv(env: Record<string, string> | undefined, cwd: string): Record<string, string> {
    if (!env) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        out[key] = substituteMcpVariables(value, cwd);
    }
    return out;
}

/** Candidate mcp.json paths: workspace first, then user-level. Later entries override names. */
export function getMcpConfigPaths(workspaceCwd: string): string[] {
    const home = os.homedir();
    return [
        path.join(home, '.cursor', 'mcp.json'),
        path.join(home, '.vscode', 'mcp.json'),
        path.join(workspaceCwd, '.cursor', 'mcp.json'),
        path.join(workspaceCwd, '.vscode', 'mcp.json'),
    ];
}

export function readMcpConfigFile(filePath: string): Record<string, EditorMcpServerConfig> {
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EditorMcpFile;
        if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
            return {};
        }
        return raw.mcpServers;
    } catch {
        return {};
    }
}

export function mergeMcpServerMaps(
    ...maps: Array<Record<string, EditorMcpServerConfig>>
): Record<string, EditorMcpServerConfig> {
    return Object.assign({}, ...maps);
}

export function loadMergedMcpServers(workspaceCwd: string): Record<string, EditorMcpServerConfig> {
    const paths = getMcpConfigPaths(workspaceCwd);
    const maps = paths.map(readMcpConfigFile);
    return mergeMcpServerMaps(...maps);
}

export function toSessionMcpServer(
    name: string,
    cfg: EditorMcpServerConfig,
    cwd: string
): SessionMcpServer | null {
    if (cfg.disabled) {
        return null;
    }

    const url = cfg.url ? substituteMcpVariables(cfg.url, cwd) : undefined;
    const transport = (cfg.type ?? (url ? 'http' : 'stdio')).toLowerCase();

    if (url && (transport === 'http' || transport === 'sse')) {
        return {
            type: transport,
            name,
            url,
            headers: recordToPairs(
                cfg.headers
                    ? Object.fromEntries(
                          Object.entries(cfg.headers).map(([k, v]) => [k, substituteMcpVariables(v, cwd)])
                      )
                    : undefined
            ),
        };
    }

    const command = cfg.command ? substituteMcpVariables(cfg.command, cwd) : undefined;
    if (!command) {
        return null;
    }

    return {
        name,
        command,
        args: substituteArgs(cfg.args, cwd),
        env: recordToPairs(substituteEnv(cfg.env, cwd)),
    };
}

/** Resolve editor MCP config into ACP `session/new` mcpServers array. */
export function resolveMcpServersForSession(workspaceCwd: string): SessionMcpServer[] {
    const merged = loadMergedMcpServers(workspaceCwd);
    const servers: SessionMcpServer[] = [];
    for (const [name, cfg] of Object.entries(merged)) {
        const server = toSessionMcpServer(name, cfg, workspaceCwd);
        if (server) {
            servers.push(server);
        }
    }
    return servers;
}
