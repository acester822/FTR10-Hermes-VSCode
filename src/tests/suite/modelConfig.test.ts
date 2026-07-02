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
    HERMES_MODEL_CONFIG_ID,
    shouldUseHermesSetModel,
    sortModelListItems,
    formatModelCost,
    isRuntimeModelSource,
    mergeModelListItems,
} from '../../acp/modelConfig';

describe('modelConfig', () => {
    it('encodeHermesModelValueId builds provider-prefixed ids', () => {
        assert.strictEqual(encodeHermesModelValueId('custom', 'agnes-2.0-flash'), 'custom:custom:agnes-2.0-flash');
        assert.strictEqual(encodeHermesModelValueId('custom:deepseek', 'deepseek-v4-flash'), 'custom:deepseek:deepseek-v4-flash');
        assert.strictEqual(encodeHermesModelValueId('', 'gpt-4'), 'gpt-4');
    });

    it('isRuntimeModelSource detects hermes config ids', () => {
        assert.strictEqual(isRuntimeModelSource('hermes'), true);
        assert.strictEqual(isRuntimeModelSource('hermes:something'), true);
        assert.strictEqual(isRuntimeModelSource(''), false);
        assert.strictEqual(isRuntimeModelSource('model-config'), false);
    });

    it('formatModelCost formats cost strings', () => {
        assert.strictEqual(formatModelCost(undefined), 'Unknown');
        assert.strictEqual(formatModelCost(0), 'Free');
        assert.strictEqual(formatModelCost(0.15), '$0.15/M');
        assert.strictEqual(formatModelCost(2.50), '$2.5/M');
    });

    it('sortModelListItems puts current first then by cost', () => {
        const items = [
            { valueId: 'a', name: 'Expensive', inputCost: 10 },
            { valueId: 'b', name: 'Cheap', inputCost: 0.5 },
            { valueId: 'c', name: 'Current', inputCost: 2 },
        ];
        const sorted = sortModelListItems(items, 'c');
        assert.strictEqual(sorted[0].valueId, 'c'); // current first
        assert.strictEqual(sorted[1].valueId, 'b'); // cheapest next
        assert.strictEqual(sorted[2].valueId, 'a'); // most expensive last
    });

    it('mergeModelListItems deduplicates by valueId', () => {
        const a = [
            { valueId: 'x', name: 'X' },
            { valueId: 'y', name: 'Y' },
        ];
        const b = [
            { valueId: 'y', name: 'Y (dup)' },
            { valueId: 'z', name: 'Z' },
        ];
        const merged = mergeModelListItems(a, b);
        assert.strictEqual(merged.length, 3);
        assert.strictEqual(merged[1].name, 'Y'); // a's version preserved
        assert.strictEqual(merged[2].valueId, 'z');
    });

    it('buildModelListState returns null for empty input', () => {
        assert.strictEqual(buildModelListState([]), null);
        assert.strictEqual(buildModelListState([{ id: '', name: '' }]), null);
    });

    it('buildModelListState parses config options with selected marker', () => {
        const state = buildModelListState([
            { id: 'gpt-4', name: 'GPT-4', current: true },
            { id: 'gpt-3.5', name: 'GPT-3.5' },
        ]);
        assert.ok(state);
        assert.strictEqual(state!.currentValueId, 'gpt-4');
        assert.strictEqual(state!.currentLabel, 'GPT-4');
        assert.strictEqual(state!.models.length, 2);
        assert.strictEqual(state!.fromAgent, false);
        assert.ok(state!.groups.length > 0);
    });

    it('buildFallbackModelListState uses provided list', () => {
        const state = buildFallbackModelListState(
            [
                { valueId: 'fast', name: 'Fast' },
                { valueId: 'smart', name: 'Smart' },
            ],
            'smart'
        );
        assert.ok(state);
        assert.strictEqual(state.fromAgent, false);
        assert.strictEqual(state.currentLabel, 'Smart');
        assert.strictEqual(state.currentValueId, 'smart');
        assert.strictEqual(state.models.length, 2);
    });

    it('buildModelListStateFromHermesModels parses Hermes ACP models field', () => {
        const state = buildModelListStateFromHermesModels({
            currentModelId: 'custom:deepseek-v4-flash',
            availableModels: [
                { modelId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                { modelId: 'custom:deepseek-v4-pro', name: 'deepseek-v4-pro' },
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
        assert.ok(fromHermes);
        assert.strictEqual(fromHermes!.configId, HERMES_MODEL_CONFIG_ID);

        const fromConfig = buildModelListStateFromSessionResponse({
            configOptions: [{ id: 'gpt-4', name: 'GPT-4', current: true }],
            models: {
                currentModelId: 'm1',
                availableModels: [{ modelId: 'm1', name: 'Model 1' }],
            },
        });
        assert.ok(fromConfig);
        assert.strictEqual(fromConfig!.currentValueId, 'gpt-4');
    });

    it('shouldUseHermesSetModel routes Hermes native models', () => {
        assert.strictEqual(
            shouldUseHermesSetModel(HERMES_MODEL_CONFIG_ID, null, null, 'deepseek:model'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('', {
                configId: HERMES_MODEL_CONFIG_ID,
                currentValueId: '',
                currentLabel: '',
                models: [],
                groups: [],
                fromAgent: true,
            }, null, 'x'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('', null, { availableModels: [] }, 'gpt-4'),
            true
        );
        assert.strictEqual(
            shouldUseHermesSetModel('model-config', null, null, 'deepseek:model'),
            false
        );
    });

    it('enrichModelListState merges additional models', () => {
        const state = buildModelListStateFromHermesModels({
            currentModelId: 'custom:agnes-2.0-flash',
            availableModels: [{ modelId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' }],
        });
        assert.ok(state);
        const enriched = enrichModelListState(state, [
            { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
        ]);
        assert.strictEqual(enriched.models.length, 2);
        assert.strictEqual(enriched.currentLabel, 'agnes-2.0-flash');
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
                        isPrimary: false,
                        models: [{ valueId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' }],
                    },
                ],
                flatModels: [
                    { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                    { valueId: 'custom:deepseek-v4-pro', name: 'deepseek-v4-pro' },
                    { valueId: 'custom:agnes-2.0-flash', name: 'agnes-2.0-flash' },
                ],
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
        assert.strictEqual(built.groups.length, 2);
        assert.strictEqual(built.models.length, 3);
        assert.strictEqual(built.currentLabel, 'agnes-2.0-flash');
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
                flatModels: [
                    { valueId: 'custom:deepseek-v4-flash', name: 'deepseek-v4-flash' },
                    { valueId: 'custom:deepseek-v4-pro', name: 'deepseek-v4-pro' },
                ],
                profileDefault: {
                    modelName: 'deepseek-v4-flash',
                    valueId: 'custom:deepseek-v4-flash',
                    groupSlug: 'custom:deepseek',
                },
            },
            null,
            { currentValueId: 'custom:deepseek-v4-pro' }
        );
        assert.strictEqual(built.currentValueId, 'custom:deepseek-v4-pro');
    });
});