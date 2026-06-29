import * as vscode from 'vscode';
import * as path from 'path';
import type { DiffReviewManager } from './DiffReviewManager';

// Diff content provider (hermes-diff:// scheme) is registered via DiffReviewManager.
// See src/acp/DiffReviewManager.ts → registerDiffContentProvider().

export interface AcpToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: any) => Promise<any>;
}

function getActiveEditorContext(includeFullContent?: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    // Fallback: use the first open document if no active text editor.
    // This can happen when focus is on a webview, terminal, or command palette.
    const docs = vscode.workspace.textDocuments;
    if (docs.length === 0) return null;

    // Prefer the last visible editor's document as fallback.
    const fallbackDoc = docs[docs.length - 1];
    return {
      filePath: fallbackDoc.uri.fsPath,
      fileName: fallbackDoc.fileName,
      languageId: fallbackDoc.languageId,
      encoding: fallbackDoc.encoding?.toString() ?? 'utf-8',
      lineCount: fallbackDoc.lineCount,
      cursorLine: 0,
      cursorCharacter: 0,
      selectionText: '',
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      visibleRanges: [],
      visibleText: '',
      note: 'No active text editor; returned last open document as fallback',
    };
  }

  const document = editor.document;
  const selection = editor.selection;
  const lineCount = document.lineCount;
  const autoFullContent = includeFullContent !== false && lineCount < 500;
  const showFull = includeFullContent === true || autoFullContent;

  const result: Record<string, any> = {
    filePath: document.uri.fsPath,
    fileName: document.fileName,
    languageId: document.languageId,
    encoding: document.encoding?.toString() ?? 'utf-8',
    lineCount,
    cursorLine: selection.active.line,
    cursorCharacter: selection.active.character,
    selectionText: document.getText(selection),
    selectionRange: {
      start: { line: selection.start.line, character: selection.start.character },
      end: { line: selection.end.line, character: selection.end.character },
    },
    visibleRanges: editor.visibleRanges.map(range => ({
      startLine: range.start.line,
      endLine: range.end.line,
    })),
    visibleText: editor.visibleRanges.map(range => document.getText(range)).join('\n'),
  };

  if (showFull) {
    result.fullText = document.getText();
  }

  return result;
}

function getOpenTabsContext() {
  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor?.document.uri.fsPath ?? null;

  const tabs: Array<{
    label: string;
    filePath: string | undefined;
    languageId: string | undefined;
    isActive: boolean;
    isDirty: boolean;
    isPinned: boolean;
  }> = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri;
        // Use the globally active editor as the source of truth for "active" state,
        // not tab.isActive which is per-group and can be misleading.
        const filePath = uri.fsPath;
        tabs.push({
          label: tab.label,
          filePath,
          languageId: vscode.workspace.textDocuments
            .find(d => d.uri.toString() === uri.toString())?.languageId,
          isActive: filePath === activeFilePath,
          isDirty: tab.isDirty,
          isPinned: tab.isPinned,
        });
      }
    }
  }

  return tabs;
}

function getAllOpenDocuments() {
  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor?.document.uri.fsPath ?? null;

  return vscode.workspace.textDocuments.map(doc => ({
    uri: doc.uri.toString(),
    filePath: doc.uri.fsPath,
    languageId: doc.languageId,
    isActive: doc.uri.fsPath === activeFilePath,
    isDirty: doc.isDirty,
    isUntitled: doc.isUntitled,
    lineCount: doc.lineCount,
    content: doc.lineCount < 1000 ? doc.getText() : undefined,
  }));
}

function getWorkspaceContext() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { hasWorkspace: false };
  }

  return {
    hasWorkspace: true,
    rootPath: folders[0].uri.fsPath,
    allFolders: folders.map(f => ({
      name: f.name,
      path: f.uri.fsPath,
    })),
    defaultLanguage: vscode.workspace.getConfiguration().get('files.defaultLanguage'),
  };
}

async function getDirectoryContents(dirPath?: string, maxDepth = 1): Promise<any> {
  const root = dirPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error('No workspace open');

  async function readDir(currentPath: string, depth: number): Promise<any> {
    if (depth > maxDepth) return { path: currentPath, truncated: true };

    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(currentPath));
    const items = await Promise.all(
      entries
        .filter(([name]) => !name.startsWith('.') && name !== 'node_modules')
        .map(async ([name, type]) => {
          const fullPath = path.join(currentPath, name);
          if (type === vscode.FileType.Directory) {
            return {
              name,
              type: 'directory',
              children: await readDir(fullPath, depth + 1),
            };
          }
          const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
          return { name, type: 'file', size: stat.size };
        }),
    );

    return items;
  }

  return { rootPath: root, tree: await readDir(root, 0) };
}

function getDiagnostics(filePath?: string) {
  if (filePath) {
    const diags = vscode.languages.getDiagnostics(vscode.Uri.file(filePath));
    return (diags as vscode.Diagnostic[]).map(d => ({
      severity: vscode.DiagnosticSeverity[d.severity],
      message: d.message,
      line: d.range.start.line,
      source: d.source,
    }));
  }

  const allDiagnostics = vscode.languages.getDiagnostics();
  return allDiagnostics.map(([uri, diags]) => ({
      filePath: uri.fsPath,
      diagnostics: diags.map(d => ({
        severity: vscode.DiagnosticSeverity[d.severity],
        message: d.message,
        range: {
          startLine: d.range.start.line,
          startChar: d.range.start.character,
          endLine: d.range.end.line,
          endChar: d.range.end.character,
        },
        source: d.source,
        code: d.code,
      })),
    }));
}

async function getGitContext() {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
  const git = gitExtension?.getAPI(1);

  if (!git || git.repositories.length === 0) {
    return { hasGit: false };
  }

  const repo = git.repositories[0];
  const head = repo.state.HEAD;

  return {
    hasGit: true,
    branch: head?.name,
    commit: head?.commit,
    upstream: head?.upstream?.name,
    workingTreeChanges: repo.state.workingTreeChanges.map((c: any) => ({
      filePath: c.uri.fsPath,
      status: c.status,
    })),
    stagedChanges: repo.state.indexChanges.map((c: any) => ({
      filePath: c.uri.fsPath,
      status: c.status,
    })),
  };
}

function getTerminalContext() {
  return {
    activeTerminal: vscode.window.activeTerminal?.name,
    terminals: vscode.window.terminals.map(t => ({
      name: t.name,
      processId: undefined,
    })),
  };
}

function getCursorSurroundings(lineWindow = 20) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const doc = editor.document;
  const cursorLine = editor.selection.active.line;

  const startLine = Math.max(0, cursorLine - lineWindow);
  const endLine = Math.min(doc.lineCount - 1, cursorLine + lineWindow);

  const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);

  return {
    filePath: doc.fileName,
    cursorLine,
    startLine,
    endLine,
    codeWithCursor: doc.getText(range),
    cursorOffset: cursorLine - startLine,
  };
}

async function getDocumentSymbols(uri: vscode.Uri) {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    uri,
  );

  function flattenSymbols(syms: vscode.DocumentSymbol[]): any[] {
    return syms.map(s => ({
      name: s.name,
      kind: vscode.SymbolKind[s.kind],
      range: `${s.range.start.line}-${s.range.end.line}`,
      children: s.children?.map(c => c.name),
      detail: s.detail || undefined,
    }));
  }

  return symbols ? flattenSymbols(symbols) : [];
}

async function getReferencesAtCursor(filePath?: string, line?: number) {
  let uri: vscode.Uri;
  let position: vscode.Position;

  if (filePath && line !== undefined) {
    uri = vscode.Uri.file(filePath);
    position = new vscode.Position(line, 0);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    uri = editor.document.uri;
    position = editor.selection.active;
  }

  const locations = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    uri,
    position,
  );

  return locations?.map(loc => ({
    file: loc.uri.fsPath,
    line: loc.range.start.line,
  })) || [];
}

async function getDefinitionsAtCursor(filePath?: string, line?: number) {
  let uri: vscode.Uri;
  let position: vscode.Position;

  if (filePath && line !== undefined) {
    uri = vscode.Uri.file(filePath);
    position = new vscode.Position(line, 0);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    uri = editor.document.uri;
    position = editor.selection.active;
  }

  const locations = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeDefinitionProvider',
    uri,
    position,
  );

  return locations?.map(loc => ({
    file: loc.uri.fsPath,
    line: loc.range.start.line,
  })) || [];
}

async function readFileContent(filePath: string, startLine?: number, endLine?: number) {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (startLine !== undefined && endLine !== undefined) {
    const range = new vscode.Range(startLine, 0, endLine, 0);
    return { content: doc.getText(range), filePath };
  }
  return { content: doc.getText(), filePath };
}

async function applyDiff(filePath: string, content: string): Promise<any> {
  const uri = vscode.Uri.file(filePath);
  let originalContent = '';
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    originalContent = doc.getText();
  } catch {
    // File doesn't exist yet
  }

  if (originalContent === content) {
    return { status: 'no_changes', filePath, applied: false, message: 'Proposed content is identical to current file.' };
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, content);
  const applied = await vscode.workspace.applyEdit(edit);

  if (applied) {
    const savedDoc = await vscode.workspace.openTextDocument(uri);
    await savedDoc.save();
    return { status: 'applied', filePath, applied: true, message: `Changes applied to ${filePath}.` };
  }

  return { status: 'failed', filePath, applied: false, message: `Failed to apply changes to ${filePath}.` };
}

export function registerEditorContextTools(diffReview?: DiffReviewManager): AcpToolDef[] {
  return [
    {
      name: 'get_active_file',
      description: 'Returns the content and metadata of the currently active file in the editor',
      parameters: {
        type: 'object',
        properties: {
          includeFullContent: {
            type: 'boolean',
            description: 'Whether to include the full file content (default: true for files < 500 lines)',
          },
        },
      },
      handler: async (args) => getActiveEditorContext(args.includeFullContent),
    },
    {
      name: 'get_open_tabs',
      description: 'Returns a list of all open tabs in the editor with their file paths and status',
      parameters: { type: 'object', properties: {} },
      handler: async () => getOpenTabsContext(),
    },
    {
      name: 'get_open_documents',
      description: 'Returns all open in-memory document buffers',
      parameters: { type: 'object', properties: {} },
      handler: async () => getAllOpenDocuments(),
    },
    {
      name: 'get_workspace_structure',
      description: 'Returns the directory tree of the current workspace',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Optional subdirectory path' },
          maxDepth: { type: 'number', description: 'Max tree depth (default: 1)' },
        },
      },
      handler: async (args) => getDirectoryContents(args.directory, args.maxDepth),
    },
    {
      name: 'get_workspace_info',
      description: 'Returns workspace folder information and default language',
      parameters: { type: 'object', properties: {} },
      handler: async () => getWorkspaceContext(),
    },
    {
      name: 'get_diagnostics',
      description: 'Returns compiler/linter errors and warnings for files',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: specific file path' },
        },
      },
      handler: async (args) => getDiagnostics(args.filePath),
    },
    {
      name: 'get_cursor_context',
      description: 'Returns the code surrounding the cursor with a configurable window size',
      parameters: {
        type: 'object',
        properties: {
          lineWindow: { type: 'number', description: 'Lines above/below cursor (default: 20)' },
        },
      },
      handler: async (args) => getCursorSurroundings(args.lineWindow ?? 20),
    },
    {
      name: 'get_git_status',
      description: 'Returns current git branch, staged and unstaged changes',
      parameters: { type: 'object', properties: {} },
      handler: async () => getGitContext(),
    },
    {
      name: 'get_terminal_context',
      description: 'Returns active and open terminal names',
      parameters: { type: 'object', properties: {} },
      handler: async () => getTerminalContext(),
    },
    {
      name: 'read_file',
      description: 'Reads the contents of any file in the workspace by path',
      parameters: {
        type: 'object',
        required: ['filePath'],
        properties: {
          filePath: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
        },
      },
      handler: async (args) => readFileContent(args.filePath, args.startLine, args.endLine),
    },
    {
      name: 'get_symbols',
      description: 'Get the outline of a file or workspace (classes, functions, variables)',
      parameters: {
        type: 'object',
        required: ['filePath'],
        properties: {
          filePath: { type: 'string', description: 'Path to the file to get symbols for' },
        },
      },
      handler: async (args) => getDocumentSymbols(vscode.Uri.file(args.filePath)),
    },
    {
      name: 'get_references',
      description: 'Find where a specific symbol is used across the codebase (from cursor position)',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: absolute path to file (defaults to active editor)' },
          line: { type: 'number', description: 'Optional: 0-based line number (defaults to cursor line)' },
        },
      },
      handler: async (args) => getReferencesAtCursor(args.filePath, args.line),
    },
    {
      name: 'get_definitions',
      description: 'Jump to the definition of a symbol under the cursor',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: absolute path to file (defaults to active editor)' },
          line: { type: 'number', description: 'Optional: 0-based line number (defaults to cursor line)' },
        },
      },
      handler: async (args) => getDefinitionsAtCursor(args.filePath, args.line),
    },
    {
      name: 'propose_diff',
      description: 'Propose file changes for user review. Applies the changes to the file with visual diff decorations (red for removed, green for added). The user can accept or reject via the chat interface. Returns status "awaiting_review" when decorations are shown.',
      parameters: {
        type: 'object',
        required: ['filePath', 'content'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to modify' },
          content: { type: 'string', description: 'The proposed new content for the entire file' },
        },
      },
      handler: async (args) => {
        if (diffReview) {
          return await diffReview.propose(args.filePath, args.content);
        }
        return { status: 'error', message: 'Diff review manager not available.' };
      },
    },
    {
      name: 'apply_diff',
      description: 'Apply file changes directly without review. Writes the content to the file immediately. Use propose_diff instead if the user wants to review changes first.',
      parameters: {
        type: 'object',
        required: ['filePath', 'content'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to modify' },
          content: { type: 'string', description: 'The new content for the entire file' },
        },
      },
      handler: async (args) => applyDiff(args.filePath, args.content),
    },
    {
      name: 'accept_diff',
      description: 'Accept the currently pending diff. Saves the file with the proposed changes. Only valid after a propose_diff call that returned "awaiting_review".',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        if (diffReview) {
          return await diffReview.accept();
        }
        return { status: 'error', message: 'Diff review manager not available.' };
      },
    },
    {
      name: 'reject_diff',
      description: 'Reject the currently pending diff. Reverts the file to its original content. Only valid after a propose_diff call that returned "awaiting_review".',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        if (diffReview) {
          return await diffReview.reject();
        }
        return { status: 'error', message: 'Diff review manager not available.' };
      },
    },
  ];
}
