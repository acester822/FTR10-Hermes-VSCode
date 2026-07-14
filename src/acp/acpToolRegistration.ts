import * as vscode from 'vscode';
import { registerEditorContextTools, type AcpToolDef } from './editorContextTools';
import { DiffReviewManager } from './DiffReviewManager';
import { logToFile } from './fileLogger';
import { followAlong } from './followAlong';

export type { AcpToolDef } from './editorContextTools';

// ── Option C: focus-aware binding ──────────────────────────────
// Tracks the editor/window the USER actually has focus in (real cursor
// movement, active-editor change, window-focus, tab-group change) so the
// agent defaults to "the window you're looking at" instead of the global
// activeTextEditor, which can be stale or point at a different Code-Server
// instance. See agent-sees-window.md (Phase 4 / "which window").
export interface FocusState {
  filePath: string | null;
  languageId: string | null;
  source: 'activeEditor' | 'selection' | 'windowFocus' | 'tabGroup' | 'none';
  lastChanged: number;
}
const _focus: FocusState = { filePath: null, languageId: null, source: 'none', lastChanged: 0 };

function _stampFocus(filePath: string | null, languageId: string | null, source: FocusState['source']) {
  if (filePath === _focus.filePath && languageId === _focus.languageId) {
    _focus.source = source;
    _focus.lastChanged = Date.now();
    return;
  }
  _focus.filePath = filePath;
  _focus.languageId = languageId;
  _focus.source = source;
  _focus.lastChanged = Date.now();
  logToFile(`[Hermes ACP] focus -> ${filePath ?? '(none)'} [${source}]`);
}

function _activeFilePath(): string | null {
  return vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
}

/** Snapshot of where the user's real focus is, plus whether it differs from activeTextEditor. */
export function getFocusedWindowContext(): FocusState & {
  activeEditorFile: string | null;
  differsFromActive: boolean;
} {
  const active = _activeFilePath();
  return {
    ..._focus,
    activeEditorFile: active,
    differsFromActive: _focus.filePath !== null && _focus.filePath !== active,
  };
}

/** Called by editorContextTools when the agent explicitly pins a window/file. */
export function pinFocus(filePath: string | null, languageId: string | null): void {
  _stampFocus(filePath, languageId, 'activeEditor');
}
let _registeredTools: AcpToolDef[] = [];
let _diffReview: DiffReviewManager | undefined;
let _toolsRegistered = false;

export function setDiffReviewManager(manager: DiffReviewManager): void {
  _diffReview = manager;
  _registeredTools = [];
  _toolsRegistered = false;
}

export function getRegisteredTools(): AcpToolDef[] {
  if (!_toolsRegistered) {
    try {
      _registeredTools = registerEditorContextTools(_diffReview);
      _toolsRegistered = true;
      logToFile(`[Hermes ACP] Registered ${_registeredTools.length} tools: ${_registeredTools.map(t => t.name).join(', ')}`);
    } catch (err) {
      logToFile(`[Hermes ACP] Failed to register tools: ${err}`);
      _registeredTools = [];
    }
  }
  return _registeredTools;
}

export function registerToolInvocationCommand(context: vscode.ExtensionContext): void {
  const tools = getRegisteredTools();
  
  if (tools.length === 0) {
    logToFile('[Hermes ACP] No tools registered! Tool invocation commands will not be available.');
  }

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
        // Real cursor movement = genuine user focus on this editor.
        _stampFocus(event.textEditor.document.uri.fsPath, event.textEditor.document.languageId, 'selection');
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
        _stampFocus(editor.document.uri.fsPath, editor.document.languageId, 'activeEditor');
      }
    }),
  );

  // Window focus gained = the user brought THIS Code-Server instance to the
  // foreground; re-stamp focus from whatever editor is active within it.
  disposables.push(
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) {
        _stampFocus(_activeFilePath(), vscode.window.activeTextEditor?.document.languageId ?? null, 'windowFocus');
      }
    }),
  );

  // Switching the active tab GROUP (split/panel) is a strong "I'm looking here" signal.
  // Note: the VS Code API only exposes onDidChangeTabGroups (no per-group event),
  // so we recompute the active tab group's active text tab on any tab-group change.
  disposables.push(
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      const group = vscode.window.tabGroups.activeTabGroup;
      const tab = group?.tabs.find(t => t.isActive);
      if (tab && tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri;
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        _stampFocus(uri.fsPath, doc?.languageId ?? null, 'tabGroup');
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

  // Phase 3: dispose follow-along decorations on teardown.
  disposables.push({ dispose: () => followAlong.dispose() });

  return disposables;
}