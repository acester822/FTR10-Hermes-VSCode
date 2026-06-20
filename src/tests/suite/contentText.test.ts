import { describe, it } from 'mocha';
import assert from 'assert';
import { extractTextFromContentBlock } from '../../acp/contentText';

describe('extractTextFromContentBlock', () => {
    it('reads standard ACP text blocks', () => {
        assert.strictEqual(
            extractTextFromContentBlock({ type: 'text', text: 'hello' }),
            'hello'
        );
    });

    it('reads nested legacy content wrappers', () => {
        assert.strictEqual(
            extractTextFromContentBlock({ content: { type: 'text', text: 'nested' } }),
            'nested'
        );
    });

    it('reads plain strings', () => {
        assert.strictEqual(extractTextFromContentBlock('plain'), 'plain');
    });

    it('reads array content blocks', () => {
        assert.strictEqual(
            extractTextFromContentBlock([
                { type: 'text', text: 'a' },
                { type: 'text', text: 'b' },
            ]),
            'ab'
        );
    });

    it('reads assistant wrapper content', () => {
        assert.strictEqual(
            extractTextFromContentBlock({
                role: 'assistant',
                content: [{ type: 'text', text: 'wrapped' }],
            }),
            'wrapped'
        );
    });

    it('reads thought field', () => {
        assert.strictEqual(
            extractTextFromContentBlock({ thought: 'thinking...' }),
            'thinking...'
        );
    });

    it('returns empty for unknown shapes', () => {
        assert.strictEqual(extractTextFromContentBlock({ type: 'image' }), '');
    });
});
