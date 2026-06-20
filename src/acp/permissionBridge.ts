import { randomUUID } from 'crypto';

/** ACP permission option as shown in the chat UI. */
export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOptionView {
    optionId: string;
    name: string;
    kind: PermissionOptionKind;
}

export interface PermissionRequestView {
    requestId: string;
    toolCallId: string;
    title: string;
    detail?: string;
    options: PermissionOptionView[];
}

export type PermissionResolvedOutcome = 'selected' | 'cancelled' | 'timeout';

export interface PermissionResolvedEvent {
    requestId: string;
    outcome: PermissionResolvedOutcome;
    optionId?: string;
    optionName?: string;
}

export type PermissionUiHandler = {
    onRequest: (request: PermissionRequestView) => void;
    onResolved?: (event: PermissionResolvedEvent) => void;
};

export type AcpPermissionResponse = {
    outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string };
};

export type PermissionSettled = {
    response: AcpPermissionResponse;
    event: PermissionResolvedEvent;
};

type PendingPermission = {
    resolve: (settled: PermissionSettled) => void;
    options: PermissionOptionView[];
    timeoutId?: ReturnType<typeof setTimeout>;
};

export const PERMISSION_TIMEOUT_MS = 120_000;

export function createPermissionRequestId(): string {
    return `perm-${randomUUID()}`;
}

export function normalizePermissionOptions(options: unknown): PermissionOptionView[] {
    if (!Array.isArray(options) || options.length === 0) {
        return [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
            { optionId: 'reject_once', name: 'Deny', kind: 'reject_once' },
        ];
    }

    return options.map((raw) => {
        const o = raw as Record<string, unknown>;
        const optionId = String(o.optionId ?? o.id ?? 'unknown');
        const kind = normalizeOptionKind(o.kind, optionId);
        return {
            optionId,
            name: String(o.name ?? optionId),
            kind,
        };
    });
}

function normalizeOptionKind(kind: unknown, optionId: string): PermissionOptionKind {
    if (kind === 'allow_once' || kind === 'allow_always' || kind === 'reject_once' || kind === 'reject_always') {
        return kind;
    }
    if (optionId.includes('always') && optionId.includes('allow')) {
        return 'allow_always';
    }
    if (optionId.includes('always') && optionId.includes('reject')) {
        return 'reject_always';
    }
    if (optionId.startsWith('reject') || optionId === 'deny') {
        return 'reject_once';
    }
    return 'allow_once';
}

export function extractPermissionDetail(toolCall: unknown): string | undefined {
    if (!toolCall || typeof toolCall !== 'object') {
        return undefined;
    }
    const tc = toolCall as Record<string, unknown>;
    const rawInput = tc.rawInput;
    if (rawInput == null) {
        return undefined;
    }
    if (typeof rawInput === 'string') {
        return rawInput;
    }
    try {
        return JSON.stringify(rawInput, null, 2);
    } catch {
        return String(rawInput);
    }
}

export class PermissionBridge {
    private _pending = new Map<string, PendingPermission>();
    private _timeoutMs: number;

    constructor(timeoutMs: number = PERMISSION_TIMEOUT_MS) {
        this._timeoutMs = timeoutMs;
    }

    get pendingCount(): number {
        return this._pending.size;
    }

    hasPending(requestId: string): boolean {
        return this._pending.has(requestId);
    }

    waitForChoice(view: PermissionRequestView): Promise<PermissionSettled> {
        if (this._pending.has(view.requestId)) {
            throw new Error(`Permission request already pending: ${view.requestId}`);
        }

        return new Promise((resolve) => {
            const entry: PendingPermission = {
                resolve,
                options: view.options,
            };

            if (this._timeoutMs > 0) {
                entry.timeoutId = setTimeout(() => {
                    this._resolveTimeout(view.requestId);
                }, this._timeoutMs);
            }

            this._pending.set(view.requestId, entry);
        });
    }

    submitSelected(requestId: string, optionId: string): PermissionResolvedEvent | null {
        const entry = this._pending.get(requestId);
        if (!entry) {
            return null;
        }

        const option = entry.options.find(o => o.optionId === optionId);
        const event: PermissionResolvedEvent = {
            requestId,
            outcome: 'selected',
            optionId,
            optionName: option?.name ?? optionId,
        };
        this._finish(requestId, {
            response: { outcome: { outcome: 'selected', optionId } },
            event,
        });
        return event;
    }

    cancelAll(): PermissionResolvedEvent[] {
        const events: PermissionResolvedEvent[] = [];
        for (const requestId of [...this._pending.keys()]) {
            const event = this.cancelOne(requestId);
            if (event) {
                events.push(event);
            }
        }
        return events;
    }

    cancelOne(requestId: string): PermissionResolvedEvent | null {
        if (!this._pending.has(requestId)) {
            return null;
        }
        const event: PermissionResolvedEvent = { requestId, outcome: 'cancelled' };
        this._finish(requestId, {
            response: { outcome: { outcome: 'cancelled' } },
            event,
        });
        return event;
    }

    dispose(): void {
        this.cancelAll();
    }

    private _resolveTimeout(requestId: string): PermissionResolvedEvent | null {
        const entry = this._pending.get(requestId);
        if (!entry) {
            return null;
        }

        const rejectOpt = entry.options.find(o =>
            o.kind === 'reject_once' || o.optionId.startsWith('reject') || o.optionId === 'deny'
        );

        if (rejectOpt) {
            const event: PermissionResolvedEvent = {
                requestId,
                outcome: 'timeout',
                optionId: rejectOpt.optionId,
                optionName: rejectOpt.name,
            };
            this._finish(requestId, {
                response: { outcome: { outcome: 'selected', optionId: rejectOpt.optionId } },
                event,
            });
            return event;
        }

        const event: PermissionResolvedEvent = { requestId, outcome: 'timeout' };
        this._finish(requestId, {
            response: { outcome: { outcome: 'cancelled' } },
            event,
        });
        return event;
    }

    private _finish(requestId: string, settled: PermissionSettled): void {
        const entry = this._pending.get(requestId);
        if (!entry) {
            return;
        }
        if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
        }
        this._pending.delete(requestId);
        entry.resolve(settled);
    }
}
