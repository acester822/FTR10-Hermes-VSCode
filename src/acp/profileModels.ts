import * as fs from 'fs';
import * as path from 'path';
import { findHermesExecutable, runHermesCommand } from './profileDiscovery';
import { normalizeHermesCliProfile } from './hermesProfile';
import {
    type ModelListItem,
    type ModelProviderGroup,
    type ProfileDefaultModel,
    type ProfileModelCatalog,
    encodeHermesModelValueId,
} from './modelConfig';
import { fetchOpenAiCompatibleModels } from './providerModelFetch';

export type { ModelProviderGroup, ProfileModelCatalog };

interface ProviderDraft {
    slug: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    discoverModels: boolean;
    modelNames: string[];
    isPrimary: boolean;
}

/** Load grouped model catalog for a Hermes profile (config + live /v1/models). */
export async function discoverProfileModelCatalog(
    hermesPath: string | undefined,
    profile: string
): Promise<ProfileModelCatalog> {
    const content = await readProfileConfigContent(hermesPath, profile);
    if (!content) {
        return { groups: [], flatModels: [] };
    }
    return buildProfileModelCatalog(content, { probeLive: true });
}

/** Load configured models for a Hermes profile (flat list). */
export async function discoverProfileConfigModels(
    hermesPath: string | undefined,
    profile: string
): Promise<ModelListItem[]> {
    const catalog = await discoverProfileModelCatalog(hermesPath, profile);
    return catalog.flatModels;
}

export async function buildProfileModelCatalog(
    content: string,
    options: { probeLive?: boolean } = {}
): Promise<ProfileModelCatalog> {
    const drafts = parseProviderDrafts(content);

    const resolved = await Promise.all(
        drafts.map(async draft => ({
            draft,
            modelNames: await resolveProviderModelNames(draft, options.probeLive),
        }))
    );

    const groups: ModelProviderGroup[] = resolved
        .filter(entry => entry.modelNames.length > 0)
        .map(({ draft, modelNames }) => ({
            slug: draft.slug,
            name: draft.name,
            isPrimary: draft.isPrimary,
            models: modelNames.map(name => ({
                valueId: encodeHermesModelValueId(
                    draft.slug.startsWith('custom:') ? draft.slug : `custom:${draft.slug}`,
                    name
                ),
                name,
            })),
        }));

    const profileDefault = resolveProfileDefaultModel(content, groups);
    const orderedGroups = alignGroupsWithProfileDefault(groups, profileDefault);

    return {
        groups: orderedGroups,
        flatModels: flattenGroupModels(orderedGroups),
        profileDefault,
    };
}

async function resolveProviderModelNames(
    draft: ProviderDraft,
    probeLive?: boolean
): Promise<string[]> {
    let modelNames = [...draft.modelNames];
    const explicitModels = modelNames.length > 0;
    const shouldProbe =
        draft.discoverModels &&
        Boolean(draft.baseUrl) &&
        (Boolean(draft.apiKey) || !explicitModels);

    if (probeLive && shouldProbe) {
        const live = await fetchOpenAiCompatibleModels(draft.apiKey, draft.baseUrl);
        if (live?.length) {
            modelNames = draft.apiKey ? live : mergeModelNames(modelNames, live);
        }
    }

    // For well-known providers without a custom base_url (e.g. OpenRouter),
    // fetch their full curated model list from the live API so users see
    // all available models even when the ACP session uses a different provider.
    if (probeLive && !draft.baseUrl && draft.slug.endsWith('openrouter')) {
        const live = await _fetchOpenRouterModels();
        if (live?.length) {
            modelNames = live;
        }
    }

    return modelNames;
}

/** Fetch model IDs from the OpenRouter live /v1/models endpoint. */
async function _fetchOpenRouterModels(timeoutMs = 8000): Promise<string[] | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { Accept: 'application/json', 'User-Agent': 'FTR10-Hermes-VSCode' },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const data = (await resp.json()) as { data?: Array<{ id?: string }> };
        const ids = (data.data ?? [])
            .map(m => (m.id ?? '').trim())
            .filter(Boolean);
        return ids.length ? ids : null;
    } catch {
        return null;
}
}

export function resolveProfileDefaultModel(
    content: string,
    groups: ModelProviderGroup[]
): ProfileDefaultModel | undefined {
    const modelName = readYamlScalar(content, 'model', 'default');
    if (!modelName) {
        return undefined;
    }
    const provider = readYamlScalar(content, 'model', 'provider') ?? 'custom';

    const primaryGroup = groups.find(g => g.isPrimary);
    if (primaryGroup) {
        const match = primaryGroup.models.find(m => m.name === modelName);
        if (match) {
            return { modelName, valueId: match.valueId, groupSlug: primaryGroup.slug };
        }
    }

    for (const group of groups) {
        const match = group.models.find(m => m.name === modelName);
        if (match) {
            return { modelName, valueId: match.valueId, groupSlug: group.slug };
        }
    }

    return {
        modelName,
        valueId: encodeHermesModelValueId(provider, modelName),
    };
}

function alignGroupsWithProfileDefault(
    groups: ModelProviderGroup[],
    profileDefault?: ProfileDefaultModel
): ModelProviderGroup[] {
    if (!profileDefault?.groupSlug) {
        return groups;
    }
    return [...groups]
        .map(group => ({
            ...group,
            isPrimary: group.slug === profileDefault.groupSlug,
        }))
        .sort((a, b) => {
            if (a.isPrimary !== b.isPrimary) {
                return a.isPrimary ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
}

/** @deprecated Use discoverProfileModelCatalog; kept for tests. */
export function parseModelsFromConfigYaml(content: string): ModelListItem[] {
    const catalog = parseProviderDrafts(content);
    const items: ModelListItem[] = [];
    const seen = new Set<string>();
    for (const draft of catalog) {
        for (const name of draft.modelNames) {
            const valueId = encodeHermesModelValueId(
                draft.slug.startsWith('custom:') ? draft.slug : `custom:${draft.slug}`,
                name
            );
            if (seen.has(valueId)) {
                continue;
            }
            seen.add(valueId);
            items.push({ valueId, name });
        }
    }
    return items;
}

export function parseProviderDrafts(content: string): ProviderDraft[] {
    const byKey = new Map<string, ProviderDraft>();

    const primaryUrl = readYamlScalar(content, 'model', 'base_url') ?? '';
    const primaryKey = resolveConfigSecret(readYamlScalar(content, 'model', 'api_key'));
    const primaryDefault = readYamlScalar(content, 'model', 'default');
    const primaryProvider = readYamlScalar(content, 'model', 'provider') ?? 'custom';

    if (primaryUrl) {
        upsertDraft(byKey, {
            slug: providerSlugFromName(inferNameFromUrl(primaryUrl)),
            name: inferNameFromUrl(primaryUrl),
            baseUrl: primaryUrl,
            apiKey: primaryKey,
            discoverModels: readDiscoverModels(content, 'model'),
            modelNames: primaryDefault ? [primaryDefault] : [],
            isPrimary: true,
        });
    } else if (primaryDefault) {
        const slug = normalizeProviderSlug(primaryProvider);
        upsertDraft(byKey, {
            slug,
            name: formatProviderDisplayName(slug.replace(/^custom:/, '')),
            baseUrl: '',
            apiKey: '',
            discoverModels: true,
            modelNames: [primaryDefault],
            isPrimary: true,
        });
    }

    for (const block of readYamlListBlocks(content, 'custom_providers')) {
        const rawName = readYamlScalar(block, undefined, 'name') || readYamlScalar(block, undefined, 'provider') || 'custom';
        const baseUrl = readYamlScalar(block, undefined, 'base_url') ?? '';
        const apiKey = resolveConfigSecret(readYamlScalar(block, undefined, 'api_key'));
        const keyEnv = readYamlScalar(block, undefined, 'key_env');
        const resolvedKey = apiKey || (keyEnv ? (process.env[keyEnv]?.trim() ?? '') : '');
        const slug = providerSlugFromName(rawName);
        const modelNames = collectExplicitModelNames(block);
        const isPrimary = Boolean(primaryUrl && normalizeUrl(baseUrl) === normalizeUrl(primaryUrl));

        upsertDraft(byKey, {
            slug,
            name: formatProviderDisplayName(rawName),
            baseUrl,
            apiKey: resolvedKey,
            discoverModels: readDiscoverModels(block),
            modelNames,
            isPrimary,
        });
    }

    for (const block of readYamlListBlocks(content, 'fallback_providers')) {
        const provider = readYamlScalar(block, undefined, 'provider') ?? '';
        const model = readYamlScalar(block, undefined, 'model');
        if (!model) {
            continue;
        }
        const slug = normalizeProviderSlug(provider);
        const name = formatProviderDisplayName(slug.replace(/^custom:/, ''));
        const existingBySlug = [...byKey.values()].find(d => d.slug === slug);
        if (existingBySlug) {
            existingBySlug.modelNames = mergeModelNames(existingBySlug.modelNames, [model]);
            continue;
        }
        upsertDraft(byKey, {
            slug,
            name,
            baseUrl: '',
            apiKey: '',
            discoverModels: false,
            modelNames: [model],
            isPrimary: false,
        });
    }

    const drafts = [...byKey.values()];
    drafts.sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
            return a.isPrimary ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
    return drafts;
}

function upsertDraft(byKey: Map<string, ProviderDraft>, incoming: ProviderDraft): void {
    const key = incoming.baseUrl
        ? `${normalizeUrl(incoming.baseUrl)}|${incoming.apiKey}`
        : `slug:${incoming.slug}`;
    const existing = byKey.get(key);
    if (!existing) {
        byKey.set(key, { ...incoming, modelNames: [...incoming.modelNames] });
        return;
    }
    existing.isPrimary = existing.isPrimary || incoming.isPrimary;
    if (!existing.baseUrl && incoming.baseUrl) {
        existing.baseUrl = incoming.baseUrl;
    }
    if (!existing.apiKey && incoming.apiKey) {
        existing.apiKey = incoming.apiKey;
    }
    existing.modelNames = mergeModelNames(existing.modelNames, incoming.modelNames);
}

function collectExplicitModelNames(block: string): string[] {
    const names: string[] = [];
    const defaultModel = readYamlScalar(block, undefined, 'model');
    if (defaultModel) {
        names.push(defaultModel);
    }
    names.push(...readYamlModelNamesFromBlock(block));
    return mergeModelNames([], names);
}

function mergeModelNames(primary: string[], extra: string[]): string[] {
    const merged = [...primary];
    const seen = new Set(primary.map(n => n.toLowerCase()));
    for (const name of extra) {
        const key = name.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(name);
        }
    }
    return merged;
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

function readDiscoverModels(content: string, section?: string): boolean {
    const source = section ? extractYamlSection(content, section) : content;
    if (!source) {
        return true;
    }
    const raw = readYamlScalar(source, undefined, 'discover_models');
    if (!raw) {
        return true;
    }
    return !['false', 'no', '0'].includes(raw.toLowerCase());
}

function resolveConfigSecret(value: string | undefined): string {
    if (!value) {
        return '';
    }
    const trimmed = value.trim();
    const match = trimmed.match(/^\$\{([^}]+)\}$/);
    if (match) {
        return process.env[match[1]]?.trim() ?? '';
    }
    return trimmed;
}

function normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, '').toLowerCase();
}

function providerSlugFromName(name: string): string {
    const cleaned = name.trim().toLowerCase().replace(/\s+/g, '-');
    return cleaned ? `custom:${cleaned}` : 'custom';
}

function normalizeProviderSlug(provider: string): string {
    const raw = provider.trim().toLowerCase();
    if (!raw || raw === 'custom') {
        return 'custom';
    }
    if (raw.startsWith('custom:')) {
        return raw;
    }
    return `custom:${raw}`;
}

export function formatProviderDisplayName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        return 'Custom';
    }
    for (const sep of ['—', ' - ']) {
        if (trimmed.includes(sep)) {
            return formatProviderDisplayName(trimmed.split(sep)[0]);
        }
    }
    if (/^[a-z0-9.-]+$/i.test(trimmed)) {
        if (trimmed.toLowerCase() === 'deepseek') {
            return 'DeepSeek';
        }
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
    return trimmed;
}

export function inferNameFromUrl(url: string): string {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.includes('deepseek')) {
            return 'DeepSeek';
        }
        if (host.includes('agnes')) {
            return 'Agnes';
        }
        if (host.includes('generativelanguage') || host.includes('googleapis')) {
            return 'Gemini';
        }
        if (host.includes('openai')) {
            return 'OpenAI';
        }
    } catch {
        // ignore invalid URL
    }
    return 'Custom endpoint';
}

async function readProfileConfigContent(
    hermesPath: string | undefined,
    profile: string
): Promise<string | null> {
    const executable = await findHermesExecutable(hermesPath);
    if (!executable) {
        return null;
    }
    const cliProfile = normalizeHermesCliProfile(profile);
    try {
        const configPath = (await runHermesCommand(executable, ['--profile', cliProfile, 'config', 'path'])).trim();
        if (!configPath) {
            return null;
        }
        return await fs.promises.readFile(configPath, 'utf-8');
    } catch {
        return null;
    }
}

/** Read model ids from custom_providers[].models (dict keys or list items). */
function readYamlModelNamesFromBlock(block: string): string[] {
    const modelsBody = extractYamlSection(block, 'models');
    if (!modelsBody) {
        return [];
    }
    const names: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string) => {
        const name = stripYamlScalar(raw).trim();
        if (!name || seen.has(name)) {
            return;
        }
        seen.add(name);
        names.push(name);
    };

    for (const line of modelsBody.split(/\r?\n/)) {
        const dictMatch = line.match(/^\s+([A-Za-z0-9][\w./-]*):\s*(\{.*\})?\s*$/);
        if (dictMatch) {
            push(dictMatch[1]);
            continue;
        }
        const listMatch = line.match(/^\s*-\s+(.+?)\s*$/);
        if (listMatch) {
            push(listMatch[1]);
        }
    }
    return names;
}

function readYamlScalar(content: string, section: string | undefined, key: string): string | undefined {
    const source = section ? extractYamlSection(content, section) : content;
    if (!source) {
        return undefined;
    }
    const match = source.match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, 'm'));
    if (!match) {
        return undefined;
    }
    return stripYamlScalar(match[1]);
}

function extractYamlSection(content: string, section: string): string | undefined {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex(line => line.trim() === `${section}:`);
    if (start === -1) {
        return undefined;
    }
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^[A-Za-z_][\w-]*:\s*$/.test(line)) {
            break;
        }
        body.push(line);
    }
    return body.join('\n');
}

function readYamlListBlocks(content: string, section: string): string[] {
    const body = extractYamlSection(content, section);
    if (!body) {
        return [];
    }
    const lines = body.split(/\r?\n/);
    const blocks: string[] = [];
    let current = '';
    let listIndent: number | null = null;

    for (const line of lines) {
        const listMatch = line.match(/^(\s*)-\s/);
        if (listMatch) {
            const indent = listMatch[1].length;
            if (listIndent === null) {
                listIndent = indent;
            }
            if (indent === listIndent) {
                if (current.trim()) {
                    blocks.push(current);
                }
                current = line.replace(/^\s*-\s?/, '') + '\n';
                continue;
            }
        }
        if (current && (line.trim() === '' || /^\s+\S/.test(line))) {
            current += line + '\n';
        }
    }
    if (current.trim()) {
        blocks.push(current);
    }
    return blocks;
}

function stripYamlScalar(raw: string): string {
    const trimmed = raw.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Load provider -> models cache written by Hermes runtime.
 *
 * Path: ``~/.hermes/provider_models_cache.json``.
 *
 * Shape:
 * ``{ "openrouter": { "models": ["anthropic/claude-...', ...], ... }, ... }``
 *
 * Returns an empty record when the file is missing, unreadable, or malformed
 * — callers should fall back to other discovery mechanisms.
 */
export async function loadProviderModelsCache(hermesHome?: string): Promise<Record<string, string[]>> {
    const home = hermesHome || process.env.HOME || '/tmp';
    const cachePath = path.join(home, '.hermes', 'provider_models_cache.json');
    try {
        const raw = await fs.promises.readFile(cachePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, { models?: unknown } | unknown>;

        const result: Record<string, string[]> = {};
        for (const [provider, entry] of Object.entries(parsed)) {
            if (entry && typeof entry === 'object') {
                const models = (entry as { models?: unknown }).models;
                if (Array.isArray(models)) {
                    const ids = models
                        .map(m => String(m ?? '').trim())
                        .filter(Boolean);
                    if (ids.length) {
                        result[provider] = ids;
                    }
                }
            }
        }
        return result;
    } catch {
        return {};
    }
}
