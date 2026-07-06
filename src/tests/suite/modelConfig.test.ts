import { describe, it } from 'mocha';
import assert from 'assert';
import {
    buildFallbackModelListState,
    buildModelListState,
    buildModelListStateFromHermesModels,
    buildModelListStateFromSessionResponse,
    buildModelListStateFromCatalog,
    enrichModelListState,
    encodeHermesModelValueId,
    flattenSelectOptions,
    findModelConfigOption,
    HERMES_MODEL_CONFIG_ID,
    SETTINGS_MODEL_CONFIG_ID,
    isHermesModelValueId,
    shouldUseHermesSetModel,
} from '../../acp/modelConfig';

describe('modelConfig', () => {
    it('flattenSelectOptions handles flat and grouped options', () => {
        const flat = flattenSelectOptions([
            { value: 'a', name: 'Model A' },
            { value: 'b', name: 'Model B' },
        ]);
        assert.strictEqual(flat.length, 2);
        assert.strictEqual(flat[0].valueId, 'a');

        const grouped = flattenSelectOptions([
            {
                group: 'g1',
                name: 'Group',
                options: [{ value: 'x', name: 'X' }],
            },
        ]);
        assert.strictEqual(grouped.length, 1);
        assert.strictEqual(grouped[0].name, 'X');
    });

    it('findModelConfigOption prefers category model', () => {
        const opts = [
            { id: 'mode', type: 'select', name: 'Mode', options: [] },
            { id: 'model', type: 'select', category: 'model', name: 'Model', options: [] },
        ];
        const found = findModelConfigOption(opts);
        assert.strictEqual(found?.id, 'model');
    });

    it('buildModelListState returns current label', () => {
        const state = buildModelListState([
            {
                id: 'model',
                type: 'select',
                category: 'model',
                name: 'Model',
                currentValue: 'gpt-4',
                options: [
                    { value: 'gpt-4', name: 'GPT-4' },
                    { value: 'gpt-3.5', name: 'GPT-3.5' },
                ],
            },
        ]);
        assert.ok(state);
        assert.strictEqual(state!.currentLabel, 'GPT-4');
        assert.strictEqual(state!.models.length, 2);
        assert.strictEqual(state!.fromAgent, true);
    });

    it('buildFallbackModelListState uses settings list', () => {
        const state = buildFallbackModelListState(
            [
                { id: 'fast', name: 'Fast' },
                { id: 'smart', name: 'Smart' },
            ],
            'smart'
        );
        assert.ok(state);
        assert.strictEqual(state!.fromAgent, false);
        assert.strictEqual(state!.currentLabel, 'Smart');
        assert.strictEqual(state!.configId, SETTINGS_MODEL_CONFIG_ID);
    });

    it('buildModelListStateFromHermesModels parses Hermes ACP models field', () => {
        const state = buildModelListStateFromHermesModels({
            currentModelId: 'deepseek:deepseek-v4-flash',
            availableModels: [
                { modelId: 'deepseek:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                { modelId: 'deepseek:deepseek-v4-pro', name: 'deepseek-v4-pro' },
            ],
        });
        assert.ok(state);
        assert.strictEqual(state!.configId, HERMES_MODEL_CONFIG_ID);
        assert.strictEqual(state!.currentLabel, 'deepseek-v4-flash');
        assert.strictEqual(state!.models.length, 2);
        assert.strictEqual(state!.fromAgent, true);
    });

    it('buildModelListStateFromSessionResponse prefers configOptions then models', () => {
        const fromHermes = buildModelListStateFromSessionResponse({
            models: {
                currentModelId: 'm1',
                availableModels: [{ modelId: 'm1', name: 'Model 1' }],
            },
        });
        assert.strictEqual(fromHermes!.configId, HERMES_MODEL_CONFIG_ID);

        const fromConfig = buildModelListStateFromSessionResponse({
            configOptions: [{
                id: 'model',
                type: 'select',
                category: 'model',
                name: 'Model',
                currentValue: 'a',
                options: [{ value: 'a', name: 'A' }],
            }],
            models: {
                currentModelId: 'm1',
                availableModels: [{ modelId: 'm1', name: 'Model 1' }],
            },
        });
        assert.strictEqual(fromConfig!.configId, 'model');
    });

    it('isHermesModelValueId detects provider-prefixed ids', () => {
        assert.strictEqual(isHermesModelValueId('deepseek:deepseek-v4-pro'), true);
        assert.strictEqual(isHermesModelValueId('gpt-4'), false);
    });

    it('shouldUseHermesSetModel routes Hermes native models', () => {
        assert.strictEqual(
            shouldUseHermesSetModel(HERMES_MODEL_CONFIG_ID, null, null, 'deepseek:model'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('', { configId: HERMES_MODEL_CONFIG_ID, currentValueId: '', currentLabel: '', models: [], fromAgent: true }, null, 'x'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('', null, [{ id: 'a', name: 'A' }], 'gpt-4'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('', null, null, 'deepseek:model'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('model-config', { configId: 'model-config', currentValueId: 'gpt-4', currentLabel: 'GPT-4', models: [], fromAgent: true }, null, 'gpt-4'),
            false
        );
    });

    it('encodeHermesModelValueId builds custom provider ids', () => {
        assert.strictEqual(encodeHermesModelValueId('custom', 'agnes-2.0-flash'), 'custom:agnes-2.0-flash');
        // Strips ``custom:`` prefix so the Hermes agent parses the correct provider name.
        assert.strictEqual(encodeHermesModelValueId('custom:deepseek', 'deepseek-v4-flash'), 'deepseek:deepseek-v4-flash');
    });

    it('enrichModelListState merges profile-configured models', () => {
        const state = buildModelListStateFromHermesModels({
            currentModelId: 'custom:agnes-2.0-flash',
            availableModels: [{ modelId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' }],
        });
        const enriched = enrichModelListState(state, [
            { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
        ]);
        assert.strictEqual(enriched!.models.length, 2);
        assert.strictEqual(enriched!.currentLabel, 'agnes-2.0-flash');
    });

    it('buildModelListStateFromCatalog builds grouped picker state', () => {
        const built = buildModelListStateFromCatalog(
            {
                groups: [
                    {
                        slug: 'custom:deepseek',
                        name: 'DeepSeek',
                        isPrimary: true,
                        models: [
                            { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                            { valueId: 'custom:deepseek-v4-pro', name: 'deepseek-v4-pro' },
                        ],
                    },
                    {
                        slug: 'custom:agnes',
                        name: 'Agnes',
                        models: [{ valueId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' }],
                    },
                ],
                flatModels: [],
                profileDefault: {
                    modelName: 'deepseek-v4-flash',
                    valueId: 'custom:deepseek-v4-flash',
                    groupSlug: 'custom:deepseek',
                },
            },
            buildModelListStateFromHermesModels({
                currentModelId: 'custom:agnes-2.0-flash',
                availableModels: [{ modelId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' }],
            })
        );
        assert.ok(built);
        assert.strictEqual(built!.groups!.length, 2);
        assert.strictEqual(built!.models.length, 3);
        assert.strictEqual(built!.currentLabel, 'deepseek-v4-flash');
    });

    it('buildModelListStateFromCatalog prefers saved model over profile default', () => {
        const built = buildModelListStateFromCatalog(
            {
                groups: [
                    {
                        slug: 'custom:deepseek',
                        name: 'DeepSeek',
                        isPrimary: true,
                        models: [
                            { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                            { valueId: 'custom:deepseek-v4-pro', name: 'deepseek-v4-pro' },
                        ],
                    },
                ],
                flatModels: [],
                profileDefault: {
                    modelName: 'deepseek-v4-flash',
                    valueId: 'custom:deepseek-v4-flash',
                    groupSlug: 'custom:deepseek',
                },
            },
            null,
            { modelId: 'custom:deepseek-v4-pro', modelLabel: 'deepseek-v4-pro' }
        );
        assert.strictEqual(built!.currentValueId, 'custom:deepseek-v4-pro');
    });
});
