import * as vscode from 'vscode';

export function registerDiffCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hermes.showDiff', async (originalUri: vscode.Uri, modifiedContent: string, title?: string) => {
      const modifiedDoc = await vscode.workspace.openTextDocument({
        content: modifiedContent,
        language: originalUri.fsPath.endsWith('.ts') ? 'typescript' : undefined,
      });

      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        modifiedDoc.uri,
        title || 'Hermes Suggestion',
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hermes.applyDiff', async (filePath: string, content: string) => {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, content);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        vscode.window.showInformationMessage(`Applied changes to ${filePath}`);
      }
      return applied;
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hermes.previewDiff', async (filePath: string, content: string) => {
      const originalUri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand('hermes.showDiff', originalUri, content, `Hermes: ${filePath}`);
    }),
  );
}