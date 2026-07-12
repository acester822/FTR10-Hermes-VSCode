import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class HermesSettingsPanel {
  public static currentPanel: HermesSettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(_extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (HermesSettingsPanel.currentPanel) {
      HermesSettingsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'hermes.controlCenter',
      'Hermes Control Center',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    HermesSettingsPanel.currentPanel = new HermesSettingsPanel(panel);
  }

  /**
   * Resolve the dashboard URL from (in order of priority):
   *   1. HERMES_DASHBOARD_URL env var (set by the user's local dashboard
   *      service, e.g. http://127.0.0.1:PORT/config)
   *   2. a `dashboard.url` entry in the extension's .env file at the repo root
   *   3. a sane loopback default (http://127.0.0.1:8080/config)
   *
   * We never hard-code a public hostname in the source — the dashboard is a
   * local, loopback-only service.
   */
  private _resolveDashboardUrl(): string {
    const fromEnv = process.env.HERMES_DASHBOARD_URL?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    try {
      const envPath = path.join(__dirname, '..', '..', '.env');
      if (fs.existsSync(envPath)) {
        const contents = fs.readFileSync(envPath, 'utf8');
        const match = contents.match(/^\s*DASHBOARD_URL\s*=\s*(\S+)\s*$/m);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch {
      // ignore — fall through to default
    }

    return 'http://127.0.0.1:9119/config';
  }

  private _getHtmlForWebview(): string {
    const dashboardUrl = this._resolveDashboardUrl();
    const webview = this._panel.webview;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; frame-src https: http:; frame-ancestors ${webview.cspSource};">
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:transparent; }
  iframe { width:100%; height:100%; border:none; display:block; background:transparent; }
</style>
</head>
<body>
<iframe
  src="${dashboardUrl}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
  allow="clipboard-read; clipboard-write; microphone; camera"
  referrerpolicy="no-referrer-when-downgrade"
  allowtransparency="true"
></iframe>
</body></html>`;
  }

  public dispose(): void {
    HermesSettingsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }
}