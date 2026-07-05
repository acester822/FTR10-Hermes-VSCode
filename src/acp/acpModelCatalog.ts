import {
    type ModelListItem,
    type ModelProviderGroup,
    type ProfileDefaultModel,
    type ProfileModelCatalog,
    encodeHermesModelValueId,
} from './modelConfig';

export interface ModelPricing {
    /** Input cost in dollars per 1M tokens. */
    input?: number;
    /** Output cost in dollars per 1M tokens. */
    output?: number;
}

export interface AcpModelOptionsProvider {
    slug: string;
    name: string;
    models?: string[];
    /** Per-model pricing keyed by model name/id. */
    pricing?: Record<string, ModelPricing>;
    /** Capability flags (e.g. { vision: true, tools: true }). */
    capabilities?: Record<string, boolean>;
    /** Model IDs that are known-unavailable despite being listed. */
    unavailable_models?: string[];
    is_current?: boolean;
}

export interface AcpModelOptionsResponse {
    model?: string;
    provider?: string;
    providers?: AcpModelOptionsProvider[];
}

/** Build grouped catalog from Hermes ACP ``model.options`` (same shape as TUI gateway). */
export function buildCatalogFromModelOptions(payload: AcpModelOptionsResponse): ProfileModelCatalog {
    const groups: ModelProviderGroup[] = [];

    for (const row of payload.providers ?? []) {
        const modelNames = (row.models ?? []).map(m => m.trim()).filter(Boolean);
        if (!modelNames.length) {
            continue;
        }
        const slug = (row.slug || 'custom').trim();
        const unavailable = new Set(row.unavailable_models ?? []);

        const models: ModelListItem[] = modelNames.map(name => {
            const pricing = row.pricing?.[name];
            return {
                valueId: encodeHermesModelValueId(slug, name),
                name,
                inputCost: pricing?.input ?? undefined,
                outputCost: pricing?.output ?? undefined,
                unavailable: unavailable.has(name),
            };
        });

        groups.push({
            slug,
            name: (row.name || slug).trim(),
            isPrimary: Boolean(row.is_current),
            models: sortModelsWithinGroup(models),
        });
    }

    const profileDefault = resolveProfileDefaultFromOptions(payload, groups);
    const sortedGroups = sortProviderGroups(groups, profileDefault);

    return {
        groups: sortedGroups,
        flatModels: flattenGroupModels(sortedGroups),
        profileDefault,
    };
}

/** Group Hermes native ACP ``models.availableModels`` by ``description`` provider label. */
export function buildCatalogFromHermesModelsRaw(raw: unknown): ProfileModelCatalog | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const available = o.availableModels ?? o.available_models;
    if (!Array.isArray(available) || available.length === 0) {
        return null;
    }

    const groupMap = new Map<string, ModelProviderGroup>();
    const currentModelId = String(o.currentModelId ?? o.current_model_id ?? '').trim();

    for (const item of available) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const m = item as Record<string, unknown>;
        const valueId = String(m.modelId ?? m.model_id ?? '').trim();
        const name = String(m.name ?? valueId).trim();
        if (!valueId) {
            continue;
        }
        const providerName = parseProviderFromDescription(String(m.description ?? ''));
        let group = groupMap.get(providerName);
        if (!group) {
            group = {
                slug: providerSlugFromDisplayName(providerName),
                name: providerName,
                isPrimary: false,
                models: [],
            };
            groupMap.set(providerName, group);
        }
        if (!group.models.some(x => x.valueId === valueId)) {
            group.models.push({
                valueId,
                name,
                inputCost: undefined,
                outputCost: undefined,
                unavailable: false,
            });
        }
    }

    const groups = [...groupMap.values()];
    if (!groups.length) {
        return null;
    }

    if (currentModelId) {
        for (const group of groups) {
            if (group.models.some(m => m.valueId === currentModelId)) {
                group.isPrimary = true;
                break;
            }
        }
    }
    if (!groups.some(g => g.isPrimary)) {
        groups[0].isPrimary = true;
    }

    for (const group of groups) {
        sortModelsWithinGroup(group.models);
    }

    groups.sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
            return a.isPrimary ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    const currentItem = groups.flatMap(g => g.models).find(m => m.valueId === currentModelId);
    const profileDefault: ProfileDefaultModel | undefined = currentModelId
        ? {
            modelName: currentItem?.name || currentModelId,
            valueId: currentModelId,
            groupSlug: groups.find(g => g.models.some(m => m.valueId === currentModelId))?.slug,
        }
        : undefined;

    return {
        groups,
        flatModels: flattenGroupModels(groups),
        profileDefault,
    };
}

function resolveProfileDefaultFromOptions(
    payload: AcpModelOptionsResponse,
    groups: ModelProviderGroup[]
): ProfileDefaultModel | undefined {
    const modelName = (payload.model ?? '').trim();
    if (!modelName) {
        return undefined;
    }
    const providerSlug = (payload.provider ?? '').trim();
    const primaryGroup =
        groups.find(g => g.isPrimary) ||
        groups.find(g => providerSlug && g.slug.toLowerCase() === providerSlug.toLowerCase()) ||
        groups.find(g => g.models.some(m => m.name === modelName));

    const matched = primaryGroup?.models.find(m => m.name === modelName);
    return {
        modelName,
        valueId: matched?.valueId ?? encodeHermesModelValueId(providerSlug || primaryGroup?.slug, modelName),
        groupSlug: primaryGroup?.slug,
    };
}

export function parseProviderFromDescription(description: string): string {
    const match = description.match(/Provider:\s*([^•]+)/i);
    if (match) {
        return match[1].trim();
    }
    return 'Models';
}

function providerSlugFromDisplayName(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!normalized || normalized === 'models') {
        return 'custom';
    }
    return normalized.includes(':') ? normalized : `custom:${normalized}`;
}

/** Prefer Hermes ``model.options``; fall back to session ``models.availableModels``. */
export function resolveModelCatalog(
    modelOptions: AcpModelOptionsResponse | null | undefined,
    hermesModelsRaw: unknown
): ProfileModelCatalog | null {
    if (modelOptions?.providers?.length) {
        const catalog = buildCatalogFromModelOptions(modelOptions);
        if (catalog.groups.length > 0) {
            return catalog;
        }
    }
    return buildCatalogFromHermesModelsRaw(hermesModelsRaw);
}

/**
 * Compute the average input cost for a provider group.
 * Models with no defined cost are treated as free (0).
 */
export function avgProviderCost(groups: ModelProviderGroup[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const group of groups) {
        const costs = group.models
            .map(m => m.inputCost)
            .filter((c): c is number => c !== undefined && c !== null);
        if (costs.length === 0) {
            result[group.slug] = 0;
        } else {
            result[group.slug] = costs.reduce((a, b) => a + b, 0) / costs.length;
        }
    }
    return result;
}

/**
 * Sort provider groups: primary first → average cost ascending → alphabetical name.
 */
export function sortProviderGroups(
    groups: ModelProviderGroup[],
    profileDefault?: ProfileDefaultModel
): ModelProviderGroup[] {
    const avgCosts = avgProviderCost(groups);
    return [...groups]
        .map(group => ({
            ...group,
            isPrimary: profileDefault?.groupSlug
                ? group.slug === profileDefault.groupSlug
                : group.isPrimary,
        }))
        .sort((a, b) => {
            if (a.isPrimary !== b.isPrimary) {
                return a.isPrimary ? -1 : 1;
            }
            const costDiff = (avgCosts[a.slug] ?? Infinity) - (avgCosts[b.slug] ?? Infinity);
            if (costDiff !== 0) {
                return costDiff;
            }
            return a.name.localeCompare(b.name);
        });
}

/**
 * Sort models within a group: currently selected (isPrimary group marker) → ascending cost → alphabetical.
 * Callers should set the current model's ``inputCost`` to -1 or use a separate mechanism.
 * We sort by: undefined cost last → ascending cost → alphabetical name.
 */
export function sortModelsWithinGroup(models: ModelListItem[]): ModelListItem[] {
    return [...models].sort((a, b) => {
        const costA = a.inputCost ?? Infinity;
        const costB = b.inputCost ?? Infinity;
        if (costA !== costB) {
            return costA - costB;
        }
        return a.name.localeCompare(b.name);
    });
}

function flattenGroupModels(groups: ModelProviderGroup[]): ModelListItem[] {
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