<div align="center">

![FTR10 Hermes VSCode icon](media/icon.png)

# FTR10 Hermes VSCode

**Your [Hermes Agent](https://hermes-agent.nousresearch.com) lives in the editor now. No terminal. No context-switching. Just talk to your code.**

[中文文档](README.zh-CN.md) · [Issues & Releases](https://github.com/acester822/FTR10-Hermes-VSCode)

</div>

---

## Why this exists

You already run [Hermes Agent](https://hermes-agent.nousresearch.com) for real work. FTR10 Hermes VSCode stops making you *leave* your editor to use it. It connects to a local `hermes acp` subprocess over the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) and renders a full chat surface — streaming replies, one-click code insertion, diffs you can actually read — right in the sidebar.

This isn't a thin wrapper that pastes prompts. The agent sees your editor: the file you're on, the tabs you have open, your diagnostics, your cursor. You stay in flow; it does the heavy lifting.

---

## What you get

| Capability | What it means for you |
|------------|----------------------|
| **In-editor agent chat** | Sidebar conversation with real-time streaming Markdown. No alt-tab. |
| **Editor Tools Bridge** | Hermes reads your active file, open tabs, cursor, selection, and live diagnostics through an in-process MCP server — and can read/write workspace files. |
| **Model picker with live pricing** | Browse every model Hermes exposes, grouped by provider, with per-token output cost shown inline. Switch provider + model in one click. |
| **Profile auto-discovery** | Hermes profiles are detected from your config and surfaced as a one-tap selector. |
| **Permission modes** | `manual` / `autoApprove` / `yolo` / `denyAll` — decide how much the agent asks before it touches your system. |
| **Diff viewer** | Proposed changes render as a real diff. Preview, then apply to disk. |
| **Multi-session tabs** | Parallel conversations, persisted locally. Rename, delete, revisit. |
| **Context attachment** | Carry prior-session messages into a new chat so the agent isn't amnesiac. |
| **CodeLens** | "Ask Hermes about this file" and "Explain this" straight above functions and classes. |
| **Slash-command picker** | Type `/` for a live, filterable list of every command the agent advertises (`/help`, `/model`, `/reset`, `/context`, …). Arrow-key or click to complete — the command runs locally in the agent, no LLM round-trip. |
| **Bilingual UI** | English + 简体中文, following your VS Code display language. |

---

## Highlights

### 💬 Chat that keeps up with you
Streaming responses, syntax-highlighted code (marked + highlight.js, sanitized with DOMPurify), inline `@file` attachment, and click-to-insert code blocks. File paths in messages open in the editor. Shell commands from Hermes mirror into an integrated terminal.

### 🎛️ Model & profile control — with prices
The model dropdown auto-populates from Hermes's `configOptions` / native `session/set_model`. Models are grouped by provider; each row shows the **output cost per 1M tokens** so you can pick smart, not blind. Lost the scroll? It's back — long model lists scroll inside the panel again (fixed in this release).

Profiles are auto-discovered from your Hermes config and exposed as a quick-switch selector. No manual ID juggling.

### 🔌 Editor Tools Bridge (MCP)
At session start the extension registers a `vscode-editor-tools` MCP server the agent can query live:
- **Active editor** — path, language, cursor, selection, visible ranges, full content (files < 500 lines)
- **Open tabs** — labels, languages, dirty/pinned state
- **Diagnostics** — errors/warnings from your language servers
- **File ops** — read/write inside the workspace

### 🔍 CodeLens, minus the ceremony
- **"Ask Hermes about this file"** — top of every file; pre-fills a prompt about purpose, structure, and risks
- **"Explain this"** — above each `function`/`class`; explains that specific symbol

### ⚡ Slash commands, built in
Type `/` anywhere in the input and a glass popup lists every command the running Hermes agent advertises — name plus a one-line description, filtered live as you keep typing. ↑/↓ (or click) to highlight, **Enter**/**Tab** to complete to `/name `, **Esc** to dismiss. Commands execute locally inside the agent (e.g. `/reset` clears context, `/model` shows or switches the model), so they're instant and don't burn a model call. Unknown commands fall through to the model as plain text. The list is driven by the ACP `available_commands_update` message, so it always reflects what your Hermes build actually exposes.

### 🩹 Diff viewer
Hermes suggests a change → you see original vs. proposed → you apply. Commands: `hermes.showDiff`, `hermes.previewDiff`, `hermes.applyDiff`.

### 🧭 Control Center
An embedded Hermes dashboard panel for agent configuration, tools, and permissions — no browser tab required.

### 🛠️ Automatic environment detection
On connect the extension probes your Hermes install end-to-end: `hermes --version`, `hermes acp --check`, and auto-installs `agent-client-protocol` when missing. If anything is broken it surfaces a guided panel so you can fix it without leaving the editor.

### 📊 Visibility & diagnostics
- **Token usage ring + numeric readout** in the input bar — shows used / total and a filling bar gauge
- **Local-history badge** marking messages restored from storage (agent context resets on switch)
- **Thoughts & tool calls** — optional reasoning + tool notifications
- **Connection logs** — view/copy ACP logs from the toolbar

---

## Install

### Requirements
- **VS Code** 1.85+ or **Cursor**
- **[Hermes Agent](https://hermes-agent.nousresearch.com)** installed; `hermes` on `PATH` (or set `hermes.path`)
- Node + Python for ACP dependencies (auto-installed on first connect)

### From source (VS Code / Cursor)
This build is not yet published to the marketplace, so install it from the repository:

1. Clone the repo and open it in VS Code / Cursor.
2. Run the build: `npm install` then `npm run compile` for debugging, or `npm run package` to compile and generate the vsix.

---

## How to use it

**1. First run.** Open the Welcome view (`Ctrl+Shift+X` → Hermes icon) and follow the 3-step walkthrough: set your API key (VS Code Secret Storage), open the Control Center, start chatting.

**2. Open the panel.** Click the activity-bar **Hermes Agent** icon, or `Ctrl+Shift+P` → **Hermes: Open Chat**.

**3. Talk.** Wait for **Ready**, type, **Enter** to send (**Shift+Enter** for newline), **Stop** to cancel.

**4. Reference files.** Type `@` for the workspace file picker; click any path in a reply to open it.

**5. Run slash commands.** Type `/` for the command picker — a filterable list of every command the agent advertises (↑/↓ or click to highlight, **Enter**/**Tab** to complete, **Esc** to dismiss). Try `/help` to list them all, `/reset` to clear context, `/model` to inspect or switch the model.

**6. Send editor context.** Select code → right-click → **Hermes: Insert Selection into Chat**.

**7. CodeLens.** "Ask Hermes about this file" at a file's top; "Explain this" above any function/class.

**8. Sessions.** **+ New** for a fresh chat; switch tabs for history; rename/delete from the tab bar.
> Switching resets the agent's in-memory context. Restored messages are flagged with a **local-history** banner — the agent doesn't retain that context unless Hermes adds session restore.

**9. Switch model / profile.** Use the **Model** and **Profile** dropdowns in the toolbar. If Hermes exposes no list, configure fallback presets in Settings.

---

## Commands

| Command | Description |
|---------|-------------|
| `Hermes: New Chat` | Start a new conversation |
| `Hermes: Open Chat` | Open the chat sidebar |
| `Hermes: Insert Selection into Chat` | Send selected editor code to the chat input |
| `Hermes: Ask about this file` | Pre-fill a prompt about the active file |
| `Hermes: Explain this function` | Pre-fill a prompt to explain a code symbol |
| `Hermes: Show Diff` | Open a visual diff of proposed changes |
| `Hermes: Preview Hermes Changes` | Preview changes as a diff |
| `Hermes: Apply Hermes Changes` | Apply proposed changes to a file |
| `Hermes: Open Control Center` | Open the embedded Hermes dashboard |
| `Hermes: Set API Key` | Store an API key securely |
| `Hermes: Configure Environment` | Configure detected Hermes installation |
| `Hermes: Open Settings` | Open extension settings |
| `Hermes: Check for Updates` | Check for extension updates |
| `Hermes: Open Logs` | View ACP connection logs |
| `Hermes: Reload Extension` | Reload the extension |
| `Hermes: Reload Session` | Reload the current session |

---

## Settings

Open **Settings** (`Ctrl+,` / `Cmd+,`) and search **Hermes**, or use **More options → Settings** in the chat title bar.

| Setting | Description | Default |
|---------|-------------|---------|
| `hermes.path` | Path to Hermes executable | auto-detect |
| `hermes.cwd` | Working directory for sessions | workspace root |
| `hermes.profile` | Hermes profile name | default |
| `hermes.permissionMode` | `manual` / `autoApprove` / `yolo` / `denyAll` | `manual` |
| `hermes.showThoughts` | Show agent thinking process | `true` |
| `hermes.showToolCalls` | Show tool call notifications | `true` |
| `hermes.contextAttachVisibility` | When to show context attachment picker | `onNewSession` |
| `hermes.models` | Fallback model list when agent provides none | `[]` |
| `hermes.defaultModel` | Default model id (fallback list only) | `""` |
| `hermes.agents` | Named agent configurations for quick switching | `[]` |

**Permission modes**
- **Manual** (default) — you must approve or deny each request.
- **Auto Approve** — automatically approve all *non-destructive* requests. Destructive commands (e.g. `rm -rf` on the wrong directory, overwriting the wrong file) are held for your manual approval.
- **Yolo** — approve *everything* automatically, including destructive commands. Use with caution.
- **Deny All** — automatically deny all permission requests.

The selected mode is persisted across sessions.

**Multiple agents:**
```json
"hermes.agents": [
  { "name": "Default", "profile": "" },
  { "name": "Fast", "path": "/path/to/hermes", "profile": "fast" }
]
```

**Fallback models:**
```json
"hermes.models": [
  { "id": "claude-sonnet", "name": "Claude Sonnet" },
  { "id": "gpt-4o", "name": "GPT-4o" }
],
"hermes.defaultModel": "claude-sonnet"
```

Connection-related setting changes trigger an automatic reconnect.

---

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Stuck on **Connecting…** | Ensure `hermes` is on PATH or set `hermes.path` in Settings; the extension runs environment detection automatically on connect. |
| **ACP dependencies missing** | Detection runs `pip install agent-client-protocol==0.9.0` automatically; else `hermes acp --check` in a terminal |
| **Connection error** | Click **Retry** in the toolbar; check logs via **More options → Logs** |
| **Hermes is initializing…** | Normal on first message after connect — plugin load can take 1–3 min; wait or check logs |
| Model not listed | Add entries under `hermes.models` in Settings |
| **Settings** not opening in Cursor | Use **More options → Settings** in the chat title bar |
| UI not in expected language | Set VS Code display language; toggle away from and back to the Hermes sidebar |

---

## Feedback & contributions

Issues, feature requests, and PRs are welcome.

**Bug reports:** [GitHub Issues](https://github.com/acester822/FTR10-Hermes-VSCode/issues) → **New issue** with:
- VS Code version
- Extension version (`0.3.2`+)
- Hermes Agent version (`hermes --version`)
- Steps to reproduce + expected vs. actual
- Relevant logs (**More options → Logs**)

Before filing, search [existing issues](https://github.com/acester822/FTR10-Hermes-VSCode/issues) and confirm Hermes works outside VS Code (`hermes acp` in a terminal).

**Links**
- Repository: [github.com/acester822/FTR10-Hermes-VSCode](https://github.com/acester822/FTR10-Hermes-VSCode)
- Hermes Agent docs: [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com)

---

## Contributors

- [acester822](https://github.com/acester822)

---

## License

MIT
