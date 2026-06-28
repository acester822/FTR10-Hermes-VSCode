import * as vscode from 'vscode';

export function registerCodeLensProvider(context: vscode.ExtensionContext): void {
  const askDisposable = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    new AskHermesCodeLensProvider(),
  );
  context.subscriptions.push(askDisposable);

  const explainDisposable = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    new ExplainThisCodeLensProvider(),
  );
  context.subscriptions.push(explainDisposable);
}

class AskHermesCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.lineCount === 0) return [];
    return [
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: '💬 Ask Hermes about this file',
        command: 'hermes.askAboutFile',
        arguments: [document.uri.fsPath],
      }),
    ];
  }
}

class ExplainThisCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    const functionRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
    let match: RegExpExecArray | null;
    while ((match = functionRegex.exec(text)) !== null) {
      const startLine = document.positionAt(match.index).line;
      const lineText = document.lineAt(startLine);
      lenses.push(
        new vscode.CodeLens(new vscode.Range(startLine, 0, startLine, lineText.text.length), {
          title: '🤖 Explain this',
          command: 'hermes.explainFunction',
          arguments: [document.uri.fsPath, match[1], startLine],
        }),
      );
    }

    const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
    while ((match = classRegex.exec(text)) !== null) {
      const startLine = document.positionAt(match.index).line;
      const lineText = document.lineAt(startLine);
      lenses.push(
        new vscode.CodeLens(new vscode.Range(startLine, 0, startLine, lineText.text.length), {
          title: '🤖 Explain this class',
          command: 'hermes.explainFunction',
          arguments: [document.uri.fsPath, match[1], startLine],
        }),
      );
    }

    return lenses;
  }
}