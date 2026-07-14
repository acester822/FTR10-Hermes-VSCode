import * as vscode from 'vscode';

/**
 * Phase 3 — follow-along overlay.
 *
 * When the agent SEES or ACTS in your editor (capture_view, reveal_line,
 * scroll_view, focus_editor), briefly paint a decoration on the target so
 * your eye follows what the agent is doing — the Zed-style "watch the agent
 * work in my surface" delight.
 *
 * Deliberately self-contained:
 *  - No dependency on AcpClient / chat webview (those are separate WIP).
 *  - Triggered directly from the editor-tool handlers (editorContextTools.ts),
 *    AND exposed as onToolCall() so AcpClient._emitToolCallUpdate can call it
 *    as a single line if/when that hook is wired (reviewable diff).
 *  - Fails soft: any vscode API hiccup is swallowed; never breaks a tool call.
 */

type FlashKind = 'see' | 'act';

class FollowAlongController {
    private _lineDecoration: vscode.TextEditorDecorationType | undefined;
    private _rangeDecoration: vscode.TextEditorDecorationType | undefined;
    private _timers = new Map<string, NodeJS.Timeout>();

    private _enabled(): boolean {
        try {
            return vscode.workspace
                .getConfiguration('ftr10')
                .get<boolean>('followAlong.enabled', true);
        } catch {
            return true;
        }
    }

    private _flashMs(): number {
        try {
            const v = vscode.workspace
                .getConfiguration('ftr10')
                .get<number>('followAlong.flashMs', 1600);
            return Math.max(200, Math.min(6000, v));
        } catch {
            return 1600;
        }
    }

    private _lineDeco(kind: FlashKind): vscode.TextEditorDecorationType {
        // 'see' = the agent is reading (calm blue); 'act' = the agent moved
        // something (warmer amber). Uses themable colors with hex fallback.
        if (!this._lineDecoration) {
            this._lineDecoration = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                borderWidth: '0 0 0 3px',
                borderStyle: 'solid',
                borderColor: new vscode.ThemeColor('focusBorder'),
                overviewRulerColor: new vscode.ThemeColor('focusBorder'),
                overviewRulerLane: vscode.OverviewRulerLane.Full,
            });
        }
        return this._lineDecoration;
    }

    private _rangeDeco(): vscode.TextEditorDecorationType {
        if (!this._rangeDecoration) {
            this._rangeDecoration = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
            });
        }
        return this._rangeDecoration;
    }

    private _key(editor: vscode.TextEditor): string {
        return `${editor.document.uri.toString()}#${editor.viewColumn ?? 0}`;
    }

    private _scheduleClear(editor: vscode.TextEditor, deco: vscode.TextEditorDecorationType): void {
        const key = this._key(editor);
        const existing = this._timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        const t = setTimeout(() => {
            try {
                editor.setDecorations(deco, []);
            } catch {
                /* editor may be gone; ignore */
            }
            this._timers.delete(key);
        }, this._flashMs());
        this._timers.set(key, t);
    }

    /** Flash a single line (reveal_line, focus_editor, capture cursor). */
    flashLine(editor: vscode.TextEditor | null | undefined, line: number, kind: FlashKind = 'act'): void {
        if (!editor || !this._enabled()) return;
        try {
            const clamped = Math.max(0, Math.min(line, editor.document.lineCount - 1));
            const range = new vscode.Range(clamped, 0, clamped, 0);
            editor.setDecorations(this._lineDeco(kind), [range]);
            this._scheduleClear(editor, this._lineDeco(kind));
        } catch {
            /* never break the tool call */
        }
    }

    /** Flash the currently visible range (scroll_view, capture_view). */
    flashVisible(editor: vscode.TextEditor | null | undefined, kind: FlashKind = 'see'): void {
        if (!editor || !this._enabled()) return;
        try {
            const vr = editor.visibleRanges[0];
            if (!vr) return;
            editor.setDecorations(this._rangeDeco(), [vr]);
            this._scheduleClear(editor, this._rangeDeco());
        } catch {
            /* ignore */
        }
    }

    /**
     * Single entry point for AcpClient._emitToolCallUpdate to call (one line).
     * Given a parsed tool-call view, if it's one of the editor see/act tools,
     * paint the follow-along overlay on the relevant editor. Best-effort.
     */
    onToolCall(view: { title?: string; toolType?: string; status?: string }): void {
        if (!this._enabled() || !view) return;
        const name = (view.title || '').toLowerCase();
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        try {
            if (name.includes('capture_view')) {
                this.flashVisible(editor, 'see');
            } else if (name.includes('scroll_view')) {
                this.flashVisible(editor, 'act');
            } else if (name.includes('reveal_line') || name.includes('focus_editor')) {
                this.flashLine(editor, editor.selection.active.line, 'act');
            }
        } catch {
            /* ignore */
        }
    }

    dispose(): void {
        for (const t of this._timers.values()) {
            clearTimeout(t);
        }
        this._timers.clear();
        this._lineDecoration?.dispose();
        this._rangeDecoration?.dispose();
        this._lineDecoration = undefined;
        this._rangeDecoration = undefined;
    }
}

/** Module singleton — shared by the tool handlers and (optionally) AcpClient. */
export const followAlong = new FollowAlongController();
