import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    activeSessionPathFor,
    migrateLegacySessionStorage,
    sanitizeProfileScopeKey,
    saveProfileState,
    loadProfileState,
    sessionsPathFor,
} from '../../chat/profileStorage';

describe('profileStorage', () => {
    it('sanitizeProfileScopeKey removes unsafe characters', () => {
        assert.strictEqual(sanitizeProfileScopeKey('jove'), 'jove');
        assert.strictEqual(sanitizeProfileScopeKey('a/b:c'), 'a_b_c');
        assert.strictEqual(sanitizeProfileScopeKey(''), '__default__');
    });

    it('stores sessions and profile state per scope', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profile-'));
        try {
            saveProfileState(dir, 'rina', { modelId: 'openai:gpt-4', modelLabel: 'GPT-4' });
            assert.deepStrictEqual(loadProfileState(dir, 'rina'), {
                modelId: 'openai:gpt-4',
                modelLabel: 'GPT-4',
            });
            assert.deepStrictEqual(loadProfileState(dir, 'jove'), {});

            const sessions = [{ id: 'abc', title: 'Hi', createdAt: 1, updatedAt: 1, messageCount: 0 }];
            fs.writeFileSync(sessionsPathFor(dir, 'jove'), JSON.stringify(sessions));
            assert.strictEqual(
                JSON.parse(fs.readFileSync(sessionsPathFor(dir, 'jove'), 'utf-8'))[0].title,
                'Hi'
            );
            assert.strictEqual(fs.existsSync(sessionsPathFor(dir, 'rina')), false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('migrateLegacySessionStorage moves global files once', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-legacy-'));
        try {
            fs.writeFileSync(path.join(dir, 'sessions.json'), '[]');
            fs.writeFileSync(path.join(dir, 'active-session.txt'), 'abc');
            migrateLegacySessionStorage(dir, '__default__');
            assert.strictEqual(fs.existsSync(path.join(dir, 'sessions.json')), false);
            assert.strictEqual(
                fs.readFileSync(activeSessionPathFor(dir, '__default__'), 'utf-8'),
                'abc'
            );
            migrateLegacySessionStorage(dir, '__default__');
            assert.strictEqual(fs.existsSync(sessionsPathFor(dir, '__default__')), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
