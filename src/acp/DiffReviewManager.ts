import * as vscode from 'vscode';

interface PendingDiff {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  uri: vscode.Uri;
  proposedUri: vscode.Uri;
}

export type DiffReviewEvent = {
  type: 'proposed';
  filePath: string;
};

/**
 * URI scheme for virtual documents showing proposed diff content.
 */
const HERMES_DIFF_SCHEME = 'hermes-diff';

/** Map of file path → proposed content for the TextDocumentContentProvider */
const proposedContentMap = new Map<string, string>();

/** Provider that serves proposed diff content from the in-memory map */
class HermesDiffContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return proposedContentMap.get(uri.path) ?? '';
  }
}

/**
 * Register the hermes-diff:// content provider so propose_diff can open
 * diff views with proper file names instead of "Untitled-1".
 */
export function registerDiffContentProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      HERMES_DIFF_SCHEME,
      new HermesDiffContentProvider(),
    ),
  );
}

export class DiffReviewManager {
  private pending: PendingDiff | null = null;
  private _onEvent: ((e: DiffReviewEvent) => void) | null = null;

  get hasPending(): boolean {
    return this.pending !== null;
  }

  get pendingFilePath(): string | null {
    return this.pending?.filePath ?? null;
  }

  onEvent(handler: (e: DiffReviewEvent) => void): void {
    this._onEvent = handler;
  }

  async propose(filePath: string, proposedContent: string): Promise<{ status: string; message: string }> {
    const uri = vscode.Uri.file(filePath);

    // Read original content from disk without modifying the live document
    let originalContent = '';
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      originalContent = doc.getText();
    } catch {
      // File doesn't exist yet — treat as empty
    }

    if (originalContent === proposedContent) {
      return { status: 'no_changes', message: 'Proposed content is identical to current file.' };
    }

    // Store proposed content in the virtual document map so the
    // hermes-diff:// content provider can serve it to the diff editor.
    const proposedUri = vscode.Uri.from({ scheme: HERMES_DIFF_SCHEME, path: filePath });
    proposedContentMap.set(filePath, proposedContent);

    // Store pending state — the original file is NOT modified yet
    this.pending = {
      filePath,
      originalContent,
      proposedContent,
      uri,
      proposedUri,
    };

    // Open a diff editor: original on disk (left) vs proposed virtual doc (right)
    await vscode.commands.executeCommand(
      'vscode.diff',
      uri,
      proposedUri,
      `Hermes: ${filePath}`,
    );

    this._onEvent?.({ type: 'proposed', filePath });

    return {
      status: 'awaiting_review',
      message: 'Changes applied to file. Use accept_diff or reject_diff to finalize.',
    };
  }

  async accept(): Promise<{ status: string; message: string }> {
    if (!this.pending) {
      return { status: 'no_pending', message: 'No pending diff to accept.' };
    }

    const pending = this.pending;
    this.cleanup();
    this.pending = null;

    // Write the proposed content to the file via WorkspaceEdit
    const doc = await vscode.workspace.openTextDocument(pending.uri);
    const fullRange = new vscode.Range(
      0, 0,
      doc.lineCount, doc.lineAt(doc.lineCount - 1).text.length,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(pending.uri, fullRange, pending.proposedContent);
    const applied = await vscode.workspace.applyEdit(edit);

    if (applied) {
      await doc.save();
    }

    // Close the diff editor tab(s) for this file
    await this.closeDiffTabs(pending.uri);

    return { status: 'accepted', message: `Changes to ${pending.filePath} accepted and saved.` };
  }

  async reject(): Promise<{ status: string; message: string }> {
    if (!this.pending) {
      return { status: 'no_pending', message: 'No pending diff to reject.' };
    }

    const pending = this.pending;
    this.cleanup();
    this.pending = null;

    // Close the diff editor tab(s) — original file was never modified
    await this.closeDiffTabs(pending.uri);

    return { status: 'rejected', message: `Changes to ${pending.filePath} rejected and reverted.` };
  }

  private cleanup(): void {
    if (this.pending) {
      proposedContentMap.delete(this.pending.filePath);
    }
  }

  private async closeDiffTabs(fileUri: vscode.Uri): Promise<void> {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const input = tab.input;
        if (input && typeof input === 'object' && 'modified' in input) {
          const diffInput = input as { original?: vscode.Uri; modified?: vscode.Uri };
          if (diffInput.original?.toString() === fileUri.toString() ||
              diffInput.modified?.toString() === fileUri.toString()) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    }
  }

  dispose(): void {
    this.cleanup();
    this.pending = null;
  }
}
