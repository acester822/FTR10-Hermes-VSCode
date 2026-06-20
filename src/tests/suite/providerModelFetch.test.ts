import { describe, it } from 'mocha';
import assert from 'assert';
import { fetchOpenAiCompatibleModels } from '../../acp/providerModelFetch';

describe('providerModelFetch', () => {
    it('fetchOpenAiCompatibleModels parses OpenAI-compatible responses', async () => {
        const originalFetch = global.fetch;
        global.fetch = (async () => ({
            ok: true,
            async json() {
                return { data: [{ id: 'model-a' }, { id: 'model-b' }] };
            },
        } as unknown as Response)) as typeof fetch;

        try {
            const models = await fetchOpenAiCompatibleModels('key', 'https://example.com/v1');
            assert.deepStrictEqual(models, ['model-a', 'model-b']);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
