import { describe, it } from 'mocha';
import assert from 'assert';
import {
    buildProfileModelCatalog,
    formatProviderDisplayName,
    inferNameFromUrl,
    parseModelsFromConfigYaml,
    parseProviderDrafts,
} from '../../acp/profileModels';

const sampleDefaultConfig = `
model:
  default: agnes-2.0-flash
  provider: custom
  base_url: https://apihub.agnes-ai.com/v1
fallback_providers:
- provider: custom:deepseek
  model: deepseek-v4-flash
custom_providers:
- name: deepseek
  base_url: https://api.deepseek.com/v1
  model: deepseek-v4-flash
  models:
    deepseek-v4-flash: {}
    deepseek-v4-pro: {}
- name: agnes
  base_url: https://apihub.agnes-ai.com/v1
  model: agnes-2.0-flash
  models:
    agnes-2.0-flash: {}
    agnes-2.0-pro: {}
    agnes-2.0-lite: {}
`;

const joveLikeConfig = `
model:
  default: deepseek-v4-flash
  provider: custom
  base_url: https://api.deepseek.com/v1
  api_key: \${DEEPSEEK_API_KEY}
fallback_providers:
- provider: custom:agnes
  model: agnes-2.0-flash
custom_providers:
- name: agnes
  base_url: https://apihub.agnes-ai.com/v1
  api_key: test-agnes-key
  model: agnes-2.0-flash
- name: deepseek
  base_url: https://api.deepseek.com/v1
  api_key: \${DEEPSEEK_API_KEY}
  model: deepseek-v4-flash
`;

describe('profileModels', () => {
    it('parseModelsFromConfigYaml collects primary, fallback, and custom provider models', () => {
        const models = parseModelsFromConfigYaml(sampleDefaultConfig);
        assert.deepStrictEqual(
            models.map(m => m.name).sort(),
            [
                'agnes-2.0-flash',
                'agnes-2.0-lite',
                'agnes-2.0-pro',
                'deepseek-v4-flash',
                'deepseek-v4-pro',
            ]
        );
    });

    it('parseProviderDrafts merges primary deepseek endpoint with custom_providers deepseek', () => {
        const drafts = parseProviderDrafts(joveLikeConfig);
        const deepseek = drafts.find(d => d.name === 'DeepSeek');
        assert.ok(deepseek);
        assert.strictEqual(deepseek!.isPrimary, true);
        assert.ok(deepseek!.modelNames.includes('deepseek-v4-flash'));
        const agnes = drafts.find(d => d.name === 'Agnes');
        assert.ok(agnes);
        assert.ok(agnes!.modelNames.includes('agnes-2.0-flash'));
    });

    it('buildProfileModelCatalog probes live /v1/models when api key is available', async () => {
        const originalFetch = global.fetch;
        process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
        global.fetch = (async (input: string | URL) => {
            const url = String(input);
            if (url.includes('api.deepseek.com')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            data: [
                                { id: 'deepseek-v4-flash' },
                                { id: 'deepseek-v4-pro' },
                            ],
                        };
                    },
                } as unknown as Response;
            }
            if (url.includes('agnes-ai.com')) {
                return {
                    ok: true,
                    async json() {
                        return {
                            data: [
                                { id: 'agnes-2.0-flash' },
                                { id: 'agnes-2.0-pro' },
                            ],
                        };
                    },
                } as unknown as Response;
            }
            return { ok: false, async json() { return {}; } } as unknown as Response;
        }) as typeof fetch;

        try {
            const catalog = await buildProfileModelCatalog(joveLikeConfig, { probeLive: true });
            const deepseek = catalog.groups.find(g => g.name === 'DeepSeek');
            assert.ok(deepseek);
            assert.deepStrictEqual(
                deepseek!.models.map(m => m.name).sort(),
                ['deepseek-v4-flash', 'deepseek-v4-pro']
            );
            const agnes = catalog.groups.find(g => g.name === 'Agnes');
            assert.ok(agnes);
            assert.deepStrictEqual(
                agnes!.models.map(m => m.name).sort(),
                ['agnes-2.0-flash', 'agnes-2.0-pro']
            );
            assert.strictEqual(deepseek!.isPrimary, true);
            assert.strictEqual(catalog.profileDefault?.modelName, 'deepseek-v4-flash');
            assert.strictEqual(catalog.profileDefault?.valueId, 'deepseek:deepseek-v4-flash');
        } finally {
            global.fetch = originalFetch;
            delete process.env.DEEPSEEK_API_KEY;
        }
    });

    it('formatProviderDisplayName prettifies provider names', () => {
        assert.strictEqual(formatProviderDisplayName('deepseek'), 'DeepSeek');
        assert.strictEqual(formatProviderDisplayName('agnes'), 'Agnes');
    });

    it('inferNameFromUrl maps known hosts', () => {
        assert.strictEqual(inferNameFromUrl('https://api.deepseek.com/v1'), 'DeepSeek');
        assert.strictEqual(inferNameFromUrl('https://apihub.agnes-ai.com/v1'), 'Agnes');
    });
});
