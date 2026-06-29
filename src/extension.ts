import * as vscode from 'vscode';
import { HermesChatProvider } from './chat/HermesChatProvider';
import { initI18n, t } from './i18n';
import { registerToolInvocationCommand, getToolManifest, getEventsSubscriptions, setDiffReviewManager } from './acp/acpToolRegistration';
import { registerCodeLensProvider } from './codeLens';
import { registerDiffCommands } from './diffViewer';
import { DiffReviewManager, registerDiffContentProvider } from './acp/DiffReviewManager';
import { HermesSettingsPanel } from './settings/hermesSettingsPanel';

let chatProvider: HermesChatProvider | undefined;

function bindChatCommand(
    context: vscode.ExtensionContext,
    command: string,
    run: (provider: HermesChatProvider) => void | Promise<void>
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(command, () => {
            if (!chatProvider) {
                return;
            }
            void run(chatProvider);
        })
    );
}

export function activate(context: vscode.ExtensionContext) {
    initI18n();
    console.log('Rina Hermes ACP activating...');

    // Register the chat webview provider
    chatProvider = new HermesChatProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('hermesChat', chatProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Feature 1 & 4: ACP Editor Context Tools + Deep Semantic Context
    // DiffReviewManager must be created BEFORE tool registration so propose_diff
    // and accept_diff/reject_diff are wired to it.
    const diffReview = new DiffReviewManager();
    setDiffReviewManager(diffReview);
    context.subscriptions.push({ dispose: () => diffReview.dispose() });

    registerToolInvocationCommand(context);
    for (const disposable of getEventsSubscriptions()) {
        context.subscriptions.push(disposable);
    }

    // Register the hermes-diff:// scheme for propose_diff virtual documents
    registerDiffContentProvider(context);

    // Feature 2: CodeLens providers
    registerCodeLensProvider(context);

    // Feature 3: Diff viewer commands
    registerDiffCommands(context);

    // Wire diff review into chat provider
    chatProvider.setDiffReviewManager(diffReview);

    // Feature 5: Main-editor Control Center (embedded dashboard)
    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.openControlCenter', () => {
            HermesSettingsPanel.createOrShow(context.extensionUri);
        })
    );

    // Secret Storage: set API key securely
    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter Hermes API Key',
                password: true,
                placeHolder: 'sk-...',
                ignoreFocusOut: true,
            });
            if (key) {
                await context.secrets.store('hermes.apiKey', key);
                vscode.window.showInformationMessage('Hermes API Key saved securely!');
            }
        })
    );

    // Register commands for code lens actions
    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.askAboutFile', async (filePath?: string) => {
            const path = filePath || vscode.window.activeTextEditor?.document.uri.fsPath;
            if (!path) {
                vscode.window.showInformationMessage(t('noActiveEditor'));
                return;
            }
            const text = `Tell me about \`${path}\`:\n- What does this file do?\n- What are the key functions/classes?\n- Are there any potential issues?`;
            vscode.commands.executeCommand('workbench.view.extension.hermes-sidebar');
            setTimeout(() => chatProvider?.insertIntoInput(text), 300);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.explainFunction', async (filePath: string, symbolName: string, line: number) => {
            const text = `Explain the \`${symbolName}\` at \`${filePath}:${line + 1}\`:\n- What does it do?\n- How is it structured?\n- Are there edge cases I should know about?`;
            vscode.commands.executeCommand('workbench.view.extension.hermes-sidebar');
            setTimeout(() => chatProvider?.insertIntoInput(text), 300);
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.newChat', () => {
            chatProvider?.newChat();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.hermes-sidebar');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hermes.sendSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showInformationMessage(t('selectCodeFirst'));
                return;
            }
            const selection = editor.document.getText(editor.selection);
            const fileName = editor.document.fileName;
            const line = editor.selection.start.line + 1;
            const text = `At ${fileName}:${line}\n\`\`\`\n${selection}\n\`\`\``;

            vscode.commands.executeCommand('workbench.view.extension.hermes-sidebar');
            chatProvider?.insertIntoInput(text);
        })
    );

    bindChatCommand(context, 'hermes.reloadExtension', provider => provider.reloadExtension());
    bindChatCommand(context, 'hermes.reloadSession', provider => provider.reloadSession());
    bindChatCommand(context, 'hermes.openSettings', provider => provider.openSettings());
    bindChatCommand(context, 'hermes.checkUpdate', provider => provider.checkForUpdate());
    bindChatCommand(context, 'hermes.openAbout', provider => provider.openAbout());
    bindChatCommand(context, 'hermes.openHelp', provider => provider.openHelp());
    bindChatCommand(context, 'hermes.openFaq', provider => provider.openFaq());
    bindChatCommand(context, 'hermes.openLogs', provider => provider.openLogs());
    bindChatCommand(context, 'hermes.detectEnvironment', provider => provider.detectEnvironment());
    bindChatCommand(context, 'hermes.detectEnvironmentBusy', () => undefined);
    bindChatCommand(context, 'hermes.configureEnvironment', provider => provider.configureEnvironment());

    // Log tool manifest
    const manifest = getToolManifest();
    console.log(`Hermes ACP tools registered: ${manifest.map(t => t.name).join(', ')}`);

    console.log('Rina Hermes ACP activated');
}

export function deactivate() {
    chatProvider?.dispose();
}