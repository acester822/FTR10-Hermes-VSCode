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

export interface ModelProviderGroup {
    slug: string;
    name: string;
    isPrimary?: boolean;
    models: ModelListItem[];
}

export interface ProfileDefaultModel {
    modelName: string;
    valueId: string;
    groupSlug?: string;
}

export interface ProfileModelCatalog {
    groups: ModelProviderGroup[];
    flatModels: ModelListItem[];
    /** Profile ``model.default`` resolved against the fetched provider catalog. */
    profileDefault?: ProfileDefaultModel;
}

export interface ModelListState {
    /** ACP config option id (session/set_config_option) */
    configId: string;
    currentValueId: string;
    currentLabel: string;
    models: ModelListItem[];
    groups?: ModelProviderGroup[];
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

/** Build a Hermes ``session/set_model`` id from config provider + model name. */
export function encodeHermesModelValueId(provider: string | undefined, modelName: string): string {
    const model = modelName.trim();
    const rawProvider = (provider ?? '').trim().toLowerCase();
    if (!rawProvider || rawProvider === 'custom' || rawProvider.startsWith('custom:')) {
        return `custom:${model}`;
    }
    return `${rawProvider}:${model}`;
}

/** Merge supplemental models; dedupe by valueId only. */
export function mergeModelListItems(
    primary: ModelListItem[],
    supplemental: ModelListItem[]
): ModelListItem[] {
    if (supplemental.length === 0) {
        return primary;
    }
    const merged = [...primary];
    const seenIds = new Set(primary.map(m => m.valueId));

    for (const item of supplemental) {
        if (seenIds.has(item.valueId)) {
            continue;
        }
        merged.push(item);
        seenIds.add(item.valueId);
    }
    return merged;
}

function findModelInGroups(
    groups: ModelProviderGroup[],
    valueId: string
): ModelListItem | undefined {
    for (const group of groups) {
        const found = group.models.find(m => m.valueId === valueId);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function upsertModelInGroups(
    groups: ModelProviderGroup[],
    groupName: string,
    item: ModelListItem
): ModelProviderGroup[] {
    const next = groups.map(g => ({ ...g, models: [...g.models] }));
    for (const group of next) {
        if (group.models.some(m => m.valueId === item.valueId)) {
            return next;
        }
    }
    let target = next.find(g => g.name === groupName);
    if (!target) {
        target = { slug: 'other', name: groupName, models: [] };
        next.push(target);
    }
    target.models.push(item);
    return next;
}

/** Build grouped picker state: full provider catalog first, then align current model. */
export function buildModelListStateFromCatalog(
    catalog: ProfileModelCatalog,
    agentState: ModelListState | null,
    options: {
        modelId?: string;
        modelLabel?: string;
        settingsModels?: Array<{ id: string; name: string }>;
    } = {}
): ModelListState | null {
    let groups = catalog.groups.map(g => ({
        ...g,
        models: g.models.map(m => ({ ...m })),
    }));

    for (const setting of options.settingsModels ?? []) {
        groups = upsertModelInGroups(groups, 'Other', {
            valueId: setting.id,
            name: setting.name,
        });
    }

    const savedId = options.modelId?.trim() || '';
    if (savedId && !findModelInGroups(groups, savedId)) {
        groups = upsertModelInGroups(groups, 'Other', {
            valueId: savedId,
            name: options.modelLabel || savedId,
        });
    }

    const flatModels = flattenGroupedModels(groups);
    if (!flatModels.length) {
        return agentState;
    }

    const current = resolveCurrentModelSelection(flatModels, groups, {
        savedModelId: savedId,
        profileDefault: catalog.profileDefault,
        agentCurrentId: agentState?.currentValueId,
    });

    return {
        configId: agentState?.configId || HERMES_MODEL_CONFIG_ID,
        currentValueId: current.valueId,
        currentLabel: current.label,
        models: flatModels,
        groups,
        fromAgent: agentState?.fromAgent ?? true,
    };
}

function resolveCurrentModelSelection(
    flatModels: ModelListItem[],
    groups: ModelProviderGroup[],
    options: {
        savedModelId?: string;
        profileDefault?: ProfileDefaultModel;
        agentCurrentId?: string;
    }
): { valueId: string; label: string } {
    const inList = (id: string) => Boolean(id) && flatModels.some(m => m.valueId === id);
    const labelFor = (id: string) =>
        findModelInGroups(groups, id)?.name ||
        flatModels.find(m => m.valueId === id)?.name ||
        id;

    if (options.savedModelId && inList(options.savedModelId)) {
        return { valueId: options.savedModelId, label: labelFor(options.savedModelId) };
    }

    const profileDefault = options.profileDefault;
    if (profileDefault) {
        if (inList(profileDefault.valueId)) {
            return { valueId: profileDefault.valueId, label: labelFor(profileDefault.valueId) };
        }
        const byName = flatModels.find(m => m.name === profileDefault.modelName);
        if (byName) {
            return { valueId: byName.valueId, label: byName.name };
        }
    }

    if (options.agentCurrentId && inList(options.agentCurrentId)) {
        return { valueId: options.agentCurrentId, label: labelFor(options.agentCurrentId) };
    }

    const primaryGroup = groups.find(g => g.isPrimary);
    const fallback = primaryGroup?.models[0] || flatModels[0];
    return { valueId: fallback.valueId, label: fallback.name };
}

function flattenGroupedModels(groups: ModelProviderGroup[]): ModelListItem[] {
    const flat: ModelListItem[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        for (const model of group.models) {
            if (seen.has(model.valueId)) {
                continue;
            }
            seen.add(model.valueId);
            flat.push(model);
        }
    }
    return flat;
}

/** Enrich agent model state with profile-configured models when the agent list is sparse. */
export function enrichModelListState(
    state: ModelListState | null,
    supplemental: ModelListItem[]
): ModelListState | null {
    if (!supplemental.length) {
        return state;
    }
    if (!state) {
        const models = mergeModelListItems([], supplemental);
        if (!models.length) {
            return null;
        }
        const current = models[0];
        return {
            configId: HERMES_MODEL_CONFIG_ID,
            currentValueId: current.valueId,
            currentLabel: current.name,
            models,
            fromAgent: true,
        };
    }
    const models = mergeModelListItems(state.models, supplemental);
    if (models.length === state.models.length) {
        return state;
    }
    const currentStillValid = models.some(m => m.valueId === state.currentValueId);
    const currentValueId = currentStillValid ? state.currentValueId : state.currentValueId;
    const currentLabel =
        models.find(m => m.valueId === currentValueId)?.name ?? state.currentLabel;
    return {
        ...state,
        configId: state.configId || HERMES_MODEL_CONFIG_ID,
        models,
        currentValueId,
        currentLabel,
    };
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
