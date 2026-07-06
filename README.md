<div align="center">

<img src="media/icon.svg" alt="FTR10 Hermes VSCode icon" width="128" />

# FTR10 Hermes VSCode

**Chat with [Hermes Agent](https://hermes-agent.nousresearch.com) directly inside VS Code or Cursor — no terminal switching required.**

[中文文档](README.zh-CN.md) · [More capabilities](https://github.com/acester822/FTR10-Hermes-VSCode)

</div>

---

## Overview

FTR10 Hermes VSCode is a VS Code / Cursor extension that brings your local Hermes Agent into the editor sidebar. Instead of juggling a separate terminal, you get a full chat experience right where you write code.

The extension connects to a local `hermes acp` subprocess over the [Agent Client Protocol (ACP)](https://agentclientprotocol.com), so you can ask questions, run tools, and iterate on code without leaving the IDE. Replies stream in real time with Markdown rendering; code blocks can be inserted into the editor with one click; file paths in messages open directly in VS Code.

**What's new in v0.3.2**

- **Editor Tools Bridge** — Hermes gains live access to your editor state: active file context, open tabs, cursor position, diagnostics, and file content via MCP
- **CodeLens** — "Ask Hermes about this file" and "Explain this" lenses on every function and class
- **Diff Viewer** — Preview and apply Hermes-suggested code changes with a visual diff
- **Onboarding Walkthrough** — 3-step guided setup in VS Code's Welcome view
- **Hermes Profile Discovery** — Auto-detects Hermes profiles and models from your config
- **Context Attachment** — Carry conversation context from prior sessions into new chats
- **Control Center** — Embedded Hermes dashboard panel for agent configuration

**Who is it for?**

- Developers already using Hermes Agent who want a smoother in-editor workflow
- Teams that want AI assistance tied to the current workspace, with session history and model control in one place

**What you get**

| Benefit | Description |
|---------|-------------|
| Stay in flow | Sidebar chat — no alt-tab to a terminal |
| Workspace-aware | Agent runs in your project directory; `@file` references open in the editor |
| Multi-session | Tabbed conversations with local history persistence |
| Transparent | Optional visibility into thinking steps and tool calls |
| Bilingual UI | English and Simplified Chinese (follows VS Code display language) |
| Editor context | Agent sees your cursor, selection, open tabs, and diagnostics |
| Code actions | One-click "Ask Hermes" and "Explain this" on code symbols |

---

## Quick Install

### Requirements

- **VS Code** 1.85 or later, or **Cursor**
- **[Hermes Agent](https://hermes-agent.nousresearch.com)** installed and configured
- `hermes` available on your `PATH` (or set `hermes.path` in Settings)

### Install in VS Code

1. Open VS Code.
2. Go to **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **FTR10 Hermes VSCode** or **FTR10**.
4. Click **Install**.

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FTR10.FTR10-Hermes-VSCode).

### Install in Cursor

1. Open Cursor.
2. Go to **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Search for **FTR10 Hermes VSCode** or **FTR10**.
4. Click **Install**.

Or install from [Open VSX](https://open-vsx.org/extension/FTR10/FTR10-Hermes-VSCode) (Cursor extension registry).

### More capabilities

Visit FTR10-Hermes-VSCode on GitHub(https://github.com/acester822/FTR10-Hermes-VSCode) for guides, tips, and related tools.

### Verify installation

1. Confirm `hermes` works in a terminal: `hermes --version`
2. Click the **Hermes Agent** icon in the activity bar
3. Wait until the status indicator shows **Ready** (green)
4. Type a message and press **Enter**

---

## Features

### Chat & messaging

- **Sidebar chat panel** — WebView-based UI with streaming responses
- **Markdown rendering** — Syntax-highlighted code blocks (marked + highlight.js, sanitized with DOMPurify)
- **Multi-session tabs** — Create, switch, rename, and delete conversations; history persisted locally
- **In-conversation search** — Find keywords in the current session
- **Stop generation** — Cancel an in-progress response without saving partial output

### Editor Tools Bridge

Hermes Agent gains real-time access to your editor state through an in-process MCP server. The agent can query:

- **Active editor context** — Current file path, language, cursor position, selection text, visible ranges, and full file content (for files under 500 lines)
- **Open tabs** — List of all open editors with labels, language IDs, dirty state, and pinned state
- **Diagnostics** — Current errors, warnings, and information from VS Code's language servers
- **File operations** — Read and write files within the workspace

This is exposed to the agent as the `vscode-editor-tools` MCP server, automatically registered at session start.

### CodeLens

- **"Ask Hermes about this file"** — Appears at the top of every file; opens the chat sidebar with a pre-filled prompt asking about the file's purpose, key functions/classes, and potential issues
- **"Explain this"** — Appears above each `function` and `class` declaration; opens the chat with a prompt to explain that specific symbol

### Diff Viewer

- **Preview changes** — Hermes can suggest code modifications that render as a visual diff (original vs. proposed)
- **Apply changes** — Accept a diff to write the changes to the file
- Commands: `hermes.showDiff`, `hermes.previewDiff`, `hermes.applyDiff`

### Context Attachment

Carry context from prior sessions into new conversations:

- **Modes**: Last 2 messages, last 10 messages, all messages (up to ~32K chars), or custom message indices
- **Configurable visibility**: `onNewSession` (default), `always`, or `never`
- Controlled via `hermes.contextAttachVisibility` setting

### Editor integration

- **Insert code blocks** — Click a code block in a reply to insert it at the cursor
- **@file references** — Type `@` to pick workspace files; click paths in messages to open them
- **Send selection to chat** — Right-click selected code → **Hermes: Insert Selection into Chat**
- **Terminal mirror** — Shell commands from Hermes appear in a VS Code integrated terminal

### Agent control

- **Multi-agent switching** — Configure named agents with different paths, profiles, and working directories
- **Model selection** — Switch models via ACP `configOptions` or Hermes native `models` / `session/set_model`
- **Profile selector** — Quick switch between Hermes profiles (auto-discovered from your Hermes config)
- **Permission prompts** — Approve or deny tool / file access requests from the agent

### Onboarding

- **Walkthrough** — 3-step guided setup in the Welcome view:
  1. Secure your API key (stored in VS Code Secret Storage)
  2. Open the Control Center to configure agent persona and tool permissions
  3. Start your first conversation

### Control Center

- **Embedded dashboard** — Opens the Hermes dashboard UI in an editor panel for configuring agent settings, tools, and permissions

### Visibility & diagnostics

- **Environment detection & configuration** — Wrench menu: scan Hermes install (L0–L5), verify `hermes --version`, check `hermes acp --check`, auto-install `agent-client-protocol` when missing; compact percentage progress in the toolbar
- **Token usage ring** — Input token usage indicator in the toolbar
- **Local history badge** — When switching sessions, UI marks messages restored from local storage (agent context is reset)
- **Thoughts & tool calls** — Optionally show agent reasoning and tool notifications
- **Connection logs** — View and copy ACP connection logs from the chat toolbar

### Internationalization

- UI follows VS Code display language
- Supported locales: **English**, **中文(简体)**

---

## How to Use

### 1. First-time setup (Walkthrough)

Open the Welcome view (`Ctrl+Shift+X` → Hermes icon) and follow the 3-step walkthrough:

1. **Set your API key** — Stored securely in VS Code Secret Storage
2. **Open the Control Center** — Configure your agent's persona and tool permissions
3. **Start a conversation** — Begin chatting with Hermes

### 2. Open the chat panel

- Click the **Hermes Agent** icon in the left activity bar, or
- Run command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Hermes: Open Chat**

### 3. Start a conversation

1. Wait for status **Ready**
2. Type your message in the input box at the bottom
3. Press **Enter** to send ( **Shift+Enter** for a new line)
4. Watch the reply stream in; click **Stop** to cancel if needed

### 4. Reference files

- Type `@` in the input to open the file picker and attach a workspace file
- Click any file path in a message to open it in the editor

### 5. Work with code from the editor

1. Select code in any editor tab
2. Right-click → **Hermes: Insert Selection into Chat**
3. The selection is inserted into the chat input with file path and line number

### 6. Use CodeLens

- Click **"Ask Hermes about this file"** at the top of any file to ask about its purpose
- Click **"Explain this"** above a function or class to get an explanation of that symbol

### 7. Manage sessions

- Click **+ New** to start a fresh conversation
- Switch between tabs to revisit local history
- Rename or delete sessions from the tab bar

> **Note:** Switching sessions resets the agent's in-memory context. Previously saved messages are restored locally and marked with a **local history** banner — the agent does not retain that prior context unless Hermes adds session restore support.

### 8. Switch model or profile

Use the **Model** and **Profile** dropdowns in the chat toolbar when your Hermes setup exposes them.

If the agent does not provide a model list, configure fallback presets in Settings (see below).

### 9. Commands

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
| `Hermes: Detect Environment` | Scan for Hermes installation |
| `Hermes: Configure Environment` | Configure detected Hermes installation |
| `Hermes: Open Settings` | Open extension settings |
| `Hermes: Check for Updates` | Check for extension updates |
| `Hermes: Open Logs` | View ACP connection logs |
| `Hermes: Reload Extension` | Reload the extension |
| `Hermes: Reload Session` | Reload the current session |

### 10. Settings

Open **Settings** (`Ctrl+,` / `Cmd+,`) and search for **Hermes**, or use **More options → Settings** in the chat view title bar (opens extension settings directly):

| Setting | Description | Default |
|---------|-------------|---------|
| `hermes.path` | Path to Hermes executable | auto-detect |
| `hermes.cwd` | Working directory for sessions | workspace root |
| `hermes.profile` | Hermes profile name | default |
| `hermes.showThoughts` | Show agent thinking process | `true` |
| `hermes.showToolCalls` | Show tool call notifications | `true` |
| `hermes.contextAttachVisibility` | When to show context attachment picker | `onNewSession` |
| `hermes.models` | Fallback model list when agent provides none | `[]` |
| `hermes.defaultModel` | Default model id (fallback list only) | `""` |
| `hermes.agents` | Named agent configurations for quick switching | `[]` |

**Example — multiple agents:**

```json
"hermes.agents": [
  { "name": "Default", "profile": "" },
  { "name": "Fast", "path": "/path/to/hermes", "profile": "fast" }
]
```

**Example — fallback models:**

```json
"hermes.models": [
  { "id": "claude-sonnet", "name": "Claude Sonnet" },
  { "id": "gpt-4o", "name": "GPT-4o" }
],
"hermes.defaultModel": "claude-sonnet"
```

Changes to connection-related settings trigger an automatic reconnect.

### Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Stuck on **Connecting…** | Open **Environment → Environment detection** from the wrench menu; ensure `hermes` is on PATH or set `hermes.path` |
| **ACP dependencies missing** | Detection tries `pip install agent-client-protocol==0.9.0` automatically; if it still fails, run `hermes acp --check` and `hermes acp` in a terminal |
| **Connection error** | Click **Retry** in the toolbar; check Hermes logs via **More options → Logs** |
| **Hermes is initializing…** (no reply yet) | Normal on first message after connect — Hermes may load plugins for 1–3 minutes; wait or check logs |
| Model not listed | Add entries under `hermes.models` in Settings |
| **Settings** not opening in Cursor | Use **More options → Settings** in the chat view title bar |
| UI not in expected language | Set VS Code display language; switch away from and back to the Hermes sidebar |

---

## Bug Reports & Feedback

We welcome issues, feature requests, and pull requests.

**Report a bug**

1. Go to [GitHub Issues](https://github.com/acester822/FTR10-Hermes-VSCode/issues)
2. Click **New issue**
3. Include:
   - VS Code version
   - Extension version (`0.3.2` or later)
   - Hermes Agent version (`hermes --version`)
   - Steps to reproduce
   - Expected vs. actual behavior
   - Relevant logs (**More options → Logs** in the chat toolbar)

**Before filing**

- Search [existing issues](https://github.com/acester822/FTR10-Hermes-VSCode/issues) to avoid duplicates
- Confirm Hermes works outside VS Code (e.g. `hermes acp` in a terminal)

**Other links**

- Repository: [github.com/acester822/FTR10-Hermes-VSCode](https://github.com/acester822/FTR10-Hermes-VSCode)
- VS Code Marketplace: [marketplace.visualstudio.com/items?itemName=FTR10.FTR10-Hermes-VSCode](https://marketplace.visualstudio.com/items?itemName=FTR10.FTR10-Hermes-VSCode)
- Cursor (Open VSX): [open-vsx.org/extension/FTR10/FTR10-Hermes-VSCode](https://open-vsx.org/extension/FTR10/FTR10-Hermes-VSCode)
- More capabilities: FTR10-Hermes-VSCode on GitHub(https://github.com/acester822/FTR10-Hermes-VSCode)
- Hermes Agent docs: [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com)

---

## License

MIT
