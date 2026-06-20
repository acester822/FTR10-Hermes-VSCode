import { describe, it } from 'mocha';
import assert from 'assert';
import { parseProfileListOutput } from '../../acp/profileDiscovery';

describe('profileDiscovery', () => {
    it('parseProfileListOutput extracts profile ids and puts default first', () => {
        const sample = `
 Profile          Model                        Gateway      Alias
 ───────────────    ───────────────────────────    ───────────    ───────────
  default         agnes-2.0-flash              running      —
 ◆jove            deepseek-v4-flash            running      jove
  rina            deepseek-v4-flash            running      rina
`;
        const profiles = parseProfileListOutput(sample);
        assert.deepStrictEqual(profiles, ['default', 'jove', 'rina']);
    });

    it('parseProfileListOutput returns default when output is empty', () => {
        assert.deepStrictEqual(parseProfileListOutput(''), ['default']);
    });
});
