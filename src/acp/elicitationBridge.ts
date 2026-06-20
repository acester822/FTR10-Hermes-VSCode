import { randomUUID } from 'crypto';

export type ElicitationFormFieldType = 'string' | 'number' | 'integer' | 'boolean';

export type ElicitationFormField = {
    name: string;
    label: string;
    type: ElicitationFormFieldType;
    required?: boolean;
    description?: string;
    enum?: string[];
    defaultValue?: string | number | boolean;
};

export type ElicitationRequestView = {
    requestId: string;
    message: string;
    fields: ElicitationFormField[];
};

export type ElicitationResolvedOutcome = 'accept' | 'decline' | 'cancel';

export type ElicitationResolvedEvent = {
    requestId: string;
    outcome: ElicitationResolvedOutcome;
};

export type ElicitationUiHandler = {
    onRequest: (request: ElicitationRequestView) => void;
    onResolved?: (event: ElicitationResolvedEvent) => void;
};

export type ElicitationResponse = {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, string | number | boolean | string[]>;
};

type PendingElicitation = {
    resolve: (response: ElicitationResponse) => void;
};

export function createElicitationRequestId(): string {
    return `elicit-${randomUUID()}`;
}

export function parseElicitationFormFields(requestedSchema: unknown): ElicitationFormField[] {
    if (!requestedSchema || typeof requestedSchema !== 'object') {
        return [];
    }
    const schema = requestedSchema as Record<string, unknown>;
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object') {
        return [];
    }
    const required = Array.isArray(schema.required) ? schema.required as string[] : [];

    return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
        const prop = raw as Record<string, unknown>;
        const typeRaw = String(prop.type ?? 'string');
        const type: ElicitationFormFieldType =
            typeRaw === 'number' || typeRaw === 'integer' || typeRaw === 'boolean'
                ? typeRaw
                : 'string';
        const enumValues = Array.isArray(prop.enum)
            ? prop.enum.map(v => String(v))
            : undefined;
        let defaultValue: string | number | boolean | undefined;
        if (typeof prop.default === 'string' || typeof prop.default === 'number' || typeof prop.default === 'boolean') {
            defaultValue = prop.default;
        }

        return {
            name,
            label: String(prop.title ?? name),
            type,
            required: required.includes(name),
            description: typeof prop.description === 'string' ? prop.description : undefined,
            enum: enumValues,
            defaultValue,
        };
    });
}

export class ElicitationBridge {
    private _pending = new Map<string, PendingElicitation>();

    waitForResponse(view: ElicitationRequestView): Promise<ElicitationResponse> {
        if (this._pending.has(view.requestId)) {
            throw new Error(`Elicitation already pending: ${view.requestId}`);
        }
        return new Promise((resolve) => {
            this._pending.set(view.requestId, { resolve });
        });
    }

    submitAccept(requestId: string, content: Record<string, string | number | boolean | string[]>): ElicitationResolvedEvent | null {
        return this._finish(requestId, { action: 'accept', content }, 'accept');
    }

    submitDecline(requestId: string): ElicitationResolvedEvent | null {
        return this._finish(requestId, { action: 'decline' }, 'decline');
    }

    cancelOne(requestId: string): ElicitationResolvedEvent | null {
        return this._finish(requestId, { action: 'cancel' }, 'cancel');
    }

    cancelAll(): ElicitationResolvedEvent[] {
        const events: ElicitationResolvedEvent[] = [];
        for (const requestId of [...this._pending.keys()]) {
            const event = this._finish(requestId, { action: 'cancel' }, 'cancel');
            if (event) {
                events.push(event);
            }
        }
        return events;
    }

    dispose(): void {
        this.cancelAll();
    }

    private _finish(
        requestId: string,
        response: ElicitationResponse,
        outcome: ElicitationResolvedOutcome
    ): ElicitationResolvedEvent | null {
        const entry = this._pending.get(requestId);
        if (!entry) {
            return null;
        }
        this._pending.delete(requestId);
        entry.resolve(response);
        return { requestId, outcome };
    }
}
