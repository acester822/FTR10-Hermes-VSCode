import * as vscode from 'vscode';
import { registerEditorContextTools, type AcpToolDef } from './editorContextTools';
import { DiffReviewManager } from './DiffReviewManager';

export type { AcpToolDef } from './editorContextTools';

let _registeredTools: AcpToolDef[] = [];
let _diffReview: DiffReviewManager | undefined;

export function setDiffReviewManager(manager: DiffReviewManager): void {
  _diffReview = manager;
}

export function getRegisteredTools(): AcpToolDef[] {
  if (_registeredTools.length === 0) {
    _registeredTools = registerEditorContextTools(_diffReview);
  }
  return _registeredTools;
}

export function registerToolInvocationCommand(context: vscode.ExtensionContext): void {
  const tools = getRegisteredTools();

  context.subscriptions.push(
    vscode.commands.registerCommand('hermes-agent.invokeTool', async (toolName: string, args: any) => {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return await tool.handler(args);
    }),
  );

  for (const tool of tools) {
    const cmdName = `hermes-agent.tool.${tool.name}`;
    context.subscriptions.push(
      vscode.commands.registerCommand(cmdName, async (args: any) => {
        return await tool.handler(args ?? {});
      }),
    );
  }
}

export function getToolManifest(): Array<{
  name: string;
  description: string;
  parameters: Record<string, any>;
}> {
  return getRegisteredTools().map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export function getEventsSubscriptions(): Array<vscode.Disposable> {
  const disposables: vscode.Disposable[] = [];

  const internalCommands = [
    'hermes-agent.internal.cursorMoved',
    'hermes-agent.internal.activeEditorChanged',
    'hermes-agent.internal.documentSaved',
    'hermes-agent.internal.diagnosticsChanged',
  ] as const;

  for (const cmd of internalCommands) {
    disposables.push(
      vscode.commands.registerCommand(cmd, (..._args: unknown[]) => {
        /* no-op — reserved for future use */
      }),
    );
  }

  disposables.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        vscode.commands.executeCommand('hermes-agent.internal.cursorMoved');
      }
    }),
  );

  disposables.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        vscode.commands.executeCommand('hermes-agent.internal.activeEditorChanged', {
          filePath: editor.document.uri.fsPath,
          languageId: editor.document.languageId,
        });
      }
    }),
  );

  disposables.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      vscode.commands.executeCommand('hermes-agent.internal.documentSaved', {
        filePath: doc.uri.fsPath,
      });
    }),
  );

  disposables.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      vscode.commands.executeCommand('hermes-agent.internal.diagnosticsChanged');
    }),
  );

  return disposables;
}
