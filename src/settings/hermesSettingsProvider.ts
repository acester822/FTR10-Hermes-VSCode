import * as vscode from 'vscode';
import { HermesCliBridge } from './hermesCliBridge';

export class HermesSettingsProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hermes.settingsDashboard';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private cliBridge: HermesCliBridge,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async data => {
      switch (data.type) {
        case 'saveSettings':
          await vscode.workspace.getConfiguration('hermes').update('agentConfig', data.value, true);
          await this.cliBridge.writeConfig(data.value);
          vscode.window.showInformationMessage('Settings synced to Hermes CLI!');
          break;
        case 'requestInitialSettings':
          const config = await this.cliBridge.readConfig();
          webviewView.webview.postMessage({ type: 'loadSettings', value: config });
          break;
        case 'testConnection':
          await this._handleTestConnection(webviewView);
          break;
        case 'exportProfile':
          await this._handleExportProfile(webviewView);
          break;
        case 'importProfile':
          await this._handleImportProfile(webviewView);
          break;
      }
    });

    this.cliBridge.startWatching(async (newConfig) => {
      webviewView.webview.postMessage({ type: 'externalConfigChange', value: newConfig });
    });
  }

  private async _handleTestConnection(webviewView: vscode.WebviewView): Promise<void> {
    try {
      const { exec } = require('child_process');
      const result = await new Promise<string>((resolve) => {
        exec('hermes --version', (error: any, stdout: string) => {
          resolve(error ? '' : stdout.trim());
        });
      });
      if (result) {
        webviewView.webview.postMessage({ type: 'connectionTestResult', ok: true, version: result });
      } else {
        webviewView.webview.postMessage({ type: 'connectionTestResult', ok: false });
      }
    } catch {
      webviewView.webview.postMessage({ type: 'connectionTestResult', ok: false });
    }
  }

  private async _handleExportProfile(webviewView: vscode.WebviewView): Promise<void> {
    const config = await this.cliBridge.readConfig();
    const profileJson = JSON.stringify(config, null, 2);
    const doc = await vscode.workspace.openTextDocument({
      content: profileJson,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc);
    webviewView.webview.postMessage({ type: 'exportProfileResult', content: profileJson });
  }

  private async _handleImportProfile(webviewView: vscode.WebviewView): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'Profile': ['json', 'yaml', 'yml'] },
      title: 'Import Hermes Profile',
    });
    if (!picked?.[0]) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(picked[0]);
      const content = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(content);
      await this.cliBridge.writeConfig(parsed);
      webviewView.webview.postMessage({ type: 'importProfileResult', ok: true });
      vscode.window.showInformationMessage('Profile imported successfully!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewView.webview.postMessage({ type: 'importProfileResult', ok: false, error: msg });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body { padding: 10px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
        .section { margin-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 15px; }
        h2 { font-size: 14px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-top: 0; }
        label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
        input[type="text"], input[type="password"] {
          width: 100%; padding: 4px 8px; margin-bottom: 8px; box-sizing: border-box;
          background: var(--vscode-input-background); color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border); border-radius: 2px;
        }
        .checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .btn-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        button {
          background: var(--vscode-button-background); color: var(--vscode-button-foreground);
          border: none; padding: 6px 14px; cursor: pointer; border-radius: 2px;
        }
        button.secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        button:hover { opacity: 0.9; }
        #connection-status { margin-top: 8px; font-size: 12px; }
        .ok { color: var(--vscode-terminal-ansiGreen); }
        .err { color: var(--vscode-terminal-ansiRed); }
        .system-preview {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          padding: 8px; margin-top: 8px; font-family: var(--vscode-editor-font-family);
          font-size: 11px; white-space: pre-wrap; max-height: 120px; overflow-y: auto;
        }
      </style>
    </head>
    <body>
      <h2>Agent Configuration</h2>

      <div class="section">
        <label for="model-name">Model Name</label>
        <input type="text" id="model-name" placeholder="e.g., hermes-3-llama-3.1">

        <label for="provider">Provider</label>
        <input type="text" id="provider" placeholder="e.g., openrouter, anthropic">
      </div>

      <div class="section">
        <h2>Tool Permissions</h2>
        <div class="checkbox-row">
          <input type="checkbox" id="auto-approve-read">
          <label for="auto-approve-read" style="display:inline">Auto-approve File Reads</label>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="auto-approve-write">
          <label for="auto-approve-write" style="display:inline">Auto-approve File Writes</label>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="auto-approve-cmd">
          <label for="auto-approve-cmd" style="display:inline">Auto-approve Terminal Commands</label>
        </div>
      </div>

      <div class="section">
        <h2>System Prompt Preview</h2>
        <div class="system-preview" id="system-preview">Configure settings above to see the system prompt preview...</div>
      </div>

      <div class="btn-row">
        <button id="save-btn">Save & Sync to CLI</button>
        <button id="test-btn" class="secondary">Test Connection</button>
        <button id="export-btn" class="secondary">Export Profile</button>
        <button id="import-btn" class="secondary">Import Profile</button>
      </div>

      <div id="connection-status"></div>

      <script>
        (function() {
          const vscode = acquireVsCodeApi();
          vscode.postMessage({ type: 'requestInitialSettings' });

          function updatePreview() {
            const modelName = document.getElementById('model-name').value;
            const provider = document.getElementById('provider').value;
            const autoRead = document.getElementById('auto-approve-read').checked;
            const autoWrite = document.getElementById('auto-approve-write').checked;
            const autoCmd = document.getElementById('auto-approve-cmd').checked;

            let preview = 'System Prompt Preview:\\n\\n';
            preview += 'You are Hermes, an AI coding assistant.\\n';
            if (modelName) preview += 'Current model: ' + modelName + '\\n';
            if (provider) preview += 'Provider: ' + provider + '\\n\\n';
            preview += 'Permissions:\\n';
            preview += '- Read files: ' + (autoRead ? 'auto-approved' : 'requires permission') + '\\n';
            preview += '- Write files: ' + (autoWrite ? 'auto-approved' : 'requires permission') + '\\n';
            preview += '- Terminal: ' + (autoCmd ? 'auto-approved' : 'requires permission');

            document.getElementById('system-preview').textContent = preview;
          }

          document.getElementById('model-name').addEventListener('input', updatePreview);
          document.getElementById('provider').addEventListener('input', updatePreview);
          document.getElementById('auto-approve-read').addEventListener('change', updatePreview);
          document.getElementById('auto-approve-write').addEventListener('change', updatePreview);
          document.getElementById('auto-approve-cmd').addEventListener('change', updatePreview);

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'loadSettings') {
              document.getElementById('model-name').value = message.value.modelName || '';
              document.getElementById('provider').value = message.value.provider || '';
              document.getElementById('auto-approve-read').checked = message.value.autoRead || false;
              document.getElementById('auto-approve-write').checked = message.value.autoWrite || false;
              document.getElementById('auto-approve-cmd').checked = message.value.autoCmd || false;
              updatePreview();
            }
            if (message.type === 'connectionTestResult') {
              const status = document.getElementById('connection-status');
              if (message.ok) {
                status.innerHTML = '<span class="ok">✓ Connected - Hermes ' + (message.version || '') + '</span>';
              } else {
                status.innerHTML = '<span class="err">✗ Connection failed</span>';
              }
            }
            if (message.type === 'externalConfigChange') {
              if (message.value.modelName) {
                document.getElementById('model-name').value = message.value.modelName;
              }
              updatePreview();
            }
          });

          document.getElementById('save-btn').addEventListener('click', () => {
            const settings = {
              modelName: document.getElementById('model-name').value,
              provider: document.getElementById('provider').value,
              autoRead: document.getElementById('auto-approve-read').checked,
              autoWrite: document.getElementById('auto-approve-write').checked,
              autoCmd: document.getElementById('auto-approve-cmd').checked
            };
            vscode.postMessage({ type: 'saveSettings', value: settings });
          });

          document.getElementById('test-btn').addEventListener('click', () => {
            document.getElementById('connection-status').textContent = 'Testing connection...';
            vscode.postMessage({ type: 'testConnection' });
          });

          document.getElementById('export-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'exportProfile' });
          });

          document.getElementById('import-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'importProfile' });
          });
        })();
      </script>
    </body>
    </html>`;
  }
}