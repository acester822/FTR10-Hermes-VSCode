# Hermes Agent Chat — 代码审查 #4

> 审查日期：2026-06-20  
> 基准：CR #1–#3（`CODE_REVIEW.md` ~ `CODE_REVIEW_3.md`）标注修复后的当前代码  
> 范围：`src/`、`media/`、`package.json`  
> 版本：0.1.0（package.json 未 bump，功能面已远超 0.1.0）

---

## 总体结论

CR #3 中多数结构性问题（`globalStorageUri`、按 session 分文件、本地 vendor、terminal buffer、exit 清理、assistant 单次持久化等）**确有落地**，项目成熟度明显高于前三轮。

但第四轮审查发现：**`media/chat.html` 中混入 TypeScript 语法，会导致整段 WebView 脚本无法解析**，属于阻断级回归；会话切换、Terminal ACP 合规、错误恢复等仍有明显缺口。当前不宜视为「三轮 CR 全部关闭 / 0.2.0 beta 就绪」。

| 维度 | CR #3 结束时自评 | CR #4 复核 |
|------|------------------|------------|
| 核心聊天 / 流式 | ✅ 全部关闭 | ⚠️ **WebView 脚本 parse 失败风险（#4-1）** |
| 持久化 | ✅ globalStorage + 分文件 | ✅ 主路径改善；扩展重载丢会话（#4-7） |
| 会话切换 | ✅ 点击加载 | ⚠️ UI 脚本错误 + 逻辑缺陷（#4-1、#4-3） |
| Terminal ACP | ✅ output 修复 | ⚠️ stderr/args/schema 仍不完整（#4-4、#4-5） |
| 安全 / 沙箱 | ⏳ | ⚠️ fs 无边界、Markdown XSS、列表 HTML 注入（#4-8–#4-10） |
| 测试 | ✅ 框架就绪 | ⚠️ 仍仅复制状态机常量，未覆盖真实模块（#4-11） |

---

## CR #3 修复核验（第四轮）

| CR3 # | 问题 | CR #4 结论 |
|-------|------|------------|
| 3-1 | Terminal 输出为空 | ✅ `term.stdout +=` 已修复 |
| 3-2 | 用户消息丢失 / 助手 chunk 重复 | ✅ user 在 `_handleUserMessage` 保存；assistant 在 `ready` 时存一次 |
| 3-3 | 持久化路径在扩展目录 | ✅ `context.globalStorageUri` |
| 3-4 | exit 状态被 `stop()` 覆盖 | ✅ exit 手动 cleanup + `_transitionTo('error')` |
| 3-5 | CDN 依赖 | ✅ `media/vendor/` + `asWebviewUri` 占位符 |
| 3-6 | 会话无法切换 | ⚠️ **已实现但引入 P0 语法错误 + 逻辑问题** |
| 3-7 | initialize 非 schema 字段 | ✅ 已移除 `capabilities` / `session`；仍 `as any`（#4-12） |
| 3-8 | sendMessage 非法迁移 | ✅ 已移除强行 `_transitionTo('ready')` |
| 3-9 | tool 更新刷屏 | ❌ 仍未按 toolCallId 合并（#4-6） |
| 3-10 | Terminal 双轨 / 参数 | ⚠️ 部分改善；stderr/args/env 仍缺（#4-4、#4-5） |
| 3-11 | fs 无工作区边界 | ❌ 仍未限制（#4-9） |
| 3-12 | Markdown XSS | ❌ 仍 `innerHTML = marked.parse`（#4-10） |
| 3-13 | 测试不足 | ❌ 仍仅 `stateMachine.test.ts` 复制常量（#4-11） |

---

## 严重问题（P0）

### 4-1. `chat.html` 含 TypeScript 语法 — 整段 WebView 脚本无法加载

**位置：** `media/chat.html` 第 733 行

```javascript
if ((e.target as HTMLElement).classList.contains('delete-btn')) return;
```

**验证：** 对同等 JS 片段执行 `node --check` → `SyntaxError: Unexpected identifier 'as'`。

**后果：** 含该行的 `<script>` 块在浏览器解析阶段失败，**不仅会话切换不可用，整个聊天 WebView（ready、发消息、取消等）均无法初始化**。属 CR #3 实现会话切换时引入的**阻断级回归**。

**修复方向：** 改为纯 JS，例如：

```javascript
if (e.target && e.target.classList && e.target.classList.contains('delete-btn')) return;
// 或 e.target.closest('.delete-btn')
```

---

### 4-2. 本地会话与 ACP 会话语义脱节（切换历史会话）

**位置：** `HermesChatProvider._handleSwitchSession`

```typescript
this._acp?.newSession(process.cwd());  // 未 await；cwd 未用 _resolveCwd()
this._sessionId = sessionId;
this._loadHistory();                   // 仅恢复 UI + 本地 JSON
this._restoreMessages();
```

**现象：**

- 本地加载的是**历史消息**；Hermes 侧是**全新 ACP session**（空上下文）  
- `newSession` **未 await**，与 `_restoreMessages` 竞态  
- `process.cwd()` 与当前工作区 / `hermes.cwd` 配置可能不一致  

**后果：** 用户以为在「继续旧对话」，Agent 实际无该对话记忆；继续提问时行为与 UI 展示严重不一致。

**修复方向：** 若 Hermes 支持 `session/load`，应加载 agent 侧会话；否则 UI 明确标注「仅查看本地历史，Agent 上下文已重置」；`await newSession(_resolveCwd())`。

---

## 中等问题（P1）

### 4-3. `newSession` 失败进入 `error` 后无法轻量重连

**位置：** `AcpClient.newSession`；`HermesChatProvider._connect`

```typescript
// AcpClient
this._transitionTo('error', `New session failed: ${msg}`);
// Provider 仍持有 this._acp，且 _connect 有 if (this._acp) return
```

**后果：** New Chat 或切换会话若 ACP 层失败，Provider 保留 dead-in-error 的 `_acp`，可见性变化不会重连，用户只能切换 Agent 或重载窗口。

**修复方向：** `newSession` 失败时 `onConnectionLost()` 或 Provider 侧 `_acp = undefined`；或提供「重试连接」命令。

---

### 4-4. Terminal：`stderr` 未进入 ACP `output`

**位置：** `AcpClient._handleTerminalOutput`

```typescript
return {
    output: term.stdout,  // stderr 单独存储但未合并
    ...
};
```

**后果：** 命令失败时 Agent 常依赖 stderr 判断错误，**可能误判成功**。

**修复方向：** 按 ACP 约定合并或分字段返回；至少 append stderr 到 output 或文档说明仅 stdout。

---

### 4-5. Terminal：仍忽略 `args` / `env` / `outputByteLimit`

**位置：** `AcpClient._handleTerminalCreate`

```typescript
const proc = spawn(cmd, [], { cwd, shell: true, ... });
```

**后果：** Agent 发送带参数命令时行为错误；输出无截断，长输出可能 OOM。

**修复方向：** 使用 `params.command` + `params.args`；实现 `outputByteLimit` 截断（schema 要求字符边界）。

---

### 4-6. Terminal：`waitForExit` 响应字段名错误

**位置：** `AcpClient._handleTerminalWaitForExit`

```typescript
return { exitCode: term.exitCode, exitSignal: term.exitSignal };
```

**schema：** `WaitForTerminalExitResponse` 使用 `signal`，非 `exitSignal`。

**后果：** 严格 Agent 可能无法读取退出信号。

---

### 4-7. 扩展重载后总是新 `sessionId`，不恢复上次会话

**位置：** `HermesChatProvider` 构造函数

```typescript
this._sessionId = Date.now().toString(36);
this._loadSessions();
this._loadHistory();  // 只加载与当前 _sessionId 对应的 msgs_*.json
```

**现象：** 每次激活扩展生成新 ID，不读取 `sessions.json` 中最近活跃会话。

**后果：** 用户重载窗口后**默认空白聊天**，历史会话在列表中但需手动切换；与「持久化已完成」的预期不符。

**修复方向：** 持久化 `activeSessionId`；启动时恢复最近会话或提示恢复。

---

### 4-8. `sendText` / `sendSelection` 在未连接时静默失败

**位置：** `HermesChatProvider.sendText`；`extension.ts` `hermes.sendSelection`

```typescript
this._postMessage({ type: 'addMessage', role: 'user', text });
this._saveMessage('user', text);
this._acp?.sendMessage(text);  // _acp 为空时无提示
```

**后果：** 消息已显示并写入历史，但从未发给 Hermes。

**修复方向：** 无 `_acp` 时先 `_connect()` 再发送，或提示「未连接」并回滚 UI/历史。

---

### 4-9. `fs` 读写仍无工作区边界

**位置：** Provider 中 `readTextFile` / `writeTextFile` 回调

**现象：** 任意绝对路径可读写在 OS 权限内均可执行。

**后果：** 恶意或误操作 prompt 可能修改工作区外文件（CR #3 #3-11 未关闭）。

**修复方向：** 限制在 `workspaceFolders` + 配置的 `hermes.cwd`；写操作可选二次确认。

---

### 4-10. Markdown 渲染 + 会话列表仍存在 XSS / 注入面

| 位置 | 问题 |
|------|------|
| `finishStreaming` / `ready` 重渲染 | `innerHTML = marked.parse(text)` 无 sanitize |
| `renderSessionList` / `renderAgentList` | `s.title`、`name` 直接拼进 `innerHTML` |

**后果：** Agent 输出或恶意配置名可在 WebView 内注入 HTML（沙箱内仍属不必要风险）。

**修复方向：** DOMPurify / marked sanitize；列表用 `textContent` 或 escape。

---

### 4-11. 测试仍与实现脱节

**位置：** `src/tests/suite/stateMachine.test.ts`

- 仍**复制** `VALID` 表，未 import `AcpClient`  
- 无 terminal / 持久化 / session switch 单测  
- 集成测试依赖外网下载 VS Code  

**后果：** CR #3 回归（如 #4-1）无法被 CI 捕获。

**修复方向：** 导出 `canTransition` 或测 `AcpClient`；对 `chat.html` 做语法检查或 playwright smoke test。

---

### 4-12. 其它 P1/P2 项

| # | 问题 | 位置 |
|---|------|------|
| 4-12 | `initialize` 仍 `as any` | `AcpClient.start` |
| 4-13 | Hermes stderr 每条进 tool 气泡，易刷屏 | `AcpClient` stderr handler |
| 4-14 | Cancel 后 `_lastAssistantText` 仍可能在 `ready` 时持久化**部分回复** | Provider status handler |
| 4-15 | `tool_call` / `tool_call_update` 仍每次新建气泡 | `_handleSessionUpdate` |
| 4-16 | 每次 `ready` 对**所有** assistant 消息 re-markdown，性能与重复 Insert 按钮风险 | `chat.html` |
| 4-17 | Windows 仍依赖 `which` 探测 `hermes` | `_findHermes` |
| 4-18 | callback 中 `role === 'user'` 的 `_saveMessage` 为死代码（AcpClient 从不 emit user） | Provider |

---

## 设计与架构问题（P2）

### D-1. 双层「会话」模型未在产品层说清

| 层 | 实现 | 生命周期 |
|----|------|----------|
| 本地 UI 会话 | `msgs_{sessionId}.json` + `sessions.json` | 持久化、可切换查看 |
| ACP/Hermes 会话 | `ActiveSession` / `session/new` | New Chat / switch 时新建 |

当前切换本地会话**不会**恢复 Agent 记忆，但 UI 无明确区分，易造成错误心智模型。

**建议：** 会话列表标注「本地记录」；或对接 `session/load` 实现真恢复。

---

### D-2. `HermesChatProvider` 职责仍集中

单类承担：WebView 协议、ACP 生命周期、权限、fs/terminal 委托、会话 CRUD、配置解析、日志。Phase 2/3 功能堆叠后维护成本仍高（CR #3 D-1 未解）。

---

### D-3. Terminal「三轨」架构

同一命令可能同时出现在：

1. ACP 后台 `spawn`（Agent 读 output）  
2. VS Code `createTerminal` mirror（用户可见）  
3. （潜在）用户本地 shell 与 cwd 不一致  

**风险：** 行为不一致、排障困难。建议文档化「Agent 以 ACP 子进程为准」，mirror 可选且参数一致。

---

### D-4. 版本与文档漂移

- `package.json` 仍为 **0.1.0**，CR #3 文档写「0.2.0 beta 就绪」  
- `CODE_REVIEW_3.md` 称「全部修复」，与 #4-1 等事实不符  
- 根目录 `.chat-history.json` / `.sessions.json` 仍可能存在（旧路径遗留），与 `globalStorage` 双轨  

---

### D-5. 可观测性

- Hermes stderr 注入聊天 UI（`⚠️ ...`），与 Output Channel 未统一  
- 状态机非法迁移仅 `console.log`，未写入 Output Channel  

---

## 数据流（当前 + 风险点）

```
扩展 activate
  → 新 random sessionId（⚠ 不恢复上次 #4-7）
  → WebView 加载 chat.html
       → 若含 TS 语法：整脚本 parse 失败（💥 #4-1）
       → ready → _connect → initialize → session/new

用户发消息
  → WebView 展示 user + Provider _saveMessage user ✅
  → AcpClient sendMessage → prompting → ready → 存 assistant 一次 ✅

切换历史 session
  → switchSession → newSession( process.cwd ) 未 await（⚠ #4-2）
  → 本地 msgs 恢复 UI；Agent 空上下文

Terminal 工具
  → stdout 回传 ✅；stderr 不回传（⚠ #4-4）
```

---

## 修复优先级建议（CR #4）

| 优先级 | 编号 | 说明 |
|--------|------|------|
| **P0** | #4-1 | 移除 `as HTMLElement` — 阻断 WebView |
| **P0** | #4-2 | 会话切换语义 + await + cwd |
| **P1** | #4-3 | error 后释放 `_acp` 或可重连 |
| **P1** | #4-4 ~ #4-6 | Terminal stderr / args / schema |
| **P1** | #4-7 ~ #4-8 | 启动恢复会话 / sendText 未连接 |
| **P1** | #4-9 ~ #4-11 | 安全、测试 |
| **P2** | D-1 ~ D-5 | 会话模型文档、模块拆分、版本 |

---

## 与 PLAN.md 对齐度（第四轮）

| PLAN 项 | CR #4 状态 |
|---------|------------|
| Phase 1 基础聊天 | ⚠️ 依赖 #4-1 是否已部署 |
| Phase 2 Markdown / 代码插入 / @file | ✅ 本地 vendor；XSS 未处理 |
| Phase 2 中断 | ✅ |
| Phase 2 会话管理 | ⚠️ 列表/删除/切换有；Agent 上下文不连续 |
| Phase 3 选中代码 | ⚠️ 未连接时静默失败 |
| Phase 3 终端 | ⚠️ mirror + ACP；stderr/args 不完整 |
| Phase 3 多 Agent | ✅ 配置 + 切换 |
| Phase 3 设置 | ✅ |

---

## 结论

项目在 CR #3 之后**工程化程度继续提升**（存储、vendor、terminal stdout、状态机 exit 路径等），但第四轮审查表明：

1. **必须先修复 #4-1**，否则侧边栏聊天可能完全不可用  
2. **会话切换需要产品 + 技术双重澄清**（#4-2、D-1）  
3. Terminal / 安全 / 测试仍是发布前短板  

建议：修复 P0 后将版本升至 **0.2.0-beta.1**，并增加 `chat.html` JS 语法检查进 CI。

---

## 参考

- `CODE_REVIEW.md` / `CODE_REVIEW_2.md` / `CODE_REVIEW_3.md`  
- `PLAN.md`  
- ACP Schema — `TerminalOutputResponse`、`WaitForTerminalExitResponse`
