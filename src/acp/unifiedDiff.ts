/**
 * Unified-diff (hunk) parsing for propose_diff / apply_diff.
 *
 * Historically these tools took the *entire* new file as `content` and did a
 * whole-file replace. That silently destroyed files whenever `content` was only
 * a snippet (the classic "diff logic" footgun). This module lets callers pass a
 * proper unified diff instead, and applies it surgically.
 *
 * Supported input shapes for `content`:
 *   1. A real unified diff, e.g.:
 *        *** Begin Patch
 *        *** Update File: path/to/file
 *        @@ context hint @@
 *         context line
 *        -removed line
 *        +added line
 *        *** End Patch
 *      (the `*** Begin Patch` / V4A wrapper is tolerated and stripped)
 *   2. A bare unified diff (starts with `@@` hunks or with `-`/`+` lines).
 *   3. A full file (no diff markers) — falls back to whole-file replace,
 *      guarded by the caller against data loss.
 *
 * Pure module: NO `vscode` import, so it can be unit-tested headlessly.
 */

export interface DiffResult {
  /** True when `content` was detected as a real (partial) diff. */
  isDiff: boolean;
  /** True when `content` looked like a whole file (no diff markers). */
  isWholeFile: boolean;
  /**
   * The merged file text (original with hunks applied). Only meaningful when
   * `isDiff` is true. For whole-file input this equals `content`.
   */
  merged: string;
  /** Number of context/added/removed lines applied (diagnostics). */
  hunksApplied: number;
  /** Human-readable reason if parsing failed. */
  error?: string;
}

const V4A_BEGIN = '*** Begin Patch';
const V4A_END = '*** End Patch';

function stripV4AWrapper(text: string): string {
  const beginIdx = text.indexOf(V4A_BEGIN);
  if (beginIdx === -1) {
    return text;
  }
  // Take everything after the Begin line; drop the End line if present.
  const afterBegin = text.slice(beginIdx + V4A_BEGIN.length);
  const endIdx = afterBegin.indexOf(V4A_END);
  const core = endIdx === -1 ? afterBegin : afterBegin.slice(0, endIdx);
  return core;
}

function looksLikeDiff(text: string): boolean {
  if (text.includes(V4A_BEGIN)) {
    return true;
  }
  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // Standard unified-diff hunk header.
    if (/^@@\s+-?\d+(,\d+)?\s+\+\d+(,\d+)?\s+@@/.test(line)) {
      return true;
    }
    // A line that is clearly a diff op (and not just empty / whitespace).
    if (/^[-+]\s?/.test(line) && line.trim() !== '') {
      return true;
    }
  }
  return false;
}

/**
 * Apply a unified diff to `original` and return the merged text.
 * Throws Error on malformed hunks (so callers can surface a clear message).
 */
export function applyUnifiedDiff(original: string, diffText: string): string {
  let core = stripV4AWrapper(diffText);
  // Drop any "*** Update File: ..." / "*** Add File: ..." / "*** Delete File: ..."
  // directive lines — they carry no hunk content.
  core = core
    .split('\n')
    .filter((l) => !/^\*\*\*\s+(Update|Add|Delete)\s+File:/.test(l.replace(/\r$/, '')))
    .join('\n');

  const origLines = original.split('\n');
  const diffLines = core.split('\n').map((l) => l.replace(/\r$/, ''));

  const result: string[] = [];
  let origIdx = 0; // index into origLines we expect to be at next
  let hunksApplied = 0;
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    // Skip blank / non-hunk preamble lines between hunks.
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }

    // Parse hunk header: @@ -l,s +l,s @@
    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!m) {
      throw new Error(`Malformed hunk header: "${line}"`);
    }
    const oldStart = parseInt(m[1], 10); // 1-based
    const newStart = parseInt(m[3], 10); // 1-based

    // Copy unchanged lines up to (oldStart - 1).
    const targetOrigIdx = oldStart - 1;
    if (targetOrigIdx < origIdx) {
      throw new Error(
        `Hunk starts at original line ${oldStart} but we are already at line ${origIdx + 1} — overlapping or out-of-order hunks.`,
      );
    }
    while (origIdx < targetOrigIdx) {
      result.push(origLines[origIdx]);
      origIdx++;
    }

    i++; // move past hunk header
    // Apply the hunk body until the next hunk header or EOF.
    while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
      const bodyLine = diffLines[i];
      const op = bodyLine.charAt(0);

      if (op === ' ') {
        // Context line — must match original at origIdx.
        const expected = origLines[origIdx];
        const content = bodyLine.slice(1);
        if (expected !== content) {
          throw new Error(
            `Context mismatch at original line ${origIdx + 1}: expected "${expected}" but diff has "${content}".`,
          );
        }
        result.push(content);
        origIdx++;
      } else if (op === '-') {
        // Removal — must match original at origIdx.
        const expected = origLines[origIdx];
        const content = bodyLine.slice(1);
        if (expected !== content) {
          throw new Error(
            `Removal mismatch at original line ${origIdx + 1}: expected "${expected}" but diff removes "${content}".`,
          );
        }
        origIdx++; // consume from original, don't copy to result
      } else if (op === '+') {
        // Addition — copy to result, don't consume original.
        result.push(bodyLine.slice(1));
      } else if (bodyLine.trim() === '') {
        // Blank line inside hunk body: treat as context if original matches,
        // else as addition. Heuristic: if original at origIdx is blank, match it.
        if (origLines[origIdx] === '') {
          result.push('');
          origIdx++;
        } else {
          result.push('');
        }
      } else {
        // Stray line inside hunk body — fail loudly rather than silently corrupt.
        throw new Error(`Unexpected line inside hunk: "${bodyLine}"`);
      }
      i++;
    }
    hunksApplied++;
  }

  // Append any remaining original lines after the last hunk.
  while (origIdx < origLines.length) {
    result.push(origLines[origIdx]);
    origIdx++;
  }

  return result.join('\n');
}

/**
 * Classify `content` and, if it is a diff, produce the merged text.
 * `original` is the current on-disk file ('' if the file is new).
 */
export function resolveDiff(content: string, original: string): DiffResult {
  if (looksLikeDiff(content)) {
    try {
      const merged = applyUnifiedDiff(original, content);
      return { isDiff: true, isWholeFile: false, merged, hunksApplied: 1 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isDiff: true, isWholeFile: false, merged: '', hunksApplied: 0, error: msg };
    }
  }
  // Not a diff → treat as a whole-file replacement.
  return { isDiff: false, isWholeFile: true, merged: content, hunksApplied: 0 };
}
