import { describe, it } from 'mocha';
import assert from 'assert';
import { applyUnifiedDiff, resolveDiff } from '../../acp/unifiedDiff';

describe('unifiedDiff.applyUnifiedDiff', () => {
    it('applies a single add hunk surgically', () => {
        const original = 'line1\nline2\nline3\n';
        const diff = [
            '*** Begin Patch',
            '*** Update File: x.ts',
            '@@ -1,3 +1,4 @@',
            ' line1',
            '+line1.5',
            ' line2',
            ' line3',
            '*** End Patch',
        ].join('\n');
        const merged = applyUnifiedDiff(original, diff);
        assert.strictEqual(merged, 'line1\nline1.5\nline2\nline3\n');
    });

    it('applies a removal hunk without touching surrounding lines', () => {
        const original = 'a\nb\nc\nd\n';
        const diff = [
            '@@ -2,2 +2,1 @@',
            ' b',
            '-c',
            ' d',
        ].join('\n');
        assert.strictEqual(applyUnifiedDiff(original, diff), 'a\nb\nd\n');
    });

    it('applies multiple hunks in order', () => {
        const original = '1\n2\n3\n4\n5\n';
        const diff = [
            '@@ -1,2 +1,2 @@',
            ' 1',
            '-2',
            '+TWO',
            '@@ -4,2 +4,2 @@',
            ' 4',
            '-5',
            '+FIVE',
        ].join('\n');
        assert.strictEqual(applyUnifiedDiff(original, diff), '1\nTWO\n3\n4\nFIVE\n');
    });

    it('handles context-only diff (no change) preserving all lines', () => {
        const original = 'x\ny\nz\n';
        const diff = [
            '@@ -1,3 +1,3 @@',
            ' x',
            ' y',
            ' z',
        ].join('\n');
        assert.strictEqual(applyUnifiedDiff(original, diff), 'x\ny\nz\n');
    });

    it('throws on context mismatch with a clear message', () => {
        const original = 'real line\n';
        const diff = [
            '@@ -1,1 +1,1 @@',
            '-different line',
        ].join('\n');
        assert.throws(() => applyUnifiedDiff(original, diff), /Removal mismatch/);
    });

    it('throws on a malformed hunk header', () => {
        const diff = '@@ not a real header @@\n line';
        assert.throws(() => applyUnifiedDiff('line\n', diff), /Malformed hunk header/);
    });
});

describe('unifiedDiff.resolveDiff', () => {
    it('detects a unified diff and merges it', () => {
        const original = 'keep\nold\nkeep\n';
        const content = '@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep\n';
        const r = resolveDiff(content, original);
        assert.strictEqual(r.isDiff, true);
        assert.strictEqual(r.isWholeFile, false);
        assert.strictEqual(r.error, undefined);
        assert.strictEqual(r.merged, 'keep\nnew\nkeep\n');
    });

    it('treats a full file as whole-file (not a diff)', () => {
        const original = 'a\nb\n';
        const content = 'c\nd\ne\n';
        const r = resolveDiff(content, original);
        assert.strictEqual(r.isDiff, false);
        assert.strictEqual(r.isWholeFile, true);
        assert.strictEqual(r.merged, content);
    });

    it('tolerates the V4A wrapper and file directives', () => {
        const original = 'one\ntwo\nthree\n';
        const content = [
            '*** Begin Patch',
            '*** Update File: foo.txt',
            '@@ -1,3 +1,3 @@',
            ' one',
            ' two',
            '-three',
            '+THREE',
            '*** End Patch',
        ].join('\n');
        const r = resolveDiff(content, original);
        assert.strictEqual(r.isDiff, true);
        assert.strictEqual(r.merged, 'one\ntwo\nTHREE\n');
    });

    it('reports an error for an undecidable/invalid diff instead of corrupting', () => {
        const original = 'only one line\n';
        const content = '@@ -1,1 +1,1 @@\n-this does not match\n';
        const r = resolveDiff(content, original);
        assert.strictEqual(r.isDiff, true);
        assert.ok(r.error, 'expected an error to be set');
    });
});
