import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import { AcpClient, AcpStatus, ModelListState, PermissionRequest, TokenUsage, ReplayMessage } from '../acp/AcpClient';
import { InlineDiffManager, isFileMutatingTool, extractFilePath } from '../acp/InlineDiffManager';
import { buildModelListStateFromCatalog, isRuntimeModelSource, encodeHermesModelValueId } from '../acp/modelConfig';
import { resolveModelCatalog } from '../acp/acpModelCatalog';
import type { AcpModelOptionsResponse } from '../acp/acpModelCatalog';
import { resolveMcpServersForSession } from '../acp/mcpConfig';
import { normalizeHermesCliProfile, scopeKeyForCliProfile } from '../acp/hermesProfile';
import { discoverHermesProfiles, detectHermesEnvironment, tryResolveHermesQuick, findHermesExecutable } from '../acp/profileDiscovery';
import type {
    HermesDetectProgressEvent,
    HermesDetectSource,
    HermesDetectStepId,
    HermesDetectStepStatus,
    HermesEnvironmentReport,
    HermesExecutableCandidate,
} from '../acp/profileDiscovery';
import { addHermesDirectoryToSystemPath, getHermesExecutableDirectory } from '../acp/hermesPathSetup';
import { accessExecutable, resolveDefaultHermesHome, venvHermesCandidates } from '../acp/hermesPaths';
import {
    activeSessionPathFor,
    loadProfileState,
    migrateLegacySessionStorage,
    saveProfileState,
    sanitizeProfileScopeKey,
    sessionsPathFor,
} from './profileStorage';
import { getLocale, getWebviewLocale, initI18n, localizeStatusMessage, t } from '../i18n';
import { resolvePermissionOptionLabel } from '../i18n/permissionOptions';
import { SupportedLocale, LocaleStrings } from '../i18n/types';
import { formatLocaleString, WEBVIEW_LOCALE_HELPER } from '../i18n/format';
import {
    canAggregateToolTexts,
    rebuildAggregatedToolText,
} from './toolAggregate';
import { classifyLogLevel, LogLevel } from '../logLevel';
import { logToFile } from '../acp/fileLogger';
import {
    composePromptWithContext,
    ContextAttachOption,
    filterAttachableMessages,
    resolveAttachMessages,
    resolveCustomAttachMessages,
} from './contextAttach';

type ContextAttachVisibility = 'onNewSession' | 'always' | 'never';

interface StoredPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

/** An image attached to a user message (base64-encoded, sent to the model for vision). */
export interface ChatImage {
    /** base64-encoded image payload (no data: prefix). */
    data: string;
    /** MIME type, e.g. image/png. */
    mimeType: string;
    /** Original file name, purely for display. */
    name: string;
}

interface ChatMessage {
    role: string;
    text: string;
    timestamp: number;
    toolCallId?: string;
    aggregatedTools?: Array<{ toolCallId: string; text: string }>;
    permissionId?: string;
    title?: string;
    detail?: string;
    options?: StoredPermissionOption[];
    resolved?: boolean;
    outcome?: 'selected' | 'cancelled';
    selectedOptionId?: string;
    selectedLabel?: string;
    /** Images attached by the user, forwarded to a vision-capable model. */
    images?: ChatImage[];
    /** Non-image files (code/text) dropped on the composer, forwarded as ACP resource blocks. */
    files?: ChatFile[];
}

/** A non-image file dropped into the composer. text is the (capped) file contents. */
interface ChatFile {
    name: string;
    mimeType: string;
    text: string;
}

interface SessionInfo {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    titleManual?: boolean;
    modelId?: string;
    modelLabel?: string;
    /** User has sent at least one message to Hermes in this session. */
    agentEngaged?: boolean;
    /** Pinned tabs stay at the front and reorder only within pinned group. */
    pinned?: boolean;
}

interface HermesAgentConfig {
    name: string;
    path?: string;
    profile?: string;
    cwd?: string;
}

interface ProfileListEntry {
    id: string;
    label: string;
}

interface ConnectionTarget {
    scopeKey: string;
    selectionId: string;
    displayName: string;
    cliProfile: string;
    configPath?: string;
    configCwd?: string;
}

interface DetectStepLogEntry {
    step: HermesDetectStepId;
    label: string;
    detail: string;
    status: HermesDetectStepStatus;
}

export class HermesChatProvider implements vscode.WebviewViewProvider {
    // ---- Lifecycle ----
    private _view?: vscode.WebviewView;
    private _acp?: AcpClient;
    private _inlineDiff = new InlineDiffManager();
    /** Maps toolCallId → filePath for file-mutating tool calls, so the completion handler can compute the diff. */
    private _pendingFileTools = new Map<string, string>();
    private _output: vscode.OutputChannel;
    private _ftr10Watcher?: fs.FSWatcher;
    private _configWatcher?: fs.FSWatcher;
    private _configWatchTimer?: ReturnType<typeof setTimeout>;
    private _diffReview?: import('../acp/DiffReviewManager').DiffReviewManager;

    public setDiffReviewManager(manager: import('../acp/DiffReviewManager').DiffReviewManager): void {
        this._diffReview = manager;
        this._diffReview.onEvent((e) => {
            if (e.type === 'proposed') {
                this._postMessage({ type: 'diffReviewRequest', filePath: e.filePath });
            }
        });
    }

    // ---- Session State ----
    private _historyDir: string;
    private _scopeKey: string;
    private _sessionsPath: string;
    private _activeIdPath: string;
    /**
     * Stable per-window key used to scope the ACTIVE-session pointer so that
     * multiple code-server windows (each its own extension host + `hermes acp`
     * child + MCP server) do not share one "live session" pointer. Derived from
     * the window's first workspace folder; falls back to a machine/session id.
     */
    private _windowKey: string;
    private _sessionMessages: ChatMessage[] = [];
    private _sessionId: string = '';
    private _sessions: SessionInfo[] = [];
    private _lastAssistantText: string = '';
    private _lastThoughtText: string = '';
    private _modelState: ModelListState | null = null;
    private _activeAgentName: string = '';
    /** Agent name or CLI profile id used for reconnect / switch. */
    private _activeSelectionId: string = '';
    private _discoveredProfiles: string[] | null = null;
    private _profileDiscoveryPromise: Promise<void> | undefined;
    private _modelSwitchInFlight: Promise<void> | undefined;
    private _tokenUsage: TokenUsage | null = null;
    private _webviewLocale?: SupportedLocale;
    private readonly _extensionId: string;
    private _pendingPermissions = new Map<string, (optionId: string | null) => void>();
    private _permissionCounter = 0;
    /** Serializes webview send so rapid sends cannot overlap. */
    private _chatOpChain: Promise<void> = Promise.resolve();
    /** Resolves when `_connect` finishes session/model setup after ACP `start`. */
    private _connectPromise: Promise<void> | undefined;
    /** When true, suppress forwarding ACP `ready` until post-connect setup completes. */
    private _deferReadyUntilSessionSetup = false;
    /** Resolves with picked sessionId or null when user picks from the session picker. */
    private _pendingSessionPick: ((sessionId: string | null) => void) | null = null;
    /** Bumped on cancel to abort a pending send before it reaches Hermes. */
    private _sendEpoch = 0;
    /** Fires when a prompt produces no output for a while (Hermes plugin init). */
    private _promptStallTimer: ReturnType<typeof setTimeout> | undefined;
    /** Chat session that owns the in-flight ACP prompt (may differ from `_sessionId` after tab switch). */
    private _promptSessionId: string | undefined;
    /** Chat session currently bound to the single ACP agent runtime context. */
    private _acpBoundSessionId: string = '';
    /** Messages available for one-time context attach after agent reset. */
    private _contextAttachMessages: ChatMessage[] = [];
    private _contextAttachActive = false;
    private _contextAttachAwaitingReply = false;
    private _detectStepLog: DetectStepLogEntry[] = [];
    private _lastDetectReport: HermesEnvironmentReport | undefined;
    private _detectInProgress = false;
    private _detectAbortController?: AbortController;
    private readonly _detectStepOrder: HermesDetectStepId[] = [
        'config',
        'path_lookup',
        'known_path',
        'pip',
        'python_import',
        'hermes_home',
        'verify',
        'acp_check',
        'acp_install',
        'summary',
    ];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) {
        this._extensionId = context.extension.id;
        this._output = vscode.window.createOutputChannel('Hermes Chat', 'hermes-chat');
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        this._historyDir = storagePath;
        migrateLegacySessionStorage(this._historyDir, '__default__');

        const initialTarget = this._resolveConnectionTarget();
        this._scopeKey = initialTarget.scopeKey;
        this._activeSelectionId = initialTarget.selectionId;
        this._activeAgentName = initialTarget.displayName;
        this._sessionsPath = sessionsPathFor(this._historyDir, this._scopeKey);
        // Per-window key: the first workspace folder path is stable across
        // reloads and distinct per code-server window. Fall back to a stable
        // per-machine id if no folder is open (rare for this extension).
        this._windowKey = HermesChatProvider._computeWindowKey();
        this._activeIdPath = activeSessionPathFor(this._historyDir, this._scopeKey, this._windowKey);
        this._loadSessions();
        this._sessionId = this._restoreActiveSession();
        this._ensureSessionRegistered();
        this._loadHistory();

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('hermes')) {
                    void this._onConfigurationChanged(e);
                }
            })
        );

        this._startConfigWatcher();
    }

    private _restoreActiveSession(): string {
        // Try restoring last active session (per-window pointer first)
        try {
            if (fs.existsSync(this._activeIdPath)) {
                const id = fs.readFileSync(this._activeIdPath, 'utf-8').trim();
                if (this._sessions.some(s => s.id === id)) return id;
            }
        } catch { /* ignore */ }
        // One-time fallback: inherit the LEGACY shared pointer on first run
        // after upgrade, so an in-flight session is not lost. This is only a
        // seed — the next _saveActiveSession() writes the per-window pointer.
        try {
            const legacy = activeSessionPathFor(this._historyDir, this._scopeKey);
            if (legacy !== this._activeIdPath && fs.existsSync(legacy)) {
                const id = fs.readFileSync(legacy, 'utf-8').trim();
                if (this._sessions.some(s => s.id === id)) return id;
            }
        } catch { /* ignore */ }
        return Date.now().toString(36);
    }

    /**
     * Stable, per-window key for scoping the active-session pointer. Uses the
     * first workspace folder path (distinct per code-server window, stable
     * across reloads). Falls back to the machine id when no folder is open.
     */
    private static _computeWindowKey(): string {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (folder && folder.trim()) {
            return folder.trim();
        }
        try {
            return `machine-${vscode.env.machineId}`;
        } catch {
            return 'no-folder';
        }
    }

    private _saveActiveSession(): void {
        try { fs.writeFileSync(this._activeIdPath, this._sessionId); } catch { /* ignore */ }
    }

    private _msgPath(sid: string): string {
        return path.join(this._historyDir, `msgs_${sid}.json`);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtml();
        this._webviewLocale = getLocale();
        this._postFtr10Vars();
        this._startFtr10Watcher();

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._syncWebviewLocale();
            }
        });

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'sendMessage':
                    this._enqueueChatOp(() => this._handleUserMessage(message.text, message.contextAttach, message.images, message.files));
                    break;
                case 'steerMessage':
                    // Follow-up sent while a turn is already running — re-steer
                    // the active Hermes turn instead of starting a new one.
                    void this._handleSteerMessage(message.text);
                    break;
                case 'cancel':
                    // Cancel must not wait behind an in-flight sendMessage; AcpClient
                    // handles send/cancel races via _activePromptId.
                    void this._handleCancel();
                    break;
                case 'openFile':
                    void this._handleOpenFile(message.path);
                    break;
                case 'listFiles':
                    void this._handleListFiles(message.query || '', message.requestId);
                    break;
                case 'previewFile': {
                    const fp = String(message.path || '');
                    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(fp.replace(/^@/, '').trim());
                    if (isImage) {
                        void this._handlePreviewImageFile(message.path, message.requestId);
                    } else {
                        void this._handlePreviewFile(message.path, message.requestId);
                    }
                    break;
                }
                case 'openImage':
                    void this._handleOpenImage(message.name, message.mimeType, message.data);
                    break;
                case 'openDiff':
                    void this._handleOpenDiff(message.filePath, message.diff);
                    break;
                case 'clearChat':
                    void this._handleClearChat();
                    break;
                case 'ready':
                    this._log('WebView ready');
                    this._syncWebviewLocale();
                    this._postPluginInfo();
                    this._postProfileList();
                    this._postConfig();
                    this._postTokenUsage();
                    // Don't call _restoreMessages() here — it would show stale
                    // messages before the session picker is resolved. Instead,
                    // the connect flow will restore messages after the user
                    // picks a session.
                    //
                    // Also defer _postSessionList() until after a session is
                    // picked: posting it now would make the webview render the
                    // *previous* session's name in the header before the picker
                    // is even resolved, leaving stale UI visible on first load.
                    // The connect flow posts the session list (and reveals the
                    // header) only once a session is actually active.
                    this._connect();
                    break;
                case 'getSessions':
                    this._postSessionList();
                    break;
                case 'telemetrySteps':
                    void this._fetchTelemetrySteps(message.session || '', message.requestId);
                    break;
                case 'deleteSession':
                    this._handleDeleteSession(message.sessionId);
                    break;
                case 'renameSession':
                    this._handleRenameSession(message.sessionId, message.title);
                    break;
                case 'reorderSessions':
                    this._handleReorderSessions(message.sessionIds);
                    break;
                case 'closeSessions':
                    void this._handleCloseSessions(message.sessionId, message.mode);
                    break;
                case 'togglePinSession':
                    this._handleTogglePinSession(message.sessionId);
                    break;
                case 'sessionExport':
                    this._handleSessionExport(message.sessionId, message.action, message.indices, message.format);
                    break;
                case 'clipboardWrite':
                    void this._handleClipboardWrite(message.text || '');
                    break;
                case 'switchAgent':
                    this._handleSwitchAgent(message.agentName);
                    break;
                case 'switchSession':
                    this._enqueueChatOp(() => this._handleSwitchSession(message.sessionId, {
                        interrupt: message.interrupt === true,
                    }));
                    break;
                case 'switchModel':
                    this._handleSwitchModel(message.configId, message.valueId);
                    break;
                case 'getModels':
                    void this._syncModelState();
                    break;
                case 'getProfiles':
                    this._postProfileList();
                    break;
                case 'openSettings':
                    void this._openSettings();
                    break;
                case 'openControlCenter':
                    void this._openControlCenter();
                    break;
                case 'openExternal':
                    if (message.url) {
                        void vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'retry':
                    void this._handleRetry();
                    break;
                case 'configureEnvironmentBrowse':
                    void this._handleConfigureEnvironmentBrowse();
                    break;
                case 'configureEnvironmentDetect':
                    void this._handleConfigureEnvironmentDetect(message.currentPath);
                    break;
                case 'configureEnvironmentSave':
                    void this._handleConfigureEnvironmentSave(message.path);
                    break;
                case 'configureEnvironmentSystem':
                    void this._handleConfigureEnvironmentSystem(message.path);
                    break;
                case 'configureEnvironmentOpenDirectory':
                    void this._handleConfigureEnvironmentOpenDirectory(message.path);
                    break;
                case 'configureEnvironmentDetectClose':
                    this._handleConfigureEnvironmentDetectClose();
                    break;
                case 'permissionResponse':
                    this._handlePermissionResponse(message.id, message.optionId ?? null);
                    break;
                case 'permissionModeChange':
                    this._handlePermissionModeChange(message.mode);
                    break;
                case 'reasoningEffortChange':
                    this._handleReasoningEffortChange(message.effort);
                    break;
                case 'acceptDiff':
                    void this._handleAcceptDiff();
                    break;
                case 'rejectDiff':
                    void this._handleRejectDiff();
                    break;
                case 'insertEditor':
                    void this._handleInsertEditor(message.text || '');
                    break;
                case 'deleteMessages':
                    this._handleDeleteMessages(message.indices);
                    break;
                case 'pickSession':
                    this._handlePickSession(message.sessionId, message.action);
                    break;
                case 'refreshSessions':
                    void this._handleRefreshSessions();
                    break;
                case 'loadMoreHistory':
                    this._handleLoadMoreHistory(message.loadedCount);
                    break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && !this._acp) {
                this._connect();
            }
        });
    }

    private _log(msg: string, level?: LogLevel): void {
        const time = new Date().toISOString().slice(11, 19);
        const line = `[${time}] ${msg}`;
        this._output.appendLine(line);
        const resolvedLevel = level ?? classifyLogLevel(msg);
        if (resolvedLevel) {
            this._postWebviewLog(line, resolvedLevel);
        }
    }

    private _postWebviewLog(line: string, level: LogLevel): void {
        this._postMessage({ type: 'log', line, level });
    }

    private _isViewingPromptSession(): boolean {
        return !this._promptSessionId || this._promptSessionId === this._sessionId;
    }

    private _otherSessionIsPrompting(): boolean {
        return this._acp?.status === 'prompting'
            && !!this._promptSessionId
            && this._promptSessionId !== this._sessionId;
    }

    private _withPromptSessionContext<T>(fn: () => T): T {
        if (!this._promptSessionId || this._promptSessionId === this._sessionId) {
            return fn();
        }
        const savedSessionId = this._sessionId;
        const savedMessages = this._sessionMessages;
        this._sessionId = this._promptSessionId;
        this._sessionMessages = this._loadSessionMessagesFromDisk(this._promptSessionId);
        try {
            return fn();
        } finally {
            this._sessionId = savedSessionId;
            this._sessionMessages = savedMessages;
        }
    }

    private _snapshotSessionModelFromProfile(sessionId?: string): void {
        const sid = sessionId || this._sessionId;
        const session = this._sessions.find(s => s.id === sid);
        if (!session || session.modelId) {
            return;
        }
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        if (!profileState.modelId) {
            return;
        }
        session.modelId = profileState.modelId;
        session.modelLabel = profileState.modelLabel;
        this._saveSessions();
    }

    private async _syncModelStateForCurrentSession(): Promise<void> {
        await this._syncModelState();
        if (this._otherSessionIsPrompting()) {
            return;
        }
        if (this._acpBoundSessionId === this._sessionId) {
            await this._applySessionModelPreference();
        }
    }

    private _resolveSessionModelId(sessionId?: string): { modelId?: string; modelLabel?: string } {
        const sid = sessionId || this._sessionId;
        const session = this._sessions.find(s => s.id === sid);
        if (session?.modelId) {
            return { modelId: session.modelId, modelLabel: session.modelLabel };
        }
        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        return { modelId: profileState.modelId, modelLabel: profileState.modelLabel };
    }

    private _syncPromptUiIfReturningToOwner(): void {
        if (!this._promptSessionId || this._promptSessionId !== this._sessionId) {
            return;
        }
        if (this._acp?.status !== 'prompting') {
            return;
        }
        this._postMessage({ type: 'status', status: 'prompting', sessionId: this._sessionId });
        if (this._lastThoughtText) {
            this._postMessage({
                type: 'addMessage',
                role: 'thought',
                text: this._lastThoughtText,
                sessionId: this._sessionId,
            });
        }
        if (this._lastAssistantText) {
            this._postMessage({
                type: 'addMessage',
                role: 'assistant',
                text: this._lastAssistantText,
                sessionId: this._sessionId,
            });
        }
    }

    private async _ensureAcpReadyForCurrentSession(): Promise<void> {
        if (!this._acp) {
            return;
        }
        if (this._otherSessionIsPrompting()) {
            await this._detachActivePrompt(this._promptSessionId!, { savePartial: true });
        }
        const needsContextReset = this._acpBoundSessionId !== this._sessionId;
        await this._applySessionModelPreference({ forceReset: needsContextReset });
        this._acpBoundSessionId = this._sessionId;
    }

    private _postPromptScopedMessage(msg: Record<string, unknown>): void {
        if (!this._isViewingPromptSession()) {
            return;
        }
        this._postMessage({ ...msg, sessionId: this._sessionId });
    }

    private _clearPromptStallTimer(): void {
        if (this._promptStallTimer) {
            clearTimeout(this._promptStallTimer);
            this._promptStallTimer = undefined;
        }
    }

    private _schedulePromptStallHint(): void {
        this._clearPromptStallTimer();
        this._promptStallTimer = setTimeout(() => {
            this._promptStallTimer = undefined;
            if (this._acp?.status !== 'prompting' || !this._isViewingPromptSession()) {
                return;
            }
            if (this._lastAssistantText || this._lastThoughtText) {
                return;
            }
            this._log('Prompt stall hint: Hermes still initializing');
            this._postMessage({
                type: 'status',
                status: 'prompting',
                message: localizeStatusMessage('Hermes is initializing...'),
                sessionId: this._sessionId,
            });
        }, 25000);
    }

    private async _detachActivePrompt(fromSessionId: string, options?: { savePartial?: boolean }): Promise<void> {
        if (!this._promptSessionId || this._promptSessionId !== fromSessionId) {
            return;
        }
        if (this._acp?.status !== 'prompting') {
            this._promptSessionId = undefined;
            this._lastAssistantText = '';
            this._lastThoughtText = '';
            return;
        }

        this._log(`Detaching in-flight prompt from session ${fromSessionId}`);
        if (options?.savePartial !== false) {
            this._flushThoughtToHistory();
            if (this._lastAssistantText.trim()) {
                this._saveMessage('assistant', this._lastAssistantText);
            }
        }
        this._lastAssistantText = '';
        this._lastThoughtText = '';
        this._sendEpoch++;
        this._cancelPendingPermissions();
        await this._acp?.cancel();
        this._promptSessionId = undefined;
    }

    private _restoreMessages(): void {
        if (this._sessionMessages.length === 0) return;
        this._log(`Restoring ${this._sessionMessages.length} messages (last 10)`);
        const totalCount = this._sessionMessages.length;
        const loadedCount = Math.min(10, totalCount);
        const slice = this._sessionMessages.slice(-loadedCount);
        this._postMessage({
            type: 'restoreHistory',
            messages: slice,
            totalCount,
            loadedCount,
            headerText: `Prior Session Loaded Successfully!`,
        });
    }

    /**
     * Convert the remote transcript that Hermes streams back during session/load
     * into local ChatMessages. This is the authoritative history pulled fresh
     * from Hermes — the extension never treats its on-disk cache as the source
     * of truth for a resumed session.
     */
    private _replayToChatMessages(replayed: ReplayMessage[]): ChatMessage[] {
        if (!replayed || replayed.length === 0) {
            return [];
        }
        return replayed.map((m, i) => {
            const entry: ChatMessage = {
                role: m.role,
                text: m.text || '',
                timestamp: Date.now() + i,
            };
            if (m.toolCallId) {
                entry.toolCallId = m.toolCallId;
            }
            return entry;
        });
    }

    private _offerContextAttach(messages: ChatMessage[]): void {
        if (this._getContextAttachVisibility() === 'never') {
            this._clearContextAttachOffer();
            return;
        }
        const hasHistory = messages.some(m => (m.text || '').trim());
        if (!hasHistory) {
            this._clearContextAttachOffer();
            return;
        }
        this._contextAttachMessages = filterAttachableMessages(messages);
        this._contextAttachActive = true;
        this._postMessage({ type: 'showContextAttach', count: this._contextAttachMessages.length });
    }

    private _getContextAttachVisibility(): ContextAttachVisibility {
        const value = vscode.workspace.getConfiguration('hermes').get<string>('contextAttachVisibility', 'onNewSession');
        if (value === 'always' || value === 'never') {
            return value;
        }
        return 'onNewSession';
    }

    private _applyContextAttachVisibility(): void {
        const mode = this._getContextAttachVisibility();
        if (mode === 'never') {
            this._clearContextAttachOffer();
            return;
        }
        if (mode === 'always') {
            this._offerContextAttach(this._sessionMessages);
            return;
        }
        if (this._contextAttachActive && !this._contextAttachAwaitingReply) {
            this._clearContextAttachOffer();
        }
    }

    private _clearContextAttachOffer(): void {
        if (!this._contextAttachActive && !this._contextAttachAwaitingReply) {
            return;
        }
        this._contextAttachActive = false;
        this._contextAttachAwaitingReply = false;
        this._contextAttachMessages = [];
        this._postMessage({ type: 'hideContextAttach' });
    }

    private _buildPromptText(userText: string, option: ContextAttachOption | undefined): string {
        if (!this._contextAttachActive) {
            return userText;
        }
        const attachOption: ContextAttachOption = option?.mode
            ? option
            : { mode: 'none' };
        const picked = attachOption.mode === 'custom'
            ? resolveCustomAttachMessages(this._sessionMessages, attachOption.indices)
            : resolveAttachMessages(this._contextAttachMessages, attachOption);
        if (picked.length === 0) {
            return userText;
        }
        return composePromptWithContext(userText, picked, getWebviewLocale());
    }

    private _completeContextAttachAfterSuccessfulReply(): void {
        if (!this._contextAttachAwaitingReply) {
            return;
        }
        this._contextAttachAwaitingReply = false;
        if (this._getContextAttachVisibility() === 'always') {
            return;
        }
        this._clearContextAttachOffer();
    }

    private _markSessionResetInWebview(): void {
        if (this._sessionMessages.length === 0) {
            return;
        }
        this._postMessage({ type: 'markSessionReset' });
    }

    private _saveMessage(role: string, text: string, toolCallId?: string, images?: ChatImage[], files?: ChatFile[]): void {
        const entry: ChatMessage = { role, text, timestamp: Date.now(), toolCallId };
        if (images && images.length) {
            // Strip the base64 payload for on-disk history to keep the JSON small;
            // we keep name/mime so the UI can still show attachment chips.
            entry.images = images.map(img => ({ name: img.name, mimeType: img.mimeType, data: '' }));
        }
        if (files && files.length) {
            // Persist only name + mime so the UI can show file chips on restore;
            // the full contents are dropped to keep sessions.json small.
            entry.files = files.map(f => ({ name: f.name, mimeType: f.mimeType, text: '' }));
        }
        this._sessionMessages.push(entry);
        this._persistMessages();
    }

    private _upsertToolMessage(toolCallId: string, text: string): void {
        const stored = this._findToolMessage(toolCallId);
        if (stored) {
            if (stored.aggregatedTools?.length) {
                const entry = stored.aggregatedTools.find(t => t.toolCallId === toolCallId);
                if (entry) {
                    entry.text = text;
                }
                stored.text = rebuildAggregatedToolText(stored.aggregatedTools);
            } else {
                stored.text = text;
            }
            stored.timestamp = Date.now();
            this._persistMessages();
            return;
        }

        const last = this._sessionMessages[this._sessionMessages.length - 1];
        if (last?.role === 'tool' && canAggregateToolTexts(last.text, text)) {
            if (!last.aggregatedTools?.length) {
                last.aggregatedTools = [{
                    toolCallId: last.toolCallId || `tool_${last.timestamp}`,
                    text: last.text,
                }];
                delete last.toolCallId;
            }
            last.aggregatedTools.push({ toolCallId, text });
            last.text = rebuildAggregatedToolText(last.aggregatedTools);
            last.timestamp = Date.now();
            this._persistMessages();
            return;
        }

        this._saveMessage('tool', text, toolCallId);
    }

    private _findToolMessage(toolCallId: string): ChatMessage | undefined {
        return this._sessionMessages.find(m => {
            if (m.role !== 'tool') {
                return false;
            }
            if (m.toolCallId === toolCallId) {
                return true;
            }
            return m.aggregatedTools?.some(t => t.toolCallId === toolCallId) ?? false;
        });
    }

    private _flushThoughtToHistory(): void {
        const text = this._lastThoughtText.trim();
        if (!text) {
            return;
        }
        this._saveMessage('thought', text);
        this._lastThoughtText = '';
    }

    private _persistMessages(): void {
        try {
            const keep = this._sessionMessages.slice(-100);
            fs.writeFileSync(this._msgPath(this._sessionId), JSON.stringify(keep, null, 2));
            this._saveCurrentSession();
        } catch {
            // non-critical
        }
    }

    private _permissionBodyText(title?: string, detail?: string): string {
        const parts: string[] = [];
        if (title?.trim()) {
            parts.push(title.trim());
        }
        if (detail?.trim()) {
            parts.push(detail.trim());
        }
        return parts.join('\n\n');
    }

    private _savePermissionRequest(id: string, request: PermissionRequest): void {
        this._sessionMessages.push({
            role: 'permission',
            text: this._permissionBodyText(request.title, request.detail),
            timestamp: Date.now(),
            permissionId: id,
            title: request.title,
            detail: request.detail,
            options: request.options.map(o => ({
                optionId: o.optionId,
                name: o.name,
                kind: o.kind,
            })),
            resolved: false,
        });
        this._persistMessages();
    }

    private _updatePermissionRequestContent(id: string, title?: string, detail?: string): void {
        const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
        if (!stored || stored.resolved) {
            return;
        }
        if (title !== undefined) {
            stored.title = title;
        }
        if (detail !== undefined) {
            stored.detail = detail;
        }
        stored.text = this._permissionBodyText(stored.title, stored.detail);
        this._persistMessages();
    }

    private _resolvePermissionHistory(
        id: string,
        outcome: 'selected' | 'cancelled',
        selectedOptionId?: string,
        selectedLabel?: string
    ): void {
        const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
        if (!stored) {
            return;
        }
        stored.resolved = true;
        stored.outcome = outcome;
        stored.selectedOptionId = selectedOptionId;
        stored.selectedLabel = selectedLabel;
        if (outcome === 'selected' && selectedLabel) {
            stored.text = `${stored.text}\n\n${t('permissionSelected', selectedLabel)}`;
        } else if (outcome === 'cancelled') {
            stored.text = `${stored.text}\n\n${t('permissionCancelled')}`;
        }
        this._persistMessages();
    }

    private _loadHistory(): void {
        try {
            const p = this._msgPath(this._sessionId);
            if (fs.existsSync(p)) {
                const data = fs.readFileSync(p, 'utf-8');
                const messages: ChatMessage[] = JSON.parse(data);
                this._sessionMessages = messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                this._log(`Loaded ${this._sessionMessages.length} messages from history`);
            }
        } catch {
            this._sessionMessages = [];
        }
    }

    private _saveSessions(limit = 50): void {
        try {
            fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, limit), null, 2));
        } catch { /* ignore */ }
    }

    private _saveCurrentSession(): void {
        const firstUser = this._sessionMessages.find(m => m.role === 'user')?.text.slice(0, 40);
        const existing = this._sessions.find(s => s.id === this._sessionId);
        if (existing) {
            existing.updatedAt = Date.now();
            existing.messageCount = this._sessionMessages.length;
            if (firstUser && !existing.titleManual) {
                existing.title = firstUser;
            }
        } else {
            this._sessions.unshift({
                id: this._sessionId,
                title: firstUser || t('newChat'),
                createdAt: parseInt(this._sessionId, 36) || Date.now(),
                updatedAt: Date.now(),
                messageCount: this._sessionMessages.length,
            });
        }
        try {
            this._saveSessions();
            this._saveActiveSession();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _ensureSessionRegistered(): void {
        if (this._sessions.some(s => s.id === this._sessionId)) {
            return;
        }
        const firstUser = this._sessionMessages.find(m => m.role === 'user')?.text.slice(0, 40);
        this._sessions.unshift({
            id: this._sessionId,
            title: firstUser || t('newChat'),
            createdAt: parseInt(this._sessionId, 36) || Date.now(),
            updatedAt: Date.now(),
            messageCount: this._sessionMessages.length,
        });
        try {
            this._saveSessions();
        } catch { /* non-critical */ }
    }

    private _postSessionList(): void {
        this._postMessage({
            type: 'sessionList',
            sessions: this._sessions,
            activeSessionId: this._sessionId,
        });
    }

    private _loadSessions(): void {
        try {
            if (fs.existsSync(this._sessionsPath)) {
                this._sessions = JSON.parse(fs.readFileSync(this._sessionsPath, 'utf-8'));
                for (const session of this._sessions) {
                    this._backfillAgentEngaged(session);
                }
                this._normalizePinnedOrder();
            }
        } catch { this._sessions = []; }
    }

    private _normalizePinnedOrder(): void {
        this._sessions = [
            ...this._sessions.filter(s => s.pinned),
            ...this._sessions.filter(s => !s.pinned),
        ];
    }

    private _backfillAgentEngaged(session: SessionInfo): void {
        if (session.agentEngaged !== undefined) {
            return;
        }
        try {
            const p = this._msgPath(session.id);
            if (!fs.existsSync(p)) {
                session.agentEngaged = false;
                return;
            }
            const messages: ChatMessage[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
            session.agentEngaged = messages.some(m =>
                m.role === 'assistant' || m.role === 'thought' || m.role === 'tool'
            );
        } catch {
            session.agentEngaged = false;
        }
    }

    private _markSessionAgentEngaged(): void {
        const session = this._sessions.find(s => s.id === this._sessionId);
        if (!session || session.agentEngaged) {
            return;
        }
        session.agentEngaged = true;
        session.updatedAt = Date.now();
        try {
            this._saveSessions();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _resolveConnectionTarget(selectionId?: string): ConnectionTarget {
        const config = vscode.workspace.getConfiguration('hermes');
        const configPath = config.get<string>('path') || undefined;
        const configCwd = config.get<string>('cwd') || undefined;
        const configProfile = config.get<string>('profile') || undefined;
        const agents = this._readAgentConfigs();

        if (agents.length > 0) {
            const resolvedId = selectionId || this._activeSelectionId || agents[0].name;
            const agent = agents.find(a => a.name === resolvedId) || agents[0];
            return {
                scopeKey: sanitizeProfileScopeKey(agent.name),
                selectionId: agent.name,
                displayName: agent.name,
                cliProfile: normalizeHermesCliProfile(agent.profile ?? configProfile),
                configPath: agent.path || configPath,
                configCwd: agent.cwd || configCwd,
            };
        }

        const resolvedId = selectionId || this._activeSelectionId || normalizeHermesCliProfile(configProfile);
        const cliProfile = normalizeHermesCliProfile(resolvedId);
        return {
            scopeKey: scopeKeyForCliProfile(cliProfile),
            selectionId: cliProfile,
            displayName: this._profileLabelFor(cliProfile),
            cliProfile,
            configPath,
            configCwd,
        };
    }

    private _profileLabelFor(cliProfile: string): string {
        return normalizeHermesCliProfile(cliProfile) === 'default'
            ? t('defaultAgent')
            : cliProfile;
    }

    private _bindProfileScope(scopeKey: string): void {
        if (scopeKey === this._scopeKey) {
            return;
        }
        this._saveCurrentSession();
        this._scopeKey = scopeKey;
        this._sessionsPath = sessionsPathFor(this._historyDir, scopeKey);
        this._activeIdPath = activeSessionPathFor(this._historyDir, scopeKey, this._windowKey);
        this._sessions = [];
        this._loadSessions();
        this._sessionId = this._restoreActiveSession();
        this._sessionMessages = [];
        this._loadHistory();
        this._ensureSessionRegistered();
        this._postSessionList();
    }

    private async _ensureDiscoveredProfiles(): Promise<void> {
        if (this._readAgentConfigs().length > 0) {
            this._discoveredProfiles = null;
            return;
        }
        if (this._discoveredProfiles) {
            return;
        }
        if (this._profileDiscoveryPromise) {
            await this._profileDiscoveryPromise;
            return;
        }
        this._profileDiscoveryPromise = (async () => {
            const config = vscode.workspace.getConfiguration('hermes');
            const hermesPath = config.get<string>('path') || undefined;
            try {
                this._discoveredProfiles = await discoverHermesProfiles(hermesPath);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Profile discovery failed: ${msg}`);
                this._discoveredProfiles = ['default'];
            }
        })();
        try {
            await this._profileDiscoveryPromise;
        } finally {
            this._profileDiscoveryPromise = undefined;
        }
    }

    private _getProfileEntries(): ProfileListEntry[] {
        const agents = this._readAgentConfigs();
        if (agents.length > 0) {
            return agents.map(a => ({ id: a.name, label: a.name }));
        }
        const profiles = this._discoveredProfiles ?? ['default'];
        return profiles.map(p => ({
            id: p,
            label: this._profileLabelFor(p),
        }));
    }

    private async _syncModelState(options?: { preferRuntimeModel?: boolean }): Promise<void> {
        if (!this._acp) {
            this._modelState = null;
            this._postModelList();
            return;
        }

        const hermesModelsRaw = this._acp.getHermesModelsRaw();
        // fetchModelOptions() caches the result in-memory on the AcpClient,
        // so repeated calls are cheap. Fall back to that cache if the fetch
        // yields nothing (e.g. ACP method unsupported / gateway unavailable).
        let modelOptions: AcpModelOptionsResponse | null | undefined =
            await this._acp.fetchModelOptions();
        if (!modelOptions?.providers?.length) {
            modelOptions = this._acp.getCachedModelOptions();
        }

        const catalog = resolveModelCatalog(modelOptions, hermesModelsRaw);
        if (!catalog?.groups.length) {
            this._modelState = null;
            this._postModelList();
            return;
        }

        const profileState = loadProfileState(this._historyDir, this._scopeKey);
        const session = this._sessions.find(s => s.id === this._sessionId);

        // When resuming a remote Hermes session, the authoritative model is
        // the one the ACP session is actually running (captured into the
        // runtime model id during session/load) — not a local profile pref,
        // which would otherwise clobber the resumed session's real model.
        const runtimeModelId = options?.preferRuntimeModel ? this._acp.getRuntimeModelId() : '';
        const seedModelId = runtimeModelId || session?.modelId || profileState.modelId;
        const seedModelLabel = runtimeModelId ? undefined : (session?.modelLabel || profileState.modelLabel);

        this._modelState = buildModelListStateFromCatalog(catalog, null, {
            modelId: seedModelId,
            modelLabel: seedModelLabel,
        });
        this._postModelList();
    }

    private async _connect(selectionId?: string): Promise<void> {
        if (this._acp) return;
        if (this._connectPromise) {
            await this._connectPromise;
            return;
        }

        this._connectPromise = this._connectInner(selectionId);
        try {
            await this._connectPromise;
        } finally {
            this._connectPromise = undefined;
        }
    }

    private async _connectInner(selectionId?: string): Promise<void> {
        const target = this._resolveConnectionTarget(selectionId);
        if (target.scopeKey !== this._scopeKey) {
            this._bindProfileScope(target.scopeKey);
        }
        this._activeSelectionId = target.selectionId;
        this._activeAgentName = target.displayName;

        this._log(`Connecting as ${target.displayName} (profile=${target.cliProfile})...`);
        this._postMessage({ type: 'activeAgent', name: target.displayName });

        const cwd = this._resolveCwd(target.configCwd);

        this._postMessage({
            type: 'status',
            status: 'connecting',
            message: localizeStatusMessage('Starting Hermes ACP...'),
        });

        const quickPath = await tryResolveHermesQuick(target.configPath);
        let resolvedPath: string | undefined;
        if (quickPath) {
            this._log(`Hermes resolved without full detection: ${quickPath}`);
            resolvedPath = quickPath;
        } else {
            const report = await this._runEnvironmentDetectionWithUi(target.configPath, 'connect');
            if (report.status === 'cancelled') {
                this._log('Connect cancelled during environment detection');
                this._postMessage({
                    type: 'status',
                    status: 'disconnected',
                    message: t('detectEnvironmentCancelled'),
                });
                return;
            }
            resolvedPath = this._pickBestExecutable(report);
            if (this._shouldOfferHermesConfiguration(report)) {
                const configuredPath = await this._autoConfigureHermesPlugin(report);
                if (configuredPath) {
                    resolvedPath = configuredPath;
                }
            }
            if (!resolvedPath) {
                const msg = report.status === 'broken'
                    ? this._formatDetectBrokenMessage(report)
                    : t('detectEnvironmentNotFound');
                this._log(`Connect failed: ${msg}`);
                this._postMessage({ type: 'status', status: 'error', message: msg });
                return;
            }
        }

        this._acp = new AcpClient(
            (role, text, toolCallId) => {
                if (role === 'assistant' || role === 'thought' || role === 'tool' || role === 'diffPreview') {
                    this._clearPromptStallTimer();
                }
                this._postPromptScopedMessage({ type: 'addMessage', role, text, toolCallId });
                if (!this._promptSessionId) {
                    return;
                }
                this._withPromptSessionContext(() => {
                    if (role === 'user') {
                        this._saveMessage('user', text);
                    }
                    if (role === 'assistant') {
                        this._lastAssistantText = text;
                    }
                    if (role === 'thought') {
                        this._lastThoughtText = text;
                    }
                    if (role === 'tool' && toolCallId) {
                        this._upsertToolMessage(toolCallId, text);
                    } else if (role === 'tool') {
                        this._saveMessage('tool', text);
                    }
                    if (role === 'diffPreview') {
                        this._saveMessage('diffPreview', text);
                    }
                });
            },
            (status, msg) => {
                this._log(`Status: ${status}${msg ? ' — ' + msg : ''}`);
                if (status === 'ready' && this._deferReadyUntilSessionSetup) {
                    return;
                }
                if (this._isViewingPromptSession()) {
                    this._postMessage({
                        type: 'status',
                        status,
                        message: msg ? localizeStatusMessage(msg) : undefined,
                        sessionId: this._sessionId,
                    });
                }
                if (status === 'ready') {
                    this._clearPromptStallTimer();
                    if (this._promptSessionId) {
                        this._withPromptSessionContext(() => {
                            this._flushThoughtToHistory();
                            if (this._lastAssistantText) {
                                this._saveMessage('assistant', this._lastAssistantText);
                            }
                        });
                    }
                    this._lastAssistantText = '';
                    this._lastThoughtText = '';
                    this._promptSessionId = undefined;
                    if (this._isViewingPromptSession()) {
                        this._completeContextAttachAfterSuccessfulReply();
                    }
                }
                if (status === 'prompting') {
                    this._lastAssistantText = '';
                    this._lastThoughtText = '';
                    this._schedulePromptStallHint();
                }
            },
            async (request) => this._requestPermissionInChat(request),
            () => {
                this._log('Connection lost');
                this._cancelPendingPermissions();
                this._tokenUsage = null;
                this._postTokenUsage();
                this._acp = undefined;
            },
            {
                readTextFile: async (p: string) => {
                    this._log(`fs.readTextFile: ${p}`);
                    if (!this._isPathAllowed(p)) {
                        throw new Error(`Access denied: '${p}' is outside workspace folders`);
                    }
                    const uri = vscode.Uri.file(p);
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    return new TextDecoder().decode(bytes);
                },
                writeTextFile: async (p: string, content: string) => {
                    this._log(`fs.writeTextFile: ${p} (${content.length} chars)`);
                    if (!this._isPathAllowed(p)) {
                        throw new Error(`Access denied: '${p}' is outside workspace folders`);
                    }
                    const uri = vscode.Uri.file(p);
                    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
                },
            },
            (cmd: string, args: string[], cwd: string) => {
                this._log(`Terminal: ${cmd.slice(0, 80)}`);
                const fullCmd = args.length > 0 ? cmd + ' ' + args.join(' ') : cmd;
                const terminal = vscode.window.createTerminal({
                    name: `Hermes: ${cmd.slice(0, 30)}`,
                    cwd,
                });
                terminal.sendText(fullCmd);
                terminal.show(false);
            },
            (usage) => {
                if (!this._isViewingPromptSession()) {
                    return;
                }
                this._tokenUsage = usage;
                this._postTokenUsage();
            },
            () => {
                void this._syncModelState();
            },
            () => {
                if (!this._isViewingPromptSession()) {
                    return;
                }
                this._flushThoughtToHistory();
                this._postMessage({ type: 'finishAssistantBubble', sessionId: this._sessionId });
            },
            (commands) => {
                if (!this._isViewingPromptSession()) {
                    return;
                }
                this._postMessage({ type: 'slashCommands', commands, sessionId: this._sessionId });
            },
            (cwd) => {
                const servers = resolveMcpServersForSession(cwd);
                if (servers.length > 0) {
                    this._log(`Forwarding ${servers.length} MCP server(s) to Hermes: ${servers.map(s => s.name).join(', ')}`);
                }
                return servers;
            },
            // onFileToolCall: capture pre-change snapshot for inline diff preview
            (update) => {
                const { toolCallId, title, kind } = update;
                if (isFileMutatingTool(update)) {
                    const fp = extractFilePath(update);
                    if (fp) {
                        try {
                            this._inlineDiff.captureSnapshot(fp);
                            // Track for completion handler
                            if (typeof toolCallId === 'string') {
                                this._pendingFileTools.set(toolCallId, fp);
                            }
                        } catch (e) {
                            console.error('[inline-diff] captureSnapshot error:', e);
                        }
                    }
                }
            },
            // onFileToolComplete: read file and emit diff when tool finishes
            (update) => {
                const { toolCallId } = update;
                if (typeof toolCallId !== 'string') return;
                const filePath = this._pendingFileTools.get(toolCallId);
                if (!filePath) return;
                this._pendingFileTools.delete(toolCallId);
                this._inlineDiff.completeSnapshot(filePath);
            }
        );

        // Wire up inline diff previews — sends colored diffs to the webview
        this._inlineDiff.onDiffPreview((filePath, diff) => {
            this._postMessage({
                type: 'addMessage',
                role: 'diffPreview',
                text: JSON.stringify({ filePath, diff, toolCallId: '' }),
                sessionId: this._sessionId,
            });
        });
        this._acp.onLog = (line: string) => {
            logToFile(`[Hermes Agent stderr] ${line}`);
            const level = classifyLogLevel(line);
            if (level) {
                this._postWebviewLog(line, level);
            }
        };
        this._deferReadyUntilSessionSetup = true;
        try {
            await this._acp.start(cwd, resolvedPath, target.cliProfile);

            // After ACP is connected but before creating a session, show the
            // session picker so the user can resume an existing Hermes session
            // or start a new one. No session is auto-loaded: the picker waits
            // for an explicit choice. The same picker is reused later via the
            // "Open Session Menu" view-bar icon (openSessionMenu()).
            let sessionReady = false;
            const pickedId = await this._openSessionMenu();
            if (pickedId) {
                this._log(`User picked Hermes session: ${pickedId.slice(0, 8)}...`);
                const replayed = await this._acp.loadSession(pickedId, cwd);
                // Adopt the picked session id so history/model resolve against
                // the resumed session, not a stale/empty local id.
                this._sessionId = pickedId;
                this._acpBoundSessionId = pickedId;
                this._saveActiveSession();
                // Use the authoritative remote transcript streamed by Hermes
                // during session/load — NOT the stale on-disk cache. The
                // extension never owns session history; it always pulls fresh.
                this._sessionMessages = this._replayToChatMessages(replayed);
                this._persistMessages();
                this._postMessage({ type: 'newChat' });
                this._restoreMessages();
                this._postSessionList();
                sessionReady = true;
            } else {
                this._log('No session chosen — creating a new one');
            }

            if (!sessionReady) {
                await this._handleNewChat(true);
            }

            // Sync model state from the (possibly resumed) ACP session's
            // runtime model. For a resumed remote session we must trust the
            // loaded session's actual model, not the local profile pref.
            await this._syncModelState({ preferRuntimeModel: sessionReady && !!pickedId });
            if (!pickedId) {
                await this._applySessionModelPreference();
            }

            // Kick off a background TUI gateway model fetch for the full
            // provider + pricing catalog, then refresh the picker when it
            // returns (the result lives in the AcpClient's in-memory cache).
            this._acp.fetchModelOptions().then((fullCatalog) => {
                if (fullCatalog?.providers?.length) {
                    this._log(`TUI gateway: ${fullCatalog.providers.length} providers`);
                    void this._syncModelState();
                }
            }).catch(() => {});
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Connect failed: ${msg}`);
            this._acp?.dispose();
            this._acp = undefined;
        } finally {
            this._deferReadyUntilSessionSetup = false;
            if (this._acp) {
                this._acpBoundSessionId = this._sessionId;
            }
            if (this._acp?.status === 'ready') {
                this._postMessage({ type: 'status', status: 'ready' });
            }
        }
    }

    /**
     * Open the Hermes session picker (the "session menu"). Lists all remote
     * Hermes sessions via ACP session/list and waits for the user to pick one
     * or start a new session. Used both on initial connect and when the
     * "Open Session Menu" view-bar icon is clicked. Resolves with the chosen
     * session id, or null when the user opted to start a new session / the
     * picker timed out.
     */
    private async _openSessionMenu(): Promise<string | null> {
        if (!this._acp) {
            return null;
        }
        let hermesSessions: import('../acp/AcpClient').HermesSessionSummary[] = [];
        try {
            hermesSessions = await this._acp.listSessions();
            this._log(`Found ${hermesSessions.length} Hermes session(s)`);
        } catch (listErr) {
            this._log(`Session list failed: ${listErr instanceof Error ? listErr.message : String(listErr)}`);
        }

        // Clear the UI before showing the picker so no stale content is visible
        // while the user makes their choice.
        this._postMessage({ type: 'newChat' });

        const pickPromise = new Promise<string | null>((resolve) => {
            this._pendingSessionPick = resolve;
            // Safety timeout: if no selection within 2 minutes, auto-create a
            // new session to avoid hanging indefinitely.
            setTimeout(() => {
                if (this._pendingSessionPick === resolve) {
                    this._log('Session picker timed out — creating new session');
                    this._pendingSessionPick = null;
                    resolve(null);
                }
            }, 120_000);
        });

        this._postMessage({
            type: 'showSessionPicker',
            sessions: hermesSessions.map(s => ({
                sessionId: s.sessionId,
                title: s.title || undefined,
                cwd: s.cwd,
                updatedAt: s.updatedAt || undefined,
            })),
        });

        const pickedId = await pickPromise;
        this._pendingSessionPick = null;
        return pickedId;
    }

    /** Public entry for the "Open Session Menu" view-bar icon command. */
    public async openSessionMenu(): Promise<void> {
        if (!this._acp) {
            this._log('Cannot open session menu — not connected');
            return;
        }
        const pickedId = await this._openSessionMenu();
        const cwd = this._resolveCwd();
        if (!pickedId) {
            this._log('No session chosen — creating a new one via ACP');
            await this._handleNewChat();
            return;
        }
        try {
            this._log(`Switching to Hermes session: ${pickedId.slice(0, 8)}...`);
            const replayed = await this._acp.loadSession(pickedId, cwd);
            this._sessionId = pickedId;
            this._acpBoundSessionId = pickedId;
            this._saveActiveSession();
            // Fresh pull from Hermes — not the stale on-disk cache.
            this._sessionMessages = this._replayToChatMessages(replayed);
            this._persistMessages();
            this._postMessage({ type: 'newChat' });
            this._restoreMessages();
            // Trust the resumed session's actual runtime model, not the local pref.
            await this._syncModelState({ preferRuntimeModel: true });
        } catch (err) {
            this._log(`Load session failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private _enqueueChatOp(op: () => Promise<void>): void {
        this._chatOpChain = this._chatOpChain
            .then(op)
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`Chat operation failed: ${msg}`);
            });
    }

    private async _awaitSessionReady(): Promise<void> {
        if (this._connectPromise) {
            await this._connectPromise.catch(() => {});
        }
    }

    private _requestPermissionInChat(request: PermissionRequest): Promise<string | null> {
        this._log(`Permission requested: ${request.title.slice(0, 80)}`);
        return new Promise((resolve) => {
            const id = `perm_${++this._permissionCounter}`;
            this._pendingPermissions.set(id, resolve);
            this._savePermissionRequest(id, request);
            this._postMessage({
                type: 'permissionRequest',
                id,
                title: request.title,
                detail: request.detail,
                options: request.options,
            });
        });
    }

    private _handlePermissionResponse(id: string, optionId: string | null): void {
        const pending = this._pendingPermissions.get(id);
        if (!pending) {
            return;
        }
        this._pendingPermissions.delete(id);
        if (optionId) {
            const stored = this._sessionMessages.find(m => m.permissionId === id && m.role === 'permission');
            const opt = stored?.options?.find(o => o.optionId === optionId);
            const label = opt
                ? resolvePermissionOptionLabel(getWebviewLocale(), opt)
                : optionId;
            this._log(`Permission approved: ${optionId}`);
            this._resolvePermissionHistory(id, 'selected', optionId, label);
            pending(optionId);
            return;
        }
        this._log('Permission cancelled');
        this._resolvePermissionHistory(id, 'cancelled');
        pending(null);
    }

    private _cancelPendingPermissions(): void {
        if (this._pendingPermissions.size === 0) {
            return;
        }
        for (const [id, resolve] of this._pendingPermissions) {
            this._resolvePermissionHistory(id, 'cancelled');
            resolve(null);
            this._postMessage({ type: 'permissionDismiss', id });
        }
        this._pendingPermissions.clear();
    }

    private _handlePermissionModeChange(mode: string | undefined): void {
        const validModes = ['manual', 'autoApprove', 'yolo', 'denyAll'];
        const resolved = validModes.includes(mode ?? '') ? mode! : 'manual';
        this._log(`Permission mode changed: ${resolved}`);
        const config = vscode.workspace.getConfiguration('hermes');
        void config.update('permissionMode', resolved, vscode.ConfigurationTarget.Global);
    }

    private async _handleReasoningEffortChange(effort: string | undefined): Promise<void> {
        const validEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
        const resolved = validEfforts.includes(effort ?? '') ? effort! : 'medium';
        this._log(`Reasoning effort changed: ${resolved}`);
        const config = vscode.workspace.getConfiguration('hermes');
        void config.update('reasoningEffort', resolved, vscode.ConfigurationTarget.Global);
        // Push to the running hermes acp backend so it picks up the new effort
        // without a full restart. `hermes config set agent.reasoning_effort`
        // writes the live config.yaml key the backend reads on the next turn.
        try {
            const executable = await findHermesExecutable(config.get<string>('path') || undefined);
            if (!executable) {
                this._log('Reasoning effort set locally; hermes executable not found to push live config');
                return;
            }
            const { spawn } = await import('child_process');
            await new Promise<void>((resolve) => {
                const proc = spawn(executable, ['config', 'set', 'agent.reasoning_effort', resolved], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    shell: process.platform === 'win32',
                });
                let stderr = '';
                proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
                proc.on('error', () => resolve());
                proc.on('exit', () => resolve());
                void stderr;
            });
            this._log(`Pushed reasoning effort to backend: agent.reasoning_effort=${resolved}`);
        } catch (err) {
            this._log(`Failed to push reasoning effort to backend: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async _handleRetry(): Promise<void> {
        this._log('Retry connection requested');
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();
        await this._connect(this._activeSelectionId || undefined);
    }

    /**
     * Fetch per-step usage from the hermes-telemetry local dashboard (loopback
     * only, no auth). The webview cannot call this directly — VS Code webview
     * CSP blocks arbitrary fetches — so the extension host performs the request
     * and posts the JSON back. Silently no-ops if the dashboard is unreachable.
     */
    private _fetchTelemetrySteps(session: string, requestId?: string): void {
        const url = `http://127.0.0.1:8765/api/steps?session=${encodeURIComponent(session || '')}`;
        const req = http.get(url, (res) => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                this._postMessage({ type: 'telemetryStepsResult', requestId, data: null });
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                let data: unknown = null;
                try { data = JSON.parse(body); } catch { data = null; }
                this._postMessage({ type: 'telemetryStepsResult', requestId, data });
            });
        });
        req.on('error', () => {
            this._postMessage({ type: 'telemetryStepsResult', requestId, data: null });
        });
        req.setTimeout(2000, () => {
            req.destroy();
            this._postMessage({ type: 'telemetryStepsResult', requestId, data: null });
        });
    }

    /** Handle user picking a Hermes session from the webview picker. */
    private _handlePickSession(sessionId?: string, action?: string): void {
        if (this._pendingSessionPick) {
            if (action === 'new') {
                this._log('User requested new Hermes session');
                this._pendingSessionPick(null);
            } else if (sessionId) {
                this._log(`User picked Hermes session: ${sessionId.slice(0, 8)}...`);
                this._pendingSessionPick(sessionId);
            }
        }
    }

    /** Handle user requesting session list refresh. */
    private async _handleRefreshSessions(): Promise<void> {
        this._log('Session list refresh requested');
        if (!this._acp) return;
        try {
            const sessions = await this._acp.listSessions();
            this._postMessage({
                type: 'showSessionPicker',
                sessions: sessions.map(s => ({
                    sessionId: s.sessionId,
                    title: s.title || undefined,
                    cwd: s.cwd,
                    updatedAt: s.updatedAt || undefined,
                })),
            });
        } catch (err) {
            this._log(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Handle user scrolling to top to load more history. */
    private _handleLoadMoreHistory(loadedCount: number): void {
        const totalCount = this._sessionMessages.length;
        if (loadedCount >= totalCount) {
            this._log(`No more history to load (${loadedCount}/${totalCount})`);
            return;
        }
        const nextBatch = Math.min(loadedCount + 10, totalCount);
        const slice = this._sessionMessages.slice(-nextBatch, -loadedCount);
        this._log(`Loading more history: ${nextBatch - loadedCount} messages (${nextBatch}/${totalCount})`);
        this._postMessage({
            type: 'prependHistory',
            messages: slice,
            totalCount,
            loadedCount: nextBatch,
        });
    }

    private _resetViewTitleToDefault(): void {
        if (!this._view) {
            return;
        }
        this._view.title = undefined;
        this._view.description = undefined;
    }

    private _setDetectContext(inProgress: boolean, reportAvailable: boolean): void {
        this._detectInProgress = inProgress;
        void vscode.commands.executeCommand('setContext', 'hermesDetectInProgress', inProgress);
        void vscode.commands.executeCommand('setContext', 'hermesDetectReportAvailable', reportAvailable);
    }

    private _handleDetectEnvironmentDismiss(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._log('Environment detection cancelled by user');
        }
    }

    private _postDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = this._formatDetectProgressPercent(event);
        this._postMessage({
            type: 'detectEnvironmentProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    private _clearViewDetectProgress(): void {
        this._resetViewTitleToDefault();
        this._detectStepLog = [];
        this._lastDetectReport = undefined;
        this._setDetectContext(false, false);
    }

    private _detectStepLabel(step: HermesDetectStepId): string {
        const keyMap: Record<HermesDetectStepId, keyof LocaleStrings> = {
            config: 'detectEnvironmentStepConfig',
            path_lookup: 'detectEnvironmentStepPath',
            known_path: 'detectEnvironmentStepKnownPath',
            pip: 'detectEnvironmentStepPip',
            python_import: 'detectEnvironmentStepPython',
            hermes_home: 'detectEnvironmentStepHermesHome',
            verify: 'detectEnvironmentStepVerify',
            acp_check: 'detectEnvironmentStepAcpCheck',
            acp_install: 'detectEnvironmentStepAcpInstall',
            summary: 'detectEnvironmentStepSummary',
        };
        return t(keyMap[step]);
    }

    private _formatDetectStepDetail(event: HermesDetectProgressEvent): string {
        if (event.status === 'running') {
            return '…';
        }
        if (event.status === 'skip') {
            return t('detectEnvironmentStepSkipped');
        }
        if (event.step === 'verify') {
            return formatLocaleString(
                t('detectEnvironmentStepVerifyCount'),
                event.verifiedCount ?? 0,
                event.totalCount ?? 0,
            );
        }
        if (event.step === 'acp_check') {
            if (event.status === 'ok') {
                return event.detail || t('detectEnvironmentStepAcpOk');
            }
            if (event.status === 'fail') {
                return event.detail || t('detectEnvironmentStepAcpFail');
            }
        }
        if (event.step === 'acp_install') {
            if (event.status === 'ok') {
                return event.detail || t('detectEnvironmentStepAcpInstallOk');
            }
            if (event.status === 'fail') {
                return event.detail || t('detectEnvironmentStepAcpInstallFail');
            }
        }
        if (event.step === 'summary') {
            if (event.detail) {
                return event.detail;
            }
            if (event.reportStatus === 'ready') return t('detectEnvironmentSummaryReady');
            if (event.reportStatus === 'broken') return t('detectEnvironmentSummaryBroken');
            return t('detectEnvironmentSummaryInstall');
        }
        if ((event.count ?? 0) > 0) {
            const summary = formatLocaleString(t('detectEnvironmentStepFoundCount'), event.count ?? 0);
            if (event.detail) {
                return `${summary}\n${event.detail}`;
            }
            return summary;
        }
        if (event.status === 'fail' && event.detail) {
            return event.detail;
        }
        return t('detectEnvironmentStepNotFound');
    }

    private _formatDetectProgressPercent(event: HermesDetectProgressEvent): string {
        const total = this._detectStepOrder.length;
        if (total === 0) {
            return '0%';
        }
        const stepIndex = this._detectStepOrder.indexOf(event.step);
        if (stepIndex < 0) {
            return '0%';
        }
        let completed = stepIndex;
        if (event.status !== 'running') {
            completed = stepIndex + 1;
        }
        if (event.step === 'summary' && event.status !== 'running') {
            completed = total;
        }
        const percent = Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
        return `${percent}%`;
    }

    private _formatDetectProgressBrief(event: HermesDetectProgressEvent): string {
        const label = this._detectStepLabel(event.step);
        const detail = this._formatDetectStepDetail(event).split('\n')[0] || '';
        return detail ? `${label} · ${detail}` : label;
    }

    private _formatDetectBrokenMessage(report: HermesEnvironmentReport): string {
        const hasVerifiedHermes = report.executables.some((item) => item.verified);
        if (hasVerifiedHermes && !report.diagnostics.acpOk) {
            return report.diagnostics.acpInstallAttempted
                ? t('detectEnvironmentSummaryAcpManual')
                : t('detectEnvironmentSummaryAcpBroken');
        }
        return t('detectEnvironmentBroken');
    }

    private _formatDetectSummaryForReport(report: HermesEnvironmentReport): string {
        if (report.status === 'not_found') {
            return t('detectEnvironmentSummaryInstall');
        }
        if (report.status === 'broken') {
            const hasVerifiedHermes = report.executables.some((item) => item.verified);
            if (hasVerifiedHermes && !report.diagnostics.acpOk) {
                if (report.diagnostics.acpInstallAttempted) {
                    return t('detectEnvironmentSummaryAcpManual');
                }
                return t('detectEnvironmentSummaryAcpBroken');
            }
            return t('detectEnvironmentSummaryBroken');
        }
        if (
            report.recommendation.action === 'configure_plugin'
        ) {
            return t('detectEnvironmentSummaryConfigureViaMenu');
        }
        return t('detectEnvironmentSummaryReady');
    }

    private _recordDetectStep(event: HermesDetectProgressEvent): void {
        const entry: DetectStepLogEntry = {
            step: event.step,
            label: this._detectStepLabel(event.step),
            detail: this._formatDetectStepDetail(event),
            status: event.status,
        };
        const index = this._detectStepLog.findIndex((item) => item.step === event.step);
        if (index >= 0) {
            this._detectStepLog[index] = entry;
        } else {
            this._detectStepLog.push(entry);
        }
    }

    private async _runEnvironmentDetectionWithUi(
        configuredPath?: string,
        mode: 'connect' | 'manual' | 'configure' = 'manual',
    ): Promise<HermesEnvironmentReport> {
        this._detectStepLog = [];
        this._detectAbortController?.abort();
        this._detectAbortController = new AbortController();
        const signal = this._detectAbortController.signal;
        const useConfigurePanel = mode === 'configure';
        if (!useConfigurePanel) {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._postMessage({ type: 'detectEnvironmentStart', mode });
        } else {
            this._setDetectContext(true, !!this._lastDetectReport);
            this._postMessage({ type: 'configureEnvironmentDetectStart' });
        }

        const report = await detectHermesEnvironment(configuredPath, {
            signal,
            onProgress: (event) => {
                if (useConfigurePanel) {
                    this._postConfigureDetectProgress(event);
                } else {
                    this._postDetectProgress(event);
                }
                this._recordDetectStep(event);
            },
        });
        this._detectAbortController = undefined;

        if (report.status === 'cancelled') {
            this._setDetectContext(false, false);
            if (useConfigurePanel) {
                this._postMessage({ type: 'configureEnvironmentDetectEnd', status: 'cancelled' });
            }
            return report;
        }

        this._logEnvironmentReport(report);
        this._lastDetectReport = report;
        const summaryStatus: HermesDetectStepStatus = report.status === 'ready' ? 'ok' : 'fail';
        const summaryText = this._formatDetectSummaryForReport(report);
        const summaryEvent: HermesDetectProgressEvent = {
            step: 'summary',
            status: summaryStatus,
            reportStatus: report.status,
            detail: summaryText,
        };
        this._recordDetectStep(summaryEvent);
        if (useConfigurePanel) {
            this._postConfigureDetectProgress(summaryEvent);
            this._postMessage({
                type: 'configureEnvironmentDetectEnd',
                status: report.status,
                summary: summaryText,
                executables: this._serializeConfigureExecutables(report.executables),
            });
        } else {
            this._postDetectProgress(summaryEvent);
            this._postMessage({
                type: 'detectEnvironmentEnd',
                status: report.status,
                mode,
                brief: '100%',
                summaryStatus,
            });
        }
        this._setDetectContext(false, true);
        return report;
    }

    public configureEnvironment(): void {
        if (this._detectInProgress) {
            return;
        }
        const config = vscode.workspace.getConfiguration('hermes');
        const systemEnv = this._getSystemPathEnvInfo();
        this._postMessage({
            type: 'configureEnvironmentOpen',
            currentPath: config.get<string>('path') || '',
            systemEnvVar: systemEnv.varName,
            systemEnvTarget: systemEnv.varTarget,
        });
    }

    private _getSystemPathEnvInfo(): { varName: string; varTarget: string } {
        if (process.platform === 'win32') {
            return {
                varName: 'Path',
                varTarget: t('detectEnvironmentSystemVarTargetWindows'),
            };
        }
        return {
            varName: 'PATH',
            varTarget: t('detectEnvironmentSystemVarTargetUnix'),
        };
    }

    private _postConfigureDetectProgress(event: HermesDetectProgressEvent): void {
        const brief = this._formatDetectProgressPercent(event);
        this._postMessage({
            type: 'configureEnvironmentDetectProgress',
            step: event.step,
            status: event.status,
            brief,
            detail: event.detail,
            paths: event.paths,
            count: event.count,
            verifiedCount: event.verifiedCount,
            totalCount: event.totalCount,
            reportStatus: event.reportStatus,
        });
    }

    private _serializeConfigureExecutables(
        executables: HermesExecutableCandidate[],
    ): Array<{ path: string; source: string; verified: boolean; version?: string }> {
        return executables.map((item) => ({
            path: item.path,
            source: this._detectSourceLabel(item.source),
            verified: item.verified,
            version: item.version,
        }));
    }

    private async _handleConfigureEnvironmentBrowse(): Promise<void> {
        const picked = await this._browseHermesExecutable();
        this._postMessage({
            type: 'configureEnvironmentBrowseResult',
            path: picked,
            error: picked ? undefined : t('configureEnvironmentInvalidPath'),
        });
    }

    private async _browseHermesExecutable(): Promise<string | undefined> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            title: t('configureEnvironmentBrowseTitle'),
            filters: process.platform === 'win32'
                ? { Executable: ['exe', 'cmd', 'bat'] }
                : undefined,
        });
        if (!picked?.[0]) {
            return undefined;
        }
        return this._resolveHermesFromBrowseSelection(picked[0].fsPath);
    }

    private async _resolveHermesFromBrowseSelection(fsPath: string): Promise<string | undefined> {
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(fsPath);
        } catch {
            return undefined;
        }
        if (stat.isFile()) {
            return (await accessExecutable(fsPath)) ? fsPath : undefined;
        }
        if (!stat.isDirectory()) {
            return undefined;
        }
        const exeName = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
        const direct = path.join(fsPath, exeName);
        if (await accessExecutable(direct)) {
            return direct;
        }
        for (const candidate of venvHermesCandidates(fsPath)) {
            if (await accessExecutable(candidate)) {
                return candidate;
            }
        }
        if (path.basename(fsPath) === 'hermes-agent') {
            const venvCandidates = process.platform === 'win32'
                ? [
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.exe'),
                    path.join(fsPath, 'venv', 'Scripts', 'hermes.cmd'),
                ]
                : [path.join(fsPath, 'venv', 'bin', 'hermes')];
            for (const candidate of venvCandidates) {
                if (await accessExecutable(candidate)) {
                    return candidate;
                }
            }
        }
        return undefined;
    }

    private async _handleConfigureEnvironmentDetect(currentPath?: string): Promise<void> {
        if (this._detectInProgress) {
            return;
        }
        const configuredPath = currentPath?.trim() || undefined;
        await this._runEnvironmentDetectionWithUi(configuredPath, 'configure');
    }

    private async _handleConfigureEnvironmentSave(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim() ?? '';
        if (trimmed && !(await accessExecutable(trimmed))) {
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        try {
            await this._configureHermesPluginPath(trimmed, { notify: false });
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: true,
                path: trimmed,
            });
            await this._connect(this._activeSelectionId || undefined);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentSaveFailed', msg),
            });
        }
    }

    private _handleConfigureEnvironmentDetectClose(): void {
        if (this._detectInProgress && this._detectAbortController) {
            this._detectAbortController.abort();
            this._log('Configure panel environment detection cancelled by user');
        }
        this._postMessage({ type: 'configureEnvironmentDetectClosed' });
    }

    private async _handleConfigureEnvironmentSystem(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed || !(await accessExecutable(trimmed))) {
            this._postMessage({
                type: 'configureEnvironmentSaveResult',
                ok: false,
                error: t('configureEnvironmentInvalidPath'),
            });
            return;
        }
        await this._confirmAndConfigureHermesSystemPath(trimmed);
    }

    private async _handleConfigureEnvironmentOpenDirectory(rawPath?: string): Promise<void> {
        const trimmed = rawPath?.trim();
        if (!trimmed) {
            return;
        }
        const directory = path.dirname(trimmed);
        await vscode.env.openExternal(vscode.Uri.file(directory));
    }

    private _pickBestExecutable(report: HermesEnvironmentReport): string | undefined {
        const verified = report.executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : report.executables;
        return pool[0]?.path;
    }

    private _shouldOfferHermesConfiguration(report: HermesEnvironmentReport): boolean {
        if (!this._pickBestExecutable(report)) {
            return false;
        }
        const workspaceConfig = vscode.workspace.getConfiguration('hermes');
        const configuredPath = workspaceConfig.get<string>('path')?.trim();
        const pluginConfigValid = !!configuredPath && report.executables.some(
            (item) => item.source === 'config' && item.verified,
        );
        const onSystemPath = report.executables.some(
            (item) => item.source === 'path_lookup' && item.verified,
        );
        return !(pluginConfigValid || onSystemPath);
    }

    private async _autoConfigureHermesPlugin(report: HermesEnvironmentReport): Promise<string | undefined> {
        const executable = await this._pickDetectedHermesExecutable(report.executables);
        if (!executable) {
            return undefined;
        }
        await this._configureHermesPluginPath(executable, { notify: false });
        return executable;
    }

    private async _confirmAndConfigureHermesSystemPath(executable: string): Promise<void> {
        const pathEntry = getHermesExecutableDirectory(executable);
        const { varName, varTarget } = this._getSystemPathEnvInfo();
        const choice = await vscode.window.showWarningMessage(
            t('detectEnvironmentConfigureSystemConfirm', pathEntry, varName, varTarget),
            { modal: true },
            t('detectEnvironmentConfigureSystemConfirmYes'),
            t('detectEnvironmentConfigureSystemConfirmNo'),
        );
        if (choice !== t('detectEnvironmentConfigureSystemConfirmYes')) {
            return;
        }
        await this._configureHermesSystemPath(executable);
    }

    private _logEnvironmentReport(report: HermesEnvironmentReport): void {
        const lines = [
            `Detect status=${report.status} install=${report.installMethod ?? 'unknown'}`,
            `pip=${report.diagnostics.pipInstalled} pythonImport=${report.diagnostics.pythonImportOk}`,
            `candidates=${report.executables.length}`,
        ];
        for (const item of report.executables) {
            lines.push(`  [${item.source}] ${item.path} verified=${item.verified}${item.version ? ` (${item.version})` : ''}`);
        }
        this._log(lines.join('\n'));
    }

    private _detectSourceLabel(source: HermesDetectSource): string {
        const keyMap: Record<HermesDetectSource, keyof import('../i18n/types').LocaleStrings> = {
            config: 'detectEnvironmentSourceConfig',
            path_lookup: 'detectEnvironmentSourcePathLookup',
            known_path: 'detectEnvironmentSourceKnownPath',
            pip: 'detectEnvironmentSourcePip',
            python_import: 'detectEnvironmentSourcePythonImport',
            hermes_home: 'detectEnvironmentSourceHermesHome',
        };
        return t(keyMap[source]);
    }

    private async _pickDetectedHermesExecutable(
        executables: HermesExecutableCandidate[],
    ): Promise<string | undefined> {
        const verified = executables.filter((item) => item.verified);
        const pool = verified.length > 0 ? verified : executables;
        if (pool.length === 1) {
            return pool[0].path;
        }
        const picked = await vscode.window.showQuickPick(
            pool.map((item) => {
                const statusLabel = item.verified
                    ? t('detectEnvironmentCandidateVerified')
                    : t('detectEnvironmentCandidateUnverified');
                const versionSuffix = item.version ? ` · ${item.version}` : '';
                return {
                    label: path.basename(item.path),
                    description: `${item.path} · ${this._detectSourceLabel(item.source)} · ${statusLabel}${versionSuffix}`,
                    executable: item.path,
                };
            }),
            {
                title: t('detectEnvironmentPickExecutable'),
                placeHolder: t('detectEnvironmentPickExecutable'),
            },
        );
        return picked?.executable;
    }

    private async _configureHermesPluginPath(
        executable: string,
        options?: { notify?: boolean },
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('hermes');
        await config.update('path', executable, vscode.ConfigurationTarget.Global);
        this._log(`Configured hermes.path: ${executable}`);
        if (options?.notify !== false) {
            void vscode.window.showInformationMessage(t('detectEnvironmentPluginConfigured', executable));
        }
    }

    private async _configureHermesSystemPath(executable: string): Promise<void> {
        try {
            const { varName, varTarget } = this._getSystemPathEnvInfo();
            const result = addHermesDirectoryToSystemPath(executable);
            if (result.alreadyPresent) {
                void vscode.window.showInformationMessage(
                    t('detectEnvironmentSystemAlreadyConfigured', varName, result.pathEntry),
                );
                return;
            }
            const target = result.profileFile || varTarget;
            const message = t('detectEnvironmentSystemConfigured', result.pathEntry, varName, target);
            const restart = t('detectEnvironmentSystemNeedsRestart');
            const choice = await vscode.window.showInformationMessage(message, restart);
            if (choice === restart) {
                void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`System PATH configuration failed: ${msg}`);
            await vscode.window.showErrorMessage(msg);
        }
    }

    private _postProfileList(): void {
        void this._ensureDiscoveredProfiles().then(() => {
            this._postMessage({ type: 'profileList', profiles: this._getProfileEntries() });
        });
    }

    private _postModelList(): void {
        const state = this._modelState;
        if (state) {
            this._postMessage({
                type: 'modelList',
                configId: state.configId,
                currentValueId: state.currentValueId,
                currentLabel: state.currentLabel,
                models: state.models,
                groups: state.groups,
                fromAgent: state.fromAgent,
            });
        } else {
            const { modelId: currentValueId, modelLabel: currentLabel } = this._resolveSessionModelId();
            this._postMessage({
                type: 'modelList',
                configId: '',
                currentValueId: currentValueId || '',
                currentLabel: currentLabel || '—',
                models: [],
                groups: [],
                fromAgent: false,
            });
        }
    }

    private _persistModelChoice(valueId: string, label: string): void {
        const session = this._sessions.find(s => s.id === this._sessionId);
        if (session) {
            session.modelId = valueId;
            session.modelLabel = label;
            this._saveSessions();
        }
        saveProfileState(this._historyDir, this._scopeKey, { modelId: valueId, modelLabel: label });
    }

    private async _resetAgentWithModel(valueId: string, configId?: string): Promise<void> {
        if (!this._acp || !valueId) {
            return;
        }

        // First, try to apply the model on the existing session via setModel.
        // If the session already has a model set, this will switch it in-place
        // WITHOUT creating a new session.
        if (this._acp.hasSession()) {
            const state = this._modelState ?? this._acp.getModelListState();
            const effectiveConfigId = configId || state?.configId || '';
            if (state && isRuntimeModelSource(effectiveConfigId)) {
                this._log(`Model change on existing session: ${valueId}`);
                try {
                    await this._acp.setModel(effectiveConfigId, valueId);
                    const runtimeId = this._acp.getRuntimeModelId();
                    if (runtimeId !== valueId) {
                        this._log(`Model apply incomplete: runtime=${runtimeId || '(none)'} expected=${valueId}`);
                    }
                    await this._syncModelState();
                    return;
                } catch (err) {
                    this._log(`Model change failed on existing session, creating new: ${err instanceof Error ? err.message : String(err)}`);
                    // Fall through to create new session
                }
            }
        }

        // Fallback: create a new session with the desired model
        const cwd = this._resolveCwd();
        await this._acp.createNewSession(cwd);
        const state = this._modelState ?? this._acp.getModelListState();
        const effectiveConfigId = configId || state?.configId || '';
        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            await this._syncModelState();
            return;
        }
        await this._acp.setModel(effectiveConfigId, valueId);
        const runtimeId = this._acp.getRuntimeModelId();
        if (runtimeId !== valueId) {
            this._log(`Model apply incomplete: runtime=${runtimeId || '(none)'} expected=${valueId}`);
        }
        await this._syncModelState();
    }

    private async _applySessionModelPreference(options?: { forceReset?: boolean }): Promise<void> {
        const forceReset = options?.forceReset ?? false;
        const { modelId: preferredId, modelLabel: preferredLabel } = this._resolveSessionModelId();
        if (!preferredId || !this._acp) {
            return;
        }
        const state = this._modelState ?? this._acp.getModelListState();
        if (!state || !isRuntimeModelSource(state.configId)) {
            return;
        }
        const runtimeId = this._acp.getRuntimeModelId();
        if (!forceReset && preferredId === runtimeId) {
            return;
        }
        const known = state.models.some(m => m.valueId === preferredId);
        if (!known) {
            const label = preferredLabel || preferredId;
            this._log(`Saved model not available: ${label}`);
            vscode.window.showWarningMessage(t('savedModelUnavailable', label));
            return;
        }
        try {
            this._log(`Apply session model: ${preferredLabel || preferredId}${forceReset ? ' (reset agent)' : ''}`);
            await this._resetAgentWithModel(preferredId, state.configId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Restore model failed: ${msg}`);
        }
    }

    private async _handleSwitchModel(configId: string, valueId: string): Promise<void> {
        const op = this._switchModel(configId, valueId);
        this._modelSwitchInFlight = op;
        try {
            await op;
        } finally {
            if (this._modelSwitchInFlight === op) {
                this._modelSwitchInFlight = undefined;
            }
        }
    }

    private async _switchModel(configId: string, valueId: string): Promise<void> {
        const state = this._modelState;
        const effectiveConfigId = configId || state?.configId || '';
        const picked = state?.models.find(m => m.valueId === valueId);
        const label = picked?.name ?? valueId;
        this._log(`Switch model: ${label} (config=${effectiveConfigId})`);

        if (this._acp && valueId) {
            if (this._acp.status === 'prompting') {
                vscode.window.showWarningMessage(t('waitForResponse'));
                return;
            }
            this._persistModelChoice(valueId, label);
            try {
                if (this._otherSessionIsPrompting()) {
                    await this._detachActivePrompt(this._promptSessionId!, { savePartial: true });
                }
                await this._resetAgentWithModel(valueId, effectiveConfigId);
                this._acpBoundSessionId = this._sessionId;
                this._log(`Model active: ${label}`);
                this._markSessionResetInWebview();
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`setModel failed: ${msg}`);
                vscode.window.showErrorMessage(t('failedSwitchModel', msg));
                return;
            }
        }

        vscode.window.showWarningMessage(t('hermesNotConnected'));
    }

    private async _handleUserMessage(text: string, contextAttach?: ContextAttachOption, images?: ChatImage[], files?: ChatFile[]): Promise<void> {
        const epoch = this._sendEpoch;
        await this._awaitSessionReady();
        if (epoch !== this._sendEpoch) {
            return;
        }
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
        if (epoch !== this._sendEpoch) {
            return;
        }
        this._log(`User message: ${text.slice(0, 80)}`);
        this._snapshotSessionModelFromProfile();
        this._promptSessionId = this._sessionId;
        this._saveMessage('user', text, undefined, images, files);
        this._markSessionAgentEngaged();
        if (this._contextAttachActive) {
            this._contextAttachAwaitingReply = true;
        }
        const promptText = this._buildPromptText(text, contextAttach);
        if (epoch !== this._sendEpoch) {
            return;
        }
        await this._ensureAcpReadyForCurrentSession();
        if (epoch !== this._sendEpoch) {
            return;
        }
        await this._acp?.sendMessage(promptText, images, files);
    }

    /**
     * Re-steer a turn that is already streaming. The host forwards the text to
     * Hermes as an in-flight session/update so the running generation absorbs
     * the correction. The user message is also echoed into the chat UI so the
     * user can see what they injected.
     */
    private async _handleSteerMessage(text: string): Promise<void> {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            return;
        }
        if (this._acp?.status !== 'prompting') {
            // Not mid-turn; fall back to a normal new message.
            await this._handleUserMessage(text);
            return;
        }
        this._log(`Steer message (mid-turn): ${trimmed.slice(0, 80)}`);
        const ok = await this._acp.sendSteerMessage(trimmed);
        if (ok) {
            // Echo the steering message into the UI as a user bubble.
            this._saveMessage('user', trimmed);
            this._postMessage({ type: 'steerEcho', text: trimmed, sessionId: this._sessionId });
        } else {
            // Steering failed (e.g. Hermes rejected the update) — send normally.
            await this._handleUserMessage(text);
        }
    }

    private async _handleCancel(): Promise<void> {
        this._sendEpoch++;
        this._clearPromptStallTimer();
        this._contextAttachAwaitingReply = false;
        await this._awaitSessionReady();
        this._flushThoughtToHistory();
        this._lastAssistantText = '';
        this._lastThoughtText = '';
        this._promptSessionId = undefined;
        this._cancelPendingPermissions();
        const wasPrompting = this._acp?.status === 'prompting';
        await this._acp?.cancel();
        this._postMessage({ type: 'finishAssistantBubble', sessionId: this._sessionId });
        if (!wasPrompting && this._acp?.status === 'ready') {
            this._postMessage({ type: 'status', status: 'ready', sessionId: this._sessionId });
        }
    }

    private _resolveFileUri(filePath: string): vscode.Uri | undefined {
        const normalized = filePath.replace(/^@/, '').trim();
        if (!normalized) {
            return undefined;
        }
        if (path.isAbsolute(normalized)) {
            return vscode.Uri.file(normalized);
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            for (const folder of folders) {
                const candidate = vscode.Uri.joinPath(folder.uri, normalized);
                if (this._isPathAllowed(candidate.fsPath)) {
                    return candidate;
                }
            }
            return vscode.Uri.joinPath(folders[0].uri, normalized);
        }
        return vscode.Uri.file(normalized);
    }

    private _toDisplayPath(uri: vscode.Uri): string {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) {
            return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        }
        return uri.fsPath.replace(/\\/g, '/');
    }

    private async _handleListFiles(query: string, requestId: string): Promise<void> {
        const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.hermes/**}';
        const q = query.trim().toLowerCase();
        try {
            const uris = await vscode.workspace.findFiles('**/*', exclude, 500);
            const files = uris
                .map(uri => this._toDisplayPath(uri))
                .filter(p => !q || p.toLowerCase().includes(q))
                .slice(0, 30);
            this._postMessage({ type: 'fileList', requestId, files });
        } catch {
            this._postMessage({ type: 'fileList', requestId, files: [] });
        }
    }

    private async _handlePreviewFile(filePath: string, requestId: string): Promise<void> {
        const normalized = filePath.replace(/^@/, '').trim();
        try {
            const uri = this._resolveFileUri(normalized);
            if (!uri || !this._isPathAllowed(uri.fsPath)) {
                this._postMessage({
                    type: 'filePreview',
                    requestId,
                    path: normalized,
                    error: t('fileAccessDenied'),
                });
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            const maxLines = 24;
            let content: string;
            if (doc.lineCount <= maxLines) {
                content = doc.getText();
            } else {
                const endLine = doc.lineAt(maxLines - 1);
                content = doc.getText(new vscode.Range(0, 0, maxLines - 1, endLine.text.length)) + '\n…';
            }
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: this._toDisplayPath(uri),
                content,
                language: doc.languageId,
            });
        } catch {
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: normalized,
                error: t('fileReadError'),
            });
        }
    }

    /**
     * Preview an image file on hover. We can't push a data: URL into a
     * vscode-resource-safe webview directly without CSP gymnastics, so we read
     * the bytes in the extension host, base64-encode them, and let the webview
     * render an <img> from a data: URI. Only image MIME types take this path;
     * everything else falls through to the text preview above.
     */
    private async _handlePreviewImageFile(filePath: string, requestId: string): Promise<void> {
        const normalized = filePath.replace(/^@/, '').trim();
        try {
            const uri = this._resolveFileUri(normalized);
            if (!uri || !this._isPathAllowed(uri.fsPath)) {
                this._postMessage({
                    type: 'filePreview',
                    requestId,
                    path: normalized,
                    error: t('fileAccessDenied'),
                });
                return;
            }
            const mime = this._imageMimeFor(uri.fsPath);
            if (!mime) {
                // Not actually an image — let the caller fall back to text.
                throw new Error('not-an-image');
            }
            const raw = fs.readFileSync(uri.fsPath);
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: this._toDisplayPath(uri),
                isImage: true,
                mimeType: mime,
                data: raw.toString('base64'),
            });
        } catch {
            this._postMessage({
                type: 'filePreview',
                requestId,
                path: normalized,
                error: t('fileReadError'),
            });
        }
    }

    private _imageMimeFor(filePath: string): string | undefined {
        const m = /\.([a-zA-Z0-9]+)$/.exec(filePath || '');
        const ext = m ? m[1].toLowerCase() : '';
        const byExt: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
            svg: 'image/svg+xml',
            avif: 'image/avif',
        };
        return byExt[ext];
    }

    private async _handleOpenFile(filePath: string): Promise<void> {
        this._log(`Open file: ${filePath}`);
        try {
            const uri = this._resolveFileUri(filePath);
            if (!uri) {
                vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
                return;
            }
            // Image files open in the main editor's image viewer (native,
            // zoomable) rather than as a text document showing binary garbage.
            if (this._imageMimeFor(uri.fsPath)) {
                await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
        }
    }

    /**
     * Open an image that lives only as base64 in a chat message (e.g. a user
     * attachment thumbnail) in the main VS Code editor. We cannot open a
     * data: URL directly, so we materialize the bytes to a scratch file under
     * the Hermes cache dir and open that. The file is content-addressed so
     * repeated opens of the same image reuse the same path (and the editor
     * just re-shows the existing tab) instead of littering new files.
     */
    private async _handleOpenImage(name: string, mimeType: string, data: string): Promise<void> {
        if (!data) {
            vscode.window.showWarningMessage(t('imageNoData'));
            return;
        }
        const cleanName = (name && path.basename(name)) || 'image';
        let buf: Buffer;
        try {
            buf = Buffer.from(data, 'base64');
        } catch {
            vscode.window.showWarningMessage(t('imageReadError'));
            return;
        }
        const ext = this._imageExtFor(mimeType, cleanName);
        const home = process.env.HERMES_HOME?.trim() || path.join(os.homedir(), '.hermes');
        const dir = path.join(home, 'cache', 'hermes-vscode-images');
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            vscode.window.showWarningMessage(t('imageWriteError'));
            return;
        }
        const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
        const baseName = cleanName.replace(/\.[^.]+$/, '') || 'image';
        const filePath = path.join(dir, `${baseName}-${hash}${ext}`);
        try {
            fs.writeFileSync(filePath, buf);
        } catch {
            vscode.window.showWarningMessage(t('imageWriteError'));
            return;
        }
        try {
            // Open in the main editor's native image viewer (zoomable, like a
            // double-clicked image) rather than as a text document that would
            // render the binary bytes as garbage.
            await vscode.commands.executeCommand(
                'vscode.open',
                vscode.Uri.file(filePath),
                { preview: false }
            );
        } catch {
            vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
        }
    }

    /**
     * Open a diff in the VS Code diff editor when the user clicks
     * "Open diff in editor" on an inline diff preview.
     */
    private async _handleOpenDiff(filePath: string, diff: string): Promise<void> {
        if (!filePath || !diff) {
            return;
        }
        const fileUri = vscode.Uri.file(filePath);

        // Read the current file content (right side of diff)
        let currentContent = '';
        try {
            const doc = await vscode.workspace.openTextDocument(fileUri);
            currentContent = doc.getText();
        } catch {
            // File may not exist
        }

        // Parse the diff to reconstruct the original content
        let originalContent = currentContent;
        try {
            const diffLines = diff.split('\n');
            const originalLines: string[] = [];
            let i = 0;

            // Skip file headers
            while (i < diffLines.length && (diffLines[i].startsWith('--- ') || diffLines[i].startsWith('+++ '))) {
                i++;
            }

            while (i < diffLines.length) {
                const line = diffLines[i];
                if (line.startsWith('@@')) {
                    // Skip hunk headers
                    i++;
                    continue;
                }
                if (line.startsWith('+')) {
                    // Added line — not in original
                    i++;
                    continue;
                }
                if (line.startsWith('-')) {
                    // Removed line — in original
                    originalLines.push(line.slice(1));
                    i++;
                    continue;
                }
                if (line.startsWith(' ')) {
                    // Context line — in both
                    originalLines.push(line.slice(1));
                    i++;
                    continue;
                }
                i++;
            }

            if (originalLines.length > 0) {
                originalContent = originalLines.join('\n');
            }
        } catch {
            // Fall back to current content
        }

        // Create virtual documents for the diff editor
        const originalDoc = await vscode.workspace.openTextDocument({
            content: originalContent,
            language: this._getLanguageId(filePath),
        });
        const modifiedDoc = await vscode.workspace.openTextDocument({
            content: currentContent,
            language: this._getLanguageId(filePath),
        });

        await vscode.commands.executeCommand(
            'vscode.diff',
            originalDoc.uri,
            modifiedDoc.uri,
            `Hermes: ${path.basename(filePath)}`,
        );
    }

    private _getLanguageId(filePath: string): string | undefined {
        const ext = path.extname(filePath).toLowerCase();
        const extMap: Record<string, string> = {
            '.ts': 'typescript', '.tsx': 'typescriptreact',
            '.js': 'javascript', '.jsx': 'javascriptreact',
            '.py': 'python', '.rb': 'ruby', '.go': 'go',
            '.rs': 'rust', '.java': 'java', '.c': 'c',
            '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
            '.css': 'css', '.scss': 'scss', '.less': 'less',
            '.html': 'html', '.htm': 'html', '.xml': 'xml',
            '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
            '.md': 'markdown', '.sql': 'sql', '.sh': 'shellscript',
            '.bash': 'shellscript', '.zsh': 'shellscript',
            '.vue': 'vue', '.svelte': 'svelte',
        };
        return extMap[ext];
    }

    private _imageExtFor(mimeType: string, name: string): string {
        const byMime: Record<string, string> = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp',
            'image/svg+xml': '.svg',
            'image/avif': '.avif',
        };
        if (mimeType && byMime[mimeType.toLowerCase()]) return byMime[mimeType.toLowerCase()];
        const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
        return m ? '.' + m[1].toLowerCase() : '.png';
    }

    private async _handleInsertEditor(text: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage(t('noActiveEditor'));
            return;
        }
        await editor.edit((editBuilder) => {
            editBuilder.insert(editor.selection.active, text);
        });
    }

    private _handleDeleteMessages(indices: unknown): void {
        if (!Array.isArray(indices) || indices.length === 0) {
            return;
        }
        const sorted = [...new Set(indices.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))]
            .sort((a, b) => b - a);
        for (const index of sorted) {
            if (index < this._sessionMessages.length) {
                this._sessionMessages.splice(index, 1);
            }
        }
        this._persistMessages();
        this._saveCurrentSession();
    }

    private async _handleClearChat(): Promise<void> {
        this._log('Clear Chat');
        this._clearContextAttachOffer();
        await this._detachActivePrompt(this._sessionId, { savePartial: false });
        this._sessionMessages = [];
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }

        const session = this._sessions.find(s => s.id === this._sessionId);
        if (session) {
            session.messageCount = 0;
            session.updatedAt = Date.now();
            session.title = t('newChat');
            session.titleManual = false;
            try {
                this._saveSessions();
            } catch { /* ignore */ }
        }

        const cwd = this._resolveCwd();
        if (this._acp) {
            await this._acp.createNewSession(cwd);
            await this._applySessionModelPreference();
            await this._syncModelState();
            this._acpBoundSessionId = this._sessionId;
        } else {
            await this._connect();
        }
        this._postMessage({ type: 'clearChat' });
        this._postSessionList();
    }

    /** Unified handler: start a fresh ACP session and set up local state.
     *  Used by "New Chat" (webview), "New Session" (picker), and initial connect.
     *  @param silent — if true, skip posting 'newChat' to webview (connect flow manages it). */
    private async _handleNewChat(silent: boolean = false): Promise<void> {
        this._log('New Chat');
        this._saveCurrentSession();
        this._sessionMessages = [];
        this._sessionId = Date.now().toString(36);
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }

        this._ensureSessionRegistered();
        this._snapshotSessionModelFromProfile();
        if (this._acp) {
            const cwd = this._resolveCwd();
            await this._acp.createNewSession(cwd);
            // Adopt the ACP session ID so local persistence uses the same
            // key as the remote session — otherwise resuming via the session
            // picker (which lists Hermes UUIDs) won't find the saved messages.
            const acpSessionId = this._acp.getSessionId();
            if (acpSessionId) {
                this._log(`Adopting ACP session ID: ${acpSessionId.slice(0, 8)}...`);
                // Save the old msg file under the new ID so any persisted
                // partial state is not lost.
                try {
                    const oldPath = this._msgPath(this._sessionId);
                    if (fs.existsSync(oldPath)) {
                        fs.renameSync(oldPath, this._msgPath(acpSessionId));
                    }
                } catch { /* non-critical */ }
                this._sessionId = acpSessionId;
                this._saveActiveSession();
            }
            await this._applySessionModelPreference();
        }
        if (!silent) {
            this._postMessage({ type: 'newChat' });
        }
        this._postSessionList();
        await this._syncModelStateForCurrentSession();
    }

    private async _handleSwitchSession(
        sessionId: string,
        options?: { skipSaveCurrent?: boolean; interrupt?: boolean }
    ): Promise<void> {
        if (sessionId === this._sessionId) {
            return;
        }
        if (this._currentSessionIsPrompting()) {
            if (!options?.interrupt) {
                return;
            }
            await this._detachActivePrompt(this._sessionId, { savePartial: true });
        } else if (this._otherSessionIsPrompting()) {
            await this._detachActivePrompt(this._promptSessionId!, { savePartial: true });
        }
        this._log(`Switch to session: ${sessionId}`);
        if (!options?.skipSaveCurrent) {
            this._saveCurrentSession();
        }
        this._sessionId = sessionId;
        this._sessionMessages = [];
        this._loadHistory();
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
        this._restoreMessages();
        await this._syncModelStateForCurrentSession();
        this._syncPromptUiIfReturningToOwner();
    }

    private _currentSessionIsPrompting(): boolean {
        return this._acp?.status === 'prompting'
            && !!this._promptSessionId
            && this._promptSessionId === this._sessionId;
    }

    private async _handleDeleteSession(sessionId: string): Promise<void> {
        this._log(`Delete session: ${sessionId}`);
        const idx = this._sessions.findIndex(s => s.id === sessionId);
        if (idx === -1) {
            return;
        }
        if (sessionId === this._promptSessionId) {
            await this._detachActivePrompt(sessionId, { savePartial: false });
        }
        this._sessions = this._sessions.filter(s => s.id !== sessionId);
        try {
            this._saveSessions();
            fs.unlinkSync(this._msgPath(sessionId));
        } catch { /* ignore */ }

        if (sessionId !== this._sessionId) {
            this._postSessionList();
            return;
        }

        if (this._sessions.length > 0) {
            const nextIdx = Math.min(idx, this._sessions.length - 1);
            // Skip save: deleted session is no longer in _sessions and must not be re-added.
            await this._handleSwitchSession(this._sessions[nextIdx].id, { skipSaveCurrent: true });
            return;
        }

        this._sessionMessages = [];
        this._sessionId = Date.now().toString(36);
        this._ensureSessionRegistered();
        this._snapshotSessionModelFromProfile();
        const cwd = this._resolveCwd();
        await this._acp?.createNewSession(cwd);
        await this._applySessionModelPreference();
        await this._syncModelState();
        this._acpBoundSessionId = this._sessionId;
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
    }

    private _handleRenameSession(sessionId: string, title: string): void {
        const session = this._sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        const trimmed = (title || '').trim().slice(0, 80) || t('newChat');
        session.title = trimmed;
        session.titleManual = true;
        session.updatedAt = Date.now();
        this._log(`Rename session ${sessionId}: ${trimmed}`);
        try {
            this._saveSessions();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _handleReorderSessions(sessionIds: unknown): void {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return;
        }
        const byId = new Map(this._sessions.map(s => [s.id, s]));
        const reordered: SessionInfo[] = [];
        for (const id of sessionIds) {
            if (typeof id !== 'string') {
                continue;
            }
            const session = byId.get(id);
            if (session) {
                reordered.push(session);
                byId.delete(id);
            }
        }
        for (const session of byId.values()) {
            reordered.push(session);
        }
        if (reordered.length !== this._sessions.length) {
            return;
        }
        const pinned = reordered.filter(s => s.pinned);
        const unpinned = reordered.filter(s => !s.pinned);
        this._sessions = [...pinned, ...unpinned];
        this._log(`Reorder sessions: ${this._sessions.map(s => s.id).join(', ')}`);
        try {
            this._saveSessions();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private async _handleCloseSessions(sessionId: string, mode: unknown): Promise<void> {
        if (typeof mode !== 'string' || !this._sessions.length) {
            return;
        }
        if (mode === 'self') {
            await this._handleDeleteSession(sessionId);
            return;
        }

        const ids = this._sessions.map(s => s.id);
        const idx = ids.indexOf(sessionId);
        let toDelete: string[] = [];
        switch (mode) {
            case 'others':
                if (idx === -1) {
                    return;
                }
                toDelete = ids.filter(id => id !== sessionId);
                break;
            case 'left':
                if (idx <= 0) {
                    return;
                }
                toDelete = ids.slice(0, idx);
                break;
            case 'right':
                if (idx === -1 || idx >= ids.length - 1) {
                    return;
                }
                toDelete = ids.slice(idx + 1);
                break;
            case 'all':
                toDelete = [...ids];
                break;
            default:
                return;
        }
        if (!toDelete.length) {
            return;
        }
        const focusId = mode === 'all' ? undefined : sessionId;
        await this._deleteSessionsBatch(toDelete, focusId);
    }

    private async _deleteSessionsBatch(toDelete: string[], focusSessionId?: string): Promise<void> {
        const deletingActive = toDelete.includes(this._sessionId);
        for (const id of toDelete) {
            this._sessions = this._sessions.filter(s => s.id !== id);
            try {
                fs.unlinkSync(this._msgPath(id));
            } catch { /* ignore */ }
        }
        try {
            this._saveSessions();
        } catch { /* ignore */ }

        if (this._sessions.length === 0) {
            this._sessionMessages = [];
            this._sessionId = Date.now().toString(36);
            this._ensureSessionRegistered();
            this._snapshotSessionModelFromProfile();
            const cwd = this._resolveCwd();
            await this._acp?.createNewSession(cwd);
            await this._applySessionModelPreference();
            await this._syncModelState();
            this._acpBoundSessionId = this._sessionId;
            this._postMessage({ type: 'newChat' });
            this._postSessionList();
            return;
        }

        if (deletingActive) {
            const nextId = focusSessionId && this._sessions.some(s => s.id === focusSessionId)
                ? focusSessionId
                : this._sessions[0].id;
            await this._handleSwitchSession(nextId, { skipSaveCurrent: true });
            return;
        }

        if (focusSessionId && focusSessionId !== this._sessionId && this._sessions.some(s => s.id === focusSessionId)) {
            await this._handleSwitchSession(focusSessionId, { skipSaveCurrent: true });
            return;
        }

        this._postSessionList();
    }

    private _handleTogglePinSession(sessionId: string): void {
        const idx = this._sessions.findIndex(s => s.id === sessionId);
        if (idx === -1) {
            return;
        }
        const session = this._sessions[idx];
        session.pinned = !session.pinned;
        this._sessions.splice(idx, 1);
        if (session.pinned) {
            let lastPinnedIdx = -1;
            for (let i = 0; i < this._sessions.length; i++) {
                if (this._sessions[i].pinned) {
                    lastPinnedIdx = i;
                }
            }
            this._sessions.splice(lastPinnedIdx + 1, 0, session);
        } else {
            const firstUnpinnedIdx = this._sessions.findIndex(s => !s.pinned);
            const insertAt = firstUnpinnedIdx === -1 ? this._sessions.length : firstUnpinnedIdx;
            this._sessions.splice(insertAt, 0, session);
        }
        session.updatedAt = Date.now();
        this._log(`${session.pinned ? 'Pin' : 'Unpin'} session ${sessionId}`);
        try {
            this._saveSessions();
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private _handleSessionExport(sessionId: string, action: unknown, indices?: unknown, format?: unknown): void {
        if (action !== 'copy' && action !== 'export') {
            return;
        }
        const session = this._sessions.find(s => s.id === sessionId);
        if (!session) {
            return;
        }
        let messages = sessionId === this._sessionId
            ? this._sessionMessages
            : this._loadSessionMessagesFromDisk(sessionId);
        if (Array.isArray(indices) && indices.length > 0) {
            const pick = new Set(
                indices.filter((index): index is number => typeof index === 'number' && index >= 0)
            );
            messages = messages.filter((_, index) => pick.has(index));
        }
        const exportFormat = format === 'json' ? 'json' : 'markdown';
        const payload = this._buildSessionExportPayload(session, messages, exportFormat);
        this._postMessage({
            type: 'sessionExport',
            action,
            ...payload,
        });
    }

    /**
     * Host bridge for clipboard writes. The webview cannot reliably access
     * `navigator.clipboard` (it is often unavailable inside VS Code webviews),
     * so all copy operations post a `clipboardWrite` message here and we use
     * the extension host's `vscode.env.clipboard.writeText`, which works
     * regardless of webview sandboxing.
     */
    private async _handleClipboardWrite(text: string): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(text);
        } catch (err) {
            this._log('Failed to write to clipboard: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    /** Public entry point for the `vscode.drop` command (host-side file drop). */
    public async handleDrop(dataTransfer: vscode.DataTransfer): Promise<void> {
        await this._handleDrop(dataTransfer);
    }

    /**
     * Host-side handler for files dropped onto the chat WebviewView. A
     * WebviewView cannot receive native drag-and-drop (enableDragAndDrop is
     * WebviewPanel-only), so VS Code routes the drop to the `vscode.drop`
     * command with a DataTransfer. We read the files here and forward their
     * parsed contents to the webview, which queues them as attachments.
     */
    private async _handleDrop(dataTransfer: vscode.DataTransfer): Promise<void> {
        try {
            const MAX_FILE_BYTES = 512 * 1024;
            const uris: vscode.Uri[] = [];
            // Files from the Explorer arrive as vscode.Uri entries under common
            // mime types; fall back to iterating every entry.
            const tryKeys = ['text/uri-list', 'application/vnd.code.tree.hermesChat', 'uri-list'];
            for (const key of tryKeys) {
                const item = dataTransfer.get(key);
                if (!item) continue;
                try {
                    const val = await item.asString();
                    if (!val) continue;
                    val.split(/\r?\n/).forEach((line) => {
                        const trimmed = line.trim();
                        if (trimmed && !trimmed.startsWith('#')) {
                            try { uris.push(vscode.Uri.parse(trimmed)); } catch { /* ignore */ }
                        }
                    });
                } catch { /* ignore */ }
            }
            // Also collect any Uri-typed entries directly.
            dataTransfer.forEach((_name, item) => {
                const v = (item as unknown as { value?: vscode.Uri }).value;
                if (v && typeof v.fsPath === 'string' && !uris.some((u) => u.fsPath === v.fsPath)) {
                    uris.push(v);
                }
            });

            if (!uris.length) {
                this._log('Drop: no file URIs found in DataTransfer');
                return;
            }

            const images: Array<{ name: string; mimeType: string; data: string }> = [];
            const files: Array<{ name: string; mimeType: string; text: string }> = [];
            for (const uri of uris) {
                try {
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > MAX_FILE_BYTES) {
                        this._log(`Drop: skipping large file ${uri.fsPath} (${stat.size} bytes)`);
                        continue;
                    }
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
                    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
                    if (imageExts.includes(ext)) {
                        const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                        const base64 = Buffer.from(bytes).toString('base64');
                        images.push({ name: uri.fsPath.split(/[\\/]/).pop() ?? 'image', mimeType: mime, data: base64 });
                    } else if (stat.type === vscode.FileType.File) {
                        const text = Buffer.from(bytes).toString('utf8');
                        files.push({ name: uri.fsPath.split(/[\\/]/).pop() ?? 'file', mimeType: 'text/plain', text });
                    } else {
                        this._log(`Drop: skipping non-file entry ${uri.fsPath} (type ${stat.type})`);
                        continue;
                    }
                } catch (err) {
                    this._log('Drop: failed to read ' + uri.fsPath + ': ' + (err instanceof Error ? err.message : String(err)));
                }
            }

            this._postMessage({ type: 'droppedFiles', images, files });
        } catch (err) {
            this._log('Drop handling failed: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private _loadSessionMessagesFromDisk(sessionId: string): ChatMessage[] {
        try {
            const p = this._msgPath(sessionId);
            if (!fs.existsSync(p)) {
                return [];
            }
            const messages: ChatMessage[] = JSON.parse(fs.readFileSync(p, 'utf-8'));
            return messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } catch {
            return [];
        }
    }

    private _buildSessionExportPayload(
        session: SessionInfo,
        messages: ChatMessage[],
        format: 'markdown' | 'json' = 'markdown'
    ): {
        sessionId: string;
        title: string;
        markdown: string;
        json: string;
        format: 'markdown' | 'json';
        filename: string;
    } {
        const loc = getWebviewLocale();
        const title = session.title || t('newChat');
        const model = session.modelLabel || session.modelId || this._modelState?.currentLabel || '—';
        const exportedAt = new Date();
        const exportedMessages = messages
            .filter(m => (m.text || '').trim().length > 0)
            .map(m => ({ role: m.role, text: m.text }));
        const json = JSON.stringify(
            {
                sessionId: session.id,
                title,
                model,
                exportedAt: exportedAt.toISOString(),
                messages: exportedMessages,
            },
            null,
            2
        );
        const header = [
            `# ${title}`,
            `> ${formatLocaleString(loc.sessionExportSessionId, session.id)}`,
            `> ${formatLocaleString(loc.sessionExportModel, model)}`,
            `> ${formatLocaleString(loc.sessionExportDate, this._formatExportDateTime(exportedAt))}`,
            '',
        ].join('\n');
        const body = this._formatMessagesAsMarkdown(messages);
        return {
            sessionId: session.id,
            title,
            markdown: body ? `${header}\n${body}` : header,
            json,
            format,
            filename: `${this._sanitizeExportFilename(title)}-${this._formatExportDateFilename(exportedAt)}.${format === 'json' ? 'json' : 'md'}`,
        };
    }

    private _formatMessagesAsMarkdown(messages: ChatMessage[]): string {
        const loc = getWebviewLocale();
        const parts: string[] = [];
        for (const message of messages) {
            const text = (message.text || '').trim();
            if (!text) {
                continue;
            }
            parts.push(`## ${this._exportRoleLabel(message.role, loc)}\n\n${text}`);
        }
        return parts.join('\n\n');
    }

    private _exportRoleLabel(role: string, loc: LocaleStrings): string {
        switch (role) {
            case 'user':
                return loc.roleYou;
            case 'assistant':
                return loc.roleHermes;
            case 'thought':
                return loc.roleThought;
            case 'tool':
                return loc.roleTool;
            case 'permission':
                return loc.permissionTitle;
            default:
                return loc.roleMessage;
        }
    }

    private _formatExportDateTime(date: Date): string {
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    private _formatExportDateFilename(date: Date): string {
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    private _sanitizeExportFilename(name: string): string {
        return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'chat';
    }

    private async _handleSwitchAgent(selectionId: string): Promise<void> {
        const target = this._resolveConnectionTarget(selectionId);
        if (target.selectionId === this._activeSelectionId && this._acp) {
            return;
        }
        this._log(`Switch profile/agent: ${target.displayName}`);
        // The extension never owns session history — drop the on-disk cache for
        // the session we're leaving so no stale transcript lingers. On resume the
        // authoritative transcript is pulled fresh from Hermes.
        const leavingSessionId = this._sessionId;
        if (this._promptSessionId) {
            await this._detachActivePrompt(this._promptSessionId, { savePartial: true });
        }
        this._saveCurrentSession();
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._promptSessionId = undefined;
        this._acpBoundSessionId = '';
        this._postTokenUsage();
        try {
            fs.unlinkSync(this._msgPath(leavingSessionId));
        } catch { /* already gone or none */ }
        this._bindProfileScope(target.scopeKey);
        this._activeSelectionId = target.selectionId;
        this._activeAgentName = target.displayName;
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
        this._postProfileList();
        this._postMessage({ type: 'activeAgent', name: target.displayName });
        await this._connect(target.selectionId);
        this._restoreMessages();
    }

    private _readAgentConfigs(): HermesAgentConfig[] {
        const config = vscode.workspace.getConfiguration('hermes');
        const raw = config.get<unknown>('agents');
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.flatMap(entry => {
            if (!entry || typeof entry !== 'object') {
                return [];
            }
            const name = (entry as { name?: unknown }).name;
            if (typeof name !== 'string' || !name.trim()) {
                return [];
            }
            const agent = entry as HermesAgentConfig;
            return [{ ...agent, name: name.trim() }];
        });
    }

    public newChat(): void {
        this._handleNewChat();
    }

    public insertIntoInput(text: string): void {
        this._postMessage({ type: 'insertInput', text });
    }

    public openSettings(): void {
        void this._openSettings();
    }

    public openLogs(): void {
        this._postMessage({ type: 'openLogs' });
    }

    public openAbout(): void {
        this._postMessage({ type: 'openAbout' });
    }

    public openHelp(): void {
        this._postMessage({ type: 'openHelp' });
    }

    public openFaq(): void {
        this._postMessage({ type: 'openFaq' });
    }

    public reloadSession(): void {
        void this._handleReloadSession();
    }

    public reloadExtension(): void {
        void this._handleReloadExtension();
    }

    /**
     * Restart the Hermes backend so it re-reads ~/.hermes/config.yaml.
     * Disposes the live `hermes acp` child (spawned by this extension) and
     * respawns a fresh one, which reloads config at init time. Unlike
     * reloadExtension this does NOT reload the whole VS Code window — the chat
     * UI stays, only the agent subprocess is recycled.
     */
    public reloadConfig(): void {
        void this._handleReloadConfig();
    }

    private async _handleReloadConfig(): Promise<void> {
        this._log('Reload Hermes config requested — restarting backend to re-read config.yaml');
        this._flushThoughtToHistory();
        if (this._lastAssistantText.trim()) {
            this._saveMessage('assistant', this._lastAssistantText);
            this._lastAssistantText = '';
        }
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();

        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();
        this._postMessage({
            type: 'status',
            status: 'connecting',
            message: localizeStatusMessage('Reloading Hermes config (restarting backend)...'),
        });
        await this._connect(this._activeSelectionId || undefined);
        this._restoreMessages();
    }

    public checkForUpdate(): void {
        void this._checkForUpdate();
    }

    /** Push updated locale strings when VS Code display language changes. */
    public updateLocale(): void {
        this._webviewLocale = undefined;
        this._syncWebviewLocale();
    }

    private _syncWebviewLocale(): void {
        const current = initI18n();
        if (current === this._webviewLocale) {
            return;
        }
        this._webviewLocale = current;
        this._postMessage({ type: 'setLocale', locale: getWebviewLocale() });
        this._postSessionList();
    }

    public async sendText(text: string): Promise<void> {
        await this._awaitSessionReady();
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnectedConnecting'));
            await this._connect();
        }
        if (!this._acp) {
            vscode.window.showWarningMessage(t('hermesNotConnected'));
            return;
        }
        this._promptSessionId = this._sessionId;
        this._snapshotSessionModelFromProfile();
        this._postMessage({ type: 'addMessage', role: 'user', text, sessionId: this._sessionId });
        this._saveMessage('user', text);
        this._markSessionAgentEngaged();
        await this._ensureAcpReadyForCurrentSession();
        await this._acp.sendMessage(text);
    }

    public dispose(): void {
        this._clearPromptStallTimer();
        this._saveCurrentSession();
        this._cancelPendingPermissions();
        this._clearViewDetectProgress();
        this._acp?.dispose();
        this._diffReview = undefined;
        this._stopConfigWatcher();
        this._ftr10Watcher?.close();
        this._output.dispose();
    }

    private async _handleAcceptDiff(): Promise<void> {
        if (!this._diffReview) {
            this._postMessage({ type: 'diffReviewResult', status: 'error', message: 'Diff review not available.' });
            return;
        }
        const result = await this._diffReview.accept();
        this._postMessage({ type: 'diffReviewResult', ...result });
        // Round-trip the acceptance back into the running agent session so the
        // assistant turn that called propose_diff wakes and acknowledges. Without
        // this, the extension shows the result locally but the ACP session never
        // receives a signal, leaving the agent silent until the user types again.
        this._notifyAgentOfDiffResolution(result.message || 'Diff accepted.', 'accepted');
    }

    private async _handleRejectDiff(): Promise<void> {
        if (!this._diffReview) {
            this._postMessage({ type: 'diffReviewResult', status: 'error', message: 'Diff review not available.' });
            return;
        }
        const result = await this._diffReview.reject();
        this._postMessage({ type: 'diffReviewResult', ...result });
        // Same round-trip as accept — let the agent know the diff was rejected.
        this._notifyAgentOfDiffResolution(result.message || 'Diff rejected.', 'rejected');
    }

    /**
     * Inject a short follow-up message into the active ACP session after a diff
     * is accepted or rejected. sendMessage only fires when the session is
     * 'ready' (i.e. the assistant turn that proposed the diff has already
     * returned), which is exactly the state we are in here, so this starts a
     * fresh turn and wakes the agent to respond.
     */
    private _notifyAgentOfDiffResolution(text: string, outcome: 'accepted' | 'rejected'): void {
        if (!this._acp) {
            return;
        }
        const note = `[diff ${outcome}] ${text}`;
        void this._acp.sendMessage(note);
    }

    private _postMessage(msg: any): void {
        this._view?.webview.postMessage(msg);
    }

    private _postConfig(): void {
        const config = vscode.workspace.getConfiguration('hermes');
        this._postMessage({
            type: 'config',
            showThoughts: config.get<boolean>('showThoughts', true),
            showToolCalls: config.get<boolean>('showToolCalls', true),
            permissionMode: config.get<string>('permissionMode', 'manual'),
            reasoningEffort: config.get<string>('reasoningEffort', 'medium'),
        });
    }

    private _postTokenUsage(): void {
        if (!this._tokenUsage) {
            this._postMessage({ type: 'tokenUsage', used: 0, size: 0 });
            return;
        }
        this._postMessage({
            type: 'tokenUsage',
            used: this._tokenUsage.used,
            size: this._tokenUsage.size,
        });
    }

    private _postPluginInfo(): void {
        const ext = vscode.extensions.getExtension(this._extensionId);
        const pkg = ext?.packageJSON;
        let iconUri = '';
        if (this._view) {
            iconUri = this._view.webview.asWebviewUri(
                vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg')
            ).toString();
        }
        this._postMessage({
            type: 'pluginInfo',
            displayName: pkg?.displayName || 'FTR10 Hermes VSCode',
            version: pkg?.version || '',
            publisher: pkg?.publisher || '',
            description: pkg?.description || '',
            repository: pkg?.repository?.url || pkg?.repository || '',
            iconUri,
        });
    }

    private async _handleReloadSession(): Promise<void> {
        this._log('Reload session requested');
        this._sendEpoch++;
        this._flushThoughtToHistory();
        if (this._lastAssistantText.trim()) {
            this._saveMessage('assistant', this._lastAssistantText);
            this._lastAssistantText = '';
        }
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();

        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();

        this._postMessage({ type: 'newChat' });
        await this._connect(this._activeSelectionId || undefined);
        this._restoreMessages();
    }

    private async _handleReloadExtension(): Promise<void> {
        this._log('Reload extension requested');
        this._sendEpoch++;
        this._flushThoughtToHistory();
        if (this._lastAssistantText.trim()) {
            this._saveMessage('assistant', this._lastAssistantText);
            this._lastAssistantText = '';
        }
        this._cancelPendingPermissions();
        this._saveCurrentSession();
        this._persistMessages();
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }

    private async _checkForUpdate(): Promise<void> {
        this._log('Checking for extension updates');
        await vscode.commands.executeCommand('workbench.extensions.action.checkForUpdates');
        await vscode.commands.executeCommand(
            'workbench.extensions.action.showExtensionsWithIds',
            [this._extensionId]
        );
    }

    private async _openSettings(): Promise<void> {
        const preferJsonEditor = vscode.workspace
            .getConfiguration('workbench.settings')
            .get<string>('editor') === 'json';
        const isCursor = /cursor/i.test(vscode.env.appName);

        // Cursor: always open Settings UI (JSON editor command often does nothing visible).
        if (preferJsonEditor && !isCursor) {
            await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
                revealSetting: { key: 'hermes.path', edit: false },
            });
            return;
        }

        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `@ext:${this._extensionId}`,
        );
    }

    private async _openControlCenter(): Promise<void> {
        await vscode.commands.executeCommand('hermes.controlCenter');
    }

    private async _onConfigurationChanged(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (e.affectsConfiguration('hermes.showThoughts') || e.affectsConfiguration('hermes.showToolCalls') || e.affectsConfiguration('hermes.permissionMode') || e.affectsConfiguration('hermes.reasoningEffort')) {
            this._postConfig();
        }
        if (e.affectsConfiguration('hermes.contextAttachVisibility')) {
            this._applyContextAttachVisibility();
        }
        if (e.affectsConfiguration('hermes.agents')) {
            this._discoveredProfiles = null;
            this._postProfileList();
        }
        const reconnectKeys = ['hermes.path', 'hermes.cwd', 'hermes.profile'];
        if (reconnectKeys.some(k => e.affectsConfiguration(k))) {
            if (e.affectsConfiguration('hermes.profile') && this._readAgentConfigs().length === 0) {
                const config = vscode.workspace.getConfiguration('hermes');
                this._activeSelectionId = normalizeHermesCliProfile(config.get<string>('profile'));
            }
            await this._reconnectForConfig();
        }
    }

    private async _reconnectForConfig(): Promise<void> {
        if (!this._view) {
            return;
        }
        this._log('Settings changed — reconnecting Hermes...');
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        await this._connect(this._activeSelectionId || undefined);
    }

    private _readFtr10Vars(): Record<string, string> {
        try {
            const varsPath = path.join(
                process.env.HOME || process.env.USERPROFILE || '~',
                '.ftr10',
                'vars.json',
            );
            if (!fs.existsSync(varsPath)) return {};
            const raw = fs.readFileSync(varsPath, 'utf-8');
            const parsed = JSON.parse(raw) as { values?: Record<string, string> };
            return parsed.values ?? {};
        } catch {
            return {};
        }
    }

    private _postFtr10Vars(): void {
        const vars = this._readFtr10Vars();
        if (Object.keys(vars).length === 0) return;
        this._postMessage({ type: 'ftr10VarsUpdate', vars });
    }

    private _startFtr10Watcher(): void {
        if (this._ftr10Watcher) return;
        try {
            const varsPath = path.join(
                process.env.HOME || process.env.USERPROFILE || '~',
                '.ftr10',
                'vars.json',
            );
            if (!fs.existsSync(varsPath)) return;
            this._ftr10Watcher = fs.watch(varsPath, () => {
                this._postFtr10Vars();
            });
        } catch {
            // FTR10 not installed — silently skip
        }
    }

    /**
     * Watch ~/.hermes/config.yaml and automatically restart the Hermes backend
     * when it changes. The backend (hermes acp, spawned by this extension)
     * reads config.yaml only at init, so a direct edit to that file requires a
     * restart to take effect. This makes `config.yaml` edits "just work":
     * save the file in any editor and the agent subprocess is recycled within
     * a debounce window, picking up the new configuration.
     *
     * A guard prevents re-entrancy while a restart is already in flight, and
     * the watch is debounced (editors often emit multiple events per save).
     */
    private _startConfigWatcher(): void {
        if (this._configWatcher) return;
        const home = process.env.HERMES_HOME?.trim() || resolveDefaultHermesHome();
        const configPath = path.join(home, 'config.yaml');
        try {
            if (!fs.existsSync(configPath)) return;
        } catch {
            return;
        }

        let debounce: ReturnType<typeof setTimeout> | undefined;
        const onChange = (): void => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
                this._log(`Detected change to ${configPath} — reloading Hermes backend`);
                void this._handleReloadConfig();
            }, 800);
        };

        try {
            this._configWatcher = fs.watch(configPath, onChange);
            this._configWatcher.on('error', () => {
                // Filesystem watch can fail (e.g. file replaced by editor save).
                // Best-effort: stop watching; a manual "Reload Hermes Config"
                // command remains available via the Reload submenu.
                this._stopConfigWatcher();
            });
        } catch {
            // Watch unsupported on this platform/file — manual command still works.
        }
    }

    private _stopConfigWatcher(): void {
        if (this._configWatchTimer) {
            clearTimeout(this._configWatchTimer);
            this._configWatchTimer = undefined;
        }
        if (this._configWatcher) {
            try {
                this._configWatcher.close();
            } catch { /* ignore */ }
            this._configWatcher = undefined;
        }
    }

    private _getHtml(): string {
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');

        if (this._view) {
            const webview = this._view.webview;
            const vendorUri = (file: string) =>
                webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', file)).toString();
            const ftr10Vars = this._readFtr10Vars();
            const ftr10VarsJson = Object.keys(ftr10Vars).length > 0
                ? JSON.stringify(ftr10Vars).replace(/</g, '\\\\u003c')
                : '{}';
            html = html
                .replace('{{CHAT_CSS_URI}}', webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css')).toString())
                .replace('{{CHAT_JS_URI}}', webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js')).toString())
                .replace('{{MEDIA_URI}}', webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media')).toString())
                .replace('{{MARKED_URI}}', vendorUri('marked.min.js'))
                .replace('{{HIGHLIGHT_URI}}', vendorUri('highlight.min.js'))
                .replace('{{HIGHLIGHT_CSS_URI}}', vendorUri('github-dark.min.css'))
                .replace('{{PURIFY_URI}}', vendorUri('purify.min.js'))
                .replace('{{LOCALE_JSON}}', JSON.stringify(getWebviewLocale()).replace(/</g, '\\u003c'))
                .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER)
                .replace('{{FTR10_VARS_JSON}}', ftr10VarsJson);
        } else {
            html = html
                .replace('{{CHAT_CSS_URI}}', '')
                .replace('{{CHAT_JS_URI}}', '')
                .replace('{{MEDIA_URI}}', '')
                .replace('{{LOCALE_JSON}}', '{}')
                .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER)
                .replace('{{FTR10_VARS_JSON}}', '{}');
        }

        return html;
    }

    private _resolveCwd(configCwd?: string): string {
        if (configCwd) return configCwd;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) return folder.uri.fsPath;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) return folders[0].uri.fsPath;
        return process.cwd();
    }

    /** Check if path is within workspace folders. Allows absolute paths only if inside workspace. */
    private _isPathAllowed(p: string): boolean {
        if (!path.isAbsolute(p)) return true; // relative paths are fine
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders.some(f => p.startsWith(f.uri.fsPath));
        }
        // No workspace: restrict to cwd
        const config = vscode.workspace.getConfiguration('hermes');
        const configCwd = config.get<string>('cwd');
        const cwd = configCwd || process.cwd();
        return p.startsWith(cwd);
    }
}
