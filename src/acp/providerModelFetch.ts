/** Fetch model ids from an OpenAI-compatible ``/v1/models`` endpoint. */
export interface OpenAiModelMetadata {
    id: string;
    inputCost?: number;   // cost per 1M tokens in USD
    outputCost?: number;  // cost per 1M tokens in USD
    provider?: string;
}

export interface ProviderCatalogEntry {
    provider?: string;
    models: OpenAiModelMetadata[];
}

export async function fetchOpenAiCompatibleModels(
    apiKey: string | null | undefined,
    baseUrl: string,
    timeoutMs = 8000
): Promise<OpenAiModelMetadata[] | null> {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!normalized) {
        return null;
    }

    const alternate = normalized.endsWith('/v1')
        ? normalized.slice(0, -3).replace(/\/+$/, '')
        : `${normalized}/v1`;
    const candidates = [...new Set([normalized, alternate].filter(Boolean))];

    for (const base of candidates) {
        const url = `${base.replace(/\/+$/, '')}/models`;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const headers: Record<string, string> = { 'User-Agent': 'rina-hermes-acp' };
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }
            const resp = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(timer);
            if (!resp.ok) {
                continue;
            }
            const data = (await resp.json()) as { data?: Array<{ id?: string; pricing?: { input?: string; output?: string } }> };
            const models = (data.data ?? [])
                .map(m => {
                    const id = (m.id ?? '').trim();
                    if (!id) {
                        return null;
                    }
                    let inputCost: number | undefined;
                    let outputCost: number | undefined;
                    if (m.pricing) {
                        if (m.pricing.input) {
                            // Convert to cost per 1M tokens (assuming input is per token)
                            inputCost = parseFloat(m.pricing.input) * 1000000;
                        }
                        if (m.pricing.output) {
                            // Convert to cost per 1M tokens (assuming output is per token)
                            outputCost = parseFloat(m.pricing.output) * 1000000;
                        }
                    }
                    return { 
                                            id, 
                                            inputCost, 
                                            outputCost,
                                            provider: normalizeProviderFromBaseUrl(base) 
                                        } as OpenAiModelMetadata;
                                    })
                                    .filter(m => m !== null);
            if (models.length) {
                return models;
            }
        } catch {
            // try next candidate
        }
    }
    return null;
}

export function normalizeProviderFromBaseUrl(baseUrl: string): string {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        const map: Record<string, string> = {
            'openai.com': 'OpenAI',
            'generativelanguage.googleapis.com': 'Gemini',
            'deepseek.com': 'DeepSeek',
            'api.anthropic.com': 'Anthropic',
        };
        const exact = Object.entries(map).find(([key]) => host === key || host.endsWith('.' + key));
        if (exact) {
            return exact[1];
        }
        for (const [key, value] of Object.entries(map)) {
            if (host.includes(key)) {
                return value;
            }
        }
        return new URL(baseUrl).hostname;
    } catch {
        return 'Custom';
    }
}