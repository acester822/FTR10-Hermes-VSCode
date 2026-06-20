import { describe, it } from 'mocha';
import assert from 'assert';
import { sliceTextByLines } from '../../acp/fsRead';
import { parsePlanSessionUpdate } from '../../acp/planUpdate';
import { parseElicitationFormFields } from '../../acp/elicitationBridge';

describe('fsRead', () => {
    it('sliceTextByLines returns full content when no range', () => {
        assert.strictEqual(sliceTextByLines('a\nb\nc'), 'a\nb\nc');
    });

    it('sliceTextByLines reads from line with limit', () => {
        assert.strictEqual(sliceTextByLines('a\nb\nc\nd', 2, 2), 'b\nc');
    });
});

describe('parsePlanSessionUpdate', () => {
    it('parses plan entries on root update', () => {
        const plan = parsePlanSessionUpdate({
            entries: [
                { content: 'Step 1', status: 'pending', priority: 'high' },
                { content: 'Step 2', status: 'in_progress' },
            ],
        }, 'plan');
        assert.ok(plan);
        assert.strictEqual(plan!.entries!.length, 2);
        assert.strictEqual(plan!.entries![0].content, 'Step 1');
    });

    it('parses plan_update items payload', () => {
        const plan = parsePlanSessionUpdate({
            plan: {
                type: 'items',
                id: 'plan-1',
                entries: [{ content: 'Deploy', status: 'completed' }],
            },
        }, 'plan_update');
        assert.ok(plan);
        assert.strictEqual(plan!.planId, 'plan-1');
        assert.strictEqual(plan!.entries![0].status, 'completed');
    });

    it('parses markdown plan fallback', () => {
        const plan = parsePlanSessionUpdate({
            content: { type: 'text', text: '1. Analyze\n2. Fix' },
        }, 'plan');
        assert.ok(plan);
        assert.strictEqual(plan!.markdown, '1. Analyze\n2. Fix');
    });

    it('handles plan_removed', () => {
        const plan = parsePlanSessionUpdate({ id: 'plan-x' }, 'plan_removed');
        assert.deepStrictEqual(plan, { planId: 'plan-x', removed: true });
    });
});

describe('parseElicitationFormFields', () => {
    it('maps schema properties to form fields', () => {
        const fields = parseElicitationFormFields({
            type: 'object',
            required: ['name'],
            properties: {
                name: { type: 'string', title: 'Name' },
                count: { type: 'integer', title: 'Count', default: 1 },
                role: { type: 'string', enum: ['admin', 'user'] },
            },
        });
        assert.strictEqual(fields.length, 3);
        assert.strictEqual(fields[0].name, 'name');
        assert.strictEqual(fields[0].required, true);
        assert.deepStrictEqual(fields[2].enum, ['admin', 'user']);
    });
});
