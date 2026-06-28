import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class HermesSettingsPanel {
  public static currentPanel: HermesSettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private gatewayUrl: string,
    private gatewayToken?: string,
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri, gatewayUrl: string, gatewayToken?: string): void {
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

    HermesSettingsPanel.currentPanel = new HermesSettingsPanel(panel, extensionUri, gatewayUrl, gatewayToken);
  }

  private _getHtmlForWebview(): string {
    const dashboardUrl = 'https://herm.ftr10.dev';
    const webview = this._panel.webview;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; frame-src https: http:; frame-ancestors ${webview.cspSource};">
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:var(--vscode-editor-background,#1e1e1e); }
  iframe { width:100%; height:100%; border:none; display:block; }
  .error { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; font-family:sans-serif; padding:20px; color:var(--vscode-foreground); }
</style>
</head>
<body>
<iframe
  src="${dashboardUrl}"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
  allow="clipboard-read; clipboard-write; microphone; camera"
  referrerpolicy="no-referrer-when-downgrade"
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