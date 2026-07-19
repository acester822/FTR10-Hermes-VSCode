import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Watches file changes and generates inline diffs for the chat feed.
 *
 * Two change sources are observed:
 *  1. vscode.workspace.onDidChangeTextDocument — fires only for documents that
 *     are OPEN in a VS Code editor.
 *  2. vscode.workspace.createFileSystemWatcher — fires for ANY file change on
 *     disk in the workspace, including files the user has NOT opened in an
 *     editor. This is what makes the inline diff actually appear when the
 *     agent edits a file purely on disk.
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

/** Normalize a path for map lookups: resolve symlinks/case where possible and use forward slashes. */
function normalizePath(p: string): string {
    try {
        return fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

export class InlineDiffManager {
    private _disposables: vscode.Disposable[] = [];
    private _snapshots = new Map<string, FileSnapshot>();
    private _onDiffPreview: DiffPreviewHandler | null = null;
    private _enabled = true;
    private _pendingToolFiles = new Set<string>();
    /** Maps realpath -> original tool-reported path, so disk events resolve to the captured snapshot key. */
    private _pathAliases = new Map<string, string>();

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
                console.log(`[inline-diff-editor] onDidChangeTextDocument: ${filePath} (pending: ${[...this._pendingToolFiles].join(', ')})`);
                const newContent = e.document.getText();
                this._emitForFile(filePath, newContent);
            })
        );

        // Disk watcher: catches changes to files the agent edits on disk even
        // when they are NOT open in a VS Code editor. Without this, the inline
        // diff never fires for the common case of an external/agent file write.
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        this._disposables.push(watcher);
        const onDiskChange = (uri: vscode.Uri) => {
            if (!this._enabled) return;
            console.log(`[inline-diff-disk] onDidChange: ${uri.fsPath} (pending: ${[...this._pendingToolFiles].join(', ')})`);
            let newContent: string;
            try {
                newContent = fs.readFileSync(uri.fsPath, 'utf-8');
            } catch {
                return; // unreadable (deleted, binary, etc.) — nothing to diff
            }
            this._emitForFile(uri.fsPath, newContent);
        };
        this._disposables.push(watcher.onDidChange(onDiskChange));
        this._disposables.push(watcher.onDidCreate(onDiskChange));
    }

    /**
     * Resolve the change to a captured pending snapshot, diff, and emit.
     * Shared by both the editor-document path and the disk-watcher path.
     */
    private _emitForFile(filePath: string, newContent: string): void {
        const realKey = normalizePath(filePath);
        // Look up by realpath first, then by the raw path, then by any alias.
        const rawKey = path.resolve(filePath);
        let snapshotKey: string | undefined =
            this._snapshots.has(realKey) ? realKey
            : this._snapshots.has(rawKey) ? rawKey
            : this._pathAliases.get(realKey);
        if (!snapshotKey) {
            console.log(`[inline-diff-emit] NO snapshot for ${filePath} (realKey=${realKey}, rawKey=${rawKey})`);
            return;
        }

        const snapshot = this._snapshots.get(snapshotKey);
        if (!snapshot) {
            console.log(`[inline-diff-emit] snapshot missing for key=${snapshotKey}`);
            return;
        }
        const oldContent = snapshot.content;
        this._snapshots.set(snapshotKey, { content: newContent, timestamp: Date.now() });
        if (oldContent === newContent) {
            console.log(`[inline-diff-emit] content unchanged for ${snapshotKey}`);
            return;
        }
        if (!this._pendingToolFiles.has(snapshotKey)) {
            console.log(`[inline-diff-emit] NOT in pendingToolFiles: ${snapshotKey} (pending=${[...this._pendingToolFiles].join(',')})`);
            return;
        }
        this._pendingToolFiles.delete(snapshotKey);
        const diff = computeDiff(oldContent, newContent, snapshotKey);
        console.log(`[inline-diff-emit] diff computed, length=${diff?.length ?? 0}, handler=${!!this._onDiffPreview}`);
        if (diff && this._onDiffPreview) {
            this._onDiffPreview(snapshotKey, diff);
        }
    }

    onDiffPreview(handler: DiffPreviewHandler): void { this._onDiffPreview = handler; }
    setEnabled(enabled: boolean): void { this._enabled = enabled; }

    captureSnapshot(filePath: string): void {
        if (!this._enabled) return;
        const realKey = normalizePath(filePath);
        const rawKey = path.resolve(filePath);
        this._pendingToolFiles.add(realKey);
        this._pathAliases.set(realKey, filePath);
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this._snapshots.set(realKey, { content, timestamp: Date.now() });
            this._snapshots.set(rawKey, { content, timestamp: Date.now() });
        } catch {
            this._snapshots.set(realKey, { content: '', timestamp: Date.now() });
            this._snapshots.set(rawKey, { content: '', timestamp: Date.now() });
        }
    }

    isFileMutating(update: Record<string, unknown>): boolean {
        return isFileMutatingTool(update);
    }

    getFilePath(update: Record<string, unknown>): string | undefined {
        return extractFilePath(update);
    }

    /**
     * Called when a file-mutating tool completes. Reads the current file content
     * directly and emits the diff without relying on the filesystem watcher.
     */
    completeSnapshot(filePath: string): void {
        if (!this._enabled) return;
        const realKey = normalizePath(filePath);
        if (!this._pendingToolFiles.has(realKey)) return;
        let newContent: string;
        try {
            newContent = fs.readFileSync(realKey, 'utf-8');
        } catch {
            return;
        }
        const snapshot = this._snapshots.get(realKey);
        if (!snapshot) return;
        const oldContent = snapshot.content;
        this._snapshots.set(realKey, { content: newContent, timestamp: Date.now() });
        if (oldContent === newContent) return;
        this._pendingToolFiles.delete(realKey);
        const diff = computeDiff(oldContent, newContent, realKey);
        console.log(`[inline-diff-complete] computed diff for ${realKey}, length=${diff?.length ?? 0}, handler=${!!this._onDiffPreview}`);
        if (diff && this._onDiffPreview) {
            this._onDiffPreview(realKey, diff);
        }
    }

    dispose(): void {
        for (const d of this._disposables) d.dispose();
        this._disposables = [];
        this._snapshots.clear();
        this._pendingToolFiles.clear();
        this._pathAliases.clear();
    }
}
