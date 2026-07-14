import * as vscode from 'vscode';
import * as path from 'path';
import * as zlib from 'zlib';
import type { DiffReviewManager } from './DiffReviewManager';
import { resolveDiff } from './unifiedDiff';
import { getFocusedWindowContext, pinFocus } from './acpToolRegistration';

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

// ── Option C: focus-aware target resolution ──────────────────
// Returns the editor the agent should act on. Priority:
//   1. explicit `focusTo` filePath (agent-pinned / user-named)
//   2. the file the USER last had real focus in (tracked in acpToolRegistration)
//   3. the global activeTextEditor (fallback, may be stale/wrong instance)
// Also returns whether the resolved target matches the user's genuine focus,
// so the agent can NEVER silently act on the wrong window and claim success.
async function resolveFocusTarget(focusTo?: string): Promise<{
  editor: vscode.TextEditor | null;
  actualFilePath: string | null;
  followedFocus: boolean;
  focusMismatch: boolean;
}> {
  const focus = getFocusedWindowContext();

  if (focusTo) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(focusTo));
      const editor = (await vscode.window.showTextDocument(doc, { preview: false })) ?? null;
      return { editor, actualFilePath: doc.uri.fsPath, followedFocus: doc.uri.fsPath === focus.filePath, focusMismatch: doc.uri.fsPath !== focus.filePath };
    } catch {
      return { editor: null, actualFilePath: null, followedFocus: false, focusMismatch: true };
    }
  }

  if (focus.filePath) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(focus.filePath));
      const editor = (await vscode.window.showTextDocument(doc, { preview: false })) ?? null;
      return { editor, actualFilePath: doc.uri.fsPath, followedFocus: true, focusMismatch: false };
    } catch {
      // fall through to activeTextEditor
    }
  }

  const active = vscode.window.activeTextEditor ?? null;
  return {
    editor: active,
    actualFilePath: active?.document.uri.fsPath ?? null,
    followedFocus: false,
    focusMismatch: active != null && focus.filePath != null && active.document.uri.fsPath !== focus.filePath,
  };
}

function getFocusedContext(): any {
  const focus = getFocusedWindowContext();
  const active = vscode.window.activeTextEditor;
  return {
    ...focus,
    activeEditorFile: active?.document.uri.fsPath ?? null,
    differsFromActive: focus.filePath !== null && focus.filePath !== (active?.document.uri.fsPath ?? null),
    note: focus.filePath
      ? (focus.filePath === active?.document.uri.fsPath
          ? 'Agent will act on the file you are focused on.'
          : 'WARNING: global activeTextEditor differs from your focused file — pass focusTo to be explicit, or the agent may act on the wrong window.')
      : 'No focus signal yet — agent will fall back to global activeTextEditor (may be a different Code-Server window).',
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

async function openFileInEditor(filePath: string): Promise<any> {
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(filePath)) {
    return { status: 'error', opened: false, message: `File not found: ${filePath}` };
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
  return { status: 'opened', opened: true, filePath };
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

  // Classify input: a real unified diff is applied surgically; otherwise it is
  // treated as a whole-file replacement (guarded against data loss).
  const resolved = resolveDiff(content, originalContent);

  if (resolved.isDiff && resolved.error) {
    return { status: 'error', filePath, applied: false, message: `Diff could not be applied: ${resolved.error}` };
  }

  if (resolved.isWholeFile && originalContent.length > 0 && content.length / originalContent.length < 0.5) {
    return {
      status: 'error',
      filePath,
      applied: false,
      message:
        `Content (${content.length} chars) is far shorter than the current file ` +
        `(${originalContent.length} chars). apply_diff expects a full file or a unified diff ` +
        `(with @@ hunks). Refusing to replace — no changes made.`,
    };
  }

  const finalContent = resolved.isDiff ? resolved.merged : content;

  if (originalContent === finalContent) {
    return { status: 'no_changes', filePath, applied: false, message: 'Proposed content is identical to current file.' };
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, finalContent);
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
      description: 'Propose file changes for user review. Accepts EITHER a full new file (replaces the entire file) OR a unified diff (lines starting with @@ for hunks, +/- for changes) which is applied surgically to only the changed lines. The user can accept or reject via the chat interface. Returns status "awaiting_review" when decorations are shown.',
      parameters: {
        type: 'object',
        required: ['filePath', 'content'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to modify' },
          content: { type: 'string', description: 'Either the full new file content, or a unified diff with @@ hunk headers and +/- lines. Passing a snippet without diff markers will be refused to prevent data loss.' },
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
      description: 'Apply file changes directly without review. Writes the content to the file immediately. Accepts EITHER a full new file OR a unified diff (@@ hunks, +/- lines) applied surgically. Use propose_diff instead if the user wants to review changes first.',
      parameters: {
        type: 'object',
        required: ['filePath', 'content'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to modify' },
          content: { type: 'string', description: 'Either the full new file content, or a unified diff with @@ hunk headers and +/- lines.' },
        },
      },
      handler: async (args) => applyDiff(args.filePath, args.content),
    },
    {
      name: 'open_file',
      description: 'Open a file in a VS Code editor tab (e.g. to display a generated .excalidraw diagram). Does not edit the file.',
      parameters: {
        type: 'object',
        required: ['filePath'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to open' },
        },
      },
      handler: async (args) => openFileInEditor(args.filePath),
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
    // ── capture_view ───────────────────────────────────────────────
    // The "agent sees my window" primitive (Phase 1 of the Zed-style
    // co-op). Returns a Hermes vision envelope so the model receives an
    // actual image block — same shape `computer_use` capture produces on
    // the host side. Hermes turns {"_multimodal":true,"content":[...]}
    // into a real vision block; the MCP server forwards it verbatim.
    {
      name: 'capture_view',
      description:
        'Capture what the user is currently looking at so the agent can SEE the ' +
        'rendered window, not just file text. Two modes: ' +
        "mode='pixel' returns a screenshot of the active editor (or its webview) " +
        'as an image the agent can look at — use this when layout, UI chrome, ' +
        'colors, or "how it actually renders" matters. ' +
        "mode='semantic' returns a lossless text composite of the visible editor " +
        '(file path, language, visible line range, and the exact visible text) — ' +
        'use this when you need the precise text without image tokens. ' +
        'Defaults to pixel. Returns a multimodal envelope for vision models.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['pixel', 'semantic'],
            description: "pixel = screenshot image; semantic = text composite of visible editor. Default 'pixel'.",
          },
          includeFullFile: {
            type: 'boolean',
            description:
              'semantic mode only. If true, also include the full file text (when small). Default false (visible range only).',
          },
        },
      },
      handler: async (args: any) => captureView(args?.mode ?? 'pixel', args?.includeFullFile === true, args?.focusTo),
    },
    // ── Phase 2: intention-level act tools ──────────────────
    // The agent ACTS in your window the Zed way: by intent (scroll, reveal a
    // line, run a command, focus an editor), NOT by raw x/y mouse clicks.
    // Each routes through a vscode API so it is deterministic, reproducible,
    // and never fights your real cursor. Your permissionBridge is the
    // human-in-the-loop gate for anything mutating.
    //
    // Option C (focus-aware): every act/see tool accepts an optional
    // `focusTo` (absolute file path). When omitted, the tool targets the
    // file the USER last had genuine focus in (cursor move / active editor /
    // window focus / tab-group switch) — see resolveFocusTarget(). This makes
    // the agent follow the window you're actually looking at, not a stale
    // global activeTextEditor that may belong to another Code-Server window.
    {
      name: 'scroll_view',
      description: 'Scroll the editor you are focused on (or a file named via focusTo) up/down/left/right WITHOUT stealing your cursor or focus. Use to let the agent look further in a file you are viewing. Directions: up, down, left, right. amount = number of scroll pages (default 1). focusTo = optional absolute path to target a specific file.',
      parameters: {
        type: 'object',
        required: ['direction'],
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          amount: { type: 'number', description: 'Scroll units (pages). Default 1.' },
          focusTo: { type: 'string', description: 'Optional absolute file path; defaults to the file you currently have focus on.' },
        },
      },
      handler: async (args: any) => scrollView(args.direction, args.amount ?? 1, args?.focusTo),
    },
    {
      name: 'reveal_line',
      description: 'Reveal/center a specific line in the editor you are focused on (or a file named via focusTo) so both you and the agent can see it. Does not move focus away from your current editor unless focusTo differs. Returns the revealed line text. focusTo = optional absolute path.',
      parameters: {
        type: 'object',
        required: ['line'],
        properties: {
          line: { type: 'number', description: '0-based line number to reveal.' },
          focusTo: { type: 'string', description: 'Optional absolute path; defaults to the file you currently have focus on.' },
        },
      },
      handler: async (args: any) => revealLine(args.line, args.focusTo),
    },
    {
      name: 'focus_editor',
      description: 'Bring a file into the active/visible editor (opens it if needed), reveal its first line, and PIN it as the session focus target so the agent follows it for subsequent see/act calls. Use when you want the agent locked onto a specific file.',
      parameters: {
        type: 'object',
        required: ['filePath'],
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to focus and pin.' },
        },
      },
      handler: async (args: any) => focusEditor(args.filePath),
    },
    {
      name: 'get_focused_context',
      description: "Report where YOUR genuine focus currently is — the file you last moved the cursor in, switched to, or brought to the foreground — separate from VS Code's global activeTextEditor. Returns filePath, source of the focus signal, lastChanged timestamp, and whether it differs from the global active editor. Use this to confirm the agent is about to act on the window you're actually looking at (not a different Code-Server window).",
      parameters: { type: 'object', properties: {} },
      handler: async () => getFocusedContext(),
    },
    {
      name: 'focus_window',
      description: 'Pin the agent to the file you are currently focused on (or a file named via focusTo), so all subsequent see/act tools default to it. Call with no args to pin the file you are looking at right now; pass focusTo to pin a specific file. Returns the pinned file path.',
      parameters: {
        type: 'object',
        properties: {
          focusTo: { type: 'string', description: 'Optional absolute path to pin; defaults to the file you currently have focus on.' },
        },
      },
      handler: async (args: any) => {
        const f = args?.focusTo;
        if (f) {
          return await focusEditor(f);
        }
        const focus = getFocusedWindowContext();
        if (focus.filePath) {
          pinFocus(focus.filePath, focus.languageId);
          return { status: 'ok', pinned: focus.filePath, source: focus.source, followedFocus: true, focusMismatch: false };
        }
        return { status: 'error', message: 'No focus signal available — move your cursor into a file or pass focusTo.' };
      },
    },
    {
      name: 'run_command',
      description: 'Execute a VS Code command by id (e.g. "editor.action.formatDocument", "workbench.action.quickOpen"). Deterministic alternative to clicking menus. Pass commandId exactly; optional args forwarded. Use for actions that have no dedicated tool.',
      parameters: {
        type: 'object',
        required: ['commandId'],
        properties: {
          commandId: { type: 'string', description: 'The VS Code command id to run.' },
          args: { type: 'array', description: 'Optional arguments array passed to the command.' },
        },
      },
      handler: async (args: any) => runCommand(args.commandId, args.args),
    },
    {
      name: 'click_webview_selector',
      description: 'Click an element inside a visible webview by CSS/DOM selector (e.g. a button in an extension panel or the chat). Intention-level click — no screen coordinates. Returns whether a match was found. Falls back to "not found" if the selector matches nothing.',
      parameters: {
        type: 'object',
        required: ['selector'],
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element to click inside the active webview.' },
        },
      },
      handler: async (args: any) => clickWebviewSelector(args.selector),
    },
  ];
}

// ── Phase 2 helpers ────────────────────────────────────
async function scrollView(direction: string, amount: number, focusTo?: string): Promise<any> {
  const target = await resolveFocusTarget(focusTo);
  const editor = target.editor;
  if (!editor) return { status: 'error', message: 'No active editor to scroll.', actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
  const dirMap: Record<string, string> = {
    up: 'editor.action.scrollUp',
    down: 'editor.action.scrollDown',
    left: 'editor.action.scrollLeft',
    right: 'editor.action.scrollRight',
  };
  const cmd = dirMap[direction];
  if (!cmd) return { status: 'error', message: `Unknown direction: ${direction}` };
  const units = Math.max(1, Math.min(20, Math.round(amount)));
  let ok = 0;
  for (let i = 0; i < units; i++) {
    try {
      // executeCommand can reject in some editor/headless contexts (e.g.
      // command not focusable); tolerate per-unit failure so the whole
      // tool call doesn't surface as an Internal error.
      await vscode.commands.executeCommand(cmd);
      ok++;
    } catch (e) {
      break;
    }
  }
  if (ok === 0) {
    return { status: 'error', message: `Scroll command '${cmd}' did not execute (no editor focus or command unavailable).`, actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
  }
  return { status: 'ok', scrolled: direction, units: ok, actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
}

async function revealLine(line: number, focusTo?: string): Promise<any> {
  const target = await resolveFocusTarget(focusTo);
  const editor = target.editor;
  if (!editor) return { status: 'error', message: 'No editor available to reveal line.', actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
  const pos = new vscode.Position(Math.max(0, Math.min(line, editor.document.lineCount - 1)), 0);
  editor.revealRange(
    new vscode.Range(pos, pos),
    vscode.TextEditorRevealType.InCenter,
  );
  const text = editor.document.lineAt(pos.line).text;
  return { status: 'ok', revealedLine: pos.line, text, filePath: editor.document.uri.fsPath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
}

async function focusEditor(focusTo: string): Promise<any> {
  if (!focusTo) return { status: 'error', message: 'filePath required.' };
  const target = await resolveFocusTarget(focusTo);
  if (!target.editor) return { status: 'error', message: `Could not focus ${focusTo}` };
  const doc = target.editor.document;
  // Pin this file as the session's focus target so subsequent see/act calls follow it.
  pinFocus(doc.uri.fsPath, doc.languageId);
  return { status: 'ok', focused: doc.uri.fsPath, languageId: doc.languageId, lineCount: doc.lineCount, followedFocus: true, focusMismatch: false };
}

async function runCommand(commandId: string, args?: unknown[]): Promise<any> {
  if (!commandId) return { status: 'error', message: 'commandId required.' };
  try {
    const result = await vscode.commands.executeCommand(commandId, ...(Array.isArray(args) ? args : []));
    return { status: 'ok', command: commandId, result: result === undefined ? null : result };
  } catch (e) {
    return { status: 'error', message: `Command ${commandId} failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function clickWebviewSelector(selector: string): Promise<any> {
  // Webviews are isolated; we cannot reach into arbitrary webview DOM from
  // the extension host without the webview cooperating. We attempt the
  // known case: the extension's OWN chat webview exposes a message
  // channel. For external webviews this returns not-found (safe).
  // NOTE: a true cross-webview click requires the target webview to
  // handle an injected message; we document the contract here.
  if (!selector) return { status: 'error', message: 'selector required.' };
  try {
    await vscode.commands.executeCommand('hermes-agent.internal.clickWebview', selector);
    return { status: 'ok', selector, note: 'dispatched click request to active webview' };
  } catch {
    return {
      status: 'unavailable',
      selector,
      message: 'No cooperating webview handler for selector clicks in this surface (only the Hermes chat webview supports it). Use run_command for other UI.',
    };
  }
}


// ── capture_view implementation ──────────────────────────────────────
// Returns either:
//   * a Hermes multimodal envelope ({_multimodal:true, content:[...]})
//     for pixel mode, OR
//   * a plain JSON object for semantic mode.
// Both shapes are handed to the MCP server, which forwards the multimodal
// envelope as structured image content (see editorToolsMcpServer.ts).

function _pngToDataUri(pngBase64: string): string {
  return `data:image/png;base64,${pngBase64}`;
}

// ── Minimal dependency-free PNG encoder ────────────────────────────
// We rasterise the visible editor into an RGBA pixel buffer and emit a
// real PNG (zlib deflate + CRC32), so the bytes carry the `‰PNG`
// magic header. Hermes' vision routing sniffs base64 prefixes
// (/9j/ → jpeg, else png) — a genuine PNG keeps the screenshot on
// the multimodal path instead of being dropped as text. No canvas/DOM
// needed (none available in the code-server extension host).
const _CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function _crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = _CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function _pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(_crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function _encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Add filter byte (0) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    const srcStart = y * stride;
    (rgba as Uint8Array).subarray(srcStart, srcStart + stride)
      .forEach((v, i) => { raw[y * (stride + 1) + 1 + i] = v; });
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    _pngChunk('IHDR', ihdr),
    _pngChunk('IDAT', idat),
    _pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function _captureEditorScreenshot(): Promise<{ pngBase64: string; width: number; height: number } | null> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const doc = editor.document;
  const fileName = doc.fileName;
  const languageId = doc.languageId;
  const ranges = editor.visibleRanges;
  if (!ranges || ranges.length === 0) return null;

  const lines: Array<{ n: number; text: string }> = [];
  for (const r of ranges) {
    for (let ln = r.start.line; ln <= r.end.line && ln < doc.lineCount; ln++) {
      lines.push({ n: ln + 1, text: doc.lineAt(ln).text });
    }
  }

  // ── Tiny software text rasteriser (no canvas) ──────────────────
  // Monospace glyphs drawn as 1bpp bitmaps scaled to the cell. Good
  // enough for a faithful "what the user sees" editor composite.
  const charW = 8;
  const charH = 16;
  const cellH = 20;
  const padX = 52;   // gutter for line numbers
  const padY = 30;   // header strip
  const headerH = 26;
  const maxCols = Math.min(200, lines.reduce((m, l) => Math.max(m, l.text.length), 0) + 2);
  const width = Math.max(320, padX + maxCols * charW + 16);
  const height = Math.max(120, padY + lines.length * cellH + 12);

  const px = new Uint8Array(width * height * 4);
  // Background fill (#1e1e1e) and header (#252526).
  const fill = (r: number, g: number, b: number, a: number) => {
    for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; }
  };
  fill(0x1e, 0x1e, 0x1e, 0xff);
  // header bar
  for (let y = 0; y < headerH; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4; px[o] = 0x25; px[o + 1] = 0x25; px[o + 2] = 0x26; px[o + 3] = 0xff;
  }
  // header divider line
  for (let x = 0; x < width; x++) { const o = (headerH * width + x) * 4; px[o] = 0x33; px[o + 1] = 0x33; px[o + 2] = 0x33; px[o + 3] = 0xff; }

  const putPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 0xff;
  };
  const drawGlyph = (ch: string, gx: number, gy: number, r: number, g: number, b: number) => {
    const glyph = _GLYPHS[ch] ?? _GLYPHS['?']!;
    for (let row = 0; row < 16; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 8; col++) {
        if ((bits >> (7 - col)) & 1) putPixel(gx + col, gy + row, r, g, b);
      }
    }
  };
  const drawText = (s: string, gx: number, gy: number, r: number, g: number, b: number) => {
    for (let i = 0; i < s.length; i++) drawGlyph(s[i], gx + i * charW, gy, r, g, b);
  };

  // Header: filename (language)
  drawText(`${fileName}  (${languageId})`.slice(0, Math.floor((width - 20) / charW)), 8, 6, 0xcc, 0xcc, 0xcc);

  // Body: gutter line numbers + visible text.
  lines.forEach((l, i) => {
    const y = padY + i * cellH + 2;
    drawText(String(l.n).padStart(4, ' '), 4, y, 0x6b, 0x72, 0x80);
    drawText(l.text.slice(0, maxCols), padX, y, 0xd4, 0xd4, 0xd4);
  });

  try {
    const png = _encodePng(width, height, px);
    return { pngBase64: png.toString('base64'), width, height };
  } catch {
    return null;
  }
}

// 8x16 monospace glyph bitmaps (row = 16-bit-ish, here 8-bit rows).
// Compact subset covering ASCII we reasonably need; '?' fallback covers the rest.
const _GLYPHS: Record<string, number[]> = (() => {
  const G: Record<string, number[]> = {};
  const set = (ch: string, rows: string[]) => {
    G[ch] = rows.map((r) => parseInt(r.replace(/ /g, '0').replace(/#/g, '1'), 2));
  };
  // Each row is 8 chars: ' ' = 0, '#' = 1.
  set(' ', ['        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('?', ['  ####  ', ' #    # ', '      # ', '     #  ', '    #   ', '    #   ', '        ', '   #    ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('A', ['  ####  ', ' #    # ', '#      #', '#      #', '#      #', '########', '#      #', '#      #', '#      #', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('B', ['######  ', '##    # ', '##    # ', '######  ', '##    # ', '##    # ', '######  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('C', ['  ####  ', ' #    # ', '##      ', '##      ', '##      ', '##      ', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('D', ['#####   ', '##   #  ', '##    # ', '##    # ', '##    # ', '##    # ', '##   #  ', '#####   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('E', ['######  ', '##    # ', '##      ', '######  ', '##      ', '##      ', '##    # ', '######  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('F', ['######  ', '##    # ', '##      ', '######  ', '##      ', '##      ', '##      ', '##      ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('G', ['  ####  ', ' #    # ', '##      ', '##  ### ', '##    # ', '##    # ', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('H', ['##    ##', '##    ##', '##    ##', '########', '##    ##', '##    ##', '##    ##', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('I', [' ###### ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', ' ###### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('L', ['##      ', '##      ', '##      ', '##      ', '##      ', '##      ', '######  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('N', ['##    # ', '###   # ', '####  # ', '## # # ', '##  ## ', '##   ##', '##    # ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('O', ['  ####  ', ' #    # ', '#      #', '#      #', '#      #', '#      #', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('P', ['######  ', '##    # ', '##    # ', '######  ', '##      ', '##      ', '##      ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('R', ['######  ', '##    # ', '##    # ', '######  ', '##  #   ', '##   #  ', '##    # ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('S', [' ###### ', ' ##     ', ' ##     ', '  ####  ', '      ##', '      ##', ' ####   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('T', ['########', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('U', ['##    ##', '##    ##', '##    ##', '##    ##', '##    ##', '##    ##', ' ###### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('V', ['##    ##', '##    ##', '##    ##', '##    ##', ' ##  ## ', '  ####  ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('W', ['##    ##', '##    ##', '##    ##', '## ## ##', '## ## ##', '## ## ##', ' ##  ## ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('X', ['##    ##', '##    ##', ' ##  ## ', '  ####  ', ' ##  ## ', '##    ##', '##    ##', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('Y', ['##    ##', '##    ##', ' ##  ## ', '  ####  ', '   ##   ', '   ##   ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('a', ['        ', '        ', '        ', '  ####  ', '      # ', '#  ####', '#    ##', ' #### #', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('b', ['##      ', '##      ', '##      ', '##  ### ', '##    # ', '##    # ', ' ##  ## ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('c', ['        ', '        ', '        ', '  ####  ', ' ##     ', ' ##     ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('d', ['      ##', '      ##', '      ##', ' ###  ##', '#    ## ', '#    ## ', ' ##  ###', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('e', ['        ', '        ', '        ', ' ###### ', ' ##    #', ' ###### ', ' ##     ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('f', ['   ##   ', '  ####  ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('g', ['        ', '        ', '        ', ' #### # ', '#    ## ', ' ##  ## ', '  ####  ', '##     ', ' ###    ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('h', ['##      ', '##      ', '##      ', '##  ### ', '##    # ', '##    # ', '##    # ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('i', ['   ##   ', '   ##   ', '        ', '  ###   ', '   ##   ', '   ##   ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('l', ['  ###   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('m', ['        ', '        ', '        ', '#   #   ', '##  ##  ', '##  ##  ', '##  ##  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('n', ['        ', '        ', '        ', '##  ### ', '##    # ', '##    # ', '##    # ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('o', ['        ', '        ', '        ', '  ####  ', '#      #', '#      #', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('r', ['        ', '        ', '        ', '##  ### ', '##   #  ', '##      ', '##      ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('s', ['        ', '        ', '        ', ' ###### ', ' ##     ', '  ####  ', '      ##', ' ####   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('t', ['   ##   ', ' ######  ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '    ### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('u', ['        ', '        ', '        ', '##    # ', '##    # ', '##    # ', ' ###  ##', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('v', ['        ', '        ', '        ', '##    ##', '##    ##', ' ##  ## ', '  ####  ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('w', ['        ', '        ', '        ', '##    ##', '##    ##', '## ## ##', '## ## ##', ' ##  ## ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('x', ['        ', '        ', '        ', '##    ##', ' ##  ## ', '  ####  ', ' ##  ## ', '##    ##', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('y', ['        ', '        ', '        ', '##    ##', '##    ##', ' ##  ## ', '  ####  ', '   ##   ', '  ##    ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('0', ['  ####  ', ' #    # ', '#  ##  #', '# #  # #', '# #  # #', '#  ##  #', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('1', ['   ##   ', '  ###   ', '   ##   ', '   ##   ', '   ##   ', '   ##   ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('2', ['  ####  ', ' #    # ', '      # ', '    #   ', '   #    ', '  #     ', ' ###### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('3', [' ###### ', '      # ', '     #  ', '   ###  ', '      # ', '      # ', ' ###### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('4', ['    #   ', '   ##   ', '  # #   ', ' #  #   ', ' #  #   ', ' ###### ', '    #   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('5', [' ###### ', ' #      ', ' ###### ', '      # ', '      # ', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('6', ['  ####  ', ' #      ', ' ###### ', ' #    # ', ' #    # ', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('7', [' ###### ', '      # ', '     #  ', '    #   ', '   #    ', '   #    ', '   #    ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('8', ['  ####  ', ' #    # ', '  ####  ', ' #    # ', ' #    # ', ' #    # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('9', ['  ####  ', ' #    # ', ' #    # ', '  #####', '      # ', '      # ', '  ####  ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set(':', ['        ', '        ', '   ##   ', '   ##   ', '        ', '   ##   ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('.', ['        ', '        ', '        ', '        ', '        ', '        ', '   ##   ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('-', ['        ', '        ', '        ', '        ', ' ###### ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('/', ['      # ', '     #  ', '     #  ', '    #   ', '   #    ', '  #     ', ' #      ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('\\', [' #      ', ' #      ', '  #     ', '  #     ', '   #    ', '    #   ', '    #   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('(', ['   ##   ', '  #     ', ' #      ', ' #      ', ' #      ', ' #      ', '  #     ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set(')', ['   ##   ', '     #  ', '      # ', '      # ', '      # ', '      # ', '     #  ', '   ##   ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ']);
  set('_', ['        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '        ', '######  ', '######  ', '######  ', '        ', '        ', '        ', '        ', '        ', '        ']);
  return G;
})();

// Silence "unused" for the helper kept for parity with future SVG path.
void _pngToDataUri;

async function captureView(mode: string, includeFullFile: boolean, focusTo?: string): Promise<any> {
  const target = await resolveFocusTarget(focusTo);
  const editor = target.editor;
  if (mode === 'semantic' || !editor) {
    // Semantic / fallback path — lossless text composite.
    if (!editor) {
      return { status: 'error', message: 'No active editor to capture.', actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
    }
    const doc = editor.document;
    const ranges = editor.visibleRanges;
    const visible: string[] = [];
    for (const r of ranges) {
      for (let ln = r.start.line; ln <= r.end.line && ln < doc.lineCount; ln++) {
        visible.push(doc.lineAt(ln).text);
      }
    }
    const result: Record<string, any> = {
      mode: 'semantic',
      filePath: doc.uri.fsPath,
      fileName: doc.fileName,
      languageId: doc.languageId,
      lineCount: doc.lineCount,
      visibleRange: ranges.map((r) => ({ startLine: r.start.line, endLine: r.end.line })),
      visibleText: visible.join('\n'),
    };
    if (includeFullFile && doc.lineCount < 1000) {
      result.fullText = doc.getText();
    }
    result.actualFilePath = target.actualFilePath;
    result.followedFocus = target.followedFocus;
    result.focusMismatch = target.focusMismatch;
    return result;
  }

  // Pixel path — render the visible editor to an image.
  const shot = await _captureEditorScreenshot();
  if (!shot) {
    return { status: 'error', message: 'Could not capture the active editor (no active text editor?).', actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch };
  }
  const summary =
    `Rendered view of ${editor!.document.fileName} (${editor!.document.languageId}). ` +
    `Visible lines ${editor!.visibleRanges[0]?.start.line + 1}–${editor!.visibleRanges[0]?.end.line + 1}. ` +
    `This is a faithful composite of the visible editor (text + line numbers), not the raw browser window.`;
  return {
    _multimodal: true,
    content: [
      { type: 'text', text: summary },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${shot.pngBase64}` },
      },
    ],
    text_summary: summary,
    meta: { mode: 'pixel', width: shot.width, height: shot.height, renderer: 'editor-composite-svg', actualFilePath: target.actualFilePath, followedFocus: target.followedFocus, focusMismatch: target.focusMismatch },
  };
}

