/** Fetch model ids from an OpenAI-compatible ``/v1/models`` endpoint. */
export async function fetchOpenAiCompatibleModels(
    apiKey: string,
    baseUrl: string,
    timeoutMs = 8000
): Promise<string[] | null> {
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
            const headers: Record<string, string> = { 'User-Agent': 'FTR10-Hermes-VSCode' };
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }
            const resp = await fetch(url, { headers, signal: controller.signal });
            clearTimeout(timer);
            if (!resp.ok) {
                continue;
            }
            const data = (await resp.json()) as { data?: Array<{ id?: string }> };
            const ids = (data.data ?? [])
                .map(m => (m.id ?? '').trim())
                .filter(Boolean);
            if (ids.length) {
                return ids;
            }
        } catch {
            // try next candidate
        }
    }
    return null;
}
