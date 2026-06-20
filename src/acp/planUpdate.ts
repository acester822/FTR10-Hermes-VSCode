import { extractTextFromContentBlock } from './contentText';

export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed';
export type PlanEntryPriority = 'high' | 'medium' | 'low';

export type PlanEntryView = {
    content: string;
    status: PlanEntryStatus;
    priority?: PlanEntryPriority;
};

export type PlanUpdateView = {
    planId: string;
    removed?: boolean;
    markdown?: string;
    entries?: PlanEntryView[];
};

export type PlanUpdateHandler = (update: PlanUpdateView) => void;

const ENTRY_STATUS: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);
const ENTRY_PRIORITY: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

function mapPlanEntry(raw: unknown): PlanEntryView | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const e = raw as Record<string, unknown>;
    const content = String(e.content ?? e.text ?? e.title ?? '').trim();
    if (!content) {
        return null;
    }
    const statusRaw = String(e.status ?? 'pending');
    const status = ENTRY_STATUS.has(statusRaw) ? statusRaw as PlanEntryStatus : 'pending';
    const priorityRaw = e.priority != null ? String(e.priority) : undefined;
    const priority = priorityRaw && ENTRY_PRIORITY.has(priorityRaw)
        ? priorityRaw as PlanEntryPriority
        : undefined;
    return { content, status, priority };
}

function mapPlanEntries(entries: unknown): PlanEntryView[] {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map(mapPlanEntry).filter((e): e is PlanEntryView => e != null);
}

function extractPlanId(update: Record<string, unknown>): string {
    const plan = update.plan;
    if (plan && typeof plan === 'object') {
        const id = (plan as Record<string, unknown>).id;
        if (typeof id === 'string' && id) {
            return id;
        }
    }
    if (typeof update.planId === 'string' && update.planId) {
        return update.planId;
    }
    if (typeof update.id === 'string' && update.id) {
        return update.id;
    }
    return 'default';
}

export function parsePlanSessionUpdate(
    update: Record<string, unknown>,
    kind: string
): PlanUpdateView | null {
    if (kind === 'plan_removed') {
        return {
            planId: extractPlanId(update),
            removed: true,
        };
    }

    const planId = extractPlanId(update);

    if (Array.isArray(update.entries)) {
        const entries = mapPlanEntries(update.entries);
        if (entries.length > 0) {
            return { planId, entries };
        }
    }

    const plan = update.plan;
    if (plan && typeof plan === 'object') {
        const p = plan as Record<string, unknown>;
        const type = String(p.type ?? 'items');

        if (type === 'items' && Array.isArray(p.entries)) {
            const entries = mapPlanEntries(p.entries);
            if (entries.length > 0) {
                return { planId: String(p.id ?? planId), entries };
            }
        }

        if (type === 'markdown') {
            const markdown = typeof p.markdown === 'string' ? p.markdown : undefined;
            if (markdown) {
                return { planId: String(p.id ?? planId), markdown };
            }
        }

        if (type === 'file' && typeof p.uri === 'string') {
            return { planId: String(p.id ?? planId), markdown: p.uri };
        }
    }

    const text = extractTextFromContentBlock(update.content)
        ?? (typeof update.text === 'string' ? update.text : undefined);
    if (text) {
        return { planId, markdown: text };
    }

    return null;
}
