import { describe, it } from 'mocha';
import assert from 'assert';

// Test the state machine transition validation logic
// (replicating the VALID transitions from AcpClient for standalone testing)
type AcpStatus = 'idle' | 'connecting' | 'ready' | 'prompting' | 'error';

const VALID: Record<AcpStatus, AcpStatus[]> = {
    idle:        ['connecting'],
    connecting:  ['ready', 'error'],
    ready:       ['prompting', 'error', 'idle'],
    prompting:   ['ready', 'error', 'idle'],
    error:       ['connecting', 'idle'],
};

function canTransition(from: AcpStatus, to: AcpStatus): boolean {
    return VALID[from]?.includes(to) ?? false;
}

describe('State Machine', () => {
    it('idle can only go to connecting', () => {
        assert.strictEqual(canTransition('idle', 'connecting'), true);
        assert.strictEqual(canTransition('idle', 'ready'), false);
        assert.strictEqual(canTransition('idle', 'error'), false);
    });

    it('connecting can go to ready or error', () => {
        assert.strictEqual(canTransition('connecting', 'ready'), true);
        assert.strictEqual(canTransition('connecting', 'error'), true);
        assert.strictEqual(canTransition('connecting', 'idle'), false);
    });

    it('ready can go to prompting, error, or idle', () => {
        assert.strictEqual(canTransition('ready', 'prompting'), true);
        assert.strictEqual(canTransition('ready', 'error'), true);
        assert.strictEqual(canTransition('ready', 'idle'), true);
        assert.strictEqual(canTransition('ready', 'connecting'), false);
    });

    it('prompting can go to ready, error, or idle', () => {
        assert.strictEqual(canTransition('prompting', 'ready'), true);
        assert.strictEqual(canTransition('prompting', 'error'), true);
        assert.strictEqual(canTransition('prompting', 'idle'), true);
        assert.strictEqual(canTransition('prompting', 'connecting'), false);
    });

    it('error can go to connecting or idle', () => {
        assert.strictEqual(canTransition('error', 'connecting'), true);
        assert.strictEqual(canTransition('error', 'idle'), true);
        assert.strictEqual(canTransition('error', 'ready'), false);
    });

    it('full lifecycle: idle → connecting → ready → prompting → ready', () => {
        assert.strictEqual(canTransition('idle', 'connecting'), true);
        assert.strictEqual(canTransition('connecting', 'ready'), true);
        assert.strictEqual(canTransition('ready', 'prompting'), true);
        assert.strictEqual(canTransition('prompting', 'ready'), true);
    });

    it('error recovery: error → connecting → ready', () => {
        assert.strictEqual(canTransition('error', 'connecting'), true);
        assert.strictEqual(canTransition('connecting', 'ready'), true);
    });
});
