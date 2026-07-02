/**
 * Model configuration types and utilities.
 *
 * This module provides the shared type definitions and helpers for model
 * catalog management across the extension.  The real model-state assembly
 * lives in acpModelCatalog.ts and profileModels.ts; this file owns the
 * interfaces, simple formatting utilities, and thin builder functions.
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ModelListItem {
    valueId: string;
    name: string;
    inputCost?: number;
    outputCost?: number;
}

export interface ModelProviderGroup {
    slug: string;
    name: string;
    isPrimary: boolean;
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
    profileDefault?: ProfileDefaultModel;
}

export interface ModelListState {
    configId: string;
    currentValueId: string;
    currentLabel: string;
    models: ModelListItem[];
    groups: ModelProviderGroup[];
    fromAgent: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Config id that marks "use Hermes native set_model". */
export const HERMES_MODEL_CONFIG_ID = 'hermes';

// ── Value-id helpers ──────────────────────────────────────────────────────────

/**
 * Build a ``provider:model-id`` value string from a provider slug and
 * model name.  If provider is already a ``custom:…`` prefix it is kept as-is.
 */
export function encodeHermesModelValueId(provider: string, modelName: string): string {
    const p = provider.trim();
    const m = modelName.trim();
    if (!p) return m;
    if (p.startsWith('custom:')) return `${p}:${m}`;
    return `custom:${p}:${m}`;
}

// ── Runtime-source guard ──────────────────────────────────────────────────────

/**
 * True when the given configId represents a runtime model source
 * (i.e. the agent supports live model switching).
 */
export function isRuntimeModelSource(configId: string): boolean {
    return configId === HERMES_MODEL_CONFIG_ID || configId.startsWith('hermes');
}

// ── Fallback / simple builders ────────────────────────────────────────────────

/**
 * Build a fallback ModelListState from an array of config-option objects.
 * Each config option is expected to have ``id`` and ``name`` string fields.
 */
export function buildModelListState(configOptions: unknown[]): ModelListState | null {
    if (!Array.isArray(configOptions) || configOptions.length === 0) return null;

    const items: ModelListItem[] = [];
    let currentValueId = '';
    let currentLabel = '';

    for (const opt of configOptions) {
        if (!opt || typeof opt !== 'object') continue;
        const o = opt as Record<string, unknown>;
        const id = String(o.id ?? '').trim();
        const name = String(o.name ?? id).trim();
        if (!id) continue;
        items.push({ valueId: id, name });
        if ((o as any).selected || (o as any).current) {
            currentValueId = id;
            currentLabel = name;
        }
    }

    return {
        configId: '',
        currentValueId,
        currentLabel: currentLabel || (items[0]?.name ?? ''),
        models: items,
        groups: [{ slug: 'config', name: 'Config', isPrimary: true, models: [...items] }],
        fromAgent: false,
    };
}

/**
 * Build a ModelListState from the raw ``models`` payload received from an
 * ACP session/update notification.  The payload is expected to contain
 * ``configOptions`` (array of {id, name}) and optional ``currentModelId`` /
 * ``currentModelName`` fields.
 */
export function buildModelListStateFromSessionResponse(source: unknown): ModelListState | null {
    if (!source || typeof source !== 'object') return null;
    const s = source as Record<string, unknown>;

    // Try configOptions first
    const configOptions = s.configOptions ?? s.config_options;
    if (Array.isArray(configOptions) && configOptions.length > 0) {
        return buildModelListState(configOptions);
    }

    // Fall back to availableModels
    const available = s.availableModels ?? s.available_models;
    if (Array.isArray(available) && available.length > 0) {
        const items: ModelListItem[] = [];
        for (const item of available) {
            if (!item || typeof item !== 'object') continue;
            const m = item as Record<string, unknown>;
            const id = String(m.modelId ?? m.model_id ?? '').trim();
            const name = String(m.name ?? id).trim();
            if (!id) continue;
            items.push({ valueId: id, name });
        }
        const currentId = String(s.currentModelId ?? s.current_model_id ?? '').trim();
        const currentName = String(s.currentModelName ?? s.current_model_name ?? '').trim();
        return {
            configId: HERMES_MODEL_CONFIG_ID,
            currentValueId: currentId || (items[0]?.valueId ?? ''),
            currentLabel: currentName || currentId || (items[0]?.name ?? ''),
            models: items,
            groups: [{ slug: 'hermes', name: 'Hermes', isPrimary: true, models: [...items] }],
            fromAgent: true,
        };
    }

    return null;
}

/**
 * Build a ModelListState from the Hermes ``models`` field obtained via
 * ACP config-option sync (the ``_hermesModelsRaw`` blob).  This is called
 * when the full model.options response is not available.
 */
export function buildModelListStateFromHermesModels(raw: unknown): ModelListState | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const available = r.availableModels ?? r.available_models;
    if (!Array.isArray(available) || available.length === 0) return null;

    const items: ModelListItem[] = [];
    for (const item of available) {
        if (!item || typeof item !== 'object') continue;
        const m = item as Record<string, unknown>;
        const id = String(m.modelId ?? m.model_id ?? '').trim();
        const name = String(m.name ?? id).trim();
        if (!id) continue;
        items.push({ valueId: id, name });
    }
    if (!items.length) return null;

    const currentId = String(r.currentModelId ?? r.current_model_id ?? '').trim();
    const currentName = String(r.currentModelName ?? r.current_model_name ?? '').trim();

    return {
        configId: HERMES_MODEL_CONFIG_ID,
        currentValueId: currentId || (items[0]?.valueId ?? ''),
        currentLabel: currentName || currentId || (items[0]?.name ?? ''),
        models: items,
        groups: [{ slug: 'hermes', name: 'Hermes', isPrimary: true, models: [...items] }],
        fromAgent: true,
    };
}

/**
 * Build a fallback ModelListState entirely from a flat list of
 * ModelListItem (e.g. profile config models) and an optional current id.
 */
export function buildFallbackModelListState(
    items: ModelListItem[],
    currentId?: string,
): ModelListState {
    const match = currentId ? items.find(m => m.valueId === currentId) : undefined;
    return {
        configId: '',
        currentValueId: match?.valueId ?? (items[0]?.valueId ?? ''),
        currentLabel: match?.name ?? (items[0]?.name ?? ''),
        models: items,
        groups: [{ slug: 'fallback', name: 'Models', isPrimary: true, models: [...items] }],
        fromAgent: false,
    };
}

/**
 * Build a ModelListState from a ProfileModelCatalog and optional agent state.
 */
export function buildModelListStateFromCatalog(
    catalog: ProfileModelCatalog,
    agentState: ModelListState | null,
    options?: { primaryGroupSlug?: string; currentValueId?: string },
): ModelListState {
    const currentValueId =
        options?.currentValueId ??
        agentState?.currentValueId ??
        catalog.profileDefault?.valueId ??
        catalog.flatModels[0]?.valueId ??
        '';
    const currentLabel =
        agentState?.currentLabel ??
        catalog.flatModels.find(m => m.valueId === currentValueId)?.name ??
        currentValueId;

    return {
        configId: agentState?.configId ?? '',
        currentValueId,
        currentLabel,
        models: catalog.flatModels,
        groups: catalog.groups,
        fromAgent: agentState?.fromAgent ?? false,
    };
}

/**
 * Enrich an existing ModelListState with additional model items, carrying
 * over current selection when the value still exists in the merged set.
 */
export function enrichModelListState(
    state: ModelListState,
    additionalModels: ModelListItem[],
): ModelListState {
    const merged = mergeModelListItems(state.models, additionalModels);
    const stillExists = merged.some(m => m.valueId === state.currentValueId);
    return {
        ...state,
        models: merged,
        currentValueId: stillExists ? state.currentValueId : (merged[0]?.valueId ?? ''),
        currentLabel: stillExists
            ? state.currentLabel
            : (merged[0]?.name ?? state.currentLabel),
    };
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

/**
 * Merge two arrays of ModelListItem, deduplicating by valueId.
 * Items in ``a`` keep their order; items in ``b`` that are not in ``a``
 * are appended.
 */
export function mergeModelListItems(a: ModelListItem[], b: ModelListItem[]): ModelListItem[] {
    const seen = new Set<string>();
    const result: ModelListItem[] = [];

    for (const item of a) {
        if (seen.has(item.valueId)) continue;
        seen.add(item.valueId);
        result.push(item);
    }
    for (const item of b) {
        if (seen.has(item.valueId)) continue;
        seen.add(item.valueId);
        result.push(item);
    }
    return result;
}

// ── Runtime model-switch gate ─────────────────────────────────────────────────

/**
 * Decide whether to use Hermes session/set_model (ACP method) vs
 * the older set_config_option path for the given configId, state, and value.
 */
export function shouldUseHermesSetModel(
    configId: string,
    state: ModelListState | null,
    hermesModelsRaw: unknown,
    _valueId: string,
): boolean {
    // When the config id is explicitly 'hermes' (the HERMES_MODEL_CONFIG_ID),
    // prefer session/set_model
    if (configId === HERMES_MODEL_CONFIG_ID) return true;

    // When the state says fromAgent is true, prefer session/set_model
    if (state?.fromAgent) return true;

    // When hermesModelsRaw is populated, the agent supports native model
    // switching — prefer session/set_model
    if (hermesModelsRaw) return true;

    return false;
}

// ── Sorting and formatting ────────────────────────────────────────────────────

/**
 * Sort model list items by priority:
 * 1. Currently selected model (if specified)
 * 2. Primary provider group
 * 3. Ascending input cost (undefine → Infinity)
 * 4. Ascending output cost (undefine → Infinity)
 * 5. Alphabetical by name
 */
export function sortModelListItems(
    items: ModelListItem[],
    currentValueId?: string,
    _primaryGroupSlug?: string,
): ModelListItem[] {
    return [...items].sort((a, b) => {
        // 1. Currently selected model comes first
        const aIsCurrent = a.valueId === currentValueId;
        const bIsCurrent = b.valueId === currentValueId;
        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;

        // 2. Primary provider group is handled at the group level
        // 3. Ascending input cost (undefined → Infinity)
        const aInputCost = a.inputCost ?? Infinity;
        const bInputCost = b.inputCost ?? Infinity;
        if (aInputCost !== bInputCost) {
            return aInputCost - bInputCost;
        }

        // 4. Ascending output cost (undefined → Infinity)
        const aOutputCost = a.outputCost ?? Infinity;
        const bOutputCost = b.outputCost ?? Infinity;
        if (aOutputCost !== bOutputCost) {
            return aOutputCost - bOutputCost;
        }

        // 5. Alphabetical by name
        return a.name.localeCompare(b.name);
    });
}

/**
 * Format cost for display in the UI.
 * Returns a string like "$X/M" or "Free" or "Unknown".
 */
export function formatModelCost(cost: number | undefined): string {
    if (cost === undefined) return 'Unknown';
    if (cost === 0) return 'Free';
    return `$${cost.toFixed(2).replace(/\.?0+$/, '')}/M`;
}