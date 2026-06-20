/**
 * Helpers for ACP session model selection (configOptions + Hermes native models).
 */

/** Hermes ACP exposes models via NewSessionResponse.models + session/set_model */
export const HERMES_MODEL_CONFIG_ID = '__hermes__';
/** VS Code settings fallback when agent exposes no model list */
export const SETTINGS_MODEL_CONFIG_ID = '__settings__';

export interface ModelListItem {
    valueId: string;
    name: string;
}

export interface ModelListState {
    /** ACP config option id (session/set_config_option) */
    configId: string;
    currentValueId: string;
    currentLabel: string;
    models: ModelListItem[];
    /** true when options come from agent configOptions; false for settings fallback */
    fromAgent: boolean;
}

export interface FallbackModel {
    id: string;
    name: string;
}

/** Flatten select options (supports grouped options). */
export function flattenSelectOptions(options: unknown): ModelListItem[] {
    if (!Array.isArray(options)) {
        return [];
    }
    const result: ModelListItem[] = [];
    for (const item of options) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const o = item as Record<string, unknown>;
        if (typeof o.value === 'string' && typeof o.name === 'string') {
            result.push({ valueId: o.value, name: o.name });
            continue;
        }
        if (Array.isArray(o.options)) {
            for (const nested of o.options) {
                if (
                    nested &&
                    typeof nested === 'object' &&
                    typeof (nested as Record<string, unknown>).value === 'string' &&
                    typeof (nested as Record<string, unknown>).name === 'string'
                ) {
                    const n = nested as Record<string, string>;
                    result.push({ valueId: n.value, name: n.name });
                }
            }
        }
    }
    return result;
}

/** Pick the best config option to use as the model selector. */
export function findModelConfigOption(configOptions: unknown): Record<string, unknown> | null {
    if (!Array.isArray(configOptions) || configOptions.length === 0) {
        return null;
    }
    const opts = configOptions.filter(
        (o): o is Record<string, unknown> => !!o && typeof o === 'object' && (o as Record<string, unknown>).type === 'select'
    );
    if (opts.length === 0) {
        return null;
    }
    const byCategory = opts.find(o => o.category === 'model');
    if (byCategory) {
        return byCategory;
    }
    const byName = opts.find(o => /model/i.test(String(o.name ?? o.id ?? '')));
    if (byName) {
        return byName;
    }
    return opts[0];
}

export function buildModelListState(configOptions: unknown): ModelListState | null {
    const option = findModelConfigOption(configOptions);
    if (!option) {
        return null;
    }
    const models = flattenSelectOptions(option.options);
    if (models.length === 0) {
        return null;
    }
    const configId = String(option.id ?? '');
    const currentValueId = String(option.currentValue ?? '');
    const currentLabel =
        models.find(m => m.valueId === currentValueId)?.name ||
        currentValueId ||
        models[0].name;

    return {
        configId,
        currentValueId,
        currentLabel,
        models,
        fromAgent: true,
    };
}

export function buildFallbackModelListState(
    models: FallbackModel[],
    currentValueId: string
): ModelListState | null {
    if (!models.length) {
        return null;
    }
    const currentValue =
        currentValueId && models.some(m => m.id === currentValueId)
            ? currentValueId
            : models[0].id;
    const currentLabel = models.find(m => m.id === currentValue)?.name ?? currentValue;

    return {
        configId: SETTINGS_MODEL_CONFIG_ID,
        currentValueId: currentValue,
        currentLabel,
        models: models.map(m => ({ valueId: m.id, name: m.name })),
        fromAgent: false,
    };
}

/** Parse Hermes ACP SessionModelState (availableModels / currentModelId). */
export function buildModelListStateFromHermesModels(raw: unknown): ModelListState | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const available = o.availableModels ?? o.available_models;
    if (!Array.isArray(available) || available.length === 0) {
        return null;
    }

    const models: ModelListItem[] = [];
    for (const item of available) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const m = item as Record<string, unknown>;
        const valueId = String(m.modelId ?? m.model_id ?? '').trim();
        const name = String(m.name ?? valueId).trim();
        if (valueId) {
            models.push({ valueId, name });
        }
    }
    if (models.length === 0) {
        return null;
    }

    const currentValueId = String(
        o.currentModelId ?? o.current_model_id ?? models[0].valueId
    );
    const currentLabel =
        models.find(m => m.valueId === currentValueId)?.name ?? currentValueId;

    return {
        configId: HERMES_MODEL_CONFIG_ID,
        currentValueId,
        currentLabel,
        models,
        fromAgent: true,
    };
}

/** Prefer standard configOptions; fall back to Hermes native models field. */
export function buildModelListStateFromSessionResponse(response: unknown): ModelListState | null {
    if (!response || typeof response !== 'object') {
        return null;
    }
    const r = response as Record<string, unknown>;
    return buildModelListState(r.configOptions) ?? buildModelListStateFromHermesModels(r.models);
}

export function isRuntimeModelSource(configId: string): boolean {
    return configId !== SETTINGS_MODEL_CONFIG_ID;
}

/** Hermes encodes choices as ``provider:model-id``. */
export function isHermesModelValueId(valueId: string): boolean {
    return /^[\w.-]+:[\w./-]+$/i.test(valueId.trim());
}

/** Choose Hermes native session/set_model vs standard set_config_option. */
export function shouldUseHermesSetModel(
    configId: string,
    modelListState: ModelListState | null,
    hermesModelsRaw: unknown,
    valueId: string
): boolean {
    const effectiveConfigId = configId || modelListState?.configId || '';
    return (
        effectiveConfigId === HERMES_MODEL_CONFIG_ID ||
        modelListState?.configId === HERMES_MODEL_CONFIG_ID ||
        hermesModelsRaw != null ||
        isHermesModelValueId(valueId)
    );
}
