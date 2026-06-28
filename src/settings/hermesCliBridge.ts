import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import * as vscode from 'vscode';

export interface SessionEntry {
  title: string;
  preview: string;
  lastActive: string;
  id: string;
}

function resolveHermesCmd(): string {
  const cfgPath = vscode.workspace.getConfiguration('hermes').get<string>('path') || '';
  if (cfgPath) { return cfgPath; }
  const onPath = '/home/ftr/.local/bin/hermes';
  if (fs.existsSync(onPath)) { return onPath; }
  return 'hermes';
}

function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const currentPath = env.PATH || '';
  if (!currentPath.includes(localBin)) {
    env.PATH = localBin + (currentPath ? ':' + currentPath : '');
  }
  return env;
}

export class HermesCliBridge {
  private configPath: string;
  private watcher: fs.FSWatcher | undefined;
  private hermesCmd: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    this.hermesCmd = resolveHermesCmd();
    this.ensureConfigExists();
  }

  startWatching(onChange: (config: any) => void): void {
    try {
      this.watcher = fs.watch(this.configPath, async (eventType) => {
        if (eventType === 'change') {
          const newConfig = await this.readConfig();
          onChange(newConfig);
        }
      });
    } catch {
      // File may not exist yet
    }
  }

  private ensureConfigExists(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public async readConfig(): Promise<any> {
    try {
      if (!fs.existsSync(this.configPath)) {
        return {};
      }
      const data = fs.readFileSync(this.configPath, 'utf-8');
      return this._parseYamlish(data);
    } catch {
      return {};
    }
  }

  public async writeConfig(settings: any): Promise<void> {
    const current = await this.readConfig();
    const merged = { ...current, ...settings };
    const yaml = this._stringifyYamlish(merged);
    fs.writeFileSync(this.configPath, yaml, 'utf-8');
  }

  public async getCliSetting(key: string): Promise<string> {
    return new Promise((resolve) => {
      exec(`${this.hermesCmd} config get ${key}`, { env: buildEnv() }, (error, stdout) => {
        resolve(error ? '' : stdout.trim());
      });
    });
  }

  private runCli(command: string): Promise<string> {
    return new Promise((resolve) => {
      exec(command, { maxBuffer: 1024 * 1024 * 10, env: buildEnv() }, (error, stdout, stderr) => {
        if (error) {
          resolve(`Error: ${error.message}\n${stderr}`);
          return;
        }
        resolve(stdout || stderr || '');
      });
    });
  }

  async getConfigOutput(): Promise<string> {
    return this.runCli(`${this.hermesCmd} config show`);
  }

  async getMemoryStatus(): Promise<string> {
    return this.runCli(`${this.hermesCmd} memory status`);
  }

  async getAgentStatus(): Promise<string> {
    return this.runCli(`${this.hermesCmd} status`);
  }

  async getSessionList(): Promise<SessionEntry[]> {
    const output = await this.runCli(`${this.hermesCmd} sessions list --limit 50`);
    return this._parseSessionTable(output);
  }

  private _parseSessionTable(output: string): SessionEntry[] {
    const lines = output.split('\n').filter(l => l.trim());
    const sessions: SessionEntry[] = [];
    let started = false;
    for (const line of lines) {
      if (line.includes('Title') && line.includes('Preview') && line.includes('Last Active')) {
        started = true;
        continue;
      }
      if (line.startsWith('─')) continue;
      if (!started) continue;
      if (!line.trim()) continue;
      const title = line.slice(0, 33).trim();
      const preview = line.slice(33, 72).trim();
      const rest = line.slice(72).trim();
      const idMatch = rest.match(/([\w-]+)$/);
      const id = idMatch ? idMatch[1] : '';
      const lastActive = rest.slice(0, rest.length - (id?.length || 0)).trim();
      sessions.push({ title: title || '(untitled)', preview, lastActive, id });
    }
    return sessions;
  }

  async deleteSession(sessionId: string): Promise<string> {
    return this.runCli(`${this.hermesCmd} sessions delete ${sessionId}`);
  }

  public dispose(): void {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* ignore */ }
      this.watcher = undefined;
    }
  }

  private _parseYamlish(text: string): any {
    const result: Record<string, any> = {};
    for (const line of text.split('\n')) {
      const match = line.match(/^(\w[\w._-]*)\s*:\s*(.*)$/);
      if (match) {
        let value: any = match[2].trim();
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        result[match[1]] = value;
      }
    }
    return result;
  }

  private _stringifyYamlish(obj: any): string {
    return Object.entries(obj)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n') + '\n';
  }
}