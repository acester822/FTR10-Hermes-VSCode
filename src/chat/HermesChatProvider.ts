import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AcpClient, AcpStatus, ModelListState, PermissionRequest, TokenUsage } from '../acp/AcpClient';
import { buildFallbackModelListState, isRuntimeModelSource } from '../acp/modelConfig';
import { resolveMcpServersForSession } from '../acp/mcpConfig';
import { getLocale, getWebviewLocale, initI18n, localizeStatusMessage, t } from '../i18n';
import { resolvePermissionOptionLabel } from '../i18n/permissionOptions';
import { SupportedLocale } from '../i18n/types';
import { WEBVIEW_LOCALE_HELPER } from '../i18n/format';

interface StoredPermissionOption {
    optionId: string;
    name: string;
    kind?: string;
}

interface ChatMessage {
    role: string;
    text: string;
    timestamp: number;
    permissionId?: string;
    title?: string;
    detail?: string;
    options?: StoredPermissionOption[];
    resolved?: boolean;
    outcome?: 'selected' | 'cancelled';
    selectedOptionId?: string;
    selectedLabel?: string;
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
}

interface HermesAgentConfig {
    name: string;
    path?: string;
    profile?: string;
    cwd?: string;
}

export class HermesChatProvider implements vscode.WebviewViewProvider {
    // ---- Lifecycle ----
    private _view?: vscode.WebviewView;
    private _acp?: AcpClient;
    private _output: vscode.OutputChannel;

    // ---- Session State ----
    private _historyDir: string;
    private _sessionsPath: string;
    private _activeIdPath: string;
    private _sessionMessages: ChatMessage[] = [];
    private _sessionId: string = '';
    private _sessions: SessionInfo[] = [];
    private _lastAssistantText: string = '';
    private _modelState: ModelListState | null = null;
    private _modelFallbackShown: boolean = false;
    private _activeAgentName: string = '';
    private _modelSwitchInFlight: Promise<void> | undefined;
    private _tokenUsage: TokenUsage | null = null;
    private _webviewLocale?: SupportedLocale;
    private readonly _extensionId: string;
    private _pendingPermissions = new Map<string, (optionId: string | null) => void>();
    private _permissionCounter = 0;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) {
        this._extensionId = context.extension.id;
        this._output = vscode.window.createOutputChannel('Hermes Chat', 'hermes-chat');
        const storagePath = context.globalStorageUri.fsPath;
        fs.mkdirSync(storagePath, { recursive: true });
        this._historyDir = storagePath;
        this._sessionsPath = path.join(storagePath, 'sessions.json');
        this._activeIdPath = path.join(storagePath, 'active-session.txt');
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
    }

    private _restoreActiveSession(): string {
        // Try restoring last active session
        try {
            if (fs.existsSync(this._activeIdPath)) {
                const id = fs.readFileSync(this._activeIdPath, 'utf-8').trim();
                if (this._sessions.some(s => s.id === id)) return id;
            }
        } catch { /* ignore */ }
        return Date.now().toString(36);
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

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._syncWebviewLocale();
            }
        });

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'sendMessage':
                    this._handleUserMessage(message.text);
                    break;
                case 'cancel':
                    this._lastAssistantText = '';
                    this._cancelPendingPermissions();
                    this._acp?.cancel();
                    break;
                case 'openFile':
                    void this._handleOpenFile(message.path);
                    break;
                case 'listFiles':
                    void this._handleListFiles(message.query || '', message.requestId);
                    break;
                case 'previewFile':
                    void this._handlePreviewFile(message.path, message.requestId);
                    break;
                case 'newChat':
                    this._handleNewChat();
                    break;
                case 'clearChat':
                    void this._handleClearChat();
                    break;
                case 'ready':
                    this._log('WebView ready');
                    this._syncWebviewLocale();
                    this._postPluginInfo();
                    this._postSessionList();
                    this._postProfileList();
                    this._postConfig();
                    this._postTokenUsage();
                    this._restoreMessages();
                    this._connect();
                    break;
                case 'getSessions':
                    this._postSessionList();
                    break;
                case 'deleteSession':
                    this._handleDeleteSession(message.sessionId);
                    break;
                case 'renameSession':
                    this._handleRenameSession(message.sessionId, message.title);
                    break;
                case 'switchAgent':
                    this._handleSwitchAgent(message.agentName);
                    break;
                case 'switchSession':
                    this._handleSwitchSession(message.sessionId);
                    break;
                case 'switchModel':
                    this._handleSwitchModel(message.configId, message.valueId);
                    break;
                case 'getModels':
                    this._postModelList();
                    break;
                case 'getProfiles':
                    this._postProfileList();
                    break;
                case 'openSettings':
                    void this._openSettings();
                    break;
                case 'openExternal':
                    if (message.url) {
                        void vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'retry':
                    void this._handleRetry();
                    break;
                case 'permissionResponse':
                    this._handlePermissionResponse(message.id, message.optionId ?? null);
                    break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && !this._acp) {
                this._connect();
            }
        });
    }

    private _log(msg: string): void {
        const time = new Date().toISOString().slice(11, 19);
        this._output.appendLine(`[${time}] ${msg}`);
    }

    private _restoreMessages(): void {
        if (this._sessionMessages.length === 0) return;
        this._log(`Restoring ${this._sessionMessages.length} messages`);
        this._postMessage({
            type: 'restoreHistory',
            messages: this._sessionMessages,
            localHistoryOnly: true,
        });
    }

    private _saveMessage(role: string, text: string): void {
        this._sessionMessages.push({ role, text, timestamp: Date.now() });
        this._persistMessages();
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
            fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, 50), null, 2));
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
            fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, 50), null, 2));
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
            }
        } catch { this._sessions = []; }
    }

    private async _connect(agentName?: string): Promise<void> {
        if (this._acp) return;
        this._log(`Connecting${agentName ? ' as ' + agentName : ''}...`);

        const config = vscode.workspace.getConfiguration('hermes');
        let configPath = config.get<string>('path') || undefined;
        let configCwd = config.get<string>('cwd') || undefined;
        let configProfile = config.get<string>('profile') || undefined;

        if (agentName) {
            this._activeAgentName = agentName;
            const agent = this._readAgentConfigs().find(a => a.name === agentName);
            if (agent) {
                if (agent.path) configPath = agent.path;
                if (agent.cwd) configCwd = agent.cwd;
                if (agent.profile) configProfile = agent.profile;
            }
        } else if (!this._activeAgentName) {
            this._activeAgentName = configProfile || t('defaultAgent');
        }

        this._postMessage({ type: 'activeAgent', name: this._activeAgentName });

        const cwd = this._resolveCwd(configCwd);

        this._acp = new AcpClient(
            (role, text, toolCallId) => {
                this._postMessage({ type: 'addMessage', role, text, toolCallId });
                if (role === 'user') {
                    this._saveMessage('user', text);
                }
                if (role === 'assistant') {
                    this._lastAssistantText = text;
                }
            },
            (status, msg) => {
                this._log(`Status: ${status}${msg ? ' — ' + msg : ''}`);
                this._postMessage({
                    type: 'status',
                    status,
                    message: msg ? localizeStatusMessage(msg) : undefined,
                });
                // Save assistant message once when streaming completes
                if (status === 'ready' && this._lastAssistantText) {
                    this._saveMessage('assistant', this._lastAssistantText);
                    this._lastAssistantText = '';
                }
                if (status === 'prompting') {
                    this._lastAssistantText = ''; // clear any stale text from previous send
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
                this._tokenUsage = usage;
                this._postTokenUsage();
            },
            (models) => {
                if (models) {
                    this._modelState = models;
                } else if (!this._modelState) {
                    this._modelState = this._buildFallbackModelList();
                }
                this._postModelList();
            },
            () => {
                this._postMessage({ type: 'finishAssistantBubble' });
            },
            (cwd) => {
                const servers = resolveMcpServersForSession(cwd);
                if (servers.length > 0) {
                    this._log(`Forwarding ${servers.length} MCP server(s) to Hermes: ${servers.map(s => s.name).join(', ')}`);
                }
                return servers;
            }
        );
        this._acp.onLog = (line: string) => {
            this._postMessage({ type: 'log', line });
        };
        try {
            await this._acp.start(cwd, configPath, configProfile);
            this._applySessionModelPreference();
            this._postModelList();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this._log(`Connect failed: ${msg}`);
            this._acp?.dispose();
            this._acp = undefined;
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

    private async _handleRetry(): Promise<void> {
        this._log('Retry connection requested');
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();
        const agentName = this._activeAgentName && this._activeAgentName !== t('defaultAgent')
            ? this._activeAgentName
            : undefined;
        await this._connect(agentName);
    }

    private _buildFallbackModelList(): ModelListState | null {
        const config = vscode.workspace.getConfiguration('hermes');
        const models = config.get<Array<{ id: string; name: string }>>('models') || [];
        const defaultModel = config.get<string>('defaultModel') || '';
        const session = this._sessions.find(s => s.id === this._sessionId);
        const currentId = session?.modelId || defaultModel;
        return buildFallbackModelListState(models, currentId);
    }

    private _postProfileList(): void {
        this._postMessage({ type: 'profileList', profiles: this._getAgentNames() });
    }

    private _postModelList(): void {
        const state = this._modelState ?? this._buildFallbackModelList();
        if (state) {
            this._postMessage({
                type: 'modelList',
                configId: state.configId,
                currentValueId: state.currentValueId,
                currentLabel: state.currentLabel,
                models: state.models,
                fromAgent: state.fromAgent,
            });
        } else {
            const session = this._sessions.find(s => s.id === this._sessionId);
            this._postMessage({
                type: 'modelList',
                configId: '',
                currentValueId: session?.modelId || '',
                currentLabel: session?.modelLabel || '—',
                models: [],
                fromAgent: false,
            });
        }
    }

    private _persistModelChoice(valueId: string, label: string): void {
        const session = this._sessions.find(s => s.id === this._sessionId);
        if (session) {
            session.modelId = valueId;
            session.modelLabel = label;
            try {
                fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, 50), null, 2));
            } catch { /* ignore */ }
        }
    }

    private async _applySessionModelPreference(): Promise<void> {
        const session = this._sessions.find(s => s.id === this._sessionId);
        if (!session?.modelId || !this._acp) {
            return;
        }
        const agentState = this._acp.getModelListState();
        if (!agentState || !isRuntimeModelSource(agentState.configId)) {
            return;
        }
        if (session.modelId === agentState.currentValueId) {
            return;
        }
        const known = agentState.models.some(m => m.valueId === session.modelId);
        if (!known) {
            const label = session.modelLabel || session.modelId;
            this._log(`Saved model not available: ${label}`);
            vscode.window.showWarningMessage(t('savedModelUnavailable', label));
            return;
        }
        try {
            await this._acp.setModel(agentState.configId, session.modelId);
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
        const state = this._modelState ?? this._buildFallbackModelList();
        const effectiveConfigId = configId || state?.configId || '';
        const picked = state?.models.find(m => m.valueId === valueId);
        const label = picked?.name ?? valueId;
        this._log(`Switch model: ${label} (config=${effectiveConfigId})`);

        if (this._acp && valueId) {
            if (this._acp.status === 'prompting') {
                vscode.window.showWarningMessage(t('waitForResponse'));
                return;
            }
            try {
                await this._acp.setModel(effectiveConfigId, valueId);
                this._persistModelChoice(valueId, label);
                this._postModelList();
                this._log(`Model active: ${label}`);
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this._log(`setModel failed: ${msg}`);
                vscode.window.showErrorMessage(t('failedSwitchModel', msg));
                return;
            }
        }

        if (!state || !isRuntimeModelSource(effectiveConfigId)) {
            this._persistModelChoice(valueId, label);
            if (state) {
                this._modelState = { ...state, currentValueId: valueId, currentLabel: label };
            }
            this._postModelList();
            if (!this._modelFallbackShown) {
                this._modelFallbackShown = true;
                vscode.window.showInformationMessage(t('modelPreferenceSaved'));
            }
            return;
        }

        vscode.window.showWarningMessage(t('hermesNotConnected'));
    }

    private async _handleUserMessage(text: string): Promise<void> {
        if (this._modelSwitchInFlight) {
            await this._modelSwitchInFlight;
        }
        this._log(`User message: ${text.slice(0, 80)}`);
        this._saveMessage('user', text);
        this._acp?.sendMessage(text);
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

    private async _handleOpenFile(filePath: string): Promise<void> {
        this._log(`Open file: ${filePath}`);
        try {
            const uri = this._resolveFileUri(filePath);
            if (!uri) {
                vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        } catch {
            vscode.window.showWarningMessage(t('couldNotOpenFile', filePath));
        }
    }

    private async _handleClearChat(): Promise<void> {
        this._log('Clear Chat');
        this._sessionMessages = [];
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }

        const session = this._sessions.find(s => s.id === this._sessionId);
        if (session) {
            session.messageCount = 0;
            session.updatedAt = Date.now();
            session.title = t('newChat');
            session.titleManual = false;
            try {
                fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, 50), null, 2));
            } catch { /* ignore */ }
        }

        const cwd = this._resolveCwd();
        if (this._acp) {
            await this._acp.newSession(cwd);
            await this._applySessionModelPreference();
        } else {
            await this._connect();
        }
        this._postModelList();
        this._postMessage({ type: 'clearChat' });
        this._postSessionList();
    }

    private async _handleNewChat(): Promise<void> {
        this._log('New Chat');
        this._saveCurrentSession();
        this._sessionMessages = [];
        this._sessionId = Date.now().toString(36);
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }

        const config = vscode.workspace.getConfiguration('hermes');
        const configCwd = config.get<string>('cwd') || undefined;
        const cwd = this._resolveCwd(configCwd);

        if (this._acp) {
            await this._acp.newSession(cwd);
            await this._applySessionModelPreference();
        } else {
            await this._connect();
        }
        this._postModelList();
        this._postMessage({ type: 'newChat' });
        this._ensureSessionRegistered();
        this._postSessionList();
    }

    private async _handleSwitchSession(sessionId: string, options?: { skipSaveCurrent?: boolean }): Promise<void> {
        if (sessionId === this._sessionId) {
            return;
        }
        this._log(`Switch to session: ${sessionId}`);
        if (!options?.skipSaveCurrent) {
            this._saveCurrentSession();
        }
        this._sessionId = sessionId;
        this._sessionMessages = [];
        this._loadHistory();
        const cwd = this._resolveCwd();
        await this._acp?.newSession(cwd);
        await this._applySessionModelPreference();
        this._postModelList();
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
        this._restoreMessages();
    }

    private async _handleDeleteSession(sessionId: string): Promise<void> {
        this._log(`Delete session: ${sessionId}`);
        const idx = this._sessions.findIndex(s => s.id === sessionId);
        if (idx === -1) {
            return;
        }
        this._sessions = this._sessions.filter(s => s.id !== sessionId);
        try {
            fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions, null, 2));
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
        const cwd = this._resolveCwd();
        await this._acp?.newSession(cwd);
        await this._applySessionModelPreference();
        this._postModelList();
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
            fs.writeFileSync(this._sessionsPath, JSON.stringify(this._sessions.slice(0, 50), null, 2));
        } catch { /* non-critical */ }
        this._postSessionList();
    }

    private async _handleSwitchAgent(agentName: string): Promise<void> {
        this._log(`Switch to agent: ${agentName}`);
        this._saveCurrentSession();
        this._acp?.dispose();
        this._acp = undefined;
        this._modelState = null;
        this._tokenUsage = null;
        this._postTokenUsage();
        this._sessionMessages = [];
        this._sessionId = Date.now().toString(36);
        try { fs.unlinkSync(this._msgPath(this._sessionId)); } catch { /* ignore */ }
        this._ensureSessionRegistered();
        this._postMessage({ type: 'newChat' });
        this._postSessionList();
        this._postProfileList();
        this._postModelList();
        this._activeAgentName = agentName;
        this._postMessage({ type: 'activeAgent', name: agentName });
        await this._connect(agentName);
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

    private _getAgentNames(): string[] {
        const names = this._readAgentConfigs().map(a => a.name);
        if (names.length > 0) {
            return names;
        }
        const config = vscode.workspace.getConfiguration('hermes');
        const profile = config.get<string>('profile');
        return [profile || t('defaultAgent')];
    }

    public newChat(): void {
        this._handleNewChat();
    }

    public insertIntoInput(text: string): void {
        this._postMessage({ type: 'insertInput', text });
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
        this._postMessage({ type: 'addMessage', role: 'user', text });
        this._saveMessage('user', text);
        this._acp.sendMessage(text);
    }

    public dispose(): void {
        this._cancelPendingPermissions();
        this._acp?.dispose();
        this._acp = undefined;
        this._view = undefined;
        this._output.dispose();
    }

    private _postMessage(msg: any): void {
        this._view?.webview.postMessage(msg);
    }

    private _postConfig(): void {
        const config = vscode.workspace.getConfiguration('hermes');
        this._postMessage({
            type: 'config',
            showThoughts: config.get<boolean>('showThoughts', false),
            showToolCalls: config.get<boolean>('showToolCalls', false),
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
        this._postMessage({
            type: 'pluginInfo',
            displayName: pkg?.displayName || 'Rina Hermes ACP',
            version: pkg?.version || '',
            publisher: pkg?.publisher || '',
            description: pkg?.description || '',
            repository: pkg?.repository?.url || pkg?.repository || '',
        });
    }

    private async _openSettings(): Promise<void> {
        const useJsonEditor = vscode.workspace
            .getConfiguration('workbench.settings')
            .get<string>('editor') === 'json';
        const isCursor = /cursor/i.test(vscode.env.appName);

        // Cursor's Settings UI refreshes built-in custom agents on open; rapid cancel/reload
        // surfaces "Failed to load custom agents" / ERR Canceled in DevTools.
        if (useJsonEditor || isCursor) {
            await vscode.commands.executeCommand('workbench.action.openSettingsJson', {
                revealSetting: { key: 'hermes.path', edit: false },
            });
            return;
        }

        await vscode.commands.executeCommand('workbench.action.openSettings', '@id:hermes.path');
    }

    private async _onConfigurationChanged(e: vscode.ConfigurationChangeEvent): Promise<void> {
        if (e.affectsConfiguration('hermes.showThoughts') || e.affectsConfiguration('hermes.showToolCalls')) {
            this._postConfig();
        }
        if (e.affectsConfiguration('hermes.models') || e.affectsConfiguration('hermes.defaultModel')) {
            if (!this._modelState || !isRuntimeModelSource(this._modelState.configId)) {
                this._modelState = null;
            }
            this._postModelList();
        }
        if (e.affectsConfiguration('hermes.agents')) {
            this._postProfileList();
        }
        const reconnectKeys = ['hermes.path', 'hermes.cwd', 'hermes.profile'];
        if (reconnectKeys.some(k => e.affectsConfiguration(k))) {
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
        const agentName = this._activeAgentName && this._activeAgentName !== t('defaultAgent')
            ? this._activeAgentName
            : undefined;
        await this._connect(agentName);
    }

    private _getHtml(): string {
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');

        if (this._view) {
            const webview = this._view.webview;
            const vendorUri = (file: string) =>
                webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', file)).toString();
            html = html
                .replace('{{MARKED_URI}}', vendorUri('marked.min.js'))
                .replace('{{HIGHLIGHT_URI}}', vendorUri('highlight.min.js'))
                .replace('{{HIGHLIGHT_CSS_URI}}', vendorUri('github-dark.min.css'))
                .replace('{{PURIFY_URI}}', vendorUri('purify.min.js'))
                .replace('{{LOCALE_JSON}}', JSON.stringify(getWebviewLocale()).replace(/</g, '\\u003c'))
                .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER);
        } else {
            html = html
                .replace('{{LOCALE_JSON}}', '{}')
                .replace('{{LOCALE_HELPER}}', WEBVIEW_LOCALE_HELPER);
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
