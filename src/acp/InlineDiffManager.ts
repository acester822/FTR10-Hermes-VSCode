import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Watches file changes via VS Code's document system and generates
 * inline diffs for the chat feed.
 */

export type DiffPreviewHandler = (filePath: string, diff: string) => void;

interface FileSnapshot {
    content: string;
    timestamp: number;
}

const FILE_MUTATING_TOOLS = new Set([
    'write_file', 'patch', 'apply_diff', 'skill_manage',
]);

export function extractFilePath(update: Record<string, unknown>): string | undefined {
    const locations = update.locations;
    if (Array.isArray(locations) && locations.length > 0) {
        const first = locations[0] as Record<string, unknown>;
        if (first && typeof first.path === 'string' && first.path.trim()) {
            return first.path.trim();
        }
    }
    const rawInput = update.rawInput ?? update.raw_input;
    if (rawInput && typeof rawInput === 'object') {
        const args = rawInput as Record<string, unknown>;
        const p = args.path || args.filePath || args.file;
        if (typeof p === 'string' && p.trim()) return p.trim();
    }
    if (typeof rawInput === 'string') {
        try {
            const parsed = JSON.parse(rawInput);
            const p = parsed.path || parsed.filePath || parsed.file;
            if (typeof p === 'string' && p.trim()) return p.trim();
        } catch { /* not JSON */ }
    }
    const content = update.content;
    if (typeof content === 'string') {
        const m = content.match(/`([^`]+)`/);
        if (m && m[1] && (m[1].includes('/') || m[1].includes('.'))) return m[1].trim();
    }
    if (Array.isArray(content)) {
        for (const block of content) {
            if (block && typeof block === 'object' && typeof (block as any).text === 'string') {
                const m = ((block as any).text as string).match(/`([^`]+)`/);
                if (m && m[1] && (m[1].includes('/') || m[1].includes('.'))) return m[1].trim();
            }
        }
    }
    const title = update.title;
    if (typeof title === 'string') {
        const colonMatch = title.match(/:\s+(.+)$/);
        if (colonMatch && colonMatch[1]) {
            const candidate = colonMatch[1].trim();
            if (candidate && !candidate.includes(' ')) return candidate;
        }
    }
    return undefined;
}

export function isFileMutatingTool(update: Record<string, unknown>): boolean {
    const title = typeof update.title === 'string' ? update.title : '';
    const kind = typeof update.kind === 'string' ? update.kind : '';
    return (
        title.startsWith('write:') || title.startsWith('patch') ||
        title.startsWith('skill_manage') ||
        kind === 'file_write' || kind === 'file_edit' || kind === 'skill_manage' ||
        FILE_MUTATING_TOOLS.has(kind)
    );
}

function computeDiff(before: string, after: string, filePath: string): string | null {
    if (before === after) return null;
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const m = beforeLines.length;
    const n = afterLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (beforeLines[i - 1] === afterLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
    let i = m, j = n;
    const ops: Array<{ op: '+' | '-' | ' '; text: string }> = [];
    while (i > 0 && j > 0) {
        if (beforeLines[i - 1] === afterLines[j - 1]) {
            ops.push({ op: ' ', text: beforeLines[i - 1] }); i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            ops.push({ op: '-', text: beforeLines[i - 1] }); i--;
        } else {
            ops.push({ op: '+', text: afterLines[j - 1] }); j--;
        }
    }
    while (i > 0) { ops.push({ op: '-', text: beforeLines[i - 1] }); i--; }
    while (j > 0) { ops.push({ op: '+', text: afterLines[j - 1] }); j--; }
    ops.reverse();
    for (const op of ops) { diffLines.push(`${op.op}${op.text}`); }
    return diffLines.join('\n');
}

export class InlineDiffManager {
    private _disposables: vscode.Disposable[] = [];
    private _snapshots = new Map<string, FileSnapshot>();
    private _onDiffPreview: DiffPreviewHandler | null = null;
    private _enabled = true;
    private _pendingToolFiles = new Set<string>();

    constructor() {
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (!this._enabled) return;
                try {
                    const content = doc.getText();
                    this._snapshots.set(doc.uri.fsPath, { content, timestamp: Date.now() });
                } catch { /* ignore */ }
            })
        );
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (!this._enabled) return;
                const filePath = e.document.uri.fsPath;
                const newContent = e.document.getText();
                const snapshot = this._snapshots.get(filePath);
                if (!snapshot) return;
                const oldContent = snapshot.content;
                this._snapshots.set(filePath, { content: newContent, timestamp: Date.now() });
                if (oldContent === newContent) return;
                if (!this._pendingToolFiles.has(filePath)) return;
                this._pendingToolFiles.delete(filePath);
                const diff = computeDiff(oldContent, newContent, filePath);
                if (diff && this._onDiffPreview) {
                    this._onDiffPreview(filePath, diff);
                }
            })
        );
    }

    onDiffPreview(handler: DiffPreviewHandler): void { this._onDiffPreview = handler; }
    setEnabled(enabled: boolean): void { this._enabled = enabled; }

    captureSnapshot(filePath: string): void {
        if (!this._enabled) return;
        this._pendingToolFiles.add(filePath);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this._snapshots.set(filePath, { content, timestamp: Date.now() });
        } catch {
            this._snapshots.set(filePath, { content: '', timestamp: Date.now() });
        }
    }

    isFileMutating(update: Record<string, unknown>): boolean {
        return isFileMutatingTool(update);
    }

    getFilePath(update: Record<string, unknown>): string | undefined {
        return extractFilePath(update);
    }

    dispose(): void {
        for (const d of this._disposables) d.dispose();
        this._disposables = [];
        this._snapshots.clear();
    }
}
