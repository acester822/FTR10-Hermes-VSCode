# FTR10 Feature Changes — Consolidated Summary (8 worktrees)

**Base commit:** `152c712` (`feat(chat): drag-and-drop any file type from explorer into composer`) — this is also `master` HEAD and the fork point for all 8 branches.
**Generated:** 2026-07-10 — verified by `git diff --stat 152c712..<branch>` plus a real dry-run merge of all 8 branches into a throwaway worktree (no `master` / feature branch was modified).

---

## Per-feature breakdown

### 1. wt/v2-mojibake  (commit `f14d62b`)
**Files changed (vs 152c712):**
```
 src/acp/AcpClient.ts               | 24 ++++++++------  (28+ / 16-)
 src/acp/hermesEnvironmentDetect.ts | 16 ++++++--------  (16+ / 16-)
 src/acp/profileDiscovery.ts        |  4 ++--          (4+ / 4-)
 3 files changed, 28 insertions(+), 16 deletions(-)
```
**What changed:** Fixes streaming mojibake at the root — the spawned `hermes acp` child inherited a non-UTF-8 locale/console encoding and mangled UTF-8 at the OS stdio layer. Forces `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` (plus `LANG`/`LC_ALL` → `C.UTF-8`) on the spawned-child env, and makes every subprocess stdout/stderr reader use explicit `Buffer.toString('utf-8')`.
**Risk:** **None.** Lives entirely under `src/acp/` and touches no webview/shared files. The only caveat is the 4 pre-existing i18n type errors at HEAD (missing `imageNoData`/`imageReadError`/`imageWriteError`) — out of scope for this task and present on the base.

### 2. wt/v2-reasoning-effort  (commit `81cba68`)
**Files changed:**
```
 media/chat.css                 |  81 +++++
 media/chat.html                |  11 +
 media/chat.js                  | 113 +++++
 package.json                   |  21 +
 package.nls.json               |   7 +
 src/chat/HermesChatProvider.ts |  41 +-
 src/i18n/locales/en.ts         |   7 +
 src/i18n/locales/zh-cn.ts      |   7 +
 src/i18n/types.ts              |   9 +
 9 files changed, 295 insertions(+), 2 deletions(-)
```
**What changed:** Adds a Reasoning Effort picker (None/Minimal/Low/Medium/High/X-High) to the chat input action bar beside the permission-mode picker. Mirrors the permission picker's open/close/position behaviour, persists to `hermes.reasoningEffort`, and pushes changes live via a `reasoningEffortChange` message → `_handleReasoningEffortChange` runs `hermes config set agent.reasoning_effort`. Registers a new setting in `package.json`/`package.nls.json`.
**Risk:** **Broadest overlap of any branch.** Touches `chat.html`, `chat.css`, `chat.js`, `HermesChatProvider.ts`, and all three i18n files. Will conflict with `wt/v2-header` (chat.html), `wt/v2-copy` (chat.js), and `wt/v2-download` (chat.html + i18n). All conflicts are additive (distinct additions) — see merge order below.

### 3. wt/v2-step-graph  (commit `207a3e6`)
**Files changed:**
```
 media/chat.css  |  76 +++----
 media/chat.html |  13 +---
 media/chat.js   | 175 ++++++++++++
 3 files changed, 223 insertions(+), 41 deletions(-)
```
**What changed:** Six webview-only Step Usage Graph fixes: (a) `mcp__vscode__propose_diff` + `skills_list` rendered as bar segments + legend swatches; (b) `step_kind` normalized via `KIND_ALIAS` into canonical kinds, deterministically coloured (think=purple `#8b5cf6`, no brown); (c) bar height scales strictly proportionally to token cost; (d) scrollbar hidden while the row stays scrollable; (e) cache read/write/hit-rate added to summary + tooltips; (f) clickable "Session summary" toggle revealing model/steps/in-out-reason tokens/cache R/W/hit%.
**Risk:** Moderate. Touches `chat.css`, `chat.html`, `chat.js`. In the verified merge order it merged **clean** because its edits land in the step-graph section, away from the quick-actions/`closeAllDropdowns` regions. If merged *after* `wt/v2-copy` or `wt/v2-reasoning-effort` it would conflict on `chat.js` (same handler regions).

### 4. wt/v2-header  (commit `86fe444`)
**Files changed:**
```
 media/chat.css  |  9 +++----
 media/chat.html | 62 +++++++++++++++---------------
 2 files changed, 40 insertions(+), 31 deletions(-)
```
**What changed:** Adds a session header bar (`#sessionHeader`) under the title/tab-bar showing the session name + index (#), and moves the context-usage meter and Quick Actions trigger + popup up into it. Pure markup + CSS — no TS/JS logic change (the provider already posted `sessionList` and `chat.js`'s `updateSessionHeader()` already existed).
**Risk:** Low–moderate. Edits `chat.html` in the input-bar / quick-actions area, which collides with `wt/v2-reasoning-effort`'s quick-actions trigger addition. Additive — both changes must be kept.

### 5. wt/v2-image-expand  (commit `8feee1a`)
**Files changed:**
```
 media/chat.css                 | 36 +++
 media/chat.js                  | 16 +-
 src/chat/HermesChatProvider.ts | 10 +-
 src/i18n/locales/en.ts         |  4 +
 src/i18n/locales/zh-cn.ts      |  4 +
 src/i18n/types.ts              |  4 +
 6 files changed, 71 insertions(+), 3 deletions(-)
```
**What changed:** Adds a "+" magnifier overlay on hover over chat images; clicking it (or the image) posts `openImage`; `_handleOpenImage` now opens the materialized bytes in the native VS Code image viewer via `vscode.open` (zoomable) instead of `showTextDocument` (binary garbage). Also adds the 4 previously-missing i18n keys (`imageNoData`/`imageReadError`/`imageWriteError` + `openImageInEditor`) so `tsc` compiles clean.
**Risk:** Low. Added the 4 i18n keys that every other branch was missing — merges clean early. `HermesChatProvider.ts` edits are in the `openImage` method, away from the reasoning/copy method edits, so no `HermesChatProvider.ts` conflict in practice.

### 6. wt/v2-drag-drop  (commit `3cf0503` on branch — implementation landed at base `152c712`)
**Files changed:**
```
 src/i18n/locales/en.ts    | 3 +
 src/i18n/locales/zh-cn.ts | 3 +
 src/i18n/types.ts         | 3 +
 3 files changed, 9 insertions(+)
```
**What changed:** Only the i18n key additions. The actual drag-and-drop implementation (accept any file from Explorer, images→base64, other files→text into `pendingFiles` + chips, `AcpClient.sendMessage` appends ACP `resource` blocks, history persists name+mime) was already committed at the base `152c712` by a prior worker; this branch just adds the locale strings so the code compiles clean.
**Risk:** **None functionally** — but it touches the three i18n files, which are a shared-conflict magnet (see group analysis). Merges clean when taken early.

### 7. wt/v2-copy  (commit `01b6bdf`)
**Files changed:**
```
 media/chat.css                 |  77 +++
 media/chat.html                |  20 +--
 media/chat.js                  | 113 +++++----
 src/chat/HermesChatProvider.ts |  51 +-
 src/i18n/locales/en.ts         |   4 +
 src/i18n/locales/zh-cn.ts      |   4 +
 src/i18n/types.ts              |   4 +
 7 files changed, 241 insertions(+), 32 deletions(-)
```
**What changed:** Fixes copy functions; routes clipboard writes through the host bridge and adds a markdown/json dropdown to "Copy Current Session". Reworks the copy button markup into a `copySessionPicker` with a caret and dropdown (markdown / json items), and adds the corresponding handlers + i18n keys (`copySessionOptions`/`copySessionAs`/`copyAsMarkdown`/`copyAsJson`).
**Risk:** Moderate–high. Touches `chat.html`, `chat.css`, `chat.js`, `HermesChatProvider.ts`, i18n. **Primary conflict partner is `wt/v2-download`** (both edit the copy button in `chat.html` and add adjacent i18n keys), plus a `chat.js` conflict with `wt/v2-reasoning-effort` (both add a dropdown-hide line in `closeAllDropdowns`). All additive.

### 8. wt/v2-download  (commit `9846924`)
**Files changed:**
```
 media/chat.html           |  3 +
 media/chat.js             |  8 +
 src/i18n/locales/en.ts    |  1 +
 src/i18n/locales/zh-cn.ts |  1 +
 src/i18n/types.ts         |  1 +
 5 files changed, 14 insertions(+)
```
**What changed:** Adds a "Download Session" button next to Copy in Quick Actions. Reuses the existing `_handleSessionExport('export')` mechanism, triggering a browser download of the current session as `.md`. Wires a new `#downloadSessionBtn` and the `downloadSession` i18n key.
**Risk:** **Highest conflict density.** Collides directly with `wt/v2-copy` in `chat.html` (copy-picker markup vs download button) and in all three i18n files (`copySessionOptions/copyAsMarkdown/copyAsJson` vs `downloadSession`). These are **additive** — both key sets and both buttons must be retained.

---

## Shared-file conflict map

Because all 8 branches fork from the **same base**, any two branches that edit the same file are potential conflict partners. Files touched by more than one branch:

| Shared file | Branches touching it | Conflict behaviour |
|---|---|---|
| `media/chat.html` | header, reasoning-effort, step-graph, copy, download (5) | Edits in distinct regions for most; real conflict **reasoning↔header** and **download↔copy** |
| `media/chat.css` | header, reasoning-effort, step-graph, copy, image-expand (5) | Mostly distinct CSS blocks; no conflict observed in dry-run |
| `media/chat.js` | reasoning-effort, step-graph, image-expand, copy, download (5) | Conflict **reasoning↔copy** in `closeAllDropdowns`; rest additive in distinct handlers |
| `src/chat/HermesChatProvider.ts` | reasoning-effort, image-expand, copy (3) | **Merged clean in dry-run** — each edits a different method region |
| `src/i18n/locales/en.ts` `zh-cn.ts` `types.ts` | reasoning-effort, image-expand, drag-drop, copy, download (5) | All additive keys; only **download↔copy** surfaces a conflict (others land on distinct lines) |
| `package.json` `package.nls.json` | reasoning-effort (1) | **Independent** — no other branch touches these |
| `src/acp/AcpClient.ts` `hermesEnvironmentDetect.ts` `profileDiscovery.ts` | mojibake (1) | **Independent** — no other branch touches these |

**Verified conflicts (dry-run merge in the order below): exactly 3 conflict points, all additive:**
1. `media/chat.html` — `reasoning-effort` vs already-merged `header` (reasoning picker + quick-actions trigger added next to header's moved quick-actions).
2. `media/chat.js` — `copy` vs already-merged `reasoning-effort` (both add a `dropdownEl.style.display='none'` line in `closeAllDropdowns`; reasoning adds `reasoningEffortDropdownEl`, copy adds `copySessionDropdown`/`copySessionPicker`).
3. `media/chat.html` + `src/i18n/locales/en.ts` + `zh-cn.ts` + `types.ts` — `download` vs already-merged `copy` (copy's picker markup/keys vs download's button/key).

---

## Recommended merge order

**Golden rule: do NOT use `git merge -X theirs` / `-X ours` on these conflicts.** Every conflict above is *additive* (both sides add distinct buttons/keys/handlers). `-X theirs` on the copy↔download conflict would silently **drop copy's dropdown keys** (`copySessionOptions`/`copyAsMarkdown`/`copyAsJson`) and the download↔copy chat.html section. Resolve each by taking **both** sides.

**Recommended order (minimises raw conflict count — verified to surface only the 3 additive conflicts above):**

```
1. wt/v2-mojibake        ← independent (src/acp only) — merge FIRST, zero risk
2. wt/v2-drag-drop       ← i18n-only additions; take early so later i18n merges are smaller
3. wt/v2-image-expand    ← webview + i18n (adds the 4 keys everyone was missing)
4. wt/v2-header          ← chat.html/chat.css
5. wt/v2-reasoning-effort← chat.html/chat.css/chat.js + setting (conflict #1: chat.html vs header)
6. wt/v2-step-graph      ← chat.css/chat.html/chat.js (merged clean in this position)
7. wt/v2-copy            ← chat.html/chat.css/chat.js/HermesChatProvider/i18n (conflict #2: chat.js vs reasoning)
8. wt/v2-download        ← chat.html/chat.js/i18n (conflict #3: chat.html + i18n vs copy)
```

**Why this order:**
- `mojibake` is genuinely isolated (separate directory) → zero chance of conflict, get it in first.
- `drag-drop` + `image-expand` land their i18n keys before the copy/download collision, so only the **copy↔download** i18n clash remains (one conflict instead of four).
- `header` before `reasoning-effort` keeps the input-bar/quick-actions chat.html edits adjacent (single additive conflict).
- `step-graph` before `copy` keeps it clear of copy's `chat.js` handler edits (verified clean).
- `copy` before `download` means download's chat.html/i18n edits are the last to land and conflict with copy's — both additive and easy to resolve in one place.

**Post-merge verification:** `npm run compile` should be clean (all 8 branches individually reported 0–4 TS errors, with the only residual being the pre-existing `image*` key type errors that `image-expand` actually fixed). Run `npm run test` (xvfb VS Code launch) — every branch passed 138/138 except `step-graph` (validated via a headless DOM harness instead, since it is cosmetic webview-only). Smoke-test the chat UI after merge to confirm the session header, reasoning picker, step graph, image magnifier, copy dropdown, and download button all coexist.
