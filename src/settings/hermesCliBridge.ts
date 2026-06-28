import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import * as vscode from 'vscode';

export class HermesCliBridge {
  private configPath: string;
  private watcher: fs.FSWatcher | undefined;

  constructor() {
    this.configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
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
      exec(`hermes config get ${key}`, (error, stdout) => {
        resolve(error ? '' : stdout.trim());
      });
    });
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