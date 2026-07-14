import { extractTextFromContentBlock } from './contentText';

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/** Cognitive state for live tool calls — drives pulse color differentiation. */
export type ToolCallState = 'analyzing' | 'searching' | 'reading' | 'writing' | 'executing' | 'error';

export type ToolCallUpdateView = {
    toolCallId: string;
    status: ToolCallStatus;
    title?: string;
    body?: string;
    kind?: string;
    toolType?: string;
    state?: ToolCallState;
};

export type ToolCallUpdateHandler = (update: ToolCallUpdateView) => void;

const TERMINAL_STATUSES: ReadonlySet<ToolCallStatus> = new Set([
    'completed',
    'failed',
    'cancelled',
]);

const TOOL_CALL_ICONS: Record<ToolCallStatus, string> = {
    pending: '🔧',
    in_progress: '⚙️',
    completed: '✅',
    failed: '❌',
    cancelled: '⏹',
};

// Tool type icons mapping
const TOOL_TYPE_ICONS: Record<string, string> = {
    search: '🔍',
    find: '🔍',
    grep: '🔍',
    terminal: '💻',
    shell: '💻',
    command: '💻',
    bash: '💻',
    execute: '💻',
    file_read: '📄',
    read_file: '📄',
    file_write: '✏️',
    write_file: '✏️',
    file_edit: '✏️',
    edit_file: '✏️',
    file: '📁',
    directory: '📁',
    list: '📋',
    web: '🌐',
    browser: '🌐',
    fetch: '🌐',
    http: '🌐',
    think: '🧠',
    reasoning: '🧠',
    python: '🐍',
    code: '🐍',
    git: '🔀',
    github: '🐙',
    test: '🧪',
    install: '📦',
    npm: '📦',
    pip: '📦',
    default: '🔧'
};

export function detectToolType(title: string | undefined, kind: string | undefined): string {
    const text = `${title || ''} ${kind || ''}`.toLowerCase();
    
    // Check for specific tool types
    for (const [type, _icon] of Object.entries(TOOL_TYPE_ICONS)) {
        if (type === 'default') continue;
        if (text.includes(type.toLowerCase())) {
            return type;
        }
    }
    
    // Check for common patterns
    if (text.includes('search') || text.includes('find') || text.includes('grep')) {
        return 'search';
    }
    if (text.includes('terminal') || text.includes('shell') || text.includes('command') || text.includes('execute')) {
        return 'terminal';
    }
    if (text.includes('read') && text.includes('file')) {
        return 'file_read';
    }
    if (text.includes('write') && text.includes('file')) {
        return 'file_write';
    }
    if (text.includes('edit') && text.includes('file')) {
        return 'file_edit';
    }
    
    return 'default';
}

export function getToolTypeIcon(toolType: string): string {
    return TOOL_TYPE_ICONS[toolType] || TOOL_TYPE_ICONS.default;
}

/** Map tool type/title to a cognitive state for pulse color differentiation. */
export function detectToolState(toolType: string | undefined, title: string | undefined): ToolCallState {
    const text = `${title || ''} ${toolType || ''}`.toLowerCase();

    if (text.includes('search') || text.includes('find') || text.includes('grep') || text.includes('web') || text.includes('browser') || text.includes('fetch')) {
        return 'searching';
    }
    if (text.includes('read_file') || text.includes('read') || text.includes('file_read') || text.includes('view') || text.includes('list')) {
        return 'reading';
    }
    if (text.includes('write') || text.includes('edit') || text.includes('file_write') || text.includes('file_edit') || text.includes('create') || text.includes('patch')) {
        return 'writing';
    }
    if (text.includes('terminal') || text.includes('shell') || text.includes('execute') || text.includes('bash') || text.includes('command') || text.includes('run') || text.includes('python') || text.includes('code') || text.includes('npm') || text.includes('pip') || text.includes('install') || text.includes('git') || text.includes('github')) {
        return 'executing';
    }
    if (text.includes('think') || text.includes('reason') || text.includes('plan')) {
        return 'analyzing';
    }
    return 'analyzing';
}

export function formatToolTitle(title: string | undefined, toolType: string): string {
    if (!title) return toolType.replace(/_/g, ' ');
    
    // Clean up common prefixes
    let cleaned = title;
    const prefixes = ['search:', 'terminal:', 'file_read:', 'file_write:', 'file_edit:'];
    for (const prefix of prefixes) {
        if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
            cleaned = cleaned.slice(prefix.length).trim();
            break;
        }
    }
    
    return cleaned || toolType.replace(/_/g, ' ');
}

export function normalizeToolCallStatus(
    status: unknown,
    kind: 'tool_call' | 'tool_call_update'
): ToolCallStatus {
    if (status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'failed') {
        return status;
    }
    return kind === 'tool_call' ? 'pending' : 'in_progress';
}

export function extractToolCallBody(update: Record<string, unknown>): string | undefined {
    const parts: string[] = [];

    const fromContent = extractTextFromContentBlock(update.content);
    if (fromContent.trim()) {
        parts.push(fromContent.trim());
    }

    const rawInput = formatToolCallRawValue(update.rawInput ?? update.raw_input);
    if (rawInput && !parts.includes(rawInput)) {
        parts.push(rawInput);
    }

    const rawOutput = formatToolCallRawValue(update.rawOutput ?? update.raw_output);
    if (rawOutput && !parts.includes(rawOutput)) {
        parts.push(rawOutput);
    }

    const description = update.description;
    if (typeof description === 'string' && description.trim()) {
        const trimmed = description.trim();
        if (!parts.includes(trimmed)) {
            parts.push(trimmed);
        }
    }

    if (parts.length === 0) {
        return undefined;
    }
    return parts.join('\n\n');
}

function formatToolCallRawValue(value: unknown): string | undefined {
    if (value == null) {
        return undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export { formatToolCallRawValue };

export function formatToolCallSummary(status: ToolCallStatus, title: string | undefined, state?: ToolCallState): string {
    const stateTag = state ? ` [${state}]` : '';
    return `${TOOL_CALL_ICONS[status]}${stateTag} ${title || 'Tool'}`;
}

export function formatToolCallDisplay(view: ToolCallUpdateView): string {
    const summary = formatToolCallSummary(view.status, view.title, view.state);
    const body = view.body?.trim();
    if (!body) {
        return summary;
    }
    return `${summary}\n\n${body}`;
}

export function parseToolCallSessionUpdate(
    update: Record<string, unknown>,
    kind: 'tool_call' | 'tool_call_update'
): ToolCallUpdateView | null {
    const toolCallId = update.toolCallId;
    if (typeof toolCallId !== 'string' || !toolCallId) {
        return null;
    }

    const status = normalizeToolCallStatus(update.status, kind);
    const title = typeof update.title === 'string' && update.title ? update.title : undefined;
    const body = extractToolCallBody(update);
    const kindValue = update.kind;
    
    // Detect tool type
        const toolType = detectToolType(title, typeof kindValue === 'string' ? kindValue : undefined);
        // Detect cognitive state for pulse color
        const state = detectToolState(toolType, title);

        return {
            toolCallId,
            status,
            title,
            body: body || undefined,
            kind: typeof kindValue === 'string' ? kindValue : undefined,
            toolType,
            state,
        };
}

function mergeToolCallBodies(prev?: string, incoming?: string): string | undefined {
    const next = incoming?.trim();
    const prior = prev?.trim();
    if (!next) {
        return prior;
    }
    if (!prior) {
        return next;
    }
    if (prior === next || prior.includes(next) || next.includes(prior)) {
        return prior.length >= next.length ? prior : next;
    }
    return `${prior}\n\n${next}`;
}

export class ToolCallTracker {
    private _active = new Map<string, ToolCallUpdateView>();

    get activeCount(): number {
        return this._active.size;
    }

    apply(incoming: ToolCallUpdateView): ToolCallUpdateView {
        const prev = this._active.get(incoming.toolCallId);
        const merged: ToolCallUpdateView = {
            toolCallId: incoming.toolCallId,
            status: incoming.status,
            title: incoming.title || prev?.title || 'Tool',
            kind: incoming.kind ?? prev?.kind,
            body: mergeToolCallBodies(prev?.body, incoming.body),
            toolType: incoming.toolType ?? prev?.toolType ?? detectToolType(incoming.title || prev?.title, incoming.kind ?? prev?.kind),
            state: incoming.state ?? prev?.state ?? detectToolState(incoming.toolType ?? prev?.toolType, incoming.title ?? prev?.title),
        };

        if (TERMINAL_STATUSES.has(merged.status)) {
            this._active.delete(incoming.toolCallId);
        } else {
            this._active.set(incoming.toolCallId, merged);
        }

        return merged;
    }

    cancelActive(): ToolCallUpdateView[] {
        const cancelled: ToolCallUpdateView[] = [];
        for (const [toolCallId, view] of this._active) {
            if (view.status === 'pending' || view.status === 'in_progress') {
                cancelled.push({
                    ...view,
                    toolCallId,
                    status: 'cancelled',
                });
            }
        }
        for (const view of cancelled) {
            this._active.delete(view.toolCallId);
        }
        return cancelled;
    }

    clear(): void {
        this._active.clear();
    }
}