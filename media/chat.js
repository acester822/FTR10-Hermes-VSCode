(function() {
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const chatBodyEl = document.getElementById('chat-body');
    const inputEl = document.getElementById('input');
    const inputAreaEl = document.getElementById('input-area');
    const inputCompositeEl = document.getElementById('inputComposite');
    const inputCompositeShellEl = inputCompositeEl ? inputCompositeEl.closest('.input-composite-shell') : null;
    const inputResizeHandle = document.getElementById('inputResizeHandle');
    const sendBtn = document.getElementById('sendBtn');
    const contextUsageEl = document.getElementById('contextUsage');
    const contextUsageNum = document.getElementById('contextUsageNum');
    const contextUsageFill = document.getElementById('contextUsageFill');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const copySessionBtn = document.getElementById('copySessionBtn');
    const downloadSessionBtn = document.getElementById('downloadSessionBtn');
    const quickActionsTrigger = document.getElementById('quickActionsTrigger');
    const attachImageBtn = document.getElementById('attachImageBtn');
    const imageFileInput = document.getElementById('imageFileInput');
    const attachPreviewRow = document.getElementById('attachPreviewRow');
    inputQuickPanel = document.getElementById('inputQuickPanel');
    const chatSearchInput = document.getElementById('chatSearchInput');
    const chatSearchCount = document.getElementById('chatSearchCount');
    const chatSearchPrev = document.getElementById('chatSearchPrev');
    const diffReviewBar = document.getElementById('diffReviewBar');
    const diffReviewFile = document.getElementById('diffReviewFile');
    const diffAcceptBtn = document.getElementById('diffAcceptBtn');
    const diffRejectBtn = document.getElementById('diffRejectBtn');
    let diffReviewVisible = false;
    const chatSearchNext = document.getElementById('chatSearchNext');
    const multiSelectToolbar = document.getElementById('multiSelectToolbar');
    const multiSelectCount = document.getElementById('multiSelectCount');
    const multiSelectAllBtn = document.getElementById('multiSelectAllBtn');
    const multiSelectDeleteBtn = document.getElementById('multiSelectDeleteBtn');
    const multiSelectCopyBtn = document.getElementById('multiSelectCopyBtn');
    const multiSelectExportBtn = document.getElementById('multiSelectExportBtn');
    const multiSelectAttachConfirmBtn = document.getElementById('multiSelectAttachConfirmBtn');
    const multiSelectExitBtn = document.getElementById('multiSelectExitBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const todoPanel = document.getElementById('todoPanel');
    const todoPanelList = document.getElementById('todoPanelList');
    const todoPanelCount = document.getElementById('todoPanelCount');
    const todoPanelClear = document.getElementById('todoPanelClear');
    const todoPanelToggle = document.getElementById('todoPanelToggle');
    let activeTodos = [];
    let placeholder = document.getElementById('placeholder');
    let lastSessions = [];
    let lastActiveSessionId = '';
    let sessionMsgCounter = 0;
    let multiSelectMode = false;
    let multiSelectPurpose = 'normal';
    let sessionRenderJobId = 0;
    const SESSION_RENDER_BANNER_ID = 'sessionRenderBanner';
    const RESTORE_BATCH_SIZE = 30;
    const MARKDOWN_RENDER_BATCH_SIZE = 4;

    const LOCAL_HISTORY_DIVIDER_ID = 'localHistoryDivider';

    function removeLocalHistoryDivider() {}

    function insertLocalHistoryDivider() {}

    function setConnectingPlaceholder() {
        if (!placeholder) return;
        placeholder.className = 'placeholder';
        placeholder.textContent = '';
        placeholder.appendChild(document.createTextNode(locale.connectingTitle || ''));
        placeholder.appendChild(document.createElement('br'));
        const hint = document.createElement('span');
        hint.style.fontSize = '11px';
        hint.style.opacity = '0.6';
        hint.textContent = locale.connectingHint || '';
        placeholder.appendChild(hint);
    }

    const DETECT_STEP_IDS = [
        'config', 'path_lookup', 'known_path', 'pip', 'python_import', 'hermes_home', 'verify', 'acp_check', 'acp_install', 'summary',
    ];
    const DETECT_STEP_LOCALE_KEYS = {
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

    let detectEnvDetailsOpen = false;
    let detectEnvPanelReady = false;
    let detectEnvFinished = false;

    function detectStepLabel(stepId) {
        const key = DETECT_STEP_LOCALE_KEYS[stepId];
        return key ? (locale[key] || stepId) : stepId;
    }

    function formatDetectStepDetail(msg) {
        if (msg.status === 'running') return '…';
        if (msg.status === 'skip') return locale.detectEnvironmentStepSkipped || 'Skipped';
        if (msg.step === 'verify') {
            return localeText(
                'detectEnvironmentStepVerifyCount',
                msg.verifiedCount != null ? msg.verifiedCount : 0,
                msg.totalCount != null ? msg.totalCount : 0,
            );
        }
        if (msg.step === 'acp_check') {
            if (msg.status === 'ok') return msg.detail || locale.detectEnvironmentStepAcpOk || '';
            if (msg.status === 'fail') return msg.detail || locale.detectEnvironmentStepAcpFail || '';
        }
        if (msg.step === 'acp_install') {
            if (msg.status === 'ok') return msg.detail || locale.detectEnvironmentStepAcpInstallOk || '';
            if (msg.status === 'fail') return msg.detail || locale.detectEnvironmentStepAcpInstallFail || '';
        }
        if (msg.step === 'summary') {
            if (msg.detail) return msg.detail;
            if (msg.reportStatus === 'ready') return locale.detectEnvironmentSummaryReady || '';
            if (msg.reportStatus === 'broken') return locale.detectEnvironmentSummaryBroken || '';
            return locale.detectEnvironmentSummaryInstall || locale.detectEnvironmentSummaryNotFound || '';
        }
        if (msg.count > 0) {
            const summary = localeText('detectEnvironmentStepFoundCount', msg.count);
            if (msg.detail) return summary + '\n' + msg.detail;
            return summary;
        }
        if (msg.status === 'fail' && msg.detail) return msg.detail;
        return locale.detectEnvironmentStepNotFound || 'Not found';
    }

    function setDetectEnvIcon(el, status) {
        if (!el) return;
        const keepStep = el.classList.contains('detect-env-step-icon');
        el.className = (keepStep ? 'detect-env-step-icon ' : '') + 'detect-env-icon ' + (status || 'running');
        el.textContent = '';
    }

    function formatDetectProgressDisplay(brief) {
        if (!brief) return '';
        return localeText('detectEnvironmentProgressPrefix', brief);
    }

    function setDetectEnvDetailsTitle() {
        const detailsTitle = document.getElementById('detectEnvDetailsTitle');
        if (!detailsTitle) return;
        detailsTitle.textContent = detectEnvFinished
            ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
            : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
    }

    function setDetectEnvDetailsOpen(open) {
        detectEnvDetailsOpen = !!open;
        const details = document.getElementById('detectEnvDetails');
        const hint = document.getElementById('detectEnvCompactHint');
        const toggle = document.getElementById('detectEnvToggle');
        if (details) details.hidden = !detectEnvDetailsOpen;
        if (hint) hint.classList.toggle('is-open', detectEnvDetailsOpen);
        if (toggle) {
            toggle.setAttribute('aria-expanded', detectEnvDetailsOpen ? 'true' : 'false');
            toggle.title = detectEnvDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
    }

    function buildDetectStepRow(stepId, rowId) {
        const li = document.createElement('li');
        li.className = 'detect-env-step';
        li.id = rowId;
        li.style.display = 'none';
        const stepIcon = document.createElement('span');
        stepIcon.className = 'detect-env-step-icon detect-env-icon running';
        const body = document.createElement('div');
        body.className = 'detect-env-step-body';
        const label = document.createElement('div');
        label.className = 'detect-env-step-label';
        label.textContent = detectStepLabel(stepId);
        const detail = document.createElement('div');
        detail.className = 'detect-env-step-detail';
        body.appendChild(label);
        body.appendChild(detail);
        li.appendChild(stepIcon);
        li.appendChild(body);
        return li;
    }

    function ensureDetectStepsList(listEl, stepIdPrefix) {
        if (!listEl || listEl.dataset.ready === '1') {
            return;
        }
        listEl.textContent = '';
        DETECT_STEP_IDS.forEach(function(stepId) {
            listEl.appendChild(buildDetectStepRow(stepId, stepIdPrefix + stepId));
        });
        listEl.dataset.ready = '1';
    }

    function refreshDetectStepLabels(listEl, stepIdPrefix) {
        if (!listEl) return;
        DETECT_STEP_IDS.forEach(function(stepId) {
            const label = listEl.querySelector('#' + stepIdPrefix + stepId + ' .detect-env-step-label');
            if (label) label.textContent = detectStepLabel(stepId);
        });
    }

    function resetDetectStepsList(stepIdPrefix) {
        DETECT_STEP_IDS.forEach(function(stepId) {
            const row = document.getElementById(stepIdPrefix + stepId);
            if (!row) return;
            row.style.display = 'none';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = '';
        });
    }

    function updateDetectStepsList(msg, stepIdPrefix, compactIconEl, compactTextEl) {
        const row = document.getElementById(stepIdPrefix + msg.step);
        if (row) {
            row.style.display = '';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), msg.status || 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = formatDetectStepDetail(msg);
        }
        if (compactIconEl && compactTextEl && msg.brief) {
            setDetectEnvIcon(compactIconEl, msg.status || 'running');
            const text = formatDetectProgressDisplay(msg.brief);
            compactTextEl.textContent = text;
            compactTextEl.title = text;
        }
    }

    function ensureDetectEnvironmentPanel() {
        const list = document.getElementById('detectEnvSteps');
        ensureDetectStepsList(list, 'detectStep-');
        if (!detectEnvPanelReady && list) {
            detectEnvPanelReady = true;
        }
    }

    function showDetectEnvironmentBar() {
        ensureDetectEnvironmentPanel();
        const bar = document.getElementById('detectEnvBar');
        if (bar) bar.hidden = false;
    }

    function hideDetectEnvironmentBar() {
        detectEnvFinished = false;
        setDetectEnvDetailsOpen(false);
        const bar = document.getElementById('detectEnvBar');
        if (bar) bar.hidden = true;
    }

    function setDetectEnvironmentCompact(brief, status) {
        setDetectEnvIcon(document.getElementById('detectEnvCompactIcon'), status);
        const textEl = document.getElementById('detectEnvCompactText');
        if (textEl) {
            textEl.textContent = brief || '';
            textEl.title = brief || '';
        }
    }

    function updateDetectEnvironmentStep(msg) {
        ensureDetectEnvironmentPanel();
        updateDetectStepsList(
            msg,
            'detectStep-',
            document.getElementById('detectEnvCompactIcon'),
            document.getElementById('detectEnvCompactText'),
        );
    }

    function initDetectEnvironmentStart(mode) {
        detectEnvFinished = false;
        showDetectEnvironmentBar();
        setDetectEnvDetailsOpen(false);
        setDetectEnvDetailsTitle();
        const toggle = document.getElementById('detectEnvToggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
            toggle.title = locale.detectEnvironmentViewDetails || '';
        }
        DETECT_STEP_IDS.forEach(function(stepId) {
            const row = document.getElementById('detectStep-' + stepId);
            if (!row) return;
            row.style.display = 'none';
            setDetectEnvIcon(row.querySelector('.detect-env-step-icon'), 'running');
            const detailEl = row.querySelector('.detect-env-step-detail');
            if (detailEl) detailEl.textContent = '';
        });
        setDetectEnvironmentCompact(
            formatDetectProgressDisplay('0%'),
            'running',
        );
    }

    function finishDetectEnvironmentPanel(msg) {
        detectEnvFinished = true;
        setDetectEnvDetailsTitle();
        const summaryMsg = {
            step: 'summary',
            status: msg.summaryStatus || (msg.status === 'ready' ? 'ok' : 'fail'),
            reportStatus: msg.status,
            brief: msg.brief,
        };
        updateDetectEnvironmentStep(summaryMsg);
        setDetectEnvironmentCompact(formatDetectProgressDisplay(msg.brief || '100%'), summaryMsg.status);
    }

    const configureEnvModal = document.getElementById('configureEnvModal');
    const configureEnvPathInput = document.getElementById('configureEnvPathInput');
    const configureEnvPathClearBtn = document.getElementById('configureEnvPathClearBtn');
    const configureEnvBrowseBtn = document.getElementById('configureEnvBrowseBtn');
    const configureEnvDetectBtn = document.getElementById('configureEnvDetectBtn');
    const configureEnvDetectSection = document.getElementById('configureEnvDetectSection');
    const configureEnvDetectCompactIcon = document.getElementById('configureEnvDetectCompactIcon');
    const configureEnvDetectCompactText = document.getElementById('configureEnvDetectCompactText');
    const configureEnvDetectCompactHint = document.getElementById('configureEnvDetectCompactHint');
    const configureEnvDetectToggle = document.getElementById('configureEnvDetectToggle');
    const configureEnvDetectClose = document.getElementById('configureEnvDetectClose');
    const configureEnvDetectDetails = document.getElementById('configureEnvDetectDetails');
    const configureEnvDetectDetailsTitle = document.getElementById('configureEnvDetectDetailsTitle');
    const configureEnvDetectSteps = document.getElementById('configureEnvDetectSteps');
    const configureEnvCandidatesSection = document.getElementById('configureEnvCandidatesSection');
    const configureEnvCandidatesList = document.getElementById('configureEnvCandidatesList');
    const configureEnvCandidatesEmpty = document.getElementById('configureEnvCandidatesEmpty');
    const configureEnvSaveBtn = document.getElementById('configureEnvSaveBtn');
    const configureEnvCancelBtn = document.getElementById('configureEnvCancelBtn');
    const configureEnvSystemBtn = document.getElementById('configureEnvSystemBtn');
    const configureEnvSystemHint = document.getElementById('configureEnvSystemHint');
    const configureEnvCloseBtn = document.getElementById('configureEnvCloseBtn');
    let configureEnvSelectedPath = '';
    let configureEnvDetectFinished = false;
    let configureEnvDetectDetailsOpen = false;
    let configureEnvDetectPanelVisible = false;
    let configureEnvSystemVar = 'PATH';
    let configureEnvSystemTarget = '';

    function showConfigureEnvDetectPanel() {
        configureEnvDetectPanelVisible = true;
        if (configureEnvDetectSection) configureEnvDetectSection.hidden = false;
    }

    function updateConfigureEnvPathClearVisibility() {
        if (!configureEnvPathClearBtn || !configureEnvPathInput) return;
        const hasValue = !!configureEnvPathInput.value.trim();
        configureEnvPathClearBtn.hidden = !hasValue;
    }

    function clearConfigureEnvPath() {
        if (!configureEnvPathInput) return;
        configureEnvPathInput.value = '';
        configureEnvSelectedPath = '';
        updateConfigureEnvPathClearVisibility();
        if (configureEnvCandidatesList) {
            configureEnvCandidatesList.querySelectorAll('.configure-env-candidate-row').forEach(function(el) {
                el.classList.remove('is-selected');
            });
        }
        configureEnvPathInput.focus();
    }

    function hideConfigureEnvDetectProgress() {
        configureEnvDetectPanelVisible = false;
        configureEnvDetectFinished = false;
        configureEnvDetectDetailsOpen = false;
        if (configureEnvDetectSection) configureEnvDetectSection.hidden = true;
        setConfigureEnvDetectDetailsOpen(false);
        resetDetectStepsList('configureDetectStep-');
        if (configureEnvDetectCompactText) {
            configureEnvDetectCompactText.textContent = '';
            configureEnvDetectCompactText.title = '';
        }
        setDetectEnvIcon(configureEnvDetectCompactIcon, 'running');
    }

    function hideConfigureEnvDetectPanel() {
        hideConfigureEnvDetectProgress();
        if (configureEnvCandidatesSection) {
            configureEnvCandidatesSection.hidden = true;
            configureEnvCandidatesSection.classList.remove('is-visible');
        }
        if (configureEnvCandidatesList) configureEnvCandidatesList.textContent = '';
        if (configureEnvCandidatesEmpty) configureEnvCandidatesEmpty.hidden = true;
    }

    function closeConfigureEnvDetectPanel() {
        const wasVisible = configureEnvDetectPanelVisible;
        hideConfigureEnvDetectProgress();
        if (wasVisible) {
            setConfigureEnvDetecting(false);
            vscode.postMessage({ type: 'configureEnvironmentDetectClose' });
        }
    }

    function createConfigureEnvFolderIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M2 4.5h4.5L8 6h6v7.5H2z');
        svg.appendChild(path);
        return svg;
    }

    function setConfigureEnvDetectDetailsOpen(open) {
        configureEnvDetectDetailsOpen = !!open;
        if (configureEnvDetectDetails) configureEnvDetectDetails.hidden = !configureEnvDetectDetailsOpen;
        if (configureEnvDetectCompactHint) {
            configureEnvDetectCompactHint.classList.toggle('is-open', configureEnvDetectDetailsOpen);
        }
        if (configureEnvDetectToggle) {
            configureEnvDetectToggle.setAttribute('aria-expanded', configureEnvDetectDetailsOpen ? 'true' : 'false');
            configureEnvDetectToggle.title = configureEnvDetectDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
    }

    function setConfigureEnvDetectDetailsTitle() {
        if (!configureEnvDetectDetailsTitle) return;
        configureEnvDetectDetailsTitle.textContent = configureEnvDetectFinished
            ? (locale.detectEnvironmentCompleteTitle || locale.detectEnvironmentStepSummary || '')
            : (locale.detectEnvironmentDetectTitle || locale.detectEnvironment || '');
    }

    function updateConfigureEnvSystemHint() {
        if (!configureEnvSystemHint) return;
        const hint = localeText(
            'configureEnvironmentSystemVarHint',
            configureEnvSystemVar || 'PATH',
            configureEnvSystemTarget || '',
        );
        configureEnvSystemHint.innerHTML = hint.replace(
            configureEnvSystemVar,
            '<code>' + escapeHtml(configureEnvSystemVar) + '</code>',
        );
        if (configureEnvSystemBtn) {
            configureEnvSystemBtn.title = localeText(
                'detectEnvironmentConfigureSystemDesc',
                configureEnvSystemVar || 'PATH',
                configureEnvSystemTarget || '',
            );
        }
    }

    function setConfigureEnvDetecting(detecting) {
        if (configureEnvBrowseBtn) configureEnvBrowseBtn.disabled = !!detecting;
        if (configureEnvDetectBtn) configureEnvDetectBtn.disabled = !!detecting;
        if (configureEnvSaveBtn) configureEnvSaveBtn.disabled = !!detecting;
        if (configureEnvSystemBtn) configureEnvSystemBtn.disabled = !!detecting;
    }

    function resetConfigureEnvDetectPanel() {
        hideConfigureEnvDetectPanel();
        configureEnvSelectedPath = '';
    }

    function openConfigureEnvModal(currentPath, systemEnvVar, systemEnvTarget) {
        if (!configureEnvModal) return;
        configureEnvSystemVar = systemEnvVar || 'PATH';
        configureEnvSystemTarget = systemEnvTarget || '';
        updateConfigureEnvSystemHint();
        resetConfigureEnvDetectPanel();
        if (configureEnvPathInput) configureEnvPathInput.value = currentPath || '';
        updateConfigureEnvPathClearVisibility();
        configureEnvModal.classList.add('is-open');
        if (configureEnvPathInput) configureEnvPathInput.focus();
    }

    function closeConfigureEnvModal() {
        if (!configureEnvModal) return;
        configureEnvModal.classList.remove('is-open');
        resetConfigureEnvDetectPanel();
    }

    function initConfigureEnvDetectStart() {
        configureEnvDetectFinished = false;
        ensureDetectStepsList(configureEnvDetectSteps, 'configureDetectStep-');
        resetDetectStepsList('configureDetectStep-');
        showConfigureEnvDetectPanel();
        setConfigureEnvDetectDetailsOpen(false);
        setConfigureEnvDetectDetailsTitle();
        if (configureEnvDetectToggle) {
            configureEnvDetectToggle.title = locale.detectEnvironmentViewDetails || '';
        }
        setDetectEnvIcon(configureEnvDetectCompactIcon, 'running');
        if (configureEnvDetectCompactText) {
            const text = formatDetectProgressDisplay('0%');
            configureEnvDetectCompactText.textContent = text;
            configureEnvDetectCompactText.title = text;
        }
    }

    function updateConfigureEnvDetectProgress(msg) {
        if (!configureEnvDetectSection || !configureEnvDetectPanelVisible) return;
        updateDetectStepsList(
            msg,
            'configureDetectStep-',
            configureEnvDetectCompactIcon,
            configureEnvDetectCompactText,
        );
    }

    function basenameFromPath(filePath) {
        if (!filePath) return 'hermes';
        const parts = filePath.split(/[/\\]/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : 'hermes';
    }

    function selectConfigureEnvCandidate(path, rowEl) {
        configureEnvSelectedPath = path || '';
        if (configureEnvPathInput) {
            configureEnvPathInput.value = configureEnvSelectedPath;
            updateConfigureEnvPathClearVisibility();
        }
        if (configureEnvCandidatesList) {
            configureEnvCandidatesList.querySelectorAll('.configure-env-candidate-row').forEach(function(el) {
                el.classList.toggle('is-selected', el === rowEl);
            });
        }
    }

    function renderConfigureEnvCandidates(executables) {
        if (!configureEnvCandidatesSection || !configureEnvCandidatesList || !configureEnvCandidatesEmpty) return;
        configureEnvCandidatesList.textContent = '';
        const list = Array.isArray(executables) ? executables : [];
        configureEnvCandidatesSection.hidden = false;
        configureEnvCandidatesSection.classList.remove('is-visible');
        void configureEnvCandidatesSection.offsetWidth;
        configureEnvCandidatesSection.classList.add('is-visible');
        if (list.length === 0) {
            configureEnvCandidatesEmpty.hidden = false;
            configureEnvCandidatesEmpty.textContent = locale.configureEnvironmentNoCandidates || '';
            return;
        }
        configureEnvCandidatesEmpty.hidden = true;
        list.forEach(function(item, index) {
            const li = document.createElement('li');
            li.className = 'configure-env-candidate-row';
            if (item.path === configureEnvSelectedPath) {
                li.classList.add('is-selected');
            }
            li.style.animationDelay = (index * 0.06) + 's';

            const body = document.createElement('div');
            body.className = 'configure-env-candidate-body';
            const icon = document.createElement('span');
            icon.className = 'configure-env-candidate-icon detect-env-icon ' + (item.verified ? 'ok' : 'fail');
            const main = document.createElement('div');
            main.className = 'configure-env-candidate-main';
            const head = document.createElement('div');
            head.className = 'configure-env-candidate-head';
            const name = document.createElement('span');
            name.className = 'configure-env-candidate-name';
            name.textContent = basenameFromPath(item.path);
            const badge = document.createElement('span');
            badge.className = 'configure-env-candidate-badge ' + (item.verified ? 'is-verified' : 'is-unverified');
            badge.textContent = item.verified
                ? (locale.detectEnvironmentCandidateVerified || 'verified')
                : (locale.detectEnvironmentCandidateUnverified || 'unverified');
            const tag = document.createElement('span');
            tag.className = 'configure-env-candidate-tag';
            tag.textContent = item.source || '';
            head.appendChild(name);
            head.appendChild(badge);
            if (item.source) head.appendChild(tag);
            const pathEl = document.createElement('div');
            pathEl.className = 'configure-env-candidate-path';
            pathEl.textContent = item.path || '';
            main.appendChild(head);
            main.appendChild(pathEl);
            if (item.version) {
                const versionEl = document.createElement('div');
                versionEl.className = 'configure-env-candidate-version';
                versionEl.textContent = item.version;
                main.appendChild(versionEl);
            }
            body.appendChild(icon);
            body.appendChild(main);
            body.addEventListener('click', function() {
                selectConfigureEnvCandidate(item.path || '', li);
            });

            const actions = document.createElement('div');
            actions.className = 'configure-env-candidate-actions';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'configure-env-candidate-open';
            openBtn.title = locale.configureEnvironmentOpenDirectory || 'Open folder';
            openBtn.setAttribute('aria-label', openBtn.title);
            openBtn.appendChild(createConfigureEnvFolderIcon());
            openBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!item.path) return;
                vscode.postMessage({
                    type: 'configureEnvironmentOpenDirectory',
                    path: item.path,
                });
            });

            const selectBtn = document.createElement('button');
            selectBtn.type = 'button';
            selectBtn.className = 'configure-env-candidate-select';
            selectBtn.setAttribute('aria-label', locale.configureEnvironmentSelectCandidate || 'Select');
            selectBtn.textContent = '✓';
            selectBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                selectConfigureEnvCandidate(item.path || '', li);
            });

            actions.appendChild(openBtn);
            actions.appendChild(selectBtn);

            li.appendChild(body);
            li.appendChild(actions);
            configureEnvCandidatesList.appendChild(li);
        });
    }

    function finishConfigureEnvDetect(msg) {
        setConfigureEnvDetecting(false);
        if (msg.status === 'cancelled' || !configureEnvDetectPanelVisible) {
            hideConfigureEnvDetectProgress();
            return;
        }
        configureEnvDetectFinished = true;
        setConfigureEnvDetectDetailsTitle();
        const summaryStatus = msg.status === 'ready' ? 'ok' : (msg.executables && msg.executables.length ? 'ok' : 'fail');
        updateConfigureEnvDetectProgress({
            step: 'summary',
            status: summaryStatus,
            reportStatus: msg.status,
            brief: '100%',
            detail: msg.summary,
        });
        renderConfigureEnvCandidates(msg.executables || []);
    }

    function startConfigureEnvDetect() {
        if (!configureEnvDetectBtn || configureEnvDetectBtn.disabled) return;
        if (configureEnvCandidatesSection) {
            configureEnvCandidatesSection.hidden = true;
            configureEnvCandidatesSection.classList.remove('is-visible');
        }
        if (configureEnvCandidatesList) configureEnvCandidatesList.textContent = '';
        if (configureEnvCandidatesEmpty) configureEnvCandidatesEmpty.hidden = true;
        configureEnvSelectedPath = configureEnvPathInput ? configureEnvPathInput.value.trim() : '';
        setConfigureEnvDetecting(true);
        initConfigureEnvDetectStart();
        vscode.postMessage({
            type: 'configureEnvironmentDetect',
            currentPath: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function saveConfigureEnvPath() {
        if (!configureEnvSaveBtn || configureEnvSaveBtn.disabled) return;
        vscode.postMessage({
            type: 'configureEnvironmentSave',
            path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function browseConfigureEnvPath() {
        if (!configureEnvBrowseBtn || configureEnvBrowseBtn.disabled) return;
        vscode.postMessage({ type: 'configureEnvironmentBrowse' });
    }

    function requestConfigureEnvSystemPath() {
        if (!configureEnvSystemBtn || configureEnvSystemBtn.disabled) return;
        vscode.postMessage({
            type: 'configureEnvironmentSystem',
            path: configureEnvPathInput ? configureEnvPathInput.value.trim() : '',
        });
    }

    function buildFaqAccordion(container) {
        if (!container || container.querySelector('.faq-list')) {
            return;
        }
        const nodes = Array.from(container.childNodes);
        const wrapper = document.createElement('div');
        wrapper.className = 'faq-list';
        let i = 0;
        while (i < nodes.length) {
            const node = nodes[i];
            if (node.nodeType === 1 && node.tagName === 'H3') {
                const details = document.createElement('details');
                details.className = 'faq-item';
                if (wrapper.childElementCount === 0) {
                    details.open = true;
                }
                const summary = document.createElement('summary');
                summary.className = 'faq-summary';
                summary.textContent = node.textContent;
                const body = document.createElement('div');
                body.className = 'faq-body';
                i += 1;
                while (i < nodes.length && !(nodes[i].nodeType === 1 && nodes[i].tagName === 'H3')) {
                    body.appendChild(nodes[i]);
                    i += 1;
                }
                details.appendChild(summary);
                details.appendChild(body);
                wrapper.appendChild(details);
            } else if (node.nodeType === 3 && !node.textContent.trim()) {
                i += 1;
            } else {
                i += 1;
            }
        }
        if (wrapper.childElementCount > 0) {
            container.textContent = '';
            container.appendChild(wrapper);
        }
    }

    function applyLocale() {
        const toolbarStatus = document.getElementById('toolbarStatus');
        const retryBtnEl = document.getElementById('retryBtn');
        const profileBtnEl = document.getElementById('profileBtn');
        const modelBtnEl = document.getElementById('modelBtn');
        const cancelBtnEl = document.getElementById('cancelBtn');
        const filePickerElLocal = document.getElementById('filePicker');

        if (toolbarStatus) toolbarStatus.title = locale.connectionStatus;
        if (retryBtnEl) retryBtnEl.title = locale.retry;
        const profileLabelText = document.getElementById('profileLabelText');
        if (profileLabelText) profileLabelText.textContent = locale.profile;
        if (profileBtnEl) profileBtnEl.title = locale.switchProfile;
        const profilesHeader = document.getElementById('profilesHeader');
        if (profilesHeader) profilesHeader.textContent = locale.profiles;
        if (modelBtnEl) modelBtnEl.title = locale.switchModel;
        const modelsHeader = document.getElementById('modelsHeader');
        if (modelsHeader) modelsHeader.textContent = locale.models;
        updateModelButtonDisplay(lastModelPayload);
        if (contextAttachHeaderLead) contextAttachHeaderLead.textContent = locale.contextAttachHeaderLead || '';
        if (contextAttachHeaderRest) contextAttachHeaderRest.textContent = locale.contextAttachHeaderRest || '';
        if (contextAttachHelp) {
            const tip = locale.contextAttachTooltip || '';
            contextAttachHelp.title = tip;
            contextAttachHelp.setAttribute('aria-label', tip);
        }
        if (contextAttachTooltipEl) {
            contextAttachTooltipEl.textContent = locale.contextAttachTooltip || '';
        }
        const contextAttachSendTitle = document.getElementById('contextAttachSendModalTitle');
        const contextAttachSendBody = document.getElementById('contextAttachSendModalBody');
        const contextAttachSendYesBtn = document.getElementById('contextAttachSendYesBtn');
        const contextAttachSendNoBtn = document.getElementById('contextAttachSendNoBtn');
        if (contextAttachSendTitle) contextAttachSendTitle.textContent = locale.contextAttachCustom || '';
        if (contextAttachSendBody) contextAttachSendBody.textContent = locale.contextAttachSendPrompt || '';
        if (contextAttachSendYesBtn) contextAttachSendYesBtn.textContent = locale.contextAttachSendYes || '';
        if (contextAttachSendNoBtn) contextAttachSendNoBtn.textContent = locale.contextAttachSendNo || '';
        if (multiSelectAttachConfirmBtn) multiSelectAttachConfirmBtn.textContent = locale.contextAttachConfirm || '';
        updateContextAttachButtonLabel();
        renderContextAttachOptions();

        const detectEnvClose = document.getElementById('detectEnvClose');
        if (detectEnvClose) {
            detectEnvClose.title = locale.detectEnvironmentClose || '';
            detectEnvClose.setAttribute('aria-label', locale.detectEnvironmentClose || 'Close');
        }
        if (detectEnvPanelReady) {
            setDetectEnvDetailsTitle();
            const toggle = document.getElementById('detectEnvToggle');
            if (toggle) {
                toggle.title = detectEnvDetailsOpen
                    ? (locale.detectEnvironmentHideDetails || '')
                    : (locale.detectEnvironmentViewDetails || '');
            }
            const hint = document.getElementById('detectEnvCompactHint');
            if (hint) hint.classList.toggle('is-open', detectEnvDetailsOpen);
            DETECT_STEP_IDS.forEach(function(stepId) {
                const row = document.getElementById('detectStep-' + stepId);
                if (!row) return;
                const label = row.querySelector('.detect-env-step-label');
                if (label) label.textContent = detectStepLabel(stepId);
            });
        }
        if (inputResizeHandle) {
            inputResizeHandle.title = locale.resizeHandle;
            inputResizeHandle.setAttribute('aria-label', locale.resizeHandle);
        }
        if (filePickerElLocal) filePickerElLocal.setAttribute('aria-label', locale.filePicker);
        if (chatSearchInput) {
            chatSearchInput.placeholder = locale.searchChat;
            chatSearchInput.setAttribute('aria-label', locale.searchChat);
        }
        if (chatSearchPrev) {
            chatSearchPrev.title = locale.searchPrev;
            chatSearchPrev.setAttribute('aria-label', locale.searchPrev);
        }
        if (chatSearchNext) {
            chatSearchNext.title = locale.searchNext;
            chatSearchNext.setAttribute('aria-label', locale.searchNext);
        }
        if (clearChatBtn) {
            clearChatBtn.title = locale.clearChat;
            clearChatBtn.setAttribute('aria-label', locale.clearChat);
        }
        if (clearInputBtn) {
            clearInputBtn.title = locale.clearInput;
            clearInputBtn.setAttribute('aria-label', locale.clearInput);
        }
        if (copySessionBtn) {
            copySessionBtn.title = locale.copySession;
            copySessionBtn.setAttribute('aria-label', locale.copySession);
        }
        if (downloadSessionBtn) {
            downloadSessionBtn.title = locale.downloadSession;
            downloadSessionBtn.setAttribute('aria-label', locale.downloadSession);
        }
        if (multiSelectAllBtn) multiSelectAllBtn.textContent = locale.multiSelectAll;
        if (multiSelectDeleteBtn) multiSelectDeleteBtn.textContent = locale.multiSelectDelete;
        if (multiSelectCopyBtn) multiSelectCopyBtn.textContent = locale.multiSelectCopy;
        if (multiSelectExportBtn) multiSelectExportBtn.textContent = locale.multiSelectExport;
        if (multiSelectExitBtn) multiSelectExitBtn.textContent = locale.multiSelectExit;
        updateMultiSelectToolbar();
        if (quickActionsTrigger) {
            quickActionsTrigger.title = locale.quickActions;
            quickActionsTrigger.setAttribute('aria-label', locale.quickActions);
        }
        if (inputEl) inputEl.placeholder = locale.inputPlaceholder;
        if (contextUsageEl) {
            contextUsageEl.title = locale.tokenUsage;
            contextUsageEl.setAttribute('aria-label', locale.tokenUsage);
        }
        if (sendBtn) sendBtn.textContent = locale.send;
        const stopBtnLabel = document.getElementById('stopBtnLabel');
        if (stopBtnLabel) stopBtnLabel.textContent = locale.stop;
        if (cancelBtnEl) {
            cancelBtnEl.title = locale.cancelResponse;
            cancelBtnEl.setAttribute('aria-label', locale.cancelResponse);
        }
        const logModalTitle = document.getElementById('logModalTitle');
        if (logModalTitle) logModalTitle.textContent = locale.hermesLogs;
        const renderBannerText = document.querySelector('#' + SESSION_RENDER_BANNER_ID + ' .session-render-text');
        if (renderBannerText) renderBannerText.textContent = locale.sessionRendering || '';
        const copyLogBtn = document.getElementById('copyLogBtn');
        if (copyLogBtn) copyLogBtn.textContent = locale.copy;
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) clearLogBtn.textContent = locale.clear;
        const aboutModalTitle = document.getElementById('aboutModalTitle');
        if (aboutModalTitle) aboutModalTitle.textContent = locale.aboutTitle;
        const helpModalTitle = document.getElementById('helpModalTitle');
        if (helpModalTitle) helpModalTitle.textContent = locale.helpTitle;
        const helpModalBody = document.getElementById('helpModalBody');
        if (helpModalBody) helpModalBody.innerHTML = locale.helpHtml;
        const faqModalTitle = document.getElementById('faqModalTitle');
        if (faqModalTitle) faqModalTitle.textContent = locale.faqTitle;
        const faqModalBody = document.getElementById('faqModalBody');
        if (faqModalBody) {
            faqModalBody.innerHTML = locale.faqHtml || '';
            buildFaqAccordion(faqModalBody);
        }
        const configureEnvModalTitle = document.getElementById('configureEnvModalTitle');
        if (configureEnvModalTitle) configureEnvModalTitle.textContent = locale.configureEnvironmentTitle || '';
        const configureEnvPathLabel = document.getElementById('configureEnvPathLabel');
        if (configureEnvPathLabel) configureEnvPathLabel.textContent = locale.configureEnvironmentPathLabel || '';
        if (configureEnvPathInput) {
            configureEnvPathInput.placeholder = locale.configureEnvironmentPathPlaceholder || '';
        }
        if (configureEnvPathClearBtn) {
            configureEnvPathClearBtn.setAttribute(
                'aria-label',
                locale.configureEnvironmentClearPath || 'Clear path',
            );
            configureEnvPathClearBtn.title = locale.configureEnvironmentClearPath || 'Clear path';
        }
        updateConfigureEnvPathClearVisibility();
        if (configureEnvBrowseBtn) configureEnvBrowseBtn.textContent = locale.configureEnvironmentBrowse || '';
        if (configureEnvDetectBtn) configureEnvDetectBtn.textContent = locale.configureEnvironmentDetect || '';
        const configureEnvCandidatesTitle = document.getElementById('configureEnvCandidatesTitle');
        if (configureEnvCandidatesTitle) {
            configureEnvCandidatesTitle.textContent = locale.configureEnvironmentCandidatesTitle || '';
        }
        if (configureEnvCandidatesEmpty) {
            configureEnvCandidatesEmpty.textContent = locale.configureEnvironmentNoCandidates || '';
        }
        if (configureEnvSaveBtn) configureEnvSaveBtn.textContent = locale.configureEnvironmentSave || '';
        if (configureEnvCancelBtn) configureEnvCancelBtn.textContent = locale.configureEnvironmentCancel || '';
        if (configureEnvSystemBtn) {
            configureEnvSystemBtn.textContent = locale.detectEnvironmentConfigureSystem || '';
        }
        updateConfigureEnvSystemHint();
        refreshDetectStepLabels(configureEnvDetectSteps, 'configureDetectStep-');
        setConfigureEnvDetectDetailsTitle();
        if (configureEnvDetectToggle) {
            configureEnvDetectToggle.title = configureEnvDetectDetailsOpen
                ? (locale.detectEnvironmentHideDetails || '')
                : (locale.detectEnvironmentViewDetails || '');
        }
        if (statusText) statusText.textContent = locale.statusDisconnected;
        pendingPermissions.forEach(function(group) {
            const labelEl = group.querySelector('.permission-label');
            if (labelEl) labelEl.textContent = locale.permissionTitle || 'Permission required';
            refreshPermissionOptionLabels(group);
            if (group._permissionState) {
                group._permissionState.moreBtn.textContent = locale.permissionShowMore || 'Show more';
                group._permissionState.lessBtn.textContent = locale.permissionCollapse || 'Collapse';
                syncPermissionDetailView(group);
            }
        });
        document.querySelectorAll('.message-group.thought, .message-group.tool').forEach(function(group) {
            if (!group._auxState) return;
            group._auxState.moreBtn.textContent = locale.permissionShowMore || 'Show more';
            group._auxState.lessBtn.textContent = locale.permissionCollapse || 'Collapse';
            const labelEl = group.querySelector('.aux-label');
            if (labelEl) {
                labelEl.textContent = group._auxState.role === 'thought' ? locale.roleThought : locale.roleTool;
            }
            syncAuxiliaryDetailView(group);
        });
    }

    const INPUT_HEIGHT_STORAGE_KEY = 'hermes-chat-input-max-height';
    const INPUT_HEIGHT_MIN = 36;
    const INPUT_HEIGHT_DEFAULT = 200;

    function getChatRegionHeight() {
        const chatH = chatBodyEl ? chatBodyEl.clientHeight : 0;
        const inputH = inputAreaEl ? inputAreaEl.clientHeight : 0;
        const region = chatH + inputH;
        if (region > 0) {
            return region;
        }
        return Math.max(window.innerHeight - 120, INPUT_HEIGHT_MIN);
    }

    function getInputHeightCeiling() {
        return Math.max(INPUT_HEIGHT_MIN, Math.floor(getChatRegionHeight() * 0.6));
    }

    function getInputMaxHeight() {
        const raw = getComputedStyle(inputAreaEl).getPropertyValue('--input-max-height').trim();
        const v = parseInt(raw, 10);
        if (!isNaN(v) && v >= INPUT_HEIGHT_MIN) {
            return v;
        }
        return INPUT_HEIGHT_DEFAULT;
    }

    function getEffectiveInputMaxHeight() {
        return Math.min(getInputMaxHeight(), getInputHeightCeiling());
    }

    function syncInputHeightFromContent() {
        const max = getEffectiveInputMaxHeight();
        inputEl.style.height = 'auto';
        const next = Math.min(inputEl.scrollHeight, max);
        inputEl.style.height = next + 'px';
        inputEl.style.overflowY = inputEl.scrollHeight > max ? 'auto' : 'hidden';
    }

    function setInputMaxHeight(px, options) {
        const opts = options || {};
        const clamped = Math.max(INPUT_HEIGHT_MIN, Math.min(px, getInputHeightCeiling()));
        inputAreaEl.style.setProperty('--input-max-height', clamped + 'px');
        if (opts.explicit) {
            inputEl.style.height = clamped + 'px';
        } else {
            syncInputHeightFromContent();
        }
        if (opts.persist !== false) {
            try { localStorage.setItem(INPUT_HEIGHT_STORAGE_KEY, String(clamped)); } catch (_) {}
        }
        return clamped;
    }

    (function initInputHeight() {
        let saved = INPUT_HEIGHT_DEFAULT;
        try {
            const raw = localStorage.getItem(INPUT_HEIGHT_STORAGE_KEY);
            if (raw) saved = parseInt(raw, 10);
        } catch (_) {}
        if (isNaN(saved)) saved = INPUT_HEIGHT_DEFAULT;
        setInputMaxHeight(saved, { persist: false, explicit: false });
    })();

    (function setupInputResize() {
        if (!inputResizeHandle) return;
        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            inputResizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            try { inputResizeHandle.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        inputResizeHandle.addEventListener('pointerdown', function(e) {
            if (e.button !== 0) return;
            dragging = true;
            startY = e.clientY;
            startHeight = inputEl.offsetHeight;
            inputResizeHandle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            inputResizeHandle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        inputResizeHandle.addEventListener('pointermove', function(e) {
            if (!dragging) return;
            setInputMaxHeight(startHeight + (startY - e.clientY), { explicit: true });
        });
        inputResizeHandle.addEventListener('pointerup', endDrag);
        inputResizeHandle.addEventListener('pointercancel', endDrag);
    })();

    window.addEventListener('resize', syncInputHeightFromContent);
    window.addEventListener('scroll', function(e) {
        hideContextAttachTooltip();
        if (contextAttachPreviewOpen && isInsideContextAttachPreview(e.target)) {
            return;
        }
        hideContextAttachPreview();
    }, true);

    let streamingMessageId = null;
    let thoughtMsgId = null;
    let canSend = false;
    let isPrompting = false;
    /** Images queued for the next send. Each: { name, mimeType, data(base64) }. */
    let pendingImages = [];
    /** Non-image files (code/text) queued for the next send. Each: { name, mimeType, text }. */
    let pendingFiles = [];
    let pendingSwitchSessionId = null;
    let contextAttachVisible = false;
    let contextAttachMode = 'none';
    let contextAttachCustomIndices = [];
    let contextAttachCustomPending = false;
    let contextAttachCustomConfirmed = false;
    let contextAttachUnconfirmedIndices = [];
    let contextAttachPreviewOpen = false;
    let contextAttachPickerHiding = false;
    let contextAttachHasChoice = false;
    let pendingSendText = '';
    function maybeFocusInputAfterResponse() {
        if (!canSend || inputEl.disabled) {
            return;
        }
        if (!document.hasFocus()) {
            return;
        }
        requestAnimationFrame(function() {
            if (canSend && !inputEl.disabled && document.hasFocus()) {
                inputEl.focus();
            }
        });
    }

    function resetContextAttachPickerElement() {
        if (contextAttachPicker) {
            contextAttachPicker.hidden = true;
            contextAttachPicker.classList.remove('is-hiding', 'is-entering', 'is-attention');
        }
        contextAttachPickerHiding = false;
    }

    function forceHideContextAttachPicker() {
        contextAttachVisible = false;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        pendingSendText = '';
        if (multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        resetContextAttachPickerElement();
        closeAllDropdowns();
    }

    function finishHideContextAttachPicker() {
        contextAttachVisible = false;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        pendingSendText = '';
        if (multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        resetContextAttachPickerElement();
        closeAllDropdowns();
    }

    function hideContextAttachPicker() {
        if (!contextAttachVisible && !contextAttachPickerHiding) {
            return;
        }
        if (contextAttachPickerHiding) {
            return;
        }
        if (!contextAttachPicker || contextAttachPicker.hidden) {
            finishHideContextAttachPicker();
            return;
        }
        contextAttachPickerHiding = true;
        contextAttachPicker.classList.remove('is-entering', 'is-attention');
        contextAttachPicker.classList.add('is-hiding');
        hideContextAttachPreview();
        const onExitEnd = function(e) {
            if (e.target !== contextAttachPicker || e.animationName !== 'context-attach-exit') {
                return;
            }
            contextAttachPicker.removeEventListener('animationend', onExitEnd);
            finishHideContextAttachPicker();
        };
        contextAttachPicker.addEventListener('animationend', onExitEnd);
    }

    function positionContextAttachTooltip() {
        if (!contextAttachHelp || !contextAttachTooltipEl || contextAttachTooltipEl.hidden) {
            return;
        }
        const rect = contextAttachHelp.getBoundingClientRect();
        const tipRect = contextAttachTooltipEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.top - tipRect.height - 10;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        if (top < 8) {
            top = rect.bottom + 10;
        }
        contextAttachTooltipEl.style.left = left + 'px';
        contextAttachTooltipEl.style.top = top + 'px';
    }

    function showContextAttachTooltip() {
        if (!contextAttachHelp || !contextAttachTooltipEl) {
            return;
        }
        contextAttachTooltipEl.textContent = locale.contextAttachTooltip || contextAttachHelp.getAttribute('aria-label') || '';
        contextAttachTooltipEl.hidden = false;
        contextAttachTooltipEl.style.left = '-9999px';
        contextAttachTooltipEl.style.top = '0';
        requestAnimationFrame(function() {
            positionContextAttachTooltip();
        });
    }

    function hideContextAttachTooltip() {
        if (contextAttachTooltipEl) {
            contextAttachTooltipEl.hidden = true;
        }
    }

    function bindContextAttachTooltip() {
        if (!contextAttachHelp) {
            return;
        }
        contextAttachHelp.addEventListener('mouseenter', showContextAttachTooltip);
        contextAttachHelp.addEventListener('mouseleave', hideContextAttachTooltip);
        contextAttachHelp.addEventListener('focus', showContextAttachTooltip);
        contextAttachHelp.addEventListener('blur', hideContextAttachTooltip);
    }

    function getContextAttachRegionGroups() {
        const divider = document.getElementById(LOCAL_HISTORY_DIVIDER_ID);
        const groups = [];
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            if (divider && !(group.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                return;
            }
            groups.push(group);
        });
        return groups;
    }

    function ensureGroupSelectableForContextAttach(group) {
        if (!isAttachableMemoryGroup(group)) {
            return;
        }
        if (group.classList.contains('selectable')) {
            return;
        }
        group.classList.add('selectable', 'context-attach-extra-selectable');
        const selectWrap = document.createElement('label');
        selectWrap.className = 'msg-select-wrap';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        checkbox.addEventListener('change', function() {
            setGroupSelected(group, checkbox.checked);
        });
        selectWrap.appendChild(checkbox);
        group.insertBefore(selectWrap, group.firstChild);
        wireSelectableGroup(group);
    }

    function ensureContextAttachSelectableTargets() {
        getContextAttachRegionGroups().forEach(ensureGroupSelectableForContextAttach);
    }

    function clearContextAttachSelectableTargets() {
        messagesEl.querySelectorAll('.message-group.context-attach-extra-selectable').forEach(function(group) {
            group.classList.remove('selectable', 'context-attach-extra-selectable', 'is-selected');
            const wrap = group.querySelector('.msg-select-wrap');
            if (wrap) {
                wrap.remove();
            }
            if (group.dataset.contextAttachReveal === '1') {
                group.style.display = 'none';
                delete group.dataset.contextAttachReveal;
            }
        });
    }

    function getExistingCustomAttachIndices() {
        if (contextAttachCustomIndices.length > 0) {
            return contextAttachCustomIndices.slice();
        }
        if (contextAttachUnconfirmedIndices.length > 0) {
            return contextAttachUnconfirmedIndices.slice();
        }
        return [];
    }

    function applyContextAttachIndicesToSelection(indices) {
        if (!indices.length) {
            return;
        }
        const indexSet = new Set(indices);
        const updates = [];
        getContextAttachRegionGroups().forEach(function(group) {
            const idx = parseInt(group.dataset.sessionIndex || '', 10);
            updates.push({
                group: group,
                selected: Number.isInteger(idx) && indexSet.has(idx),
            });
        });
        setGroupsSelected(updates);
    }

    function getCustomContextAttachSelectionCount() {
        if (contextAttachCustomConfirmed) {
            return contextAttachCustomIndices.length;
        }
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            return getSelectedMessageIndices().length;
        }
        if (contextAttachCustomPending || contextAttachUnconfirmedIndices.length > 0) {
            return getUnconfirmedCustomSelectionIndices().length;
        }
        return 0;
    }

    function getContextAttachCountLabel(count) {
        return (locale.contextAttachSelected || '附带上轮已选{0}条记忆').replace('{0}', String(count));
    }

    function getContextAttachOptionLabel(mode) {
        switch (mode) {
            case 'last2':
                return locale.contextAttachLast2;
            case 'last10':
                return locale.contextAttachLast10;
            case 'all':
                return locale.contextAttachAll;
            case 'custom': {
                const count = getCustomContextAttachSelectionCount();
                if (count > 0) {
                    return getContextAttachCountLabel(count);
                }
                if (contextAttachCustomPending || contextAttachCustomConfirmed || contextAttachHasChoice) {
                    return locale.contextAttachCustomNone || '您没有选择任何记忆';
                }
                return locale.contextAttachCustom;
            }
            case 'none':
            default:
                if (contextAttachHasChoice) {
                    return locale.contextAttachNone;
                }
                return locale.contextAttachPlaceholder || locale.contextAttachNone;
        }
    }

    function updateContextAttachButtonLabel() {
        if (!contextAttachLabel || !contextAttachBtn) {
            return;
        }
        const isPlaceholder = contextAttachMode === 'none' && !contextAttachHasChoice;
        contextAttachLabel.textContent = getContextAttachOptionLabel(contextAttachMode);
        contextAttachBtn.classList.toggle('is-placeholder', isPlaceholder);
        contextAttachBtn.title = isPlaceholder
            ? (locale.contextAttachPlaceholder || '')
            : getContextAttachOptionLabel(contextAttachMode);
        if (contextAttachPreviewOpen) {
            if (hasContextAttachSelection()) {
                renderContextAttachPreviewContent();
                requestAnimationFrame(function() {
                    positionContextAttachPreview();
                });
            } else {
                hideContextAttachPreview();
            }
        }
    }

    function getGroupPreviewRoleLabel(group) {
        if (group.classList.contains('permission')) {
            return locale.permissionTitle || 'Permission';
        }
        if (group.classList.contains('thought')) {
            return locale.roleThought || 'Thought';
        }
        if (group.classList.contains('tool')) {
            return locale.roleTool || 'Tool';
        }
        return getGroupRoleLabel(group);
    }

    function getGroupPreviewText(group) {
        if (group.classList.contains('permission') && group._permissionState && group._permissionState.text) {
            return group._permissionState.text.trim();
        }
        if (group._auxState && group._auxState.rawText) {
            return group._auxState.rawText.trim();
        }
        return getMessagePlainText(group).trim();
    }

    function isAttachableMemoryGroup(group) {
        return group.classList.contains('user')
            || group.classList.contains('assistant')
            || group.classList.contains('permission');
    }

    function getAttachableMemoryGroups() {
        return getContextAttachRegionGroups().filter(isAttachableMemoryGroup);
    }

    function resolveAttachPreviewGroups() {
        if (!contextAttachVisible || contextAttachMode === 'none') {
            return [];
        }
        const attachable = getAttachableMemoryGroups();
        if (contextAttachMode === 'last2') {
            return attachable.slice(-2);
        }
        if (contextAttachMode === 'last10') {
            return attachable.slice(-10);
        }
        if (contextAttachMode === 'all') {
            return attachable.slice();
        }
        if (contextAttachMode === 'custom') {
            let indices = [];
            if (contextAttachCustomConfirmed) {
                indices = contextAttachCustomIndices;
            } else if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
                indices = getSelectedMessageIndices();
            } else {
                indices = contextAttachUnconfirmedIndices;
            }
            if (!indices.length) {
                return [];
            }
            const byIndex = new Map();
            messagesEl.querySelectorAll('.message-group').forEach(function(group) {
                const idx = parseInt(group.dataset.sessionIndex || '', 10);
                if (Number.isInteger(idx)) {
                    byIndex.set(idx, group);
                }
            });
            const picked = [];
            indices.forEach(function(index) {
                const group = byIndex.get(index);
                if (group && isAttachableMemoryGroup(group) && picked.indexOf(group) === -1) {
                    picked.push(group);
                }
            });
            return picked;
        }
        return [];
    }

    function hasContextAttachSelection() {
        return resolveAttachPreviewGroups().length > 0;
    }

    function isInsideContextAttachPreview(node) {
        if (!node || !contextAttachPreviewEl) {
            return false;
        }
        return contextAttachPreviewEl === node || contextAttachPreviewEl.contains(node);
    }

    function estimateContextAttachInputTokens(groups) {
        const parts = [(locale.contextAttachPrefixHeader || ''), '---'];
        groups.forEach(function(group) {
            parts.push(getGroupPreviewRoleLabel(group));
            parts.push(getGroupPreviewText(group));
        });
        const text = parts.join('\n');
        let weight = 0;
        for (let i = 0; i < text.length; i++) {
            weight += text.charCodeAt(i) > 0x2E7F ? 0.55 : 0.25;
        }
        return Math.max(1, Math.ceil(weight));
    }

    function updateContextAttachPreviewTitle(count, tokens) {
        const titleEl = document.getElementById('contextAttachPreviewTitle');
        if (!titleEl) {
            return;
        }
        const template = locale.contextAttachPreviewTitle || '({0} / ~{1})';
        titleEl.textContent = template
            .replace('{0}', String(count))
            .replace('{1}', String(tokens));
    }

    function renderContextAttachPreviewContent() {
        if (!contextAttachPreviewList) {
            return;
        }
        const groups = resolveAttachPreviewGroups();
        if (!groups.length) {
            contextAttachPreviewList.innerHTML = '';
            updateContextAttachPreviewTitle(0, 0);
            return;
        }
        updateContextAttachPreviewTitle(groups.length, estimateContextAttachInputTokens(groups));
        contextAttachPreviewList.innerHTML = groups.map(function(group) {
            const role = escapeHtml(getGroupPreviewRoleLabel(group));
            const text = escapeHtml(getGroupPreviewText(group) || '—');
            return '<li class="context-attach-preview-item">' +
                '<span class="context-attach-preview-role">' + role + '</span>' +
                '<span class="context-attach-preview-text">' + text + '</span>' +
                '</li>';
        }).join('');
    }

    function positionContextAttachPreview() {
        if (!contextAttachBtn || !contextAttachPreviewEl || contextAttachPreviewEl.hidden) {
            return;
        }
        const rect = contextAttachBtn.getBoundingClientRect();
        const tipRect = contextAttachPreviewEl.getBoundingClientRect();
        let left = rect.left;
        let top = rect.top - tipRect.height - 10;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        if (top < 8) {
            top = rect.bottom + 10;
        }
        contextAttachPreviewEl.style.left = left + 'px';
        contextAttachPreviewEl.style.top = top + 'px';
    }

    function showContextAttachPreview() {
        if (!contextAttachVisible || !contextAttachBtn || !contextAttachPreviewEl) {
            return;
        }
        if (contextAttachPicker && contextAttachPicker.classList.contains('is-open')) {
            return;
        }
        if (!hasContextAttachSelection()) {
            return;
        }
        renderContextAttachPreviewContent();
        contextAttachPreviewOpen = true;
        contextAttachPreviewEl.hidden = false;
        contextAttachPreviewEl.style.left = '-9999px';
        contextAttachPreviewEl.style.top = '0';
        requestAnimationFrame(function() {
            positionContextAttachPreview();
        });
    }

    function hideContextAttachPreview() {
        contextAttachPreviewOpen = false;
        if (contextAttachPreviewEl) {
            contextAttachPreviewEl.hidden = true;
        }
    }

    function bindContextAttachPreview() {
        if (!contextAttachBtn || !contextAttachPreviewEl) {
            return;
        }
        contextAttachBtn.addEventListener('mouseenter', function() {
            showContextAttachPreview();
        });
        contextAttachBtn.addEventListener('mousedown', function() {
            hideContextAttachPreview();
        });
        const contextAttachPreviewClose = document.getElementById('contextAttachPreviewClose');
        if (contextAttachPreviewClose) {
            contextAttachPreviewClose.addEventListener('click', function(e) {
                e.stopPropagation();
                hideContextAttachPreview();
            });
        }
        document.addEventListener('pointerdown', function(e) {
            if (!contextAttachPreviewOpen) {
                return;
            }
            if (isInsideContextAttachPreview(e.target)) {
                return;
            }
            hideContextAttachPreview();
        }, true);
    }

    function renderContextAttachOptions() {
        if (!contextAttachList) {
            return;
        }
        const options = [
            { mode: 'none', label: locale.contextAttachNone },
            { mode: 'last2', label: locale.contextAttachLast2 },
            { mode: 'last10', label: locale.contextAttachLast10 },
            { mode: 'all', label: locale.contextAttachAll },
            { mode: 'custom', label: locale.contextAttachCustom },
        ];
        contextAttachList.innerHTML = options.map(function(opt) {
            const isActive = opt.mode === contextAttachMode
                && (opt.mode !== 'none' || contextAttachHasChoice);
            const active = isActive ? ' active' : '';
            return '<div class="dropdown-item' + active + '" data-attach-mode="' + escapeHtml(opt.mode) + '">' +
                escapeHtml(opt.label) + (isActive ? ' ✓' : '') + '</div>';
        }).join('');
        contextAttachList.querySelectorAll('.dropdown-item[data-attach-mode]').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const mode = this.dataset.attachMode;
                if (mode === 'custom') {
                    contextAttachHasChoice = true;
                    enterContextAttachSelectMode();
                    return;
                }
                if (multiSelectPurpose === 'contextAttach') {
                    exitMultiSelectMode();
                }
                contextAttachCustomPending = false;
                contextAttachCustomConfirmed = false;
                contextAttachUnconfirmedIndices = [];
                contextAttachHasChoice = true;
                contextAttachMode = mode;
                contextAttachCustomIndices = [];
                updateContextAttachButtonLabel();
                renderContextAttachOptions();
                hideContextAttachPreview();
                closeAllDropdowns();
            });
        });
    }

    function showContextAttachPicker() {
        contextAttachVisible = true;
        contextAttachMode = 'none';
        contextAttachCustomIndices = [];
        contextAttachCustomPending = false;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = [];
        contextAttachHasChoice = false;
        hideContextAttachPreview();
        if (contextAttachPicker) {
            contextAttachPicker.classList.remove('is-hiding', 'is-entering', 'is-attention');
            contextAttachPicker.hidden = false;
            contextAttachPicker.classList.add('is-entering', 'is-attention');
            const onPickerAnimEnd = function(e) {
                if (e.target !== contextAttachPicker || e.animationName !== 'context-attach-enter') {
                    return;
                }
                contextAttachPicker.classList.remove('is-entering');
                contextAttachPicker.removeEventListener('animationend', onPickerAnimEnd);
            };
            contextAttachPicker.addEventListener('animationend', onPickerAnimEnd);
            if (contextAttachBtn) {
                const onAttentionEnd = function(e) {
                    if (e.target !== contextAttachBtn || e.animationName !== 'context-attach-attention-pulse') {
                        return;
                    }
                    contextAttachPicker.classList.remove('is-attention');
                    contextAttachBtn.removeEventListener('animationend', onAttentionEnd);
                };
                contextAttachBtn.addEventListener('animationend', onAttentionEnd);
            }
        }
        contextAttachPickerHiding = false;
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
    }

    function enterContextAttachSelectMode() {
        const previousIndices = getExistingCustomAttachIndices();
        contextAttachCustomPending = true;
        contextAttachCustomConfirmed = false;
        contextAttachUnconfirmedIndices = previousIndices.slice();
        contextAttachMode = 'custom';
        closeAllDropdowns();
        ensureContextAttachSelectableTargets();
        enterMultiSelectMode(null, 'contextAttach');
        applyContextAttachIndicesToSelection(previousIndices);
        updateContextAttachButtonLabel();
    }

    function confirmContextAttachSelection() {
        const indices = getSelectedMessageIndices();
        if (!indices.length) {
            return;
        }
        contextAttachCustomIndices = indices.slice();
        contextAttachUnconfirmedIndices = [];
        contextAttachMode = 'custom';
        contextAttachCustomConfirmed = true;
        contextAttachCustomPending = false;
        contextAttachHasChoice = true;
        exitMultiSelectMode();
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
    }

    function getUnconfirmedCustomSelectionIndices() {
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            return getSelectedMessageIndices();
        }
        return contextAttachUnconfirmedIndices.slice();
    }

    function hasUnconfirmedCustomMemorySelection() {
        if (!contextAttachVisible || contextAttachCustomConfirmed) {
            return false;
        }
        if (contextAttachMode !== 'custom' && !contextAttachCustomPending) {
            return false;
        }
        return getUnconfirmedCustomSelectionIndices().length > 0;
    }

    function buildContextAttachPayload(forceNoAttach) {
        if (!contextAttachVisible) {
            return undefined;
        }
        if (forceNoAttach) {
            return { mode: 'none' };
        }
        if (contextAttachCustomConfirmed && contextAttachMode === 'custom') {
            return {
                mode: 'custom',
                indices: contextAttachCustomIndices.slice(),
            };
        }
        if (contextAttachMode === 'none') {
            return { mode: 'none' };
        }
        if (contextAttachMode === 'custom' && !contextAttachCustomConfirmed) {
            return { mode: 'none' };
        }
        return {
            mode: contextAttachMode,
            indices: undefined,
        };
    }

    function finalizeContextAttachSelectionFromPending() {
        const indices = getUnconfirmedCustomSelectionIndices();
        if (!indices.length) {
            return false;
        }
        contextAttachCustomIndices = indices.slice();
        contextAttachUnconfirmedIndices = [];
        contextAttachMode = 'custom';
        contextAttachCustomConfirmed = true;
        contextAttachCustomPending = false;
        contextAttachHasChoice = true;
        if (multiSelectMode && multiSelectPurpose === 'contextAttach') {
            exitMultiSelectMode();
        }
        updateContextAttachButtonLabel();
        renderContextAttachOptions();
        return true;
    }

    function openContextAttachSendModal(text) {
        pendingSendText = text;
        showModal(contextAttachSendModal);
    }

    function closeContextAttachSendModal() {
        pendingSendText = '';
        hideModal(contextAttachSendModal);
    }

    function executeSendMessage(text, attachOverride) {
        hideFilePicker();
        hideSlashCommandPicker();
        resetAutoScrollFollow();
        const imagesForSend = pendingImages.slice();
        const filesForSend = pendingFiles.slice();
        addMessage('user', text, { images: imagesForSend, files: filesForSend });
        inputEl.value = '';
        pendingImages = [];
        pendingFiles = [];
        renderAttachPreview();
        syncInputHeightFromContent();
        updateQuickActionBtns();
        inputEl.disabled = true;
        awaitingFirstChunk = true;
        setInputMode('waiting');

        const payload = attachOverride !== undefined
            ? attachOverride
            : buildContextAttachPayload(false);
        vscode.postMessage({
            type: 'sendMessage',
            text: text,
            contextAttach: payload,
            images: imagesForSend.map(function (img) { return { name: img.name, mimeType: img.mimeType, data: img.data }; }),
            files: filesForSend.map(function (f) { return { name: f.name, mimeType: f.mimeType, text: f.text }; }),
        });
    }

    // ---- Image attachment handling ----
    function readImageFile(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const result = reader.result;
                    const dataUrl = typeof result === 'string' ? result : '';
                    const comma = dataUrl.indexOf(',');
                    if (comma === -1) { reject(new Error('bad read')); return; }
                    const meta = dataUrl.slice(0, comma);
                    const mimeMatch = /data:([^;]+)/.exec(meta);
                    const mimeType = mimeMatch ? mimeMatch[1] : (file.type || 'image/png');
                    resolve({ name: file.name, mimeType: mimeType, data: dataUrl.slice(comma + 1) });
                } catch (e) {
                    reject(e);
                }
            };
            reader.onerror = function () { reject(reader.error || new Error('read error')); };
            reader.readAsDataURL(file);
        });
    }

    function addImageFiles(fileList) {
        const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
            return f && f.type && f.type.indexOf('image/') === 0;
        });
        if (!files.length) return;
        Promise.all(files.map(readImageFile)).then(function (imgs) {
            pendingImages = pendingImages.concat(imgs);
            renderAttachPreview();
        }).catch(function (err) {
            console.error('Image read failed', err);
        });
    }

    // Max bytes of a text file we'll inline as a dropped attachment. Larger
    // files are skipped (the model can't read them inline anyway).
    const MAX_FILE_BYTES = 512 * 1024;
    function readFileAsText(file) {
        return new Promise(function (resolve, reject) {
            if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
                reject(new Error('file too large: ' + file.name));
                return;
            }
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const text = typeof reader.result === 'string' ? reader.result : '';
                    resolve({ name: file.name, mimeType: file.type || 'text/plain', text: text });
                } catch (e) {
                    reject(e);
                }
            };
            reader.onerror = function () { reject(reader.error || new Error('read error')); };
            reader.readAsText(file);
        });
    }

    // Split a dropped/grabbed list into images (handled as base64) and
    // non-image files (read as text and inlined into the prompt).
    function addDroppedFiles(fileList) {
        const items = Array.prototype.slice.call(fileList || []);
        const images = items.filter(function (f) {
            return f && f.type && f.type.indexOf('image/') === 0;
        });
        const textFiles = items.filter(function (f) {
            return f && f.type && f.type.indexOf('image/') !== 0;
        });
        if (images.length) addImageFiles(images);
        if (!textFiles.length) return;
        Promise.all(textFiles.map(readFileAsText)).then(function (files) {
            pendingFiles = pendingFiles.concat(files);
            renderAttachPreview();
        }).catch(function (err) {
            console.error('File read failed', err);
        });
    }

    function removePendingImage(index) {
        pendingImages.splice(index, 1);
        renderAttachPreview();
    }

    function removePendingFile(index) {
        pendingFiles.splice(index, 1);
        renderAttachPreview();
    }

    function renderAttachPreview() {
        if (!attachPreviewRow) return;
        attachPreviewRow.innerHTML = '';
        if (!pendingImages.length && !pendingFiles.length) {
            attachPreviewRow.hidden = true;
            return;
        }
        attachPreviewRow.hidden = false;
        pendingImages.forEach(function (img, idx) {
            const chip = document.createElement('div');
            chip.className = 'attach-chip';
            const thumb = document.createElement('img');
            thumb.className = 'attach-thumb';
            thumb.src = 'data:' + img.mimeType + ';base64,' + img.data;
            thumb.alt = img.name;
            const name = document.createElement('span');
            name.className = 'attach-name';
            name.textContent = img.name;
            name.title = img.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'attach-remove';
            remove.setAttribute('aria-label', 'Remove image');
            remove.textContent = '×';
            remove.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                removePendingImage(idx);
            });
            chip.appendChild(thumb);
            chip.appendChild(name);
            chip.appendChild(remove);
            attachPreviewRow.appendChild(chip);
        });
        pendingFiles.forEach(function (f, idx) {
            const chip = document.createElement('div');
            chip.className = 'attach-chip file-chip';
            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = '📄';
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'attach-name';
            name.textContent = f.name;
            name.title = f.name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'attach-remove';
            remove.setAttribute('aria-label', 'Remove file');
            remove.textContent = '×';
            remove.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                removePendingFile(idx);
            });
            chip.appendChild(icon);
            chip.appendChild(name);
            chip.appendChild(remove);
            attachPreviewRow.appendChild(chip);
        });
    }

    if (attachImageBtn && imageFileInput) {
        attachImageBtn.addEventListener('click', function (e) {
            e.preventDefault();
            imageFileInput.click();
        });
        imageFileInput.addEventListener('change', function () {
            addDroppedFiles(imageFileInput.files);
            imageFileInput.value = '';
        });
    }

    // Paste image from clipboard
    if (inputEl) {
        inputEl.addEventListener('paste', function (e) {
            const items = (e.clipboardData && e.clipboardData.items) || [];
            const imageItems = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].type && items[i].type.indexOf('image/') === 0) {
                    const f = items[i].getAsFile();
                    if (f) imageItems.push(f);
                }
            }
            if (imageItems.length) {
                e.preventDefault();
                addImageFiles(imageItems);
            }
        });
    }

    // Drag & drop files (any type) from the VS Code Explorer onto the composer.
    // Images become base64 attachments; other files are read as text and inlined.
    (function wireFileDropTarget() {
        const target = inputCompositeShellEl || inputCompositeEl || inputAreaEl;
        if (!target) return;
        let dragDepth = 0;
        function hasFiles(dt) {
            if (!dt) return false;
            if (dt.items && dt.items.length) {
                for (let i = 0; i < dt.items.length; i++) {
                    if (dt.items[i].kind === 'file') {
                        return true;
                    }
                }
                return false;
            }
            return (dt.files || []).length > 0;
        }
        target.addEventListener('dragenter', function (e) {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            dragDepth++;
            target.classList.add('drag-over-file');
        });
        target.addEventListener('dragover', function (e) {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        target.addEventListener('dragleave', function (e) {
            if (!hasFiles(e.dataTransfer) && !target.classList.contains('drag-over-file')) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) {
                target.classList.remove('drag-over-file');
            }
        });
        target.addEventListener('drop', function (e) {
            const dt = e.dataTransfer;
            if (!dt) return;
            const files = Array.prototype.slice.call(dt.files || []);
            if (!files.length) return;
            e.preventDefault();
            dragDepth = 0;
            target.classList.remove('drag-over-file');
            addDroppedFiles(files);
        });
    })();


    function openSwitchSessionModal(sessionId) {
        pendingSwitchSessionId = sessionId;
        const titleEl = document.getElementById('switchSessionModalTitle');
        const bodyEl = document.getElementById('switchSessionModalBody');
        const stayBtn = document.getElementById('switchSessionStayBtn');
        const confirmBtn = document.getElementById('switchSessionConfirmBtn');
        if (titleEl) titleEl.textContent = locale.switchSessionPromptTitle || '';
        if (bodyEl) bodyEl.textContent = locale.switchSessionPromptBody || '';
        if (stayBtn) stayBtn.textContent = locale.switchSessionStay || '';
        if (confirmBtn) confirmBtn.textContent = locale.switchSessionConfirm || '';
        showModal(switchSessionModal);
    }

    function closeSwitchSessionModal() {
        pendingSwitchSessionId = null;
        hideModal(switchSessionModal);
    }

    function requestSwitchSession(sessionId) {
        if (!sessionId || sessionId === activeSessionId) {
            return;
        }
        if (isPrompting) {
            openSwitchSessionModal(sessionId);
            return;
        }
        vscode.postMessage({ type: 'switchSession', sessionId: sessionId });
    }
    /** True after send until first agent output; stop stays hidden to avoid early cancel. */
    let awaitingFirstChunk = false;
    window._showThoughts = true;
    window._showToolCalls = true;

    const SCROLL_BOTTOM_THRESHOLD = 24;
    const SCROLL_IDLE_MS = 5000;
    let scrollPinnedByUser = false;
    let scrollIdleTimer = null;

    function isMessagesAtBottom() {
        if (!messagesEl) {
            return true;
        }
        return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
    }

    function isActivelyStreaming() {
        return !!(streamingMessageId || isPrompting);
    }

    function maybeScrollToBottom(force) {
        if (!messagesEl) {
            return;
        }
        if (force || !scrollPinnedByUser) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    function scheduleScrollReenable() {
        if (scrollIdleTimer) {
            clearTimeout(scrollIdleTimer);
        }
        scrollIdleTimer = setTimeout(function() {
            scrollIdleTimer = null;
            if (isActivelyStreaming()) {
                scrollPinnedByUser = false;
                maybeScrollToBottom(true);
            }
        }, SCROLL_IDLE_MS);
    }

    function onMessagesScroll() {
        if (!isActivelyStreaming()) {
            return;
        }
        if (!isMessagesAtBottom()) {
            scrollPinnedByUser = true;
        }
        scheduleScrollReenable();
    }

    if (messagesEl) {
        messagesEl.addEventListener('scroll', onMessagesScroll, { passive: true });
    }

    function resetAutoScrollFollow() {
        scrollPinnedByUser = false;
        if (scrollIdleTimer) {
            clearTimeout(scrollIdleTimer);
            scrollIdleTimer = null;
        }
    }

    function formatTokenCount(n) {
        const value = Number(n) || 0;
        if (value >= 1_000_000) {
            return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (value >= 10_000) {
            return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        if (value >= 1_000) {
            return (value / 1_000).toFixed(1) + 'k';
        }
        return String(value);
    }

    function updateTokenUsage(used, size) {
        const usedTokens = Math.max(0, Number(used) || 0);
        const totalTokens = Math.max(0, Number(size) || 0);
        if (totalTokens <= 0) {
            if (contextUsageEl) contextUsageEl.hidden = true;
            return;
        }
        const pct = Math.min(100, Math.round((usedTokens / totalTokens) * 100));
        const level = pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';
        const label = localeText('tokenUsageLabel', formatTokenCount(usedTokens), formatTokenCount(totalTokens), pct);
        if (contextUsageEl && contextUsageNum && contextUsageFill) {
            contextUsageEl.hidden = false;
            contextUsageNum.textContent = formatTokenCount(usedTokens) + ' / ' + formatTokenCount(totalTokens) + ' (' + pct + '%)';
            contextUsageFill.style.width = pct + '%';
            contextUsageEl.dataset.level = level;
            contextUsageEl.title = label;
            contextUsageEl.setAttribute('aria-label', label);
        }
    }
    let toolCallMap = {};
    let toolAggregateGroupId = null;
    const TOOL_SHORT_MAX_LINES = 3;
    const TOOL_AGGREGATE_MAX_LINES = 12;
    const TOOL_AGGREGATE_SEPARATOR = '\n\n---\n\n';
    const pendingPermissions = new Map();
    let permissionMode = 'manual'; // 'manual' | 'autoApprove' | 'denyAll'
    const PERM_COLLAPSED_LINES = 3;
    const PERM_LINE_HEIGHT_EM = 1.45;
    const THOUGHT_COLLAPSED_LINES = 5;
    const TOOL_COLLAPSED_LINES = 8;
    const AUX_LINE_HEIGHT_EM = 1.35;

    function getAuxCollapsedLines(role) {
        return role === 'thought' ? THOUGHT_COLLAPSED_LINES : TOOL_COLLAPSED_LINES;
    }

    function getAuxCollapsedMaxHeight(role) {
        return (AUX_LINE_HEIGHT_EM * getAuxCollapsedLines(role)) + 'em';
    }

    function auxDetailOverflows(scrollEl, text, maxLines) {
        if (!scrollEl) return false;
        if (text && text.split('\n').length > maxLines) return true;
        return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
    }

    function syncAuxiliaryDetailView(group) {
        const state = group._auxState;
        if (!state || !state.scrollEl) return;

        if (state.role === 'thought') {
            if (state.contentEl) {
                state.contentEl.innerHTML = renderMarkdown(state.rawText || '');
            }
            state.scrollEl.classList.remove('is-collapsed');
            state.scrollEl.classList.add('is-expanded');
            state.scrollEl.style.maxHeight = '';
            return;
        } else {
            const maxLines = getAuxCollapsedLines(state.role);
            state.scrollEl.classList.toggle('is-collapsed', !state.detailExpanded);
            state.scrollEl.classList.toggle('is-expanded', state.detailExpanded);
            if (!state.detailExpanded) {
                state.scrollEl.style.maxHeight = getAuxCollapsedMaxHeight(state.role);
                state.scrollEl.scrollTop = state.scrollEl.scrollHeight;
            } else {
                state.scrollEl.style.maxHeight = '';
            }
            const overflow = auxDetailOverflows(state.scrollEl, state.rawText, maxLines);
            state.moreBtn.hidden = state.detailExpanded || !overflow;
            state.lessBtn.hidden = !state.detailExpanded || !overflow;
        }
    }

    function countNonemptyLines(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return 0;
        return trimmed.split('\n').filter(function(line) { return line.trim().length > 0; }).length;
    }

    function isShortToolText(text) {
        return countNonemptyLines(text) <= TOOL_SHORT_MAX_LINES;
    }

    function isAggregatedToolText(text) {
        return (text || '').indexOf('---') >= 0;
    }

    function mergeToolTexts(existing, incoming) {
        return existing.trim() + TOOL_AGGREGATE_SEPARATOR + incoming.trim();
    }

    function canAggregateToolTexts(existing, incoming) {
        if (!isShortToolText(incoming)) return false;
        const existingLines = countNonemptyLines(existing);
        if (existingLines > TOOL_SHORT_MAX_LINES && !isAggregatedToolText(existing)) return false;
        return countNonemptyLines(mergeToolTexts(existing, incoming)) <= TOOL_AGGREGATE_MAX_LINES;
    }

    function rebuildAggregateToolContent(group) {
        const state = group._auxState;
        if (!state || !state.aggregatedTools || !state.aggregatedTools.length) return;
        const merged = state.aggregatedTools
            .map(function(entry) { return entry.text.trim(); })
            .filter(Boolean)
            .join(TOOL_AGGREGATE_SEPARATOR);
        setAuxiliaryContent(group, merged);
    }

    function resetToolAggregation() {
        toolAggregateGroupId = null;
    }

    function ensureAggregateEntries(group) {
        const state = group._auxState;
        if (!state) return;
        if (state.aggregatedTools && state.aggregatedTools.length) return;
        let firstId = null;
        let firstText = state.rawText || '';
        Object.keys(toolCallMap).forEach(function(id) {
            if (toolCallMap[id] === group.id && !firstId) {
                firstId = id;
            }
        });
        state.aggregatedTools = [{
            toolCallId: firstId || ('tool_' + group.id),
            text: firstText,
        }];
    }

    /* ── Todo Panel ── */

    // Detect the Hermes `todo` tool's actual output signatures ONLY — not loose
    // keywords like "task"/"step" (which would hijack unrelated tool output).
    // Result format:  "**Todo list**\n\n- <emoji> item ..."
    // Initial format: "Updating todo list\n\n- <status>: item ..."
    function isTodoContent(text) {
        if (!text) return false;
        return /(^|\n)\s*\*\*Todo list\*\*/i.test(text)
            || /(^|\n)\s*(Updating|Reading) todo list/i.test(text);
    }

    var TODO_STATUS_ICON = {
        completed: '✓',
        in_progress: '◐',
        pending: '○',
        cancelled: '✕'
    };
    function normalizeTodoStatus(token) {
        var t = (token || '').toLowerCase().trim();
        if (t === '✅' || t === 'completed' || t === 'complete' || t === 'done') return 'completed';
        if (t === '🔄' || t === 'in_progress' || t === 'in progress' || t === 'active' || t === 'running') return 'in_progress';
        if (t === '✗' || t === '✕' || t === 'cancelled' || t === 'canceled') return 'cancelled';
        return 'pending'; // ⏳ / • / pending / anything else
    }

    function parseTodoItems(text) {
        var items = [];
        if (!text) return items;
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            // Skip headers + the "**Progress:**" footer.
            if (/^\*\*Todo list\*\*$/i.test(line)) continue;
            if (/^\*\*Progress:\*\*/i.test(line)) continue;
            if (/^(Updating|Reading) todo list$/i.test(line)) continue;
            // Result bullet:  "- <emoji> content"   e.g. "- ✅ Fix parser"
            var m = line.match(/^[-*]\s*(✅|🔄|⏳|✗|✕|•)\s*(.+)$/);
            if (m) {
                items.push({ text: m[2].trim(), status: normalizeTodoStatus(m[1]) });
                continue;
            }
            // Initial bullet:  "- <status>: content"  e.g. "- in_progress: Fix parser"
            var m2 = line.match(/^[-*]\s*(pending|in[_ ]progress|completed|complete|cancelled|canceled|done)\s*:\s*(.+)$/i);
            if (m2) {
                items.push({ text: m2[2].trim(), status: normalizeTodoStatus(m2[1]) });
                continue;
            }
        }
        return items;
    }

    // The todo tool always emits the FULL current list, so each update REPLACES
    // the panel state (so items check off / drop out), never appends.
    function renderTodos(items) {
        if (!todoPanel || !Array.isArray(items) || items.length === 0) return;
        activeTodos = items;
        rebuildTodoPanel();
    }

    function rebuildTodoPanel() {
        if (!todoPanel || !todoPanelList) return;
        if (activeTodos.length === 0) {
            todoPanel.hidden = true;
            return;
        }
        var done = 0;
        for (var k = 0; k < activeTodos.length; k++) {
            var st = activeTodos[k].status;
            if (st === 'completed' || st === 'cancelled') done++;
        }
        todoPanel.hidden = false;
        todoPanel.classList.toggle('is-all-done', done === activeTodos.length);
        todoPanelList.innerHTML = '';
        for (var i = 0; i < activeTodos.length; i++) {
            var item = activeTodos[i];
            var status = item.status || 'pending';
            var isDone = status === 'completed' || status === 'cancelled';
            var el = document.createElement('div');
            el.className = 'todo-item is-' + status + (isDone ? ' is-done' : '');
            el.innerHTML = '<span class="todo-checkbox">' + (TODO_STATUS_ICON[status] || '○') + '</span>'
                + '<span class="todo-text">' + escapeHtml(item.text) + '</span>';
            todoPanelList.appendChild(el);
        }
        if (todoPanelCount) {
            todoPanelCount.textContent = done + '/' + activeTodos.length;
        }
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function clearTodos() {
        activeTodos = [];
        if (todoPanel) todoPanel.hidden = true;
        if (todoPanelList) todoPanelList.innerHTML = '';
    }

    // Wire up todo collapse toggle (header stays visible, list hides)
    if (todoPanelToggle) {
        todoPanelToggle.addEventListener('click', function () {
            if (!todoPanel) return;
            const collapsed = todoPanel.classList.toggle('is-collapsed');
            todoPanelToggle.setAttribute('aria-expanded', String(!collapsed));
            todoPanelToggle.title = collapsed ? 'Expand tasks' : 'Collapse tasks';
        });
    }

    // Wire up todo clear button
    if (todoPanelClear) {
        todoPanelClear.addEventListener('click', clearTodos);
    }

    function splitToolText(text) {
        const summaryText = text || '';
        const sepIdx = summaryText.indexOf('\n\n');
        const callPart = sepIdx >= 0 ? summaryText.slice(0, sepIdx).trim() : summaryText.trim();
        const bodyPart = sepIdx >= 0 ? summaryText.slice(sepIdx + 2).trim() : '';
        return { callPart: callPart, bodyPart: bodyPart };
    }

    function isToolCallEmpty(text) {
        const summaryText = text || '';
        const sepIdx = summaryText.indexOf('\n\n');
        const callPart = sepIdx >= 0 ? summaryText.slice(0, sepIdx).trim() : summaryText.trim();
        const bodyPart = sepIdx >= 0 ? summaryText.slice(sepIdx + 2).trim() : '';
        if (bodyPart) return false;
        const info = parseToolCallText(callPart);
        if (info.args) return false;
        const t = (info.title || '').trim();
        if (t && t !== 'Tool') return false;
        // No body, no args, and no real tool name — this is a ghost/empty block.
        return true;
    }

    function handleToolMessage(text, toolCallId) {
        // Skip truly empty tool calls so they don't render as blank/ghost blocks.
        if (isToolCallEmpty(text)) {
            return;
        }
        if (toolCallMap[toolCallId]) {
            const group = document.getElementById(toolCallMap[toolCallId]);
            if (group && group._auxState) {
                const { callPart, bodyPart } = splitToolText(text);
                const toolInfo = parseToolCallText(callPart);

                const msgEl = group.querySelector('.message.tool');
                if (msgEl && msgEl._cardData) {
                    const cd = msgEl._cardData;
                    cd.titleEl.textContent = toolInfo.title;
                    cd.iconEl.textContent = toolInfo.icon;
                    cd.statusEl.className = 'tool-call-status';
                    if (toolInfo.status === 'in_progress' || toolInfo.status === 'pending') {
                        cd.statusEl.classList.add('is-running');
                        cd.statusEl.textContent = 'Running...';
                    } else if (toolInfo.status === 'completed') {
                        cd.statusEl.classList.add('is-complete');
                        cd.statusEl.textContent = 'Done';
                    } else if (toolInfo.status === 'cancelled') {
                        cd.statusEl.classList.add('is-failed');
                        cd.statusEl.textContent = 'Cancelled';
                    } else if (toolInfo.status === 'failed') {
                        cd.statusEl.classList.add('is-failed');
                        cd.statusEl.textContent = 'Failed';
                    }
                    cd.card.classList.remove('is-live', 'is-complete', 'is-failed', 'is-analyzing', 'is-searching', 'is-reading', 'is-writing', 'is-executing', 'is-error');
                    if (toolInfo.status === 'completed') {
                        cd.card.classList.add('is-complete');
                    } else if (toolInfo.status === 'failed' || toolInfo.status === 'cancelled') {
                        cd.card.classList.add('is-failed');
                    } else {
                        cd.card.classList.add('is-live');
                        // Apply cognitive state class for pulse color differentiation
                        if (toolInfo.state) {
                            cd.card.classList.add('is-' + toolInfo.state);
                        }
                    }
                }

                if (group._auxState.contentEl && bodyPart) {
                    if (group._auxState.aggregatedTools && group._auxState.aggregatedTools.length) {
                        const entry = group._auxState.aggregatedTools.find(function(t) {
                            return t.toolCallId === toolCallId;
                        });
                        if (entry) {
                            entry.text = bodyPart;
                        }
                        rebuildAggregateToolContent(group);
                    } else {
                        setAuxiliaryContent(group, bodyPart);
                    }
                    // Auto-expand the card when result content arrives
                    // Check for todo content in the body
                    if (isTodoContent(bodyPart)) {
                        var todoItems = parseTodoItems(bodyPart);
                        renderTodos(todoItems);
                    }
                }
                // Only set live if the tool is actually still in progress
                if (toolInfo.status !== 'completed' && toolInfo.status !== 'failed') {
                    setAuxMessageLive(group, true);
                }
                maybeScrollToBottom();
            }
            return;
        }

        finalizeAssistantBubble();

        if (toolAggregateGroupId) {
            const group = document.getElementById(toolAggregateGroupId);
            if (group && group._auxState && false) {
                ensureAggregateEntries(group);
                group._auxState.aggregatedTools.push({ toolCallId: toolCallId, text: text });
                rebuildAggregateToolContent(group);
                toolCallMap[toolCallId] = toolAggregateGroupId;
                setAuxMessageLive(group, true);
                enableStopAfterAgentOutput();
                maybeScrollToBottom();
                return;
            }
        }

        const id = addMessage('tool', text);
        toolCallMap[toolCallId] = id;
        toolAggregateGroupId = id;

        // Check for todo content in the full text on initial creation
        var bodySep = text.indexOf('\n\n');
        var initialBody = bodySep >= 0 ? text.slice(bodySep + 2).trim() : '';
        if (initialBody && isTodoContent(initialBody)) {
            var todoItems = parseTodoItems(initialBody);
            renderTodos(todoItems);
        }
    }

    function setAuxiliaryContent(group, text) {
        const state = group._auxState;
        if (!state) return;
        // Skip rendering partial/empty text to avoid garbled display during initialization
        if (!text || text.trim().length < 3) return;
        state.rawText = text || '';
        state.contentEl.innerHTML = formatToolOutput(state.rawText);
        setupContentBlocks(state.contentEl);
        processFileRefs(state.contentEl);
        // Reveal + ensure a Show more/less toggle for the unified Result section.
        if (state.bodyInner) {
            const section = state.bodyInner.querySelector('.tool-call-section');
            if (section) section.style.display = '';
            ensureToolResultToggle(state.bodyInner, state.contentEl);
            state.contentEl.classList.add('is-preview');
        }
        syncAuxiliaryDetailView(group);
    }

    // Decide whether a Result section needs a Show more/less toggle.
    function resultContentNeedsToggle(el) {
        if (!el) return false;
        return el.scrollHeight > el.clientHeight + 10;
    }

    // Ensure a .tool-result-toggle button exists for a Result section's content node.
    function ensureToolResultToggle(bodyInner, resultContent) {
        if (!bodyInner || !resultContent) return;
        const section = resultContent.closest('.tool-call-section');
        if (!section) return;
        if (section.querySelector('.tool-result-toggle')) return;
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'tool-result-toggle';
        toggleBtn.innerHTML = '<span>Show more</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const isExpanded = resultContent.classList.contains('is-expanded');
            resultContent.classList.toggle('is-preview', !isExpanded);
            resultContent.classList.toggle('is-expanded', !isExpanded);
            toggleBtn.classList.toggle('is-expanded', !isExpanded);
            toggleBtn.querySelector('span').textContent = isExpanded ? 'Show less' : 'Show more';
        });
        section.appendChild(toggleBtn);
    }

function parseToolCallText(text) {
        const result = {
            icon: '🔧',
            title: 'Tool',
            status: 'in_progress',
            state: 'analyzing',
            toolType: 'default',
            args: '',
            output: ''
        };

        if (!text) return result;

        // Detect status from original text BEFORE stripping icon
        const lowerFull = text.toLowerCase();
        if (text.includes('✅') || lowerFull.includes('completed')) {
            result.status = 'completed';
        } else if (text.includes('❌') || lowerFull.includes('failed')) {
            result.status = 'failed';
        } else if (text.includes('⏹') || lowerFull.includes('cancelled')) {
            result.status = 'cancelled';
        }

        // Extract leading emoji icon (handles multi-codepoint emoji like ⚙️ ✏️)
        const iconMatch = text.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*(.*)$/u);
        if (iconMatch) {
            result.icon = iconMatch[1];
            text = iconMatch[2].trim();
        }

        // Remove any remaining status emoji from text
        text = text.replace(/[✅❌⚙️⏹🔧]/g, '').trim();

        // Extract state tag: [analyzing], [searching], [reading], [writing], [executing]
        const stateMatch = text.match(/^\[(analyzing|searching|reading|writing|executing|error)\]\s*/);
        if (stateMatch) {
            result.state = stateMatch[1];
            text = text.slice(stateMatch[0].length).trim();
        }

        // Detect tool type from title
        const lowerText = text.toLowerCase();
        if (lowerText.includes('search') || lowerText.includes('find') || lowerText.includes('grep')) {
            result.toolType = 'search';
            result.icon = '🔍';
        } else if (lowerText.includes('terminal') || lowerText.includes('shell') || lowerText.includes('command') || lowerText.includes('execute')) {
            result.toolType = 'terminal';
            result.icon = '💻';
        } else if (lowerText.includes('read') && lowerText.includes('file')) {
            result.toolType = 'file_read';
            result.icon = '📄';
        } else if (lowerText.includes('write') && lowerText.includes('file')) {
            result.toolType = 'file_write';
            result.icon = '✏️';
        } else if (lowerText.includes('edit') && lowerText.includes('file')) {
            result.toolType = 'file_edit';
            result.icon = '✏️';
        }

        const prefixes = ['search:', 'terminal:', 'file_read:', 'file_write:', 'file_edit:'];
        for (const prefix of prefixes) {
            if (lowerText.startsWith(prefix)) {
                text = text.slice(prefix.length).trim();
                break;
            }
        }

        result.title = text || result.toolType.replace(/_/g, ' ');

        const jsonMatch = text.match(/\{[^}]+\}/);
        if (jsonMatch) {
            try {
                const args = JSON.parse(jsonMatch[0]);
                result.args = JSON.stringify(args, null, 2);
            } catch (e) {
                result.args = jsonMatch[0];
            }
        }

        return result;
    }

    // Format tool input name to be more readable
    function formatToolName(name) {
        if (!name) return 'Tool';

        // Remove common prefixes
        var cleaned = name
            .replace(/^mcp_/i, '')
            .replace(/_VS_Code_Editor_Tools_/i, ' ')
            .replace(/_Tools?_/g, ' ')
            .replace(/_/g, ' ')
            .trim();

        // Convert to title case
        cleaned = cleaned.replace(/\b\w/g, function(l) { return l.toUpperCase(); });

        // Add action verb if missing
        if (!cleaned.match(/^(Get|Set|Read|Write|Edit|Create|Delete|Search|Find|Execute|Run|List|Show|Hide|Open|Close|Update|Add|Remove)/i)) {
            cleaned = 'Running ' + cleaned;
        }

        return cleaned;
    }

    // Format JSON object with syntax highlighting
    function formatJsonObject(obj, indent) {
        var spaces = '  '.repeat(indent || 0);
        var nextSpaces = '  '.repeat((indent || 0) + 1);

        if (obj === null) {
            return '<span class="json-null">null</span>';
        }

        if (typeof obj === 'boolean') {
            return '<span class="json-boolean">' + obj + '</span>';
        }

        if (typeof obj === 'number') {
            return '<span class="json-number">' + obj + '</span>';
        }

        if (typeof obj === 'string') {
            // Escape HTML and format
            var escaped = obj
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/\n/g, '<br>');
            return '<span class="json-string">"' + escaped + '"</span>';
        }

        if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]';

            var items = obj.map(function(item) {
                return nextSpaces + formatJsonObject(item, (indent || 0) + 1);
            });

            return '[\n' + items.join(',\n') + '\n' + spaces + ']';
        }

        if (typeof obj === 'object') {
            var keys = Object.keys(obj);
            if (keys.length === 0) return '{}';

            var items = keys.map(function(key) {
                var value = formatJsonObject(obj[key], (indent || 0) + 1);
                return nextSpaces + '<span class="json-key">"' + key + '"</span>: ' + value;
            });

            return '{\n' + items.join(',\n') + '\n' + spaces + '}';
        }

        return String(obj);
    }

    // Format a string as a formatted code block for display in tool output
    function formatStringAsCode(str, langHint) {
        if (!str) return '';
        var lines = str.split('\n');
        var htmlLines = lines.map(function(line) {
            return escapeHtml(line);
        });
        return '<pre style="margin:0;padding:0;background:transparent;border:none;border-radius:0;overflow:auto;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all;"><code>' + htmlLines.join('\n') + '</code></pre>';
    }

    // Parse and format tool output with proper handling of file content and JSON
    function formatToolOutput(text) {
        if (!text || !text.trim()) return '';

        var trimmed = text.trim();

        // Strip preamble text to find JSON
        var jsonStart = trimmed.indexOf('{');
        if (jsonStart >= 0) {
            var candidate = trimmed.slice(jsonStart);
            try {
                var parsed = JSON.parse(candidate);

                // Handle .result field - it may contain file content as JSON string
                if (typeof parsed.result === 'string') {
                    var resultStr = parsed.result.trim();

                    // Inner string appears to be independent JSON
                    if ((resultStr.startsWith('{') || resultStr.startsWith('[')) && resultStr.length > 2) {
                        try {
                            var innerParsed = JSON.parse(resultStr);
                            // File read result - extract text content
                            if (innerParsed.visibleText || innerParsed.fullText) {
                                var codeText = innerParsed.visibleText || innerParsed.fullText || '';
                                var langHint = innerParsed.languageId || innerParsed.fileName || innerParsed.filePath || 'plaintext';
                                return formatStringAsCode(codeText, langHint);
                            }
                            // Nested object - format as JSON
                            return formatJsonObject(innerParsed);
                        } catch (e) {
                            // Inner parse failed - use as raw string if it looks like code
                            if (resultStr.includes('\n') && resultStr.length > 100) {
                                return formatStringAsCode(resultStr, parsed.languageId || '');
                            }
                        }
                    }

                    // Long non-JSON string
                    if (resultStr.length > 100) {
                        return formatStringAsCode(resultStr, parsed.languageId || '');
                    }

                    return '<span class="json-string">"' + escapeHtml(resultStr) + '"</span>';
                }

                // No .result field - format the whole object as JSON
                return formatJsonObject(parsed);
            } catch (e) {
                // Not valid JSON
            }
        }

        // Check if content starts with array or object
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                var parsed = JSON.parse(trimmed);
                return formatJsonObject(parsed);
            } catch (e) {
                // Not valid JSON
            }
        }

        // Not JSON - render as markdown
        return renderMarkdown(text);
    }

    function buildAuxiliaryMessage(role, text) {
        const msgEl = document.createElement('div');
        msgEl.className = 'message ' + role;

        if (role === 'tool') {
            const summaryText = text || '';
            const sepIdx = summaryText.indexOf('\n\n');
            const callPart = sepIdx >= 0 ? summaryText.slice(0, sepIdx).trim() : summaryText.trim();
            const bodyPart = sepIdx >= 0 ? summaryText.slice(sepIdx + 2).trim() : '';

            const toolInfo = parseToolCallText(callPart);

            // Format the tool name better
            toolInfo.title = formatToolName(toolInfo.title);

            const card = document.createElement('div');
            card.className = 'tool-call-card';
            if (toolInfo.status === 'completed') {
                card.classList.add('is-complete');
            } else if (toolInfo.status === 'failed') {
                card.classList.add('is-failed');
            } else {
                card.classList.add('is-live');
                if (toolInfo.state) {
                    card.classList.add('is-' + toolInfo.state);
                }
            }
            // Auto-expand if body content is present on initial render

            const header = document.createElement('div');
            header.className = 'tool-call-header';

            const iconEl = document.createElement('span');
            iconEl.className = 'tool-call-icon';
            iconEl.textContent = toolInfo.icon;

            const titleEl = document.createElement('span');
            titleEl.className = 'tool-call-title';
            titleEl.textContent = toolInfo.title;

            const statusEl = document.createElement('span');
            statusEl.className = 'tool-call-status';
            if (toolInfo.status === 'in_progress' || toolInfo.status === 'pending') {
                statusEl.classList.add('is-running');
                statusEl.innerHTML = '<span class="status-dot"></span> Running';
            } else if (toolInfo.status === 'completed') {
                statusEl.classList.add('is-complete');
                statusEl.innerHTML = '<span class="status-dot"></span> Done';
            } else if (toolInfo.status === 'failed') {
                statusEl.classList.add('is-failed');
                statusEl.innerHTML = '<span class="status-dot"></span> Failed';
            }

            const chevron = document.createElement('span');
            chevron.className = 'tool-call-chevron';
            chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'tool-call-copy';
            copyBtn.title = locale.copy;
            copyBtn.innerHTML = COPY_ICON_SVG;
            copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const text = bodyPart || callPart || toolInfo.title;
                if (!text) return;
                copyToClipboard(text).then(function() {
                    copyBtn.title = locale.copied;
                    copyBtn.classList.add('copied');
                    setTimeout(function() {
                        copyBtn.title = locale.copy;
                        copyBtn.classList.remove('copied');
                    }, 1500);
                });
            });

            header.appendChild(iconEl);
            header.appendChild(titleEl);
            header.appendChild(statusEl);
            header.appendChild(copyBtn);
            header.appendChild(chevron);

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'tool-call-body';

            const bodyInner = document.createElement('div');
            bodyInner.className = 'tool-call-body-inner';

            if (toolInfo.args) {
                const argsSection = document.createElement('div');
                argsSection.className = 'tool-call-section';
                const argsTitle = document.createElement('div');
                argsTitle.className = 'tool-call-section-title';
                argsTitle.textContent = 'Arguments';
                const argsContent = document.createElement('div');
                argsContent.className = 'tool-call-section-content';

                // Format arguments if JSON
                try {
                    var parsed = JSON.parse(toolInfo.args);
                    argsContent.innerHTML = formatJsonObject(parsed);
                } catch (e) {
                    argsContent.textContent = toolInfo.args;
                }

                argsSection.appendChild(argsTitle);
                argsSection.appendChild(argsContent);
                bodyInner.appendChild(argsSection);
            }

            let resultSection = document.createElement('div');
            resultSection.className = 'tool-call-section';
            const resultTitle = document.createElement('div');
            resultTitle.className = 'tool-call-section-title';
            resultTitle.textContent = 'Result';

            const resultContent = document.createElement('div');
            resultContent.className = 'tool-call-section-content is-preview';
            resultSection.appendChild(resultTitle);
            resultSection.appendChild(resultContent);
            bodyInner.appendChild(resultSection);

            if (bodyPart) {
                // Format the output properly
                resultContent.innerHTML = formatToolOutput(bodyPart);

                // Only show the toggle when content actually overflows 10 lines.
                const needsToggle = resultContent.scrollHeight > resultContent.clientHeight + 5;
                if (needsToggle) {
                    const toggleBtn = document.createElement('button');
                    toggleBtn.type = 'button';
                    toggleBtn.className = 'tool-result-toggle';
                    toggleBtn.innerHTML = '<span>Show more</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                    toggleBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const isExpanded = resultContent.classList.contains('is-expanded');
                        resultContent.classList.toggle('is-preview', !isExpanded);
                        resultContent.classList.toggle('is-expanded', !isExpanded);
                        toggleBtn.classList.toggle('is-expanded', !isExpanded);
                        toggleBtn.querySelector('span').textContent = isExpanded ? 'Show less' : 'Show more';
                    });
                    resultSection.appendChild(toggleBtn);
                }
            } else {
                // No body yet (arrives via live update) — keep hidden until filled.
                resultSection.style.display = 'none';
            }

            bodyDiv.appendChild(bodyInner);
            card.appendChild(header);
            card.appendChild(bodyDiv);
            msgEl.appendChild(card);

            header.addEventListener('click', function() {
                card.classList.toggle('is-expanded');
            });

            msgEl._cardData = { card: card, header: header, titleEl: titleEl, statusEl: statusEl, iconEl: iconEl, bodyDiv: bodyDiv };

            const scrollEl = document.createElement('div');
            scrollEl.className = 'aux-body-scroll';
            scrollEl.style.display = 'none';
            const contentEl = resultContent;
            const dummyBtn = document.createElement('button');
            dummyBtn.style.display = 'none';
            dummyBtn.hidden = true;

            return { div: msgEl, scrollEl: scrollEl, contentEl: contentEl, moreBtn: dummyBtn, lessBtn: dummyBtn, role: role, rawText: bodyPart, callText: callPart, bodyDiv: bodyDiv, bodyInner: bodyInner };
        }

        const header = document.createElement('div');
        header.className = 'aux-header';
        const label = document.createElement('div');
        label.className = 'label aux-label';
        label.textContent = locale.roleThought || 'Reasoning';
        header.appendChild(label);
        msgEl.appendChild(header);

        const wrap = document.createElement('div');
        wrap.className = 'aux-body-wrap';

        const scrollEl = document.createElement('div');
        scrollEl.className = 'aux-body-scroll is-expanded';
        const contentEl = document.createElement('div');
        contentEl.className = 'aux-body-content';
        contentEl.innerHTML = renderMarkdown(text || '');
        scrollEl.appendChild(contentEl);
        wrap.appendChild(scrollEl);
        msgEl.appendChild(wrap);

        const dummyBtn = document.createElement('button');
        dummyBtn.style.display = 'none';
        dummyBtn.hidden = true;

        return { div: msgEl, scrollEl: scrollEl, contentEl: contentEl, moreBtn: dummyBtn, lessBtn: dummyBtn, role: role, rawText: text || '', callText: '', bodyDiv: wrap };
    }

    function wireAuxiliaryMessage(group, parts, deferMarkdown) {
        const state = {
            role: parts.role,
            rawText: parts.rawText,
            detailExpanded: false,
            scrollEl: parts.scrollEl,
            contentEl: parts.contentEl,
            moreBtn: parts.moreBtn,
            lessBtn: parts.lessBtn,
        };
        group._auxState = state;
        if (parts.moreBtn) {
            parts.moreBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                state.detailExpanded = true;
                syncAuxiliaryDetailView(group);
            });
        }
        if (parts.lessBtn) {
            parts.lessBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                state.detailExpanded = false;
                syncAuxiliaryDetailView(group);
            });
        }
        if (parts.bodyDiv && parts.role === 'thought') {
            const msgEl = group.querySelector('.message.thought');
            if (msgEl) {
                msgEl.appendChild(parts.bodyDiv);
            }
        }
        if (deferMarkdown) {
            if (state.contentEl) {
                state.contentEl.textContent = parts.rawText || '';
            }
            syncAuxiliaryDetailView(group);
        } else {
            if (state.contentEl) {
                setAuxiliaryContent(group, parts.rawText);
            }
        }
    }

    function finalizeAuxiliaryBubble(group) {
        if (!group || !group._auxState) return;
        setAuxiliaryContent(group, group._auxState.rawText);
    }

    function permissionBodyText(title, detail) {
        const parts = [];
        if (title) parts.push(String(title));
        if (detail && String(detail).trim()) parts.push(String(detail).trim());
        return parts.join('\n\n');
    }

    function permissionOptionLabel(opt) {
        const kind = String(opt.kind || '').toLowerCase().replace(/-/g, '_');
        const id = String(opt.optionId || '').toLowerCase().replace(/-/g, '_');
        const map = {
            allow_once: 'permissionAllowOnce',
            allow_always: 'permissionAllowAlways',
            allow_session: 'permissionAllowSession',
            reject_once: 'permissionRejectOnce',
            reject_always: 'permissionRejectAlways',
            deny_once: 'permissionRejectOnce',
            deny_always: 'permissionRejectAlways',
            deny: 'permissionDeny',
        };
        let key = map[id] || map[kind];
        const tokens = [id, kind].filter(Boolean);
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('session') >= 0) {
                    key = 'permissionAllowSession';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0 && tokens[i].indexOf('always') >= 0) {
                    key = 'permissionAllowAlways';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('allow') >= 0) {
                    key = 'permissionAllowOnce';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if ((tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0)
                    && tokens[i].indexOf('always') >= 0) {
                    key = 'permissionRejectAlways';
                    break;
                }
            }
        }
        if (!key) {
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].indexOf('reject') >= 0 || tokens[i].indexOf('deny') >= 0) {
                    key = tokens[i].indexOf('once') >= 0 ? 'permissionRejectOnce' : 'permissionDeny';
                    break;
                }
            }
        }
        if (key && locale[key]) return locale[key];
        return opt.name || opt.optionId;
    }

    function getPermissionCollapsedMaxHeight() {
        return (PERM_LINE_HEIGHT_EM * PERM_COLLAPSED_LINES) + 'em';
    }

    function permissionDetailOverflows(scrollEl, text) {
        if (!scrollEl) return false;
        if (text && text.split('\n').length > PERM_COLLAPSED_LINES) return true;
        return scrollEl.scrollHeight > scrollEl.clientHeight + 1;
    }

    function syncPermissionDetailView(group) {
        const state = group._permissionState;
        if (!state || !state.scrollEl) return;
        state.textEl.textContent = state.text || '';
        state.wrapEl.style.display = state.cardCollapsed ? 'none' : '';
        state.scrollEl.classList.toggle('is-collapsed', !state.detailExpanded);
        state.scrollEl.classList.toggle('is-expanded', state.detailExpanded);
        if (!state.detailExpanded) {
            state.scrollEl.style.maxHeight = getPermissionCollapsedMaxHeight();
            state.scrollEl.scrollTop = state.scrollEl.scrollHeight;
        } else {
            state.scrollEl.style.maxHeight = '';
        }
        const overflow = permissionDetailOverflows(state.scrollEl, state.text);
        state.moreBtn.hidden = state.detailExpanded || !overflow;
        state.lessBtn.hidden = !state.detailExpanded || !overflow;
        state.cardToggle.title = state.cardCollapsed
            ? (locale.permissionCardExpand || 'Expand details')
            : (locale.permissionCardCollapse || 'Collapse details');
        state.cardToggle.setAttribute('aria-expanded', state.cardCollapsed ? 'false' : 'true');
    }

    function updatePermissionContent(group, title, detail) {
        if (!group._permissionState) return;
        group._permissionState.text = permissionBodyText(title, detail);
        syncPermissionDetailView(group);
    }

    function refreshPermissionOptionLabels(group) {
        if (!group._permissionState) return;
        group._permissionState.options.forEach(function(opt) {
            const btn = group.querySelector('.permission-btn[data-option-id="' + opt.optionId.replace(/"/g, '\\"') + '"]');
            if (btn) btn.textContent = permissionOptionLabel(opt);
        });
    }

    function buildPermissionActions(id, options, readOnly) {
        const actions = document.createElement('div');
        actions.className = 'permission-actions';
        if (readOnly) {
            actions.style.display = 'none';
            return actions;
        }
        (options || []).forEach(function(opt) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'permission-btn';
            btn.dataset.optionId = opt.optionId;
            const kind = String(opt.kind || '').toLowerCase();
            const idLower = String(opt.optionId || '').toLowerCase();
            if (kind.indexOf('allow') === 0 || idLower.indexOf('allow') === 0) {
                btn.classList.add('allow');
            } else if (kind.indexOf('reject') === 0 || kind.indexOf('deny') === 0
                || idLower.indexOf('reject') >= 0 || idLower.indexOf('deny') >= 0) {
                btn.classList.add('reject');
            }
            btn.textContent = permissionOptionLabel(opt);
            btn.addEventListener('click', function() {
                resolvePermission(id, opt.optionId, permissionOptionLabel(opt));
            });
            actions.appendChild(btn);
        });
        return actions;
    }

    function applyPermissionResolvedUI(group, statusText) {
        const div = group.querySelector('.message');
        if (!div) {
            return;
        }
        div.classList.remove('pending');
        div.classList.add('resolved');
        group.querySelectorAll('.permission-btn').forEach(function(btn) {
            btn.disabled = true;
        });
        const actions = group.querySelector('.permission-actions');
        if (actions) {
            actions.style.display = 'none';
        }
        let status = div.querySelector('.permission-status');
        if (!status) {
            status = document.createElement('div');
            status.className = 'permission-status';
            div.appendChild(status);
        }
        status.textContent = statusText;
    }

    function createPermissionCard(id, msg, cardOptions) {
        const readOnly = !!(cardOptions && cardOptions.readOnly);
        const group = document.createElement('div');
        group.className = 'message-group permission';
        group.id = 'perm-' + id;
        group.dataset.permissionId = id;

        const div = document.createElement('div');
        div.className = 'message permission' + (readOnly || msg.resolved ? ' resolved' : ' pending');

        const header = document.createElement('div');
        header.className = 'permission-header';

        const label = document.createElement('div');
        label.className = 'label permission-label';
        label.textContent = locale.permissionTitle || 'Permission required';
        header.appendChild(label);

        const cardToggle = document.createElement('button');
        cardToggle.type = 'button';
        cardToggle.className = 'permission-card-toggle';
        cardToggle.innerHTML = '<span class="permission-card-arrow">▼</span>';
        header.appendChild(cardToggle);
        div.appendChild(header);

        const wrap = document.createElement('div');
        wrap.className = 'permission-detail-wrap';

        const scrollEl = document.createElement('div');
        scrollEl.className = 'permission-detail-scroll is-collapsed';
        const textEl = document.createElement('div');
        textEl.className = 'permission-detail-text';
        scrollEl.appendChild(textEl);
        wrap.appendChild(scrollEl);

        const controls = document.createElement('div');
        controls.className = 'permission-detail-controls';
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'permission-detail-toggle';
        moreBtn.textContent = locale.permissionShowMore || 'Show more';
        const lessBtn = document.createElement('button');
        lessBtn.type = 'button';
        lessBtn.className = 'permission-detail-toggle';
        lessBtn.textContent = locale.permissionCollapse || 'Collapse';
        lessBtn.hidden = true;
        controls.appendChild(moreBtn);
        controls.appendChild(lessBtn);
        wrap.appendChild(controls);
        div.appendChild(wrap);

        const options = msg.options || [];
        div.appendChild(buildPermissionActions(id, options, readOnly));

        group.appendChild(div);
        group._permissionState = {
            text: permissionBodyText(msg.title, msg.detail),
            detailExpanded: !!(readOnly || msg.resolved),
            cardCollapsed: false,
            options: options,
            wrapEl: wrap,
            scrollEl: scrollEl,
            textEl: textEl,
            moreBtn: moreBtn,
            lessBtn: lessBtn,
            cardToggle: cardToggle,
            readOnly: readOnly,
        };

        cardToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.cardCollapsed = !group._permissionState.cardCollapsed;
            div.classList.toggle('is-card-collapsed', group._permissionState.cardCollapsed);
            syncPermissionDetailView(group);
        });
        moreBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.detailExpanded = true;
            syncPermissionDetailView(group);
        });
        lessBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            group._permissionState.detailExpanded = false;
            syncPermissionDetailView(group);
        });

        updatePermissionContent(group, msg.title, msg.detail);
        if (readOnly || msg.resolved) {
            let statusText = locale.permissionCancelled || 'Cancelled';
            if (msg.outcome === 'selected' && (msg.selectedLabel || msg.selectedOptionId)) {
                statusText = localeText('permissionSelected', msg.selectedLabel || msg.selectedOptionId);
            } else if (msg.selectedLabel) {
                statusText = localeText('permissionSelected', msg.selectedLabel);
            }
            applyPermissionResolvedUI(group, statusText);
        }
        assignSessionIndex(group);
        return group;
    }

    function restorePermissionMessage(m) {
        const id = m.permissionId || ('perm_hist_' + (m.timestamp || Date.now()));
        const group = createPermissionCard(id, {
            title: m.title || m.text || '',
            detail: m.detail || '',
            options: m.options || [],
            resolved: true,
            outcome: m.outcome,
            selectedLabel: m.selectedLabel,
            selectedOptionId: m.selectedOptionId,
        }, { readOnly: true });
        messagesEl.appendChild(group);
    }

    let connectionAttempted = false;
    const cancelBtn = document.getElementById('cancelBtn');
    const retryBtn = document.getElementById('retryBtn');
    let activeSessionId = '';

    const filePickerEl = document.getElementById('filePicker');
    let mentionStart = -1;
    let filePickerVisible = false;

    // ---- Slash command picker (input starts with "/") ----
    const slashCommandPickerEl = document.getElementById('slashCommandPicker');
    let slashCommands = [];
    let slashCommandItems = [];
    let slashCommandIndex = 0;
    let slashCommandVisible = false;

    function hideSlashCommandPicker() {
        slashCommandVisible = false;
        slashCommandItems = [];
        slashCommandIndex = 0;
        if (slashCommandPickerEl) {
            slashCommandPickerEl.classList.remove('visible');
            slashCommandPickerEl.innerHTML = '';
            slashCommandPickerEl.hidden = true;
        }
    }

    function renderSlashCommandPicker() {
        if (!slashCommandPickerEl) { return; }
        const val = inputEl.value;
        const pos = inputEl.selectionStart;
        // Only show when the input is exactly a leading "/..." token.
        const before = val.slice(0, pos);
        const match = before.match(/^\/([\w-]*)$/);
        if (!match) {
            hideSlashCommandPicker();
            return;
        }
        const query = match[1].toLowerCase();
        const filtered = slashCommands.filter(function (c) {
            return query === '' || c.name.toLowerCase().startsWith(query);
        });
        slashCommandItems = filtered;
        slashCommandIndex = 0;
        slashCommandPickerEl.innerHTML = '';
        if (slashCommands.length > 0) {
            const header = document.createElement('div');
            header.className = 'slash-command-picker-header';
            header.textContent = locale.slashCommandsTitle || 'Commands';
            slashCommandPickerEl.appendChild(header);
        }
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'slash-command-empty';
            empty.textContent = locale.noMatchingCommands || 'No matching commands';
            slashCommandPickerEl.appendChild(empty);
            slashCommandPickerEl.hidden = false;
            slashCommandPickerEl.classList.add('visible');
            slashCommandVisible = true;
            return;
        }
        filtered.forEach(function (cmd, idx) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'slash-command-item' + (idx === 0 ? ' active' : '');
            const name = document.createElement('div');
            name.className = 'slash-command-name';
            name.textContent = cmd.name;
            const desc = document.createElement('div');
            desc.className = 'slash-command-desc';
            desc.textContent = cmd.description || (cmd.inputHint ? cmd.inputHint : '');
            btn.appendChild(name);
            btn.appendChild(desc);
            btn.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectSlashCommand(cmd);
            });
            slashCommandPickerEl.appendChild(btn);
        });
        slashCommandPickerEl.hidden = false;
        slashCommandPickerEl.classList.add('visible');
        slashCommandVisible = true;
    }

    function updateSlashCommandHighlight() {
        if (!slashCommandPickerEl) { return; }
        slashCommandPickerEl.querySelectorAll('.slash-command-item').forEach(function (el, idx) {
            el.classList.toggle('active', idx === slashCommandIndex);
            if (idx === slashCommandIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    // Apply the chosen command: replace the leading "/token" with "/name ".
    function selectSlashCommand(cmd) {
        const val = inputEl.value;
        const pos = inputEl.selectionStart;
        const before = val.slice(0, pos);
        const match = before.match(/^(\/[\w-]*)$/);
        const replacement = '/' + cmd.name + ' ';
        let newVal, newPos;
        if (match) {
            newVal = replacement + val.slice(match[1].length);
            newPos = replacement.length;
        } else {
            // Fallback: append on its own line.
            newVal = val + '\n' + replacement;
            newPos = newVal.length;
        }
        inputEl.value = newVal;
        inputEl.setSelectionRange(newPos, newPos);
        hideSlashCommandPicker();
        syncInputHeightFromContent();
        inputEl.focus();
    }
    let filePickerItems = [];
    let filePickerIndex = 0;
    let fileListRequestId = 0;
    let fileListDebounce = null;

    let previewTooltip = null;
    let previewHideTimer = null;
    let previewRequestId = 0;
    const previewRequests = new Map();

    function setInputMode(mode) {
        const waiting = mode === 'stop' || mode === 'waiting';
        if (inputCompositeEl) {
            inputCompositeEl.classList.toggle('waiting', waiting);
        }
        if (inputCompositeShellEl) {
            inputCompositeShellEl.classList.toggle('waiting', waiting);
        }
        if (mode === 'stop') {
            sendBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        } else if (mode === 'waiting') {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        } else if (mode === 'send') {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = !canSend;
        } else {
            cancelBtn.classList.add('hidden');
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = true;
        }
    }

    function setQuickPanelOpen(open) {
        if (!inputQuickPanel || !quickActionsTrigger) return;
        inputQuickPanel.classList.toggle('open', open);
        inputQuickPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        quickActionsTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        quickActionsTrigger.classList.toggle('is-active', open);
        if (open && chatSearchInput && !chatSearchInput.disabled) {
            setTimeout(function() { chatSearchInput.focus(); }, 280);
        }
    }

    function toggleQuickPanel() {
        setQuickPanelOpen(!inputQuickPanel.classList.contains('open'));
    }

    function updateConnectionActionVisibility(status) {
        const showActions = status === 'error' || (status === 'idle' && connectionAttempted);
        if (retryBtn) {
            retryBtn.hidden = !showActions;
            retryBtn.disabled = status === 'connecting';
        }
    }

    function bindConnectionErrorActions() {
        const phRetry = document.getElementById('placeholderRetryBtn');
        if (phRetry) phRetry.addEventListener('click', doRetry);
    }

    function buildConnectionErrorPlaceholder(errText) {
        if (placeholder) placeholder.className = 'placeholder';
        return escapeHtml(errText) +
            '<div class="connection-error-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
            '<button type="button" class="retry-btn" id="placeholderRetryBtn">' + escapeHtml(locale.retryConnect) + '</button>' +
            '</div>';
    }

    function updateRetryVisibility(status) {
        updateConnectionActionVisibility(status);
    }

    function doRetry() {
        if (retryBtn && retryBtn.disabled) return;
        connectionAttempted = true;
        vscode.postMessage({ type: 'retry' });
    }

    function updateStatus(status, message) {
        statusDot.className = 'dot ' + status;
        const labels = {
            idle: locale.statusDisconnected,
            connecting: locale.statusConnecting,
            ready: locale.statusReady,
            prompting: locale.statusThinking,
            error: locale.statusError
        };
        let text = message || labels[status] || status;
        if (text.startsWith('Session:')) {
            text = labels[status] || status;
        }
        statusText.textContent = text;
        statusText.title = message || text;
        updateRetryVisibility(status);
    }

    // ---- Log viewer ----
    let logs = [];
    const logFilterError = document.getElementById('logFilterError');
    const logFilterWarning = document.getElementById('logFilterWarning');
    const logModal = document.getElementById('logModal');
    const logContent = document.getElementById('logContent');
    const copyLogBtn = document.getElementById('copyLogBtn');
    const LOG_SCROLL_BOTTOM_THRESHOLD = 24;
    const LOG_SCROLL_IDLE_MS = 5000;
    let logScrollPinnedByUser = false;
    let logScrollIdleTimer = null;
    let copyLogResetTimer = null;

    function isLogModalOpen() {
        return !!(logModal && logModal.classList.contains('is-open'));
    }

    function isLogAtBottom() {
        if (!logContent) {
            return true;
        }
        return logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight <= LOG_SCROLL_BOTTOM_THRESHOLD;
    }

    function maybeScrollLogToBottom(force) {
        if (!logContent) {
            return;
        }
        if (force || !logScrollPinnedByUser) {
            logContent.scrollTop = logContent.scrollHeight;
        }
    }

    function scheduleLogScrollReenable() {
        if (logScrollIdleTimer) {
            clearTimeout(logScrollIdleTimer);
        }
        logScrollIdleTimer = setTimeout(function() {
            logScrollIdleTimer = null;
            logScrollPinnedByUser = false;
            maybeScrollLogToBottom(true);
        }, LOG_SCROLL_IDLE_MS);
    }

    function onLogContentScroll() {
        if (!isLogModalOpen()) {
            return;
        }
        if (isLogAtBottom()) {
            logScrollPinnedByUser = false;
            if (logScrollIdleTimer) {
                clearTimeout(logScrollIdleTimer);
                logScrollIdleTimer = null;
            }
            return;
        }
        logScrollPinnedByUser = true;
        scheduleLogScrollReenable();
    }

    function resetLogAutoScrollFollow() {
        logScrollPinnedByUser = false;
        if (logScrollIdleTimer) {
            clearTimeout(logScrollIdleTimer);
            logScrollIdleTimer = null;
        }
    }

    function getVisibleLogText() {
        const showError = !logFilterError || logFilterError.checked;
        const showWarning = !logFilterWarning || logFilterWarning.checked;
        return logs
            .filter(function(entry) {
                if (entry.level === 'error') return showError;
                if (entry.level === 'warning') return showWarning;
                return false;
            })
            .map(function(entry) { return entry.line; })
            .join('\n');
    }

    function renderLogContent() {
        const showError = !logFilterError || logFilterError.checked;
        const showWarning = !logFilterWarning || logFilterWarning.checked;
        const visible = logs.filter(function(entry) {
            if (entry.level === 'error') return showError;
            if (entry.level === 'warning') return showWarning;
            return false;
        });
        if (!visible.length) {
            logContent.textContent = locale.noLogs;
            return;
        }
        logContent.textContent = '';
        for (const entry of visible) {
            const lineEl = document.createElement('div');
            lineEl.className = entry.level === 'error' ? 'log-line-error' : 'log-line-warning';
            lineEl.textContent = entry.line;
            logContent.appendChild(lineEl);
        }
        maybeScrollLogToBottom();
    }

    function showModal(el) {
        if (el) el.classList.add('is-open');
    }
    function hideModal(el) {
        if (el) el.classList.remove('is-open');
    }

    function openLogModal() {
        resetLogAutoScrollFollow();
        renderLogContent();
        showModal(logModal);
        maybeScrollLogToBottom(true);
    }
    document.getElementById('closeLogBtn').addEventListener('click', function() {
        hideModal(logModal);
    });
    if (copyLogBtn) {
        copyLogBtn.addEventListener('click', function() {
            const text = getVisibleLogText();
            if (!text) return;
            copyToClipboard(text).then(function() {
                copyLogBtn.classList.add('copied');
                const prevText = copyLogBtn.textContent;
                copyLogBtn.textContent = locale.copied;
                if (copyLogResetTimer) clearTimeout(copyLogResetTimer);
                copyLogResetTimer = setTimeout(function() {
                    copyLogResetTimer = null;
                    copyLogBtn.classList.remove('copied');
                    copyLogBtn.textContent = prevText || locale.copy;
                }, 1500);
            });
        });
    }
    document.getElementById('clearLogBtn').addEventListener('click', function() {
        logs = [];
        renderLogContent();
    });
    if (logFilterError) logFilterError.addEventListener('change', renderLogContent);
    if (logFilterWarning) logFilterWarning.addEventListener('change', renderLogContent);
    if (logContent) {
        logContent.addEventListener('scroll', onLogContentScroll, { passive: true });
    }

    const COPY_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 2h8a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h0zm1 2v8h8V5H5zm-2 2h1v6h6v1H4a1 1 0 0 1-1-1V6h0z"/></svg>';
    const TAB_PIN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M9.2 1.3 11.5 3.6V6l2.2 2.1v1.2H10v4.2L9 14H7L6 13.5V9.3H2.3V8.1L4.5 6V3.6L6.8 1.3h2.4zm-.9 1.4H7.7L5.9 4.5V6.4L4.3 8h7.4L10.1 6.4V4.5L8.3 2.7z"/></svg>';
    const SELECT_ICON_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5V7zm0 4.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2z"/><path d="M3.15 4.85l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M3.15 9.35l.7-.7 1 1 2-2 .7.7-2.7 2.7-1.7-1.7z"/><path d="M7.5 3h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1zm0 4.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1 0-1z"/></svg>';
    const CHEVRON_DOWN_SVG = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 6 8 9.5 11.5 6l.7.7L8 10.9l-4.2-4.2.7-.7z"/></svg>';

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function() {
                fallbackCopyToClipboard(text);
            });
        }
        fallbackCopyToClipboard(text);
        return Promise.resolve();
    }

    function fallbackCopyToClipboard(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    function updateQuickActionBtns() {
        const hasMessages = messagesEl.querySelectorAll('.message-group').length > 0;
        const hasInput = !!inputEl.value.trim();
        if (clearChatBtn) clearChatBtn.disabled = !hasMessages;
        if (copySessionBtn) copySessionBtn.disabled = !hasMessages;
        if (downloadSessionBtn) downloadSessionBtn.disabled = !hasMessages;
        if (clearInputBtn) clearInputBtn.disabled = !hasInput;
        if (chatSearchInput) chatSearchInput.disabled = !hasMessages;
        if (!hasMessages) clearChatSearch();
        else if (chatSearchInput && chatSearchInput.value.trim()) scheduleChatSearch();
    }

    const chatSearchState = {
        query: '',
        matches: [],
        current: -1,
        timer: null,
    };

    function getMessageContentEl(group) {
        const bubble = group.querySelector('.message') || group;
        return bubble.querySelector('.content') || bubble.querySelector('.aux-body-content');
    }

    function clearSearchMarks() {
        document.querySelectorAll('mark.search-mark').forEach(function(mark) {
            const text = document.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(text, mark);
        });
        document.querySelectorAll('.message-group').forEach(function(group) {
            group.classList.remove('search-hit', 'search-hit-active');
        });
    }

    function wrapTextRange(root, start, end, active) {
        if (!root || start >= end) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let node;
        while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            const nodeStart = offset;
            const nodeEnd = offset + text.length;
            if (nodeEnd <= start) {
                offset = nodeEnd;
                continue;
            }
            if (nodeStart >= end) break;

            const localStart = Math.max(0, start - nodeStart);
            const localEnd = Math.min(text.length, end - nodeStart);
            const before = text.slice(0, localStart);
            const middle = text.slice(localStart, localEnd);
            const after = text.slice(localEnd);
            const frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            const mark = document.createElement('mark');
            mark.className = active ? 'search-mark search-mark-active' : 'search-mark';
            mark.textContent = middle;
            frag.appendChild(mark);
            if (after) frag.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(frag, node);
            break;
        }
    }

    function updateChatSearchUI() {
        const total = chatSearchState.matches.length;
        const hasQuery = !!chatSearchState.query;
        if (chatSearchCount) {
            if (!hasQuery) {
                chatSearchCount.textContent = '';
                chatSearchCount.classList.remove('no-match');
            } else if (total === 0) {
                chatSearchCount.textContent = '0/0';
                chatSearchCount.classList.add('no-match');
            } else {
                chatSearchCount.textContent = (chatSearchState.current + 1) + '/' + total;
                chatSearchCount.classList.remove('no-match');
            }
        }
        const canNav = total > 0;
        if (chatSearchPrev) chatSearchPrev.disabled = !canNav;
        if (chatSearchNext) chatSearchNext.disabled = !canNav;
    }

    function applyChatSearchHighlight() {
        clearSearchMarks();
        if (chatSearchState.current < 0 || !chatSearchState.matches.length) {
            updateChatSearchUI();
            return;
        }
        chatSearchState.matches.forEach(function(match) {
            match.group.classList.add('search-hit');
        });
        const active = chatSearchState.matches[chatSearchState.current];
        active.group.classList.add('search-hit-active');

        const byRoot = new Map();
        chatSearchState.matches.forEach(function(match, idx) {
            const contentEl = getMessageContentEl(match.group);
            if (!contentEl) return;
            if (!byRoot.has(contentEl)) byRoot.set(contentEl, []);
            byRoot.get(contentEl).push({
                start: match.start,
                end: match.end,
                active: idx === chatSearchState.current,
            });
        });
        byRoot.forEach(function(ranges, root) {
            ranges.sort(function(a, b) { return b.start - a.start; });
            ranges.forEach(function(range) {
                wrapTextRange(root, range.start, range.end, range.active);
            });
        });

        active.group.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateChatSearchUI();
    }

    function runChatSearch() {
        if (!chatSearchInput) return;
        const query = chatSearchInput.value.trim();
        chatSearchState.query = query;
        chatSearchState.matches = [];
        chatSearchState.current = -1;
        clearSearchMarks();
        if (!query) {
            updateChatSearchUI();
            return;
        }
        const needle = query.toLowerCase();
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            const text = getMessagePlainText(group);
            const haystack = text.toLowerCase();
            let idx = 0;
            while ((idx = haystack.indexOf(needle, idx)) !== -1) {
                chatSearchState.matches.push({
                    group: group,
                    start: idx,
                    end: idx + query.length,
                });
                idx += needle.length || 1;
            }
        });
        if (chatSearchState.matches.length > 0) {
            chatSearchState.current = 0;
            applyChatSearchHighlight();
        } else {
            updateChatSearchUI();
        }
    }

    function scheduleChatSearch() {
        if (chatSearchState.timer) clearTimeout(chatSearchState.timer);
        chatSearchState.timer = setTimeout(function() {
            chatSearchState.timer = null;
            runChatSearch();
        }, 150);
    }

    function clearChatSearch() {
        if (chatSearchState.timer) {
            clearTimeout(chatSearchState.timer);
            chatSearchState.timer = null;
        }
        if (chatSearchInput) chatSearchInput.value = '';
        chatSearchState.query = '';
        chatSearchState.matches = [];
        chatSearchState.current = -1;
        clearSearchMarks();
        updateChatSearchUI();
    }

    function gotoChatSearchMatch(delta) {
        const total = chatSearchState.matches.length;
        if (!total) return;
        chatSearchState.current = (chatSearchState.current + delta + total) % total;
        applyChatSearchHighlight();
    }

    function getSessionPlainText() {
        const groups = messagesEl.querySelectorAll('.message-group');
        const lines = [];
        groups.forEach(function(group) {
            const role = group.classList.contains('user') ? locale.roleYou
                : group.classList.contains('assistant') ? locale.roleHermes
                : group.classList.contains('thought') ? locale.roleThought
                : group.classList.contains('tool') ? locale.roleTool
                : locale.roleMessage;
            const text = getMessagePlainText(group).trim();
            if (!text) return;
            lines.push(role + ':\n' + text);
        });
        return lines.join('\n\n');
    }

    function flashQuickActionBtn(btn, className, duration) {
        if (!btn) return;
        btn.classList.add(className || 'copied');
        setTimeout(function() {
            btn.classList.remove(className || 'copied');
        }, duration || 1500);
    }

    function isSelectableRole(role) {
        return role === 'user' || role === 'assistant' || role === 'thought' || role === 'tool';
    }

    function isGroupInContextAttachRegion(group) {
        const divider = document.getElementById(LOCAL_HISTORY_DIVIDER_ID);
        if (!divider) {
            return true;
        }
        return !!(group.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    function getSelectableGroups() {
        return Array.from(messagesEl.querySelectorAll('.message-group.selectable')).filter(function(group) {
            if (group.style.display === 'none') {
                return false;
            }
            if (multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
                return false;
            }
            if (multiSelectPurpose === 'contextAttach' && !isAttachableMemoryGroup(group)) {
                return false;
            }
            return true;
        });
    }

    function getSelectedGroups() {
        return getSelectableGroups().filter(function(group) {
            return group.classList.contains('is-selected');
        });
    }

    function getGroupCheckbox(group) {
        return group.querySelector('.msg-select-wrap input[type="checkbox"]');
    }

    function setGroupSelected(group, selected) {
        group.classList.toggle('is-selected', selected);
        const checkbox = getGroupCheckbox(group);
        if (checkbox) checkbox.checked = selected;
        updateMultiSelectToolbar();
    }

    function setGroupsSelected(updates) {
        updates.forEach(function(entry) {
            entry.group.classList.toggle('is-selected', entry.selected);
            const checkbox = getGroupCheckbox(entry.group);
            if (checkbox) checkbox.checked = entry.selected;
        });
        updateMultiSelectToolbar();
    }

    function areAllSelectableGroupsSelected(groups) {
        return groups.length > 0 && groups.every(function(group) {
            return group.classList.contains('is-selected');
        });
    }

    function toggleGroupSelection(group) {
        setGroupSelected(group, !group.classList.contains('is-selected'));
    }

    function updateMultiSelectToolbar() {
        const selected = getSelectedGroups();
        const count = selected.length;
        const isAttachMode = multiSelectPurpose === 'contextAttach';
        if (multiSelectCount) {
            multiSelectCount.textContent = count > 0
                ? (locale.multiSelectCount || '{0} selected').replace('{0}', String(count))
                : (locale.selectMessages || 'Select');
        }
        const hasSelection = count > 0;
        if (multiSelectDeleteBtn) multiSelectDeleteBtn.disabled = !hasSelection;
        if (multiSelectCopyBtn) multiSelectCopyBtn.disabled = !hasSelection;
        if (multiSelectExportBtn) multiSelectExportBtn.disabled = !hasSelection;
        if (multiSelectAttachConfirmBtn) {
            multiSelectAttachConfirmBtn.hidden = !isAttachMode;
            multiSelectAttachConfirmBtn.disabled = !hasSelection;
        }
        const selectableGroups = getSelectableGroups();
        if (multiSelectAllBtn) {
            multiSelectAllBtn.textContent = areAllSelectableGroupsSelected(selectableGroups)
                ? (locale.multiSelectDeselectAll || '取消全选')
                : (locale.multiSelectAll || '全选');
        }
        if (isAttachMode) {
            updateContextAttachButtonLabel();
        }
        hideContextAttachPreview();
    }

    function enterMultiSelectMode(initialGroup, purpose) {
        multiSelectPurpose = purpose || 'normal';
        if (multiSelectMode) {
            if (initialGroup) {
                setGroupSelected(initialGroup, true);
            }
            updateMultiSelectToolbar();
            return;
        }
        multiSelectMode = true;
        messagesEl.classList.add('multi-select-active');
        if (multiSelectToolbar) {
            multiSelectToolbar.hidden = false;
            multiSelectToolbar.classList.add('visible');
        }
        if (initialGroup) {
            setGroupSelected(initialGroup, true);
        } else {
            updateMultiSelectToolbar();
        }
    }

    function exitMultiSelectMode() {
        if (!multiSelectMode) {
            return;
        }
        const wasAttachMode = multiSelectPurpose === 'contextAttach';
        if (wasAttachMode && contextAttachCustomPending && !contextAttachCustomConfirmed) {
            const indices = getSelectedMessageIndices();
            if (indices.length > 0) {
                contextAttachUnconfirmedIndices = indices.slice();
                contextAttachMode = 'custom';
            } else {
                contextAttachMode = 'none';
                contextAttachCustomPending = false;
                contextAttachUnconfirmedIndices = [];
            }
        }
        multiSelectMode = false;
        multiSelectPurpose = 'normal';
        messagesEl.classList.remove('multi-select-active');
        getSelectableGroups().forEach(function(group) {
            setGroupSelected(group, false);
        });
        clearContextAttachSelectableTargets();
        if (multiSelectToolbar) {
            multiSelectToolbar.hidden = true;
            multiSelectToolbar.classList.remove('visible');
        }
        updateMultiSelectToolbar();
        updateContextAttachButtonLabel();
    }

    function wireSelectableGroup(group) {
        if (group.dataset.selectWired) return;
        group.dataset.selectWired = '1';
        group.addEventListener('click', function(e) {
            if (!multiSelectMode) return;
            if (multiSelectPurpose === 'contextAttach' && !isGroupInContextAttachRegion(group)) {
                return;
            }
            if (e.target.closest('.message-actions, .block-actions, .insert-dropdown, .insert-dropdown-menu, .msg-select-wrap')) {
                return;
            }
            e.preventDefault();
            toggleGroupSelection(group);
        });
    }

    function assignSessionIndex(group) {
        group.dataset.sessionIndex = String(sessionMsgCounter++);
    }

    function reindexSessionIndices() {
        sessionMsgCounter = 0;
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            assignSessionIndex(group);
        });
    }

    function getGroupRoleLabel(group) {
        if (group.classList.contains('user')) return locale.roleYou;
        if (group.classList.contains('assistant')) return locale.roleHermes;
        if (group.classList.contains('thought')) return locale.roleThought;
        if (group.classList.contains('tool')) return locale.roleTool;
        return locale.roleMessage;
    }

    function getGroupMarkdownText(group) {
        if (group._auxState && group._auxState.rawText) {
            return group._auxState.rawText;
        }
        if (group._rawText) {
            return group._rawText;
        }
        return getMessagePlainText(group);
    }

    function getGroupsPlainText(groups) {
        const lines = [];
        groups.forEach(function(group) {
            const role = getGroupRoleLabel(group);
            const text = getMessagePlainText(group).trim();
            if (!text) return;
            lines.push(role + ':\n' + text);
        });
        return lines.join('\n\n');
    }

    function showSessionRenderBanner() {
        if (!chatBodyEl) return;
        let banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner) {
            banner = document.createElement('div');
            banner.id = SESSION_RENDER_BANNER_ID;
            banner.className = 'session-render-banner';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            banner.innerHTML = '<span class="session-render-spinner" aria-hidden="true"></span><span class="session-render-text"></span>';
            chatBodyEl.appendChild(banner);
        }
        banner.classList.remove('is-hiding');
        const textEl = banner.querySelector('.session-render-text');
        if (textEl) textEl.textContent = locale.sessionRendering || '';
        banner.hidden = false;
    }

    function forceHideSessionRenderBanner() {
        const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner) return;
        banner.classList.remove('is-hiding');
        banner.hidden = true;
    }

    function hideSessionRenderBanner() {
        const banner = document.getElementById(SESSION_RENDER_BANNER_ID);
        if (!banner || banner.hidden || banner.classList.contains('is-hiding')) return;
        banner.classList.add('is-hiding');
        const onExitEnd = function(e) {
            if (e.target !== banner || e.animationName !== 'session-render-exit') return;
            banner.removeEventListener('animationend', onExitEnd);
            banner.hidden = true;
            banner.classList.remove('is-hiding');
        };
        banner.addEventListener('animationend', onExitEnd);
    }

    function cancelSessionMarkdownRender() {
        sessionRenderJobId++;
        forceHideSessionRenderBanner();
    }

    function collectMarkdownRenderTargets() {
        const targets = [];
        messagesEl.querySelectorAll('.message-group').forEach(function(group) {
            if (group.id === LOCAL_HISTORY_DIVIDER_ID) return;
            const assistantContent = group.querySelector('.message.assistant .content');
            if (assistantContent) {
                const text = group._rawText || assistantContent.textContent || '';
                if (text.trim()) {
                    targets.push({ kind: 'assistant', el: assistantContent, text: text, group: group });
                }
            }
            if (group._auxState && group._auxState.contentEl) {
                const text = group._auxState.rawText || group._auxState.contentEl.textContent || '';
                if (text.trim()) {
                    targets.push({ kind: 'aux', group: group, text: text });
                }
            }
        });
        return targets;
    }

    function renderMarkdownTarget(target) {
        if (target.kind === 'assistant') {
            target.group._rawText = target.text;
            target.el.innerHTML = renderMarkdown(target.text);
            setupContentBlocks(target.el);
            processFileRefs(target.el);
            return;
        }
        if (target.kind === 'aux') {
            setAuxiliaryContent(target.group, target.text);
        }
    }

    function scheduleSessionMarkdownRender() {
        const jobId = ++sessionRenderJobId;
        const targets = collectMarkdownRenderTargets();
        if (!targets.length) {
            hideSessionRenderBanner();
            window._hermesRendered = true;
            if (chatSearchState.query) scheduleChatSearch();
            return;
        }
        showSessionRenderBanner();
        let index = 0;
        function runBatch() {
            if (jobId !== sessionRenderJobId) return;
            const end = Math.min(index + MARKDOWN_RENDER_BATCH_SIZE, targets.length);
            for (; index < end; index++) {
                renderMarkdownTarget(targets[index]);
            }
            if (index < targets.length) {
                requestAnimationFrame(runBatch);
            } else {
                hideSessionRenderBanner();
                window._hermesRendered = true;
                if (chatSearchState.query) scheduleChatSearch();
            }
        }
        requestAnimationFrame(runBatch);
    }

    function getSelectedMessageIndices(groups) {
        return (groups || getSelectedGroups()).map(function(group) {
            return parseInt(group.dataset.sessionIndex || '', 10);
        }).filter(function(index) {
            return Number.isInteger(index) && index >= 0;
        });
    }

    function requestSessionExport(action, indices, sessionId) {
        const sid = sessionId || lastActiveSessionId;
        if (!sid) return;
        vscode.postMessage({
            type: 'sessionExport',
            sessionId: sid,
            action: action,
            indices: indices && indices.length ? indices : undefined,
        });
    }

    function getGroupsMarkdown(groups) {
        const parts = [];
        groups.forEach(function(group) {
            const role = getGroupRoleLabel(group);
            const text = getGroupMarkdownText(group).trim();
            if (!text) return;
            parts.push('## ' + role + '\n\n' + text);
        });
        return parts.join('\n\n');
    }

    function deleteSelectedGroups() {
        const selected = getSelectedGroups();
        if (!selected.length) return;
        const indices = selected.map(function(group) {
            return parseInt(group.dataset.sessionIndex || '', 10);
        }).filter(function(index) {
            return Number.isInteger(index) && index >= 0;
        });
        vscode.postMessage({ type: 'deleteMessages', indices: indices });
        selected.forEach(function(group) {
            group.remove();
        });
        reindexSessionIndices();
        exitMultiSelectMode();
        updateQuickActionBtns();
        if (!messagesEl.querySelector('.message-group')) {
            placeholder.style.display = 'block';
        }
    }

    function exportSelectedGroups() {
        const indices = getSelectedMessageIndices();
        if (!indices.length) return;
        requestSessionExport('export', indices);
    }

    function getMessagePlainText(group) {
        const bubble = group.querySelector('.message') || group;
        const content = bubble.querySelector('.content');
        if (content) return content.textContent || '';
        const aux = bubble.querySelector('.aux-body-content');
        if (aux) return aux.textContent || '';
        const toolSection = bubble.querySelector('.tool-call-section-content');
        if (toolSection) return toolSection.textContent || '';
        return '';
    }

    function attachMessageActions(group, inner) {
        const actions = document.createElement('div');
        actions.className = 'message-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-btn';
        copyBtn.title = locale.copy;
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const text = getMessagePlainText(group);
            if (!text) return;
            copyToClipboard(text).then(function() {
                copyBtn.title = locale.copied;
                copyBtn.classList.add('copied');
                setTimeout(function() {
                    copyBtn.title = locale.copy;
                    copyBtn.classList.remove('copied');
                }, 1500);
            });
        });
        actions.appendChild(copyBtn);

        group.appendChild(actions);
    }

    function attachCopyButton(group) {
        const inner = group.querySelector('.message-group-inner');
        if (inner) attachMessageActions(group, inner);
    }

    function addMessage(role, text, options) {
        const restoring = options && options.restore;
        placeholder.style.display = 'none';

        // For streaming assistant messages, update the last one (not when restoring history)
        if (!restoring && role === 'assistant' && streamingMessageId) {
            const last = document.getElementById(streamingMessageId);
            if (last) {
                last.querySelector('.content').textContent = text;
                last._rawText = text;
                if (chatSearchState.query) scheduleChatSearch();
                maybeScrollToBottom();
                return;
            }
        }

        const id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const group = document.createElement('div');
        group.className = 'message-group ' + role;
        group.id = id;
        if (isSelectableRole(role)) {
            group.classList.add('selectable');
            const selectWrap = document.createElement('label');
            selectWrap.className = 'msg-select-wrap';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.addEventListener('click', function(e) {
                e.stopPropagation();
            });
            checkbox.addEventListener('change', function() {
                setGroupSelected(group, checkbox.checked);
            });
            selectWrap.appendChild(checkbox);
            group.appendChild(selectWrap);
            wireSelectableGroup(group);
        }
        assignSessionIndex(group);

        const inner = document.createElement('div');
        inner.className = 'message-group-inner';

        let div;
        let auxParts = null;
        if (role === 'tool' || role === 'thought') {
            auxParts = buildAuxiliaryMessage(role, text);
            div = auxParts.div;
            if (!restoring) {
                div.classList.add('is-live');
            }
        } else {
            div = document.createElement('div');
            div.className = 'message ' + role;
            const content = document.createElement('div');
            content.className = 'content';
            content.textContent = text;
            div.appendChild(content);
            group._rawText = text;
            if (role === 'user') {
                processFileRefs(content);
                // Render any images attached to this user message as thumbnails.
                if (options && options.images && options.images.length) {
                    const gallery = document.createElement('div');
                    gallery.className = 'message-images';
                    options.images.forEach(function (img) {
                        if (!img || !img.mimeType || !img.data) return;
                        const wrap = document.createElement('div');
                        wrap.className = 'message-image-wrap';
                        const im = document.createElement('img');
                        im.className = 'message-image';
                        im.src = 'data:' + img.mimeType + ';base64,' + img.data;
                        im.alt = img.name || 'attached image';
                        // Magnifying-glass affordance: opening the attachment in
                        // the main editor gives a full-size, zoomable view.
                        im.title = locale.openImageInEditor || 'Open in editor';
                        im.addEventListener('click', function () {
                            vscode.postMessage({
                                type: 'openImage',
                                name: img.name || 'image',
                                mimeType: img.mimeType,
                                data: img.data,
                            });
                        });
                        wrap.appendChild(im);
                        gallery.appendChild(wrap);
                    });
                    if (gallery.childElementCount) {
                        div.appendChild(gallery);
                    }
                }
                // Render any non-image files attached to this user message as chips.
                if (options && options.files && options.files.length) {
                    const fgallery = document.createElement('div');
                    fgallery.className = 'message-files';
                    options.files.forEach(function (f) {
                        if (!f || !f.name) return;
                        const chip = document.createElement('div');
                        chip.className = 'message-file-chip';
                        const icon = document.createElement('span');
                        icon.className = 'file-icon';
                        icon.textContent = '📄';
                        icon.setAttribute('aria-hidden', 'true');
                        const label = document.createElement('span');
                        label.className = 'file-name';
                        label.textContent = f.name;
                        label.title = f.name;
                        chip.appendChild(icon);
                        chip.appendChild(label);
                        fgallery.appendChild(chip);
                    });
                    if (fgallery.childElementCount) {
                        div.appendChild(fgallery);
                    }
                }
            }
        }

        // Mark as streaming if assistant message (live stream only)
        if (role === 'assistant' && !restoring) {
            resetToolAggregation();
            div.classList.add('streaming');
            streamingMessageId = id;
            clearAllToolLive();
            enableStopAfterAgentOutput();
        }
        if (role === 'assistant') {
            group._rawText = text;
        }

        inner.appendChild(div);
        if (auxParts) {
            wireAuxiliaryMessage(group, auxParts, !!(restoring && options && options.deferMarkdown));
        }
        if (!restoring && role === 'thought') {
            resetToolAggregation();
        }
        if (!restoring && (role === 'thought' || role === 'tool')) {
            enableStopAfterAgentOutput();
        }
        attachMessageActions(group, inner);
        group.appendChild(inner);
        if (options && options.skipAppend) {
            return group;
        }
        messagesEl.appendChild(group);
        // Apply visibility filter for thought/tool messages
        if (role === 'thought' && !window._showThoughts) group.style.display = 'none';
        if (role === 'tool' && !window._showToolCalls) group.style.display = 'none';
        updateQuickActionBtns();
        if (chatSearchState.query) scheduleChatSearch();
        maybeScrollToBottom();
        return id;
    }

    function renderMarkdown(text) {
        const html = marked.parse(text);
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, {
                USE_PROFILES: { html: true },
                ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            });
        }
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('*').forEach(function(n) {
            if (!n.attributes) return;
            for (let i = n.attributes.length - 1; i >= 0; i--) {
                const attr = n.attributes[i];
                if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:'))) {
                    n.removeAttribute(attr.name);
                }
            }
        });
        return div.innerHTML;
    }

    function clearAllToolLive() {
            Object.keys(toolCallMap).forEach(function(key) {
                const group = document.getElementById(toolCallMap[key]);
                const msg = group && group.querySelector('.message.tool');
                if (msg) {
                    msg.classList.remove('is-live');
                    const card = (msg._cardData && msg._cardData.card) || msg.querySelector('.tool-call-card');
                    if (card) {
                        card.classList.remove('is-live', 'is-analyzing', 'is-searching', 'is-reading', 'is-writing', 'is-executing', 'is-error');
                        // Any tool left in a live state at stream end has no further
                        // update coming — flip it to a terminal (complete) state so it
                        // doesn't stay stuck showing "Running...".
                        if (!card.classList.contains('is-complete') && !card.classList.contains('is-failed')) {
                            card.classList.add('is-complete');
                        }
                        const statusEl = msg._cardData ? msg._cardData.statusEl : card.querySelector('.tool-call-status');
                        if (statusEl) {
                            const isFailed = card.classList.contains('is-failed');
                            statusEl.className = 'tool-call-status ' + (isFailed ? 'is-failed' : 'is-complete');
                            statusEl.innerHTML = '<span class="status-dot"></span> ' + (isFailed ? 'Failed' : 'Done');
                        }
                    }
                }
            });
    }

    function setAuxMessageLive(group, live) {
        if (!group) return;
        const msg = group.querySelector('.message.thought, .message.tool');
        if (msg) msg.classList.toggle('is-live', live);
    }

    function finalizeAssistantBubble() {
        if (thoughtMsgId) {
            const thoughtGroup = document.getElementById(thoughtMsgId);
            setAuxMessageLive(thoughtGroup, false);
            finalizeAuxiliaryBubble(thoughtGroup);
            thoughtMsgId = null;
        }
        clearAllToolLive();
        if (streamingMessageId) {
            const group = document.getElementById(streamingMessageId);
            const el = group ? group.querySelector('.message') : null;
            if (el) {
                el.classList.remove('streaming');
                const text = el.querySelector('.content').textContent;
                if (group) group._rawText = text;
                el.querySelector('.content').innerHTML = renderMarkdown(text);
                setupContentBlocks(el.querySelector('.content'));
                processFileRefs(el.querySelector('.content'));
            }
            streamingMessageId = null;
        }
        if (chatSearchState.query) scheduleChatSearch();
    }

    function enableStopAfterAgentOutput() {
        if (!awaitingFirstChunk) {
            return;
        }
        awaitingFirstChunk = false;
        if (isPrompting) {
            setInputMode('stop');
        }
    }

    function finishStreaming() {
        finalizeAssistantBubble();
        if (isPrompting && awaitingFirstChunk) {
            setInputMode('waiting');
        } else {
            setInputMode(isPrompting ? 'stop' : (canSend ? 'send' : 'disabled'));
        }
    }

    function appendToInput(text) {
        if (!text) return;
        hideFilePicker();
        const val = inputEl.value;
        const needsSep = val.length > 0 && !/\n$/.test(val);
        inputEl.value = val + (needsSep ? '\n' : '') + text;
        if (!inputEl.disabled) {
            const pos = inputEl.value.length;
            inputEl.setSelectionRange(pos, pos);
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        }
    }

    function insertIntoInput(text) {
        if (!text) return;
        hideFilePicker();
        const val = inputEl.value;
        const start = typeof inputEl.selectionStart === 'number' ? inputEl.selectionStart : val.length;
        const end = typeof inputEl.selectionEnd === 'number' ? inputEl.selectionEnd : start;
        inputEl.value = val.slice(0, start) + text + val.slice(end);
        if (!inputEl.disabled) {
            const pos = start + text.length;
            inputEl.setSelectionRange(pos, pos);
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        }
    }

    function insertToEditor(text) {
        if (!text) return;
        vscode.postMessage({ type: 'insertEditor', text: text });
    }

    function closeInsertDropdowns(except) {
        document.querySelectorAll('.insert-dropdown.is-open').forEach(function(dropdown) {
            if (except && dropdown === except) return;
            dropdown.classList.remove('is-open');
        });
    }

    function createInsertDropdown(getText) {
        const dropdown = document.createElement('div');
        dropdown.className = 'insert-dropdown';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'block-btn insert-toggle';
        toggle.innerHTML = escapeHtml(locale.insertMenu || locale.insert) + CHEVRON_DOWN_SVG;
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = dropdown.classList.contains('is-open');
            closeInsertDropdowns();
            dropdown.classList.toggle('is-open', !open);
        });

        const menu = document.createElement('div');
        menu.className = 'insert-dropdown-menu';

        const inputBtn = document.createElement('button');
        inputBtn.type = 'button';
        inputBtn.textContent = locale.insertToInput;
        inputBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeInsertDropdowns();
            if (inputEl.disabled) return;
            appendToInput(getText());
        });

        const editorBtn = document.createElement('button');
        editorBtn.type = 'button';
        editorBtn.textContent = locale.insertToEditor;
        editorBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeInsertDropdowns();
            insertToEditor(getText());
        });

        menu.appendChild(inputBtn);
        menu.appendChild(editorBtn);
        dropdown.appendChild(toggle);
        dropdown.appendChild(menu);
        return dropdown;
    }

    function addBlockActions(container, getText) {
        if (container.querySelector('.block-actions')) return;
        const actions = document.createElement('div');
        actions.className = 'block-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'block-btn';
        copyBtn.title = locale.copy;
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            copyToClipboard(getText()).then(function() {
                copyBtn.classList.add('copied');
                copyBtn.title = locale.copied;
                setTimeout(function() {
                    copyBtn.classList.remove('copied');
                    copyBtn.title = locale.copy;
                }, 1500);
            });
        });

        actions.appendChild(copyBtn);
        actions.appendChild(createInsertDropdown(getText));
        container.appendChild(actions);
    }

    function tableToMarkdown(table) {
        const rows = [];
        table.querySelectorAll('tr').forEach(function(tr) {
            const cells = [];
            tr.querySelectorAll('th, td').forEach(function(cell) {
                cells.push((cell.textContent || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim());
            });
            if (cells.length) rows.push(cells);
        });
        if (!rows.length) return '';
        const widths = rows[0].map(function(_, index) {
            return Math.max.apply(null, rows.map(function(row) {
                return (row[index] || '').length;
            }));
        });
        const formatRow = function(row) {
            return '| ' + row.map(function(cell, index) {
                return (cell || '').padEnd(widths[index], ' ');
            }).join(' | ') + ' |';
        };
        const header = formatRow(rows[0]);
        const divider = '| ' + widths.map(function(width) {
            return '-'.repeat(Math.max(3, width));
        }).join(' | ') + ' |';
        const body = rows.slice(1).map(formatRow);
        return [header, divider].concat(body).join('\n');
    }

    function setupTableBlock(table) {
        if (!table || table.dataset.blockReady) return;
        table.dataset.blockReady = '1';
        const wrap = document.createElement('div');
        wrap.className = 'block-actions-wrap';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
        addBlockActions(wrap, function() {
            return tableToMarkdown(table);
        });
    }

    function setupCodeBlock(codeBlock) {
        const pre = codeBlock.closest('pre');
        if (!pre || pre.dataset.blockReady) return;
        pre.dataset.blockReady = '1';
        hljs.highlightElement(codeBlock);
        const lang = (codeBlock.className.match(/language-(\w+)/) || [])[1] || '';
        const wrap = document.createElement('div');
        wrap.className = 'block-actions-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        addBlockActions(wrap, function() {
            const code = codeBlock.textContent || '';
            if (!lang) return code;
            return '```' + lang + '\n' + code + '\n```';
        });
    }

    function setupContentBlocks(container) {
        if (!container) return;
        container.querySelectorAll('pre code').forEach(function(block) {
            setupCodeBlock(block);
        });
        container.querySelectorAll('table').forEach(function(table) {
            setupTableBlock(table);
        });
    }

    function hideFilePreview() {
        if (previewHideTimer) {
            clearTimeout(previewHideTimer);
            previewHideTimer = null;
        }
        if (previewTooltip) {
            previewTooltip.remove();
            previewTooltip = null;
        }
    }

    function showFilePreview(path, content, error, isImage, mimeType, data) {
        hideFilePreview();
        previewTooltip = document.createElement('div');
        previewTooltip.className = 'file-preview-tooltip';
        if (isImage && data) previewTooltip.className += ' fp-image-tip';
        const header = document.createElement('div');
        header.className = 'fp-header';
        header.textContent = path;
        previewTooltip.appendChild(header);
        if (error) {
            const err = document.createElement('div');
            err.className = 'fp-error';
            err.textContent = error;
            previewTooltip.appendChild(err);
        } else if (isImage && data) {
            const img = document.createElement('img');
            img.className = 'fp-image';
            img.src = 'data:' + (mimeType || 'image/png') + ';base64,' + data;
            img.alt = path;
            previewTooltip.appendChild(img);
        } else {
            const pre = document.createElement('pre');
            pre.textContent = content || locale.emptyFile;
            previewTooltip.appendChild(pre);
        }
        document.body.appendChild(previewTooltip);
    }

    function positionFilePreview(anchor) {
        if (!previewTooltip || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const tip = previewTooltip.getBoundingClientRect();
        let top = rect.bottom + 6;
        let left = rect.left;
        if (top + tip.height > window.innerHeight - 8) {
            top = rect.top - tip.height - 6;
        }
        if (left + tip.width > window.innerWidth - 8) {
            left = window.innerWidth - tip.width - 8;
        }
        previewTooltip.style.top = Math.max(8, top) + 'px';
        previewTooltip.style.left = Math.max(8, left) + 'px';
    }

    function attachFileRefPreview(link) {
        if (link.dataset.previewReady) return;
        link.dataset.previewReady = '1';
        let enterTimer = null;
        link.addEventListener('mouseenter', function () {
            enterTimer = setTimeout(function () {
                const filePath = link.dataset.path || link.textContent.replace(/^@/, '');
                const reqId = String(++previewRequestId);
                previewRequests.set(reqId, link);
                vscode.postMessage({ type: 'previewFile', path: filePath, requestId: reqId });
            }, 250);
        });
        link.addEventListener('mouseleave', function () {
            if (enterTimer) clearTimeout(enterTimer);
            previewHideTimer = setTimeout(hideFilePreview, 150);
        });
    }

    function processFileRefs(container) {
        if (!container) return;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.parentElement && node.parentElement.closest('pre, code, a.file-ref')) continue;
            const text = node.textContent || '';
            const refRegex = /@([\w./\\\-]+(?:\.[a-zA-Z0-9]+)?)/g;
            let match;
            let lastIdx = 0;
            const parts = [];
            while ((match = refRegex.exec(text)) !== null) {
                const before = text.slice(lastIdx, match.index);
                if (before) parts.push(document.createTextNode(before));
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'file-ref';
                link.textContent = match[0];
                link.title = locale.fileLinkTitle;
                link.dataset.path = match[1];
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    vscode.postMessage({ type: 'openFile', path: match[1] });
                });
                attachFileRefPreview(link);
                parts.push(link);
                lastIdx = match.index + match[0].length;
            }
            if (parts.length > 0) {
                const remaining = text.slice(lastIdx);
                if (remaining) parts.push(document.createTextNode(remaining));
                nodesToReplace.push({ node, parts });
            }
        }
        for (const { node, parts } of nodesToReplace) {
            const parent = node.parentNode;
            if (!parent) continue;
            const fragment = document.createDocumentFragment();
            parts.forEach(p => fragment.appendChild(p));
            parent.replaceChild(fragment, node);
        }
    }

    function hideFilePicker() {
        filePickerVisible = false;
        mentionStart = -1;
        filePickerItems = [];
        filePickerIndex = 0;
        filePickerEl.classList.remove('visible');
        filePickerEl.innerHTML = '';
    }

    function renderFilePickerItems(files) {
        filePickerItems = files || [];
        filePickerIndex = 0;
        filePickerEl.innerHTML = '';
        if (filePickerItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-picker-empty';
            empty.textContent = locale.noMatchingFiles;
            filePickerEl.appendChild(empty);
        } else {
            filePickerItems.forEach(function (filePath, idx) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'file-picker-item' + (idx === 0 ? ' active' : '');
                btn.textContent = '@' + filePath;
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    selectFileMention(filePath);
                });
                filePickerEl.appendChild(btn);
            });
        }
        filePickerEl.classList.add('visible');
        filePickerVisible = true;
    }

    function updateFilePickerHighlight() {
        filePickerEl.querySelectorAll('.file-picker-item').forEach(function (el, idx) {
            el.classList.toggle('active', idx === filePickerIndex);
            if (idx === filePickerIndex) {
                el.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function selectFileMention(filePath) {
        if (mentionStart < 0) return;
        const val = inputEl.value;
        const before = val.slice(0, mentionStart);
        const after = val.slice(inputEl.selectionStart);
        const insertion = '@' + filePath + ' ';
        inputEl.value = before + insertion + after;
        const cursor = before.length + insertion.length;
        inputEl.setSelectionRange(cursor, cursor);
        syncInputHeightFromContent();
        hideFilePicker();
        inputEl.focus();
    }

    function detectFileMention() {
        const val = inputEl.value;
        const pos = inputEl.selectionStart;
        const before = val.slice(0, pos);
        const match = before.match(/@([\w./\\\-]*)$/);
        if (!match) {
            hideFilePicker();
            return;
        }
        mentionStart = pos - match[0].length;
        const query = match[1] || '';
        if (fileListDebounce) clearTimeout(fileListDebounce);
        fileListDebounce = setTimeout(function () {
            const reqId = String(++fileListRequestId);
            filePickerEl.dataset.requestId = reqId;
            filePickerEl.innerHTML = '<div class="file-picker-empty">' + escapeHtml(locale.searchingFiles) + '</div>';
            filePickerEl.classList.add('visible');
            filePickerVisible = true;
            vscode.postMessage({ type: 'listFiles', query: query, requestId: reqId });
        }, 120);
    }

    function resetChatView() {
        cancelSessionMarkdownRender();
        clearChatSearch();
        exitMultiSelectMode();
        removeLocalHistoryDivider();
        forceHideContextAttachPicker();
        clearTodos();
        messagesEl.innerHTML = '<div class="placeholder" id="placeholder">' + escapeHtml(locale.readyPlaceholder) + '</div>';
        placeholder = document.getElementById('placeholder');
        streamingMessageId = null;
        thoughtMsgId = null;
        toolCallMap = {};
        sessionMsgCounter = 0;
        resetToolAggregation();
        pendingPermissions.clear();
        window._hermesRendered = false;
        updateQuickActionBtns();
        updateTokenUsage(0, 0);
        setInputMode(canSend ? 'send' : 'disabled');
    }

    function newChat() {
        resetChatView();
    }

    function clearChat() {
        resetChatView();
    }

    var _restoredTotalCount = 0;
    var _restoredScrollLoadMore = null;

    function restoreHistory(messages, totalCount, loadedCount, headerText) {
        cancelSessionMarkdownRender();
        streamingMessageId = null;
        thoughtMsgId = null;
        toolCallMap = {};
        sessionMsgCounter = 0;
        resetToolAggregation();
        pendingPermissions.clear();
        window._hermesRendered = false;
        exitMultiSelectMode();
        if (!messages || messages.length === 0) {
            return;
        }
        placeholder.style.display = 'none';
        removeLocalHistoryDivider();
        _restoredTotalCount = totalCount || messages.length;
        _restoredLoadedCount = loadedCount || messages.length;

        // Insert a header if provided (e.g. "Prior Session Loaded Successfully!")
        removeHermesHistoryHeader();
        if (headerText) {
            var header = document.createElement('div');
            header.className = 'hermes-history-header';
            header.id = HERMES_HISTORY_HEADER_ID;
            header.textContent = headerText;
            messagesEl.insertBefore(header, messagesEl.firstChild);
        }

        let cursor = 0;
        function appendRestoreBatch() {
            const end = Math.min(cursor + RESTORE_BATCH_SIZE, messages.length);
            for (; cursor < end; cursor++) {
                const m = messages[cursor];
                if (m.role === 'permission') {
                    restorePermissionMessage(m);
                } else {
                    addMessage(m.role, m.text, { restore: true, deferMarkdown: true });
                }
            }
            if (cursor < messages.length) {
                requestAnimationFrame(appendRestoreBatch);
                return;
            }
            updateQuickActionBtns();
            scheduleSessionMarkdownRender();
            // Wire scroll-to-top to load more history
            wireScrollToTopLoadMore();
        }
        requestAnimationFrame(appendRestoreBatch);
    }

    var HERMES_HISTORY_HEADER_ID = 'hermesHistoryHeader';
    function removeHermesHistoryHeader() {
        var el = document.getElementById(HERMES_HISTORY_HEADER_ID);
        if (el) el.remove();
    }

    function wireScrollToTopLoadMore() {
        if (_restoredScrollLoadMore) {
            messagesEl.removeEventListener('scroll', _restoredScrollLoadMore);
        }
        _restoredScrollLoadMore = function() {
            if (_restoredLoadedCount >= _restoredTotalCount) return;
            if (messagesEl.scrollTop <= 20) {
                vscode.postMessage({ type: 'loadMoreHistory', loadedCount: _restoredLoadedCount });
            }
        };
        messagesEl.addEventListener('scroll', _restoredScrollLoadMore, { passive: true });
    }

    function prependHistory(messages, totalCount, loadedCount) {
        _restoredTotalCount = totalCount || _restoredTotalCount;
        _restoredLoadedCount = loadedCount || _restoredLoadedCount;
        if (!messages || messages.length === 0) return;

        if (_restoredScrollLoadMore) {
            messagesEl.removeEventListener('scroll', _restoredScrollLoadMore);
        }

        var firstMsg = messagesEl.querySelector('.message-group');
        var rendered = 0;
        var pendingElements = [];

        function appendPrependBatch() {
            var end = Math.min(rendered + RESTORE_BATCH_SIZE, messages.length);
            for (; rendered < end; rendered++) {
                var m = messages[rendered];
                var el;
                if (m.role === 'permission') {
                    el = addMessage('permission', m.text, { restore: true, skipAppend: true });
                } else {
                    el = addMessage(m.role, m.text, { restore: true, deferMarkdown: true, skipAppend: true });
                }
                if (el) {
                    pendingElements.push(el);
                }
            }
            if (rendered < messages.length) {
                requestAnimationFrame(appendPrependBatch);
                return;
            }
            // Insert all pending elements at the top
            var fragment = document.createDocumentFragment();
            for (var i = 0; i < pendingElements.length; i++) {
                fragment.appendChild(pendingElements[i]);
            }
            if (firstMsg && firstMsg.parentNode) {
                messagesEl.insertBefore(fragment, firstMsg);
            } else {
                messagesEl.appendChild(fragment);
            }
            scheduleSessionMarkdownRender();
            wireScrollToTopLoadMore();
        }
        requestAnimationFrame(appendPrependBatch);
    }

    function sendMessage() {
        const text = inputEl.value.trim();
        if (!canSend) return;
        // Allow sending with an attached image or file even if the text box is empty.
        if (!text && pendingImages.length === 0 && pendingFiles.length === 0) return;

        executeSendMessage(text);
    }

    // Auto-resize + @file mention
    inputEl.addEventListener('input', function() {
        syncInputHeightFromContent();
        detectFileMention();
        renderSlashCommandPicker();
        updateQuickActionBtns();
    });

    // Enter to send, Shift+Enter for newline; file picker navigation
    inputEl.addEventListener('keydown', function(e) {
        if (slashCommandVisible && slashCommandItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                slashCommandIndex = (slashCommandIndex + 1) % slashCommandItems.length;
                updateSlashCommandHighlight();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                slashCommandIndex = (slashCommandIndex - 1 + slashCommandItems.length) % slashCommandItems.length;
                updateSlashCommandHighlight();
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                selectSlashCommand(slashCommandItems[slashCommandIndex]);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                selectSlashCommand(slashCommandItems[slashCommandIndex]);
                return;
            }
        }
        if (filePickerVisible && filePickerItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                filePickerIndex = (filePickerIndex + 1) % filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                filePickerIndex = (filePickerIndex - 1 + filePickerItems.length) % filePickerItems.length;
                updateFilePickerHighlight();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectFileMention(filePickerItems[filePickerIndex]);
                return;
            }
        }
        if (e.key === 'Escape' && filePickerVisible) {
            e.preventDefault();
            hideFilePicker();
            return;
        }
        if (e.key === 'Escape' && slashCommandVisible) {
            e.preventDefault();
            hideSlashCommandPicker();
            return;
        }
        if (e.key === 'Escape' && multiSelectMode) {
            e.preventDefault();
            exitMultiSelectMode();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    if (quickActionsTrigger) {
        quickActionsTrigger.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleQuickPanel();
        });
        quickActionsTrigger.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleQuickPanel();
            }
        });
    }

    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', scheduleChatSearch);
        chatSearchInput.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                gotoChatSearchMatch(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                gotoChatSearchMatch(1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) gotoChatSearchMatch(-1);
                else gotoChatSearchMatch(1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                clearChatSearch();
            }
        });
    }
    if (chatSearchPrev) {
        chatSearchPrev.addEventListener('click', function() { gotoChatSearchMatch(-1); });
    }
    if (chatSearchNext) {
        chatSearchNext.addEventListener('click', function() { gotoChatSearchMatch(1); });
    }

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', function() {
            if (clearChatBtn.disabled) return;
            vscode.postMessage({ type: 'clearChat' });
        });
    }

    if (multiSelectAllBtn) {
        multiSelectAllBtn.addEventListener('click', function() {
            if (!multiSelectMode) {
                enterMultiSelectMode(null, multiSelectPurpose);
            }
            const groups = getSelectableGroups();
            const selectAll = !areAllSelectableGroupsSelected(groups);
            setGroupsSelected(groups.map(function(group) {
                return { group: group, selected: selectAll };
            }));
        });
    }
    if (multiSelectDeleteBtn) {
        multiSelectDeleteBtn.addEventListener('click', function() {
            if (multiSelectDeleteBtn.disabled) return;
            deleteSelectedGroups();
        });
    }
    if (multiSelectCopyBtn) {
        multiSelectCopyBtn.addEventListener('click', function() {
            if (multiSelectCopyBtn.disabled) return;
            const indices = getSelectedMessageIndices();
            if (!indices.length) return;
            requestSessionExport('copy', indices);
        });
    }
    if (multiSelectExportBtn) {
        multiSelectExportBtn.addEventListener('click', function() {
            if (multiSelectExportBtn.disabled) return;
            exportSelectedGroups();
        });
    }
    if (multiSelectExitBtn) {
        multiSelectExitBtn.addEventListener('click', exitMultiSelectMode);
    }
    if (multiSelectAttachConfirmBtn) {
        multiSelectAttachConfirmBtn.addEventListener('click', function() {
            if (multiSelectAttachConfirmBtn.disabled) {
                return;
            }
            confirmContextAttachSelection();
        });
    }

    document.addEventListener('click', function(e) {
        if (!e.target.closest('.insert-dropdown')) {
            closeInsertDropdowns();
        }
        if (tabContextMenu && !e.target.closest('.tab-context-menu')) {
            hideTabContextMenu();
        }
        if (detectEnvDetailsOpen && !e.target.closest('.detect-env-bar')) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = document.getElementById('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && tabContextMenu && !tabContextMenu.hidden) {
            hideTabContextMenu();
        }
        if (e.key === 'Escape' && detectEnvDetailsOpen) {
            setDetectEnvDetailsOpen(false);
            const detectToggle = document.getElementById('detectEnvToggle');
            if (detectToggle) detectToggle.setAttribute('aria-expanded', 'false');
        }
        if (e.key === 'Escape' && configureEnvDetectDetailsOpen) {
            setConfigureEnvDetectDetailsOpen(false);
        }
        if (e.key === 'Escape' && configureEnvModal && configureEnvModal.classList.contains('is-open')) {
            closeConfigureEnvModal();
        }
    });

    const detectEnvToggle = document.getElementById('detectEnvToggle');
    if (detectEnvToggle) {
        detectEnvToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setDetectEnvDetailsOpen(!detectEnvDetailsOpen);
            detectEnvToggle.setAttribute('aria-expanded', detectEnvDetailsOpen ? 'true' : 'false');
        });
    }
    const detectEnvCloseBtn = document.getElementById('detectEnvClose');
    if (detectEnvCloseBtn) {
        detectEnvCloseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            hideDetectEnvironmentBar();
            vscode.postMessage({ type: 'detectEnvironmentDismiss' });
        });
    }

    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', function() {
            if (clearInputBtn.disabled) return;
            inputEl.value = '';
            pendingImages = [];
            pendingFiles = [];
            renderAttachPreview();
            syncInputHeightFromContent();
            updateQuickActionBtns();
            inputEl.focus();
        });
    }

    if (copySessionBtn) {
        copySessionBtn.addEventListener('click', function() {
            if (copySessionBtn.disabled) return;
            requestSessionExport('copy');
            flashQuickActionBtn(copySessionBtn);
        });
    }

    cancelBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'cancel' });
    });

    if (retryBtn) {
        retryBtn.addEventListener('click', doRetry);
    }
    if (configureEnvBrowseBtn) {
        configureEnvBrowseBtn.addEventListener('click', browseConfigureEnvPath);
    }
    if (configureEnvDetectBtn) {
        configureEnvDetectBtn.addEventListener('click', startConfigureEnvDetect);
    }
    if (configureEnvDetectClose) {
        configureEnvDetectClose.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeConfigureEnvDetectPanel();
        });
    }
    if (configureEnvPathClearBtn) {
        configureEnvPathClearBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            clearConfigureEnvPath();
        });
    }
    if (configureEnvPathInput) {
        configureEnvPathInput.addEventListener('input', function() {
            configureEnvSelectedPath = configureEnvPathInput.value.trim();
            updateConfigureEnvPathClearVisibility();
        });
    }
    if (configureEnvDetectToggle) {
        configureEnvDetectToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            setConfigureEnvDetectDetailsOpen(!configureEnvDetectDetailsOpen);
        });
    }
    if (configureEnvSaveBtn) {
        configureEnvSaveBtn.addEventListener('click', saveConfigureEnvPath);
    }
    if (configureEnvCancelBtn) {
        configureEnvCancelBtn.addEventListener('click', closeConfigureEnvModal);
    }
    if (configureEnvCloseBtn) {
        configureEnvCloseBtn.addEventListener('click', closeConfigureEnvModal);
    }
    if (configureEnvSystemBtn) {
        configureEnvSystemBtn.addEventListener('click', requestConfigureEnvSystemPath);
    }
    if (configureEnvModal) {
        configureEnvModal.addEventListener('click', function(e) {
            if (e.target === configureEnvModal) {
                closeConfigureEnvModal();
            }
        });
    }



    // About / Help / FAQ modals (opened from view title bar commands)
    const aboutModal = document.getElementById('aboutModal');
    const helpModal = document.getElementById('helpModal');
    const faqModal = document.getElementById('faqModal');
    const faqModalBody = document.getElementById('faqModalBody');
    const aboutContent = document.getElementById('aboutContent');
    let pluginInfo = {};

    function renderAboutContent() {
        const name = pluginInfo.displayName || 'FTR10 Hermes VSCode';
        const version = pluginInfo.version || '—';
        const publisher = pluginInfo.publisher || '';
        const repo = pluginInfo.repository || '';
        const iconUri = pluginInfo.iconUri || '';
        const logoHtml = iconUri
            ? '<div class="about-brand"><img src="' + escapeHtml(iconUri) + '" alt="' + escapeHtml(name) + '" /></div>'
            : '';
        aboutContent.innerHTML =
            logoHtml +
            '<h3>' + escapeHtml(name) + '</h3>' +
            '<p>' + locale.aboutVersion + ' <code>' + escapeHtml(version) + '</code>' +
            (publisher ? ' · ' + escapeHtml(publisher) : '') + '</p>' +
            '<p>' + locale.aboutDescription + '</p>' +
            '<ul>' +
            '<li>' + escapeHtml(locale.aboutFeatureTabs) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeaturePickers) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeatureInsert) + '</li>' +
            '<li>' + escapeHtml(locale.aboutFeatureTools) + '</li>' +
            '</ul>' +
            (repo ? '<p class="dim">' + escapeHtml(locale.repository) + '：<a href="#" data-url="' + escapeHtml(repo) + '">' + escapeHtml(repo) + '</a></p>' : '');
        aboutContent.querySelectorAll('a[data-url]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                vscode.postMessage({ type: 'openExternal', url: link.dataset.url });
            });
        });
    }

    function closeInfoModals() {
        hideModal(aboutModal);
        hideModal(helpModal);
        hideModal(faqModal);
    }

    document.querySelectorAll('.close-info-modal').forEach(function(btn) {
        btn.addEventListener('click', closeInfoModals);
    });
    aboutModal.addEventListener('click', function(e) {
        if (e.target === aboutModal) closeInfoModals();
    });
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) closeInfoModals();
    });
    faqModal.addEventListener('click', function(e) {
        if (e.target === faqModal) closeInfoModals();
    });
    if (faqModalBody) {
        faqModalBody.addEventListener('toggle', function(e) {
            const item = e.target;
            if (!item.classList || !item.classList.contains('faq-item') || !item.open) {
                return;
            }
            const list = item.closest('.faq-list');
            if (!list) {
                return;
            }
            list.querySelectorAll('.faq-item[open]').forEach(function(other) {
                if (other !== item) {
                    other.open = false;
                }
            });
        }, true);
        faqModalBody.addEventListener('click', function(e) {
            const link = e.target.closest('a[data-url]');
            if (!link) return;
            e.preventDefault();
            vscode.postMessage({ type: 'openExternal', url: link.dataset.url });
        });
    }

    // Pickers
    const tabBar = document.getElementById('tab-bar');
    const tabContextMenu = document.getElementById('tabContextMenu');
    let tabContextSessionId = null;
    const profilePicker = document.getElementById('profilePicker');
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const modelPicker = document.getElementById('modelPicker');
    const modelBtn = document.getElementById('modelBtn');
    const modelLabelEl = document.getElementById('modelLabel');
    const modelDropdown = document.getElementById('modelDropdown');
    const contextAttachPicker = document.getElementById('contextAttachPicker');
    const contextAttachBtn = document.getElementById('contextAttachBtn');
    const contextAttachLabel = document.getElementById('contextAttachLabel');
    const contextAttachDropdown = document.getElementById('contextAttachDropdown');
    const contextAttachList = document.getElementById('contextAttachList');
    const contextAttachHelp = document.getElementById('contextAttachHelp');
    const contextAttachHeaderLead = document.getElementById('contextAttachHeaderLead');
    const contextAttachHeaderRest = document.getElementById('contextAttachHeaderRest');
    const contextAttachTooltipEl = document.getElementById('contextAttachTooltip');
    const contextAttachPreviewEl = document.getElementById('contextAttachPreview');
    const contextAttachPreviewList = document.getElementById('contextAttachPreviewList');
    const contextAttachSendModal = document.getElementById('contextAttachSendModal');
    const switchSessionModal = document.getElementById('switchSessionModal');
    // Session picker helpers
    const sessionPickerModal = document.getElementById('sessionPickerModal');
    const sessionPickerList = document.getElementById('sessionPickerList');
    const sessionPickerEmpty = document.getElementById('sessionPickerEmpty');
    const sessionPickerTitle = document.getElementById('sessionPickerTitle');
    const sessionPickerSubtitle = document.getElementById('sessionPickerSubtitle');
    const sessionPickerRefreshBtn = document.getElementById('sessionPickerRefreshBtn');
    const sessionPickerNewBtn = document.getElementById('sessionPickerNewBtn');
    let hermesSessionList = [];

    let hermesLoadingInterval = null;
    const hermesLoadingEl = document.getElementById('hermesLoading');
    const hermesLoadingText = document.querySelector('.hermes-loading-text');

    function showHermesLoading(message) {
        if (hermesLoadingEl) {
            hermesLoadingEl.hidden = false;
            placeholder.style.display = 'block';
            placeholder.className = 'placeholder';
            if (hermesLoadingText) {
                hermesLoadingText.textContent = message || 'Connecting to Hermes';
            }
            // Animate dots with JS
            if (hermesLoadingInterval) clearInterval(hermesLoadingInterval);
            let dotCount = 0;
            hermesLoadingInterval = setInterval(function() {
                dotCount = (dotCount + 1) % 5;
                if (hermesLoadingText) {
                    var base = hermesLoadingText.textContent.replace(/\.\.\.\.?$/, '').trim();
                    hermesLoadingText.textContent = base + '.'.repeat(dotCount);
                }
            }, 500);
        }
    }

    function hideHermesLoading() {
        if (hermesLoadingEl) {
            hermesLoadingEl.hidden = true;
        }
        if (hermesLoadingInterval) {
            clearInterval(hermesLoadingInterval);
            hermesLoadingInterval = null;
        }
    }

    function showHermesSessionPicker(sessions) {
        hideHermesLoading();
        hermesSessionList = sessions || [];
        sessionPickerTitle.textContent = 'Welcome to Hermes';
        const count = hermesSessionList.length;
        sessionPickerSubtitle.textContent = count === 0
            ? 'No previous sessions found — start a new one'
            : count + (count === 1 ? ' session' : ' sessions') + ' available — select one to resume or start new';

        const list = sessionPickerList;
        list.textContent = '';

        if (!hermesSessionList || hermesSessionList.length === 0) {
            sessionPickerEmpty.hidden = false;
            sessionPickerEmpty.textContent = 'No previous sessions found — create a new one to get started.';
            sessionPickerEmpty.style.display = 'block';
        } else {
            sessionPickerEmpty.hidden = true;
            hermesSessionList.forEach(function(session) {
                const card = document.createElement('div');
                card.className = 'session-picker-card';
                card.dataset.sessionId = session.sessionId;

                const icon = document.createElement('span');
                icon.className = 'session-picker-card-icon';
                icon.textContent = '💬';

                const body = document.createElement('div');
                body.className = 'session-picker-card-body';

                const title = document.createElement('div');
                title.className = 'session-picker-card-title';
                title.textContent = session.title || 'Untitled';

                const meta = document.createElement('div');
                meta.className = 'session-picker-card-meta';
                const cwdLabel = session.cwd ? session.cwd.split('/').pop() || session.cwd : '';
                const timeLabel = session.updatedAt ? formatSessionTime(session.updatedAt) : '';
                meta.textContent = [cwdLabel, timeLabel].filter(Boolean).join(' \u00b7 ');

                const sid = document.createElement('span');
                sid.className = 'session-picker-card-id';
                sid.textContent = session.sessionId.slice(0, 8);

                body.appendChild(title);
                body.appendChild(meta);
                card.appendChild(icon);
                card.appendChild(body);
                card.appendChild(sid);

                card.addEventListener('click', function() {
                    vscode.postMessage({ type: 'pickSession', sessionId: session.sessionId });
                    hideHermesSessionPicker();
                });

                list.appendChild(card);
            });
        }

        sessionPickerModal.hidden = false;
    }

    function hideHermesSessionPicker() {
        sessionPickerModal.hidden = true;
    }

    function formatSessionTime(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return '';
            const hours = d.getHours().toString().padStart(2, '0');
            const mins = d.getMinutes().toString().padStart(2, '0');
            return hours + ':' + mins;
        } catch { return ''; }
    }

    if (sessionPickerNewBtn) {
        sessionPickerNewBtn.textContent = '\u2795 New Session';
        sessionPickerNewBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'pickSession', action: 'new' });
            hideHermesSessionPicker();
        });
    }

    if (sessionPickerRefreshBtn) {
        sessionPickerRefreshBtn.textContent = 'Refresh';
        sessionPickerRefreshBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'refreshSessions' });
        });
    }

    function closeAllDropdowns() {
        if (profilePicker) profilePicker.classList.remove('is-open');
        modelPicker.classList.remove('is-open');
        if (contextAttachPicker) contextAttachPicker.classList.remove('is-open');
        if (permissionModePickerEl) permissionModePickerEl.classList.remove('is-open');
        if (inputQuickPanel) setQuickPanelOpen(false);
        if (profileDropdown) profileDropdown.style.display = 'none';
        modelDropdown.style.display = 'none';
        if (contextAttachDropdown) contextAttachDropdown.style.display = 'none';
        if (permissionModeDropdownEl) permissionModeDropdownEl.style.display = 'none';
        hideContextAttachTooltip();
        hideContextAttachPreview();
    }

    document.addEventListener('click', function(e) {
        if (e.target.closest('.picker')) {
            return;
        }
        if (e.target.closest('#contextAttachPreview')) {
            return;
        }
        if (!e.target.closest('#input-area')) {
            hideFilePicker();
        }
        closeAllDropdowns();
    });

    if (profileBtn) {
        profileBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = profileDropdown.style.display === 'none';
            closeAllDropdowns();
            if (open) {
                profilePicker.classList.add('is-open');
                profileDropdown.style.display = 'block';
                vscode.postMessage({ type: 'getProfiles' });
            }
        });
    }
    if (profileDropdown) {
        profileDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    modelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const open = modelDropdown.style.display === 'none';
        closeAllDropdowns();
        if (open) {
            modelPicker.classList.add('is-open');
            modelDropdown.style.display = 'block';
            vscode.postMessage({ type: 'getModels' });
        }
    });
    modelDropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    if (contextAttachBtn && contextAttachDropdown) {
        contextAttachBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = contextAttachDropdown.style.display === 'none';
            closeAllDropdowns();
            if (open) {
                contextAttachPicker.classList.add('is-open');
                contextAttachDropdown.style.display = 'block';
                renderContextAttachOptions();
            }
        });
        contextAttachDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    // Permission mode picker
    const permissionModePickerEl = document.getElementById('permissionModePicker');
    const permissionModeBtnEl = document.getElementById('permissionModeBtn');
    const permissionModeIconEl = document.getElementById('permissionModeIcon');
    const permissionModeDropdownEl = document.getElementById('permissionModeDropdown');
    const permissionModeListEl = document.getElementById('permissionModeList');
    const permissionModes = [
        { id: 'manual', label: 'Manual', hint: 'Ask every time' },
        { id: 'autoApprove', label: 'Auto Approve', hint: 'Approve all safe actions' },
        { id: 'yolo', label: 'Yolo', hint: 'Approve everything' },
        { id: 'denyAll', label: 'Deny All', hint: 'Reject all' },
    ];

    function updatePermissionModeUI() {
        const mode = permissionModes.find(function(m) { return m.id === permissionMode; });
        if (permissionModeBtnEl && mode) {
            const label = mode.label;
            const hint = mode.hint || '';
            permissionModeBtnEl.setAttribute('title', label + (hint ? ' — ' + hint : ''));
            permissionModeBtnEl.setAttribute('aria-label', label);
        }
        if (permissionModeIconEl) {
            const mediaBase = (typeof FTR10_MEDIA_URI === 'string' && FTR10_MEDIA_URI) ? FTR10_MEDIA_URI.replace(/\/$/, '') + '/' : '';
            if (permissionMode === 'yolo') {
                permissionModeIconEl.src = mediaBase + 'accelerate-svgrepo-com.svg';
                permissionModeIconEl.style.transform = '';
            } else if (permissionMode === 'autoApprove') {
                permissionModeIconEl.src = mediaBase + 'thumbs-up-svgrepo-com.svg';
                permissionModeIconEl.style.transform = '';
            } else if (permissionMode === 'denyAll') {
                permissionModeIconEl.src = mediaBase + 'thumbs-up-svgrepo-com.svg';
                permissionModeIconEl.style.transform = 'rotate(180deg)';
            } else {
                permissionModeIconEl.src = mediaBase + 'shield-svgrepo-com.svg';
                permissionModeIconEl.style.transform = '';
            }
        }
        if (permissionModePickerEl) {
            permissionModePickerEl.classList.remove('mode-manual', 'mode-autoApprove', 'mode-yolo', 'mode-denyAll');
            permissionModePickerEl.classList.add('mode-' + permissionMode);
        }
        if (permissionModeListEl) {
            permissionModeListEl.querySelectorAll('.permission-mode-option').forEach(function(el) {
                el.classList.toggle('is-active', el.dataset.mode === permissionMode);
            });
        }
    }

    function renderPermissionModeOptions() {
        if (!permissionModeListEl) return;
        permissionModeListEl.innerHTML = '';
        permissionModes.forEach(function(mode) {
            const item = document.createElement('div');
            item.className = 'permission-mode-option' + (mode.id === permissionMode ? ' is-active' : '');
            item.dataset.mode = mode.id;
            item.innerHTML = '<span class="mode-check">✓</span><span class="mode-label">' + mode.label + '</span><span class="mode-hint">' + mode.hint + '</span>';
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                permissionMode = mode.id;
                updatePermissionModeUI();
                closeAllDropdowns();
                vscode.postMessage({ type: 'permissionModeChange', mode: permissionMode });
            });
            permissionModeListEl.appendChild(item);
        });
    }

    if (permissionModeBtnEl && permissionModeDropdownEl) {
        permissionModeBtnEl.addEventListener('click', function(e) {
            e.stopPropagation();
            const open = permissionModeDropdownEl.style.display === 'none';
            closeAllDropdowns();
            if (open) {
                permissionModePickerEl.classList.add('is-open');
                permissionModeDropdownEl.style.display = 'block';
                renderPermissionModeOptions();
                positionPermissionDropdown();
            }
        });
        permissionModeDropdownEl.addEventListener('click', function(e) { e.stopPropagation(); });
    }

    function positionPermissionDropdown() {
        if (!permissionModeDropdownEl || !permissionModeBtnEl) return;
        const rect = permissionModeBtnEl.getBoundingClientRect();
        const dropW = permissionModeDropdownEl.offsetWidth || 220;
        const dropH = permissionModeDropdownEl.offsetHeight || 200;
        const margin = 6;
        let left = rect.right - dropW;
        if (left < margin) left = margin;
        if (left + dropW > window.innerWidth - margin) left = window.innerWidth - dropW - margin;
        let top = rect.bottom + margin;
        if (top + dropH > window.innerHeight - margin) {
            const above = rect.top - dropH - margin;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - dropH - margin);
        }
        permissionModeDropdownEl.style.position = 'fixed';
        permissionModeDropdownEl.style.left = left + 'px';
        permissionModeDropdownEl.style.top = top + 'px';
        permissionModeDropdownEl.style.bottom = 'auto';
        permissionModeDropdownEl.style.right = 'auto';
        permissionModeDropdownEl.style.zIndex = '1000';
    }

    window.addEventListener('resize', function() {
        if (permissionModeDropdownEl && permissionModeDropdownEl.style.display !== 'none') {
            positionPermissionDropdown();
        }
    });
    updatePermissionModeUI();

    const switchSessionStayBtn = document.getElementById('switchSessionStayBtn');
    const switchSessionConfirmBtn = document.getElementById('switchSessionConfirmBtn');
    if (switchSessionStayBtn) {
        switchSessionStayBtn.addEventListener('click', closeSwitchSessionModal);
    }
    if (switchSessionConfirmBtn) {
        switchSessionConfirmBtn.addEventListener('click', function() {
            if (!pendingSwitchSessionId) {
                closeSwitchSessionModal();
                return;
            }
            const sessionId = pendingSwitchSessionId;
            closeSwitchSessionModal();
            vscode.postMessage({ type: 'switchSession', sessionId: sessionId, interrupt: true });
        });
    }
    if (switchSessionModal) {
        switchSessionModal.addEventListener('click', function(e) {
            if (e.target === switchSessionModal) {
                closeSwitchSessionModal();
            }
        });
    }
    bindContextAttachTooltip();
    bindContextAttachPreview();
    const contextAttachSendYesBtn = document.getElementById('contextAttachSendYesBtn');
    const contextAttachSendNoBtn = document.getElementById('contextAttachSendNoBtn');
    if (contextAttachSendYesBtn) {
        contextAttachSendYesBtn.addEventListener('click', function() {
            const text = pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            finalizeContextAttachSelectionFromPending();
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(false));
        });
    }
    if (contextAttachSendNoBtn) {
        contextAttachSendNoBtn.addEventListener('click', function() {
            const text = pendingSendText;
            if (!text) {
                closeContextAttachSendModal();
                return;
            }
            contextAttachUnconfirmedIndices = [];
            contextAttachCustomPending = false;
            if (contextAttachMode === 'custom' && !contextAttachCustomConfirmed) {
                contextAttachMode = 'none';
            }
            closeContextAttachSendModal();
            executeSendMessage(text, buildContextAttachPayload(true));
        });
    }
    if (contextAttachSendModal) {
        contextAttachSendModal.addEventListener('click', function(e) {
            if (e.target === contextAttachSendModal) {
                closeContextAttachSendModal();
            }
        });
    }

    function renderProfileList(profiles) {
        const list = document.getElementById('profileList');
        const profileLabelEl = document.getElementById('profileLabel');
        const current = profileLabelEl ? profileLabelEl.textContent : '';
        if (!list) return;
        const entries = (profiles || []).map(function(item) {
            if (item && typeof item === 'object' && item.id) {
                return { id: String(item.id), label: String(item.label || item.id) };
            }
            const name = String(item || '');
            return { id: name, label: name };
        });
        if (!entries.length) {
            list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.configureAgents) + '</div>';
            return;
        }
        list.innerHTML = entries.map(function(entry) {
            const active = entry.label === current ? ' active' : '';
            return '<div class="dropdown-item' + active + '" data-profile="' + escapeHtml(entry.id) + '">' +
                escapeHtml(entry.label) + (active ? ' ✓' : '') + '</div>';
        }).join('');
        list.querySelectorAll('.dropdown-item[data-profile]').forEach(function(item) {
            item.addEventListener('click', function() {
                vscode.postMessage({ type: 'switchAgent', agentName: this.dataset.profile });
                closeAllDropdowns();
            });
        });
    }

    let modelConfigId = '';
    let lastModelPayload = null;

    function shouldShowModelPlaceholder(payload) {
        if (!payload) {
            return true;
        }
        const models = payload.models || [];
        if (!models.length) {
            return true;
        }
        if (!payload.currentValueId) {
            return true;
        }
        return !models.some(function(m) {
            return m.valueId === payload.currentValueId;
        });
    }

    function updateModelButtonDisplay(payload) {
        if (!modelLabelEl || !modelBtn) {
            return;
        }
        if (shouldShowModelPlaceholder(payload)) {
            modelLabelEl.textContent = locale.modelPlaceholder || '';
            modelBtn.classList.add('is-placeholder');
            modelBtn.title = locale.modelPlaceholder || locale.switchModel || '';
            return;
        }
        modelLabelEl.textContent = payload.currentLabel || payload.currentValueId || '';
        modelBtn.classList.remove('is-placeholder');
        modelBtn.title = locale.modelFromAgent;
    }

    function renderModelList(payload) {
        const list = document.getElementById('modelList');
        lastModelPayload = payload;
        modelConfigId = payload.configId || '';
        updateModelButtonDisplay(payload);

        const groups = Array.isArray(payload.groups) ? payload.groups.filter(function(g) {
            return g && Array.isArray(g.models) && g.models.length > 0;
        }) : [];
        const models = payload.models || [];

        if (!models.length) {
            list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.noModels) + '</div>';
            document.getElementById('modelSearchWrap').hidden = true;
            return;
        }

        // Show search when there are enough items
        var searchWrap = document.getElementById('modelSearchWrap');
        var searchInput = document.getElementById('modelSearchInput');
        if (models.length >= 8) {
            searchWrap.hidden = false;
            searchInput.placeholder = locale.searchModels || 'Filter models...';
        } else {
            searchWrap.hidden = true;
        }

        function renderFiltered(filterText) {
            var q = (filterText || '').toLowerCase().trim();
            var hasFilter = q.length > 0;

            if (hasFilter && groups.length > 1) {
                // Filter models within each group
                var filteredGroups = groups.map(function(g) {
                    var filteredModels = g.models.filter(function(m) {
                        return (m.name || '').toLowerCase().indexOf(q) !== -1
                            || (m.valueId || '').toLowerCase().indexOf(q) !== -1
                            || (g.name || g.slug || '').toLowerCase().indexOf(q) !== -1;
                    });
                    return { group: g, models: filteredModels };
                }).filter(function(entry) {
                    return entry.models.length > 0;
                });

                if (!filteredGroups.length) {
                    list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.noModels) + '</div>';
                    return;
                }

                list.innerHTML = filteredGroups.map(function(entry) {
                    var header = '<div class="dropdown-group-label">' + escapeHtml(entry.group.name || entry.group.slug || '') + '</div>';
                    var items = entry.models.map(renderModelItem).join('');
                    return header + items;
                }).join('');
            } else if (hasFilter) {
                // Single group or flat list — filter flat
                var flatFiltered = models.filter(function(m) {
                    var groupName = '';
                    if (groups.length === 1) {
                        groupName = groups[0].name || groups[0].slug || '';
                    }
                    return (m.name || '').toLowerCase().indexOf(q) !== -1
                        || (m.valueId || '').toLowerCase().indexOf(q) !== -1
                        || groupName.toLowerCase().indexOf(q) !== -1;
                });
                if (!flatFiltered.length) {
                    list.innerHTML = '<div class="dropdown-item disabled">' + escapeHtml(locale.noModels) + '</div>';
                    return;
                }
                list.innerHTML = flatFiltered.map(renderModelItem).join('');
            } else if (groups.length > 1) {
                // No filter, multiple groups
                list.innerHTML = groups.map(function(group) {
                    var header = '<div class="dropdown-group-label">' + escapeHtml(group.name || group.slug || '') + '</div>';
                    var items = group.models.map(renderModelItem).join('');
                    return header + items;
                }).join('');
            } else {
                // No filter, single group or flat
                list.innerHTML = models.map(renderModelItem).join('');
            }

            list.querySelectorAll('.dropdown-item[data-value]').forEach(function(item) {
                item.addEventListener('click', function() {
                    vscode.postMessage({
                        type: 'switchModel',
                        configId: modelConfigId,
                        valueId: this.dataset.value
                    });
                    closeAllDropdowns();
                });
            });
        }

        function renderModelItem(m) {
            var active = m.valueId === payload.currentValueId;
            var costHtml = '';
            if (m.outputCost !== undefined && m.outputCost !== null) {
                costHtml = '<span class="model-cost">' + formatCost(m.outputCost) + '</span>';
            }
            return '<div class="dropdown-item' + (active ? ' active' : '') + '" data-value="' + escapeHtml(m.valueId) + '">' +
                '<span class="model-name">' + escapeHtml(m.name) + '</span>' +
                costHtml +
                (active ? '<span class="model-check">✓</span>' : '') +
                '</div>';
        }

        // Initial render
        renderFiltered('');

        // Bind search input
        searchInput.oninput = function() {
            renderFiltered(this.value);
        };
    }

    function formatCost(costPer1M) {
        if (costPer1M === undefined || costPer1M === null) return '';
        if (costPer1M === 0) return '<span class="model-cost-free">Free</span>';
        if (costPer1M < 0.001) return '<span class="model-cost-free">≈Free</span>';
        if (costPer1M >= 1000) return '$' + (costPer1M / 1000).toFixed(1) + 'K/M';
        if (costPer1M >= 1) return '$' + Math.round(costPer1M) + '/M';
        // Sub-dollar: show cents
        return '$' + (costPer1M).toFixed(2) + '/M';
    }

    function escapeHtml(s) {
        return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    let editingSessionId = null;

    function startTabRename(tab, sessionId) {
        if (!tab || tab.classList.contains('editing')) {
            return;
        }
        tab.classList.add('editing');
        tab.draggable = false;
        editingSessionId = sessionId;
        const titleEl = tab.querySelector('.tab-title');
        if (!titleEl) {
            return;
        }
        const previousTitle = titleEl.textContent || locale.newChat;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-title-input';
        input.value = previousTitle;
        input.maxLength = 80;
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        function finish(commit) {
            if (finished) {
                return;
            }
            finished = true;
            editingSessionId = null;
            tab.classList.remove('editing');
            const newTitle = input.value.trim() || locale.newChat;
            const span = document.createElement('span');
            span.className = 'tab-title';
            span.textContent = commit ? newTitle : previousTitle;
            input.replaceWith(span);
            tab.draggable = true;
            if (commit) {
                vscode.postMessage({ type: 'renameSession', sessionId: sessionId, title: newTitle });
            }
        }

        input.addEventListener('keydown', function(e) {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', function() {
            finish(true);
        });
        input.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    function reorderSessionTabs(fromId, toId) {
        if (!fromId || !toId || fromId === toId || !lastSessions.length) {
            return;
        }
        const fromSession = lastSessions.find(function(s) { return s.id === fromId; });
        const toSession = lastSessions.find(function(s) { return s.id === toId; });
        if (!fromSession || !toSession) {
            return;
        }
        if (!!fromSession.pinned !== !!toSession.pinned) {
            return;
        }
        const ids = lastSessions.map(function(s) { return s.id; });
        const fromIdx = ids.indexOf(fromId);
        const toIdx = ids.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0) {
            return;
        }
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, fromId);
        const byId = {};
        lastSessions.forEach(function(s) { byId[s.id] = s; });
        lastSessions = ids.map(function(id) { return byId[id]; }).filter(Boolean);
        renderSessionTabs(lastSessions, lastActiveSessionId);
        vscode.postMessage({ type: 'reorderSessions', sessionIds: ids });
    }

    function hideTabContextMenu() {
        tabContextSessionId = null;
        if (tabContextMenu) {
            tabContextMenu.hidden = true;
            tabContextMenu.innerHTML = '';
        }
    }

    function positionTabContextMenu(x, y) {
        if (!tabContextMenu) return;
        tabContextMenu.hidden = false;
        tabContextMenu.style.left = '0px';
        tabContextMenu.style.top = '0px';
        const rect = tabContextMenu.getBoundingClientRect();
        const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        tabContextMenu.style.left = Math.min(x, maxLeft) + 'px';
        tabContextMenu.style.top = Math.min(y, maxTop) + 'px';
    }

    function downloadSessionMarkdown(markdown, filename) {
        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'chat-export.md';
        link.click();
        URL.revokeObjectURL(url);
    }

    function showTabContextMenu(sessionId, clientX, clientY) {
        const session = lastSessions.find(function(s) { return s.id === sessionId; });
        if (!session || !tabContextMenu) {
            return;
        }
        tabContextSessionId = sessionId;
        const idx = lastSessions.findIndex(function(s) { return s.id === sessionId; });
        const canCloseLeft = idx > 0;
        const canCloseRight = idx >= 0 && idx < lastSessions.length - 1;
        const canCloseOthers = lastSessions.length > 1;
        const pinLabel = session.pinned ? locale.tabContextUnpin : locale.tabContextPin;

        tabContextMenu.innerHTML =
            '<div class="tab-ctx-sid">' +
                '<span class="tab-ctx-sid-label">' + escapeHtml(locale.tabContextSid) + ':</span>' +
                '<span class="tab-ctx-sid-value" title="' + escapeHtml(sessionId) + '">' + escapeHtml(sessionId) + '</span>' +
                '<button type="button" class="tab-ctx-sid-copy" data-action="copySid" title="' + escapeHtml(locale.copySid) + '">' + COPY_ICON_SVG + '</button>' +
            '</div>' +
            '<button type="button" class="tab-ctx-item" data-action="export">' + escapeHtml(locale.tabContextExport) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="copy">' + escapeHtml(locale.tabContextCopy) + '</button>' +
            '<div class="tab-ctx-divider"></div>' +
            '<button type="button" class="tab-ctx-item" data-action="rename">' + escapeHtml(locale.tabContextRename) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="close">' + escapeHtml(locale.tabContextClose) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeOthers"' + (canCloseOthers ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseOthers) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeLeft"' + (canCloseLeft ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseLeft) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeRight"' + (canCloseRight ? '' : ' disabled') + '>' + escapeHtml(locale.tabContextCloseRight) + '</button>' +
            '<button type="button" class="tab-ctx-item" data-action="closeAll">' + escapeHtml(locale.tabContextCloseAll) + '</button>' +
            '<div class="tab-ctx-divider"></div>' +
            '<button type="button" class="tab-ctx-item" data-action="togglePin">' + escapeHtml(pinLabel) + '</button>';

        tabContextMenu.querySelector('[data-action="copySid"]').addEventListener('click', function(e) {
            e.stopPropagation();
            copyToClipboard(sessionId);
        });
        tabContextMenu.querySelectorAll('.tab-ctx-item[data-action]').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                if (item.disabled || !tabContextSessionId) return;
                const action = item.dataset.action;
                const targetId = tabContextSessionId;
                hideTabContextMenu();
                if (action === 'export') {
                    requestSessionExport('export', undefined, targetId);
                } else if (action === 'copy') {
                    requestSessionExport('copy', undefined, targetId);
                } else if (action === 'rename') {
                    const tab = tabBar.querySelector('.session-tab[data-id="' + targetId + '"]');
                    if (tab) startTabRename(tab, targetId);
                } else if (action === 'togglePin') {
                    vscode.postMessage({ type: 'togglePinSession', sessionId: targetId });
                } else if (action === 'close' || action === 'closeOthers' || action === 'closeLeft' || action === 'closeRight' || action === 'closeAll') {
                    const mode = action === 'close' ? 'self'
                        : action === 'closeOthers' ? 'others'
                        : action === 'closeLeft' ? 'left'
                        : action === 'closeRight' ? 'right'
                        : 'all';
                    vscode.postMessage({ type: 'closeSessions', sessionId: targetId, mode: mode });
                }
            });
        });

        positionTabContextMenu(clientX, clientY);
    }

    function wireTabDragDrop(tab) {
        tab.draggable = true;
        tab.addEventListener('dragstart', function(e) {
            if (tab.classList.contains('editing')) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.dataset.id || '');
            tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', function() {
            tab.classList.remove('dragging');
            tabBar.querySelectorAll('.session-tab').forEach(function(t) {
                t.classList.remove('drag-over');
            });
        });
        tab.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tab.classList.add('drag-over');
        });
        tab.addEventListener('dragleave', function() {
            tab.classList.remove('drag-over');
        });
        tab.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            tab.classList.remove('drag-over');
            const fromId = e.dataTransfer.getData('text/plain');
            reorderSessionTabs(fromId, tab.dataset.id);
        });
        tab.addEventListener('mousedown', function(e) {
            tab.draggable = !(e.target && e.target.closest && e.target.closest('.tab-close'));
        });
    }

    function renderSessionTabs(sessions, activeId) {
        // Session tabs were removed in favor of the Hermes session picker
        // (opened via the view-bar "Open Session Menu" icon). Keep the
        // bookkeeping fields current but never render the tab bar.
        activeSessionId = activeId || activeSessionId;
        lastSessions = sessions || [];
        lastActiveSessionId = activeSessionId;
        if (tabBar) {
            tabBar.innerHTML = '';
        }
        return;
        // --- legacy tab rendering retained below but never reached ---
        if (editingSessionId) {
            return;
        }
        if (!sessions || sessions.length === 0) {
            tabBar.innerHTML = '';
            return;
        }
        const parts = [];
        sessions.forEach(function(s, index) {
            const active = s.id === activeSessionId ? ' active' : '';
            const pinnedClass = s.pinned ? ' pinned' : '';
            const title = escapeHtml(s.title || locale.newChat);
            const pinIcon = s.pinned
                ? '<span class="tab-pin-icon" title="' + escapeHtml(locale.tabContextPin) + '">' + TAB_PIN_SVG + '</span>'
                : '';
            parts.push('<div class="session-tab' + active + pinnedClass + '" data-id="' + escapeHtml(s.id) + '" title="' + title + '">' +
                pinIcon +
                '<span class="tab-title">' + title + '</span>' +
                '<span class="tab-close" data-id="' + escapeHtml(s.id) + '" title="' + escapeHtml(locale.tabClose) + '">×</span>' +
                '</div>');
            if (s.pinned && index < sessions.length - 1 && !sessions[index + 1].pinned) {
                parts.push('<span class="tab-pin-separator" aria-hidden="true"></span>');
            }
        });
        tabBar.innerHTML = parts.join('');

        tabBar.querySelectorAll('.session-tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                if (e.target && e.target.closest && e.target.closest('.tab-close')) {
                    return;
                }
                if (tab.classList.contains('editing')) {
                    return;
                }
                if (tab.dataset.id !== activeSessionId) {
                    requestSwitchSession(tab.dataset.id);
                }
            });
            tab.addEventListener('dblclick', function(e) {
                if (e.target && e.target.closest && e.target.closest('.tab-close')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                startTabRename(tab, tab.dataset.id);
            });
            tab.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                e.stopPropagation();
                showTabContextMenu(tab.dataset.id, e.clientX, e.clientY);
            });
            wireTabDragDrop(tab);
        });
        tabBar.querySelectorAll('.tab-close').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ type: 'deleteSession', sessionId: btn.dataset.id });
            });
        });

        const activeTab = tabBar.querySelector('.session-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function updateSessionHeader() {
        const nameEl = document.getElementById('sessionHeaderName');
        const idxEl = document.getElementById('sessionHeaderIdx');
        const headerEl = document.getElementById('sessionHeader');
        if (!nameEl || !idxEl) return;
        const session = lastSessions.find(function(s) { return s.id === lastActiveSessionId; });
        const title = session && (session.title || locale.newChat) ? (session.title || locale.newChat) : locale.newChat;
        nameEl.textContent = title;
        nameEl.title = title;
        const idx = lastSessions.findIndex(function(s) { return s.id === lastActiveSessionId; });
        if (idx >= 0 && lastSessions.length > 0) {
            idxEl.textContent = '#' + (idx + 1);
            idxEl.title = (idx + 1) + ' / ' + lastSessions.length;
            idxEl.hidden = false;
        } else {
            idxEl.textContent = '';
            idxEl.hidden = true;
        }
        if (headerEl) headerEl.hidden = false;
    }

    function showPermissionRequest(msg) {
        finalizeAssistantBubble();
        placeholder.style.display = 'none';
        enableStopAfterAgentOutput();
        const id = msg.id;
        if (!id) {
            return;
        }
        if (pendingPermissions.has(id)) {
            updatePermissionContent(pendingPermissions.get(id), msg.title, msg.detail);
            return;
        }
        const group = createPermissionCard(id, msg);
        messagesEl.appendChild(group);
        pendingPermissions.set(id, group);
        maybeScrollToBottom();

        // Auto-resolve based on permission mode.
        // yolo  => approve everything, no exceptions.
        // autoApprove => approve everything EXCEPT destructive actions
        //                (e.g. rm -rf on the wrong dir, overwriting the wrong
        //                file), which are left to the user to confirm.
        // denyAll => reject everything.
        const msgText = ((msg.title || '') + ' ' + (msg.detail || '')).toLowerCase();
        const isDestructive = /rm\s+-rf|rm\s+-fr|del\s+\/|format\s|mkfs|>\s*\/dev\/|truncate|overwrite|force\s+write|shred|dd\s+if=|:\s*!\s*$/i.test(msgText)
            || /\b(rm|del|delete|remove)\b[\s\S]{0,80}?(all|everything|\*|\/|\.\.\/|home|system)/i.test(msgText);

        if (permissionMode === 'yolo') {
            const options = msg.options || [];
            const allowAlways = options.find(function(o) { return o.kind === 'allow_always'; });
            const allowOnce = options.find(function(o) { return o.kind === 'allow_once'; });
            const chosenOpt = allowAlways || allowOnce || options[0];
            if (chosenOpt) {
                const label = chosenOpt.name || chosenOpt.optionId;
                applyPermissionResolvedUI(group, (localeText('permissionSelected', label)) + ' (yolo)');
                collapseAutoPermission(group);
                pendingPermissions.delete(id);
                vscode.postMessage({ type: 'permissionResponse', id: id, optionId: chosenOpt.optionId });
            }
        } else if (permissionMode === 'autoApprove') {
            if (isDestructive) {
                // Leave destructive actions for the user to confirm manually.
                applyPermissionResolvedUI(group, localeText('permissionDestructiveHold') || 'Destructive action — needs approval');
            } else {
                const options = msg.options || [];
                // Prefer allow_always, then allow_once, then first option
                const allowAlways = options.find(function(o) { return o.kind === 'allow_always'; });
                const allowOnce = options.find(function(o) { return o.kind === 'allow_once'; });
                const chosenOpt = allowAlways || allowOnce || options[0];
                if (chosenOpt) {
                    const label = chosenOpt.name || chosenOpt.optionId;
                    applyPermissionResolvedUI(group, (localeText('permissionSelected', label)) + ' (auto)');
                    // Auto-approved: collapse the card so only the status indicator shows.
                    collapseAutoPermission(group);
                    pendingPermissions.delete(id);
                    vscode.postMessage({ type: 'permissionResponse', id: id, optionId: chosenOpt.optionId });
                }
            }
        } else if (permissionMode === 'denyAll') {
            const options = msg.options || [];
            const rejectAlways = options.find(function(o) { return o.kind === 'reject_always'; });
            const rejectOnce = options.find(function(o) { return o.kind === 'reject_once'; });
            // Deny by finding a reject option or just cancelling
            if (rejectAlways || rejectOnce) {
                const chosenOpt = rejectAlways || rejectOnce;
                const label = chosenOpt.name || chosenOpt.optionId;
                applyPermissionResolvedUI(group, (localeText('permissionSelected', label)) + ' (auto)');
                collapseAutoPermission(group);
                pendingPermissions.delete(id);
                vscode.postMessage({ type: 'permissionResponse', id: id, optionId: chosenOpt.optionId });
            } else {
                // No reject option — cancel
                pendingPermissions.delete(id);
                applyPermissionResolvedUI(group, (locale.permissionCancelled || 'Cancelled') + ' (auto)');
                collapseAutoPermission(group);
                vscode.postMessage({ type: 'permissionResponse', id: id, optionId: null });
            }
        }
    }

    // Collapse an auto-resolved permission so it shows only a minimal indicator,
    // not the fully expanded card with all details.
    function collapseAutoPermission(group) {
        if (!group || !group._permissionState) return;
        group._permissionState.cardCollapsed = true;
        const div = group.querySelector('.message.permission');
        if (div) div.classList.add('is-card-collapsed');
        if (group._permissionState.wrapEl) group._permissionState.wrapEl.style.display = 'none';
        syncPermissionDetailView(group);
    }

    function resolvePermission(id, optionId, selectedLabel) {
        const group = pendingPermissions.get(id);
        if (!group) {
            return;
        }
        pendingPermissions.delete(id);
        applyPermissionResolvedUI(group, localeText('permissionSelected', selectedLabel || optionId));
        vscode.postMessage({ type: 'permissionResponse', id: id, optionId: optionId });
    }

    function dismissPermissionRequest(id, statusText) {
        const group = pendingPermissions.get(id);
        if (!group) {
            return;
        }
        pendingPermissions.delete(id);
        applyPermissionResolvedUI(group, statusText || locale.permissionCancelled || 'Cancelled');
    }

    // Messages from extension
    function isMessageForActiveSession(msg) {
        return !msg.sessionId || msg.sessionId === lastActiveSessionId;
    }

    window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'slashCommands':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (Array.isArray(msg.commands)) {
                    slashCommands = msg.commands.map(function (c) {
                        return {
                            name: String(c.name || ''),
                            description: String(c.description || ''),
                            inputHint: c.inputHint != null ? String(c.inputHint) : null,
                        };
                    }).filter(function (c) { return c.name.length > 0; });
                    renderSlashCommandPicker();
                }
                break;

            case 'addMessage':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.role === 'assistant') {
                    addMessage('assistant', msg.text);
                } else if (msg.role === 'tool' && msg.toolCallId) {
                    handleToolMessage(msg.text, msg.toolCallId);
                } else if (msg.role === 'thought') {
                    // Update the current thought bubble while streaming the same segment
                    if (thoughtMsgId) {
                        const el = document.getElementById(thoughtMsgId);
                        if (el) {
                            setAuxiliaryContent(el, msg.text);
                            setAuxMessageLive(el, true);
                            maybeScrollToBottom();
                            break;
                        }
                    }
                    const id = addMessage('thought', msg.text);
                    thoughtMsgId = id;
                } else {
                    addMessage(msg.role, msg.text);
                }
                break;

            case 'status':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                if (msg.status === 'connecting') {
                    connectionAttempted = true;
                    showHermesLoading('Connecting to Hermes');
                }
                updateStatus(msg.status, msg.message);
                hideHermesLoading();
                if (msg.status === 'ready') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    resetToolAggregation();
                    finishStreaming();
                    canSend = true;
                    inputEl.disabled = false;
                    setInputMode('send');
                    placeholder.style.display = 'none';
                    if (!window._hermesRendered) {
                        scheduleSessionMarkdownRender();
                    }
                    maybeFocusInputAfterResponse();
                } else if (msg.status === 'prompting') {
                    isPrompting = true;
                    resetAutoScrollFollow();
                    canSend = false;
                    inputEl.disabled = true;
                    if (!awaitingFirstChunk) {
                        setInputMode('stop');
                    }
                } else if (msg.status === 'error') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                    const errText = msg.message || locale.connectionError;
                    placeholder.innerHTML = buildConnectionErrorPlaceholder(errText);
                    bindConnectionErrorActions();
                    placeholder.style.display = 'block';
                } else if (msg.status === 'idle') {
                    isPrompting = false;
                    awaitingFirstChunk = false;
                    canSend = false;
                    inputEl.disabled = true;
                    finishStreaming();
                    setInputMode('disabled');
                    updateTokenUsage(0, 0);
                }
                break;

            case 'tokenUsage':
                updateTokenUsage(msg.used, msg.size);
                break;

            case 'newChat':
                newChat();
                break;

            case 'clearChat':
                clearChat();
                break;

            case 'insertInput':
                insertIntoInput(msg.text || '');
                break;

            case 'restoreHistory':
                restoreHistory(msg.messages, msg.totalCount, msg.loadedCount, msg.headerText);
                break;

            case 'prependHistory':
                prependHistory(msg.messages, msg.totalCount, msg.loadedCount);
                break;

            case 'detectEnvironmentStart':
                initDetectEnvironmentStart(msg.mode || 'manual');
                if (placeholder) placeholder.style.display = 'none';
                break;

            case 'detectEnvironmentProgress':
                updateDetectEnvironmentStep(msg);
                break;

            case 'detectEnvironmentEnd':
                finishDetectEnvironmentPanel(msg);
                break;

            case 'configureEnvironmentOpen':
                openConfigureEnvModal(msg.currentPath || '', msg.systemEnvVar, msg.systemEnvTarget);
                break;

            case 'configureEnvironmentDetectStart':
                setConfigureEnvDetecting(true);
                break;

            case 'configureEnvironmentDetectProgress':
                updateConfigureEnvDetectProgress(msg);
                break;

            case 'configureEnvironmentDetectEnd':
                finishConfigureEnvDetect(msg);
                break;

            case 'configureEnvironmentDetectClosed':
                hideConfigureEnvDetectProgress();
                setConfigureEnvDetecting(false);
                break;

            case 'configureEnvironmentBrowseResult':
                if (msg.path && configureEnvPathInput) {
                    configureEnvPathInput.value = msg.path;
                    configureEnvSelectedPath = msg.path;
                    updateConfigureEnvPathClearVisibility();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'configureEnvironmentSaveResult':
                if (msg.ok) {
                    closeConfigureEnvModal();
                } else if (msg.error && configureEnvDetectCompactText) {
                    showConfigureEnvDetectPanel();
                    configureEnvDetectCompactText.textContent = msg.error;
                    setDetectEnvIcon(configureEnvDetectCompactIcon, 'fail');
                }
                break;

            case 'setLocale':
                if (msg.locale) {
                    locale = msg.locale;
                    applyLocale();
                    if (lastSessions.length > 0) {
                        renderSessionTabs(lastSessions, lastActiveSessionId);
                    }
                    const divider = document.getElementById(LOCAL_HISTORY_DIVIDER_ID);
                    if (divider) {
                        divider.textContent = '';
                
                    }
                }
                break;

            case 'showSessionPicker':
                showHermesSessionPicker(msg.sessions);
                break;

            case 'hideSessionPicker':
                hideHermesSessionPicker();
                break;

            case 'sessionList':
                renderSessionTabs(msg.sessions, msg.activeSessionId);
                updateSessionHeader();
                break;

            case 'sessionExport':
                if (msg.action === 'copy' && msg.markdown) {
                    copyToClipboard(msg.markdown);
                } else if (msg.action === 'export' && msg.markdown) {
                    downloadSessionMarkdown(msg.markdown, msg.filename);
                }
                break;

            case 'agentList':
            case 'profileList':
                renderProfileList(msg.agents || msg.profiles);
                break;

            case 'modelList':
                renderModelList(msg);
                break;

            case 'log':
                if (msg.level === 'error' || msg.level === 'warning') {
                    logs.push({ line: msg.line, level: msg.level });
                    if (logs.length > 500) logs = logs.slice(-500);
                    if (isLogModalOpen()) {
                        renderLogContent();
                    }
                }
                break;

            case 'openLogs':
                openLogModal();
                break;

            case 'openAbout':
                renderAboutContent();
                showModal(aboutModal);
                break;

            case 'openHelp':
                showModal(helpModal);
                break;

            case 'openFaq':
                showModal(faqModal);
                break;

            case 'config':
                window._showThoughts = msg.showThoughts;
                window._showToolCalls = msg.showToolCalls;
                // Apply persisted permission mode so a new session restores the
                // user's last selection instead of always defaulting to 'manual'.
                if (msg.permissionMode && msg.permissionMode !== permissionMode) {
                    permissionMode = msg.permissionMode;
                    updatePermissionModeUI();
                }
                // Apply to existing messages
                document.querySelectorAll('.message-group.thought').forEach(function(el) {
                    el.style.display = msg.showThoughts ? '' : 'none';
                });
                document.querySelectorAll('.message-group.tool').forEach(function(el) {
                    el.style.display = msg.showToolCalls ? '' : 'none';
                });
                break;

            case 'activeAgent':
            case 'activeProfile':
                if (msg.name) {
                    const profileLabel = document.getElementById('profileLabel');
                    if (profileLabel) profileLabel.textContent = msg.name;
                }
                break;

            case 'pluginInfo':
                pluginInfo = msg;
                renderAboutContent();
                break;

            case 'fileList':
                if (filePickerEl.dataset.requestId === msg.requestId) {
                    renderFilePickerItems(msg.files || []);
                }
                break;

            case 'filePreview':
                if (previewRequests.has(msg.requestId)) {
                    const anchor = previewRequests.get(msg.requestId);
                    previewRequests.delete(msg.requestId);
                    showFilePreview(msg.path || '', msg.content, msg.error, msg.isImage, msg.mimeType, msg.data);
                    positionFilePreview(anchor);
                }
                break;

            case 'finishAssistantBubble':
                if (!isMessageForActiveSession(msg)) {
                    break;
                }
                finalizeAssistantBubble();
                if (isPrompting && !awaitingFirstChunk) {
                    setInputMode('stop');
                }
                break;

            case 'permissionRequest':
                showPermissionRequest(msg);
                break;

            case 'permissionUpdate':
                if (msg.id && pendingPermissions.has(msg.id)) {
                    updatePermissionContent(
                        pendingPermissions.get(msg.id),
                        msg.title,
                        msg.detail
                    );
                }
                break;

            case 'permissionDismiss':
                dismissPermissionRequest(msg.id, msg.status || locale.permissionCancelled);
                break;

            case 'showContextAttach':
                showContextAttachPicker();
                break;

            case 'hideContextAttach':
                hideContextAttachPicker();
                break;

            case 'markSessionReset':
                insertLocalHistoryDivider();
                break;

            case 'diffReviewRequest':
                showDiffReviewBar(msg.filePath || '');
                break;

            case 'diffReviewResult':
                hideDiffReviewBar();
                if (msg.status === 'accepted') {
                    addMessage('assistant', 'Changes accepted and saved.');
                } else if (msg.status === 'rejected') {
                    addMessage('assistant', 'Changes rejected and reverted.');
                } else if (msg.status === 'no_pending') {
                    addMessage('assistant', 'No pending changes to review.');
                } else if (msg.status === 'error') {
                    addMessage('assistant', 'Error: ' + (msg.message || 'Unknown error'));
                }
                break;
        }
    });

    // Signal ready
    applyLocale();

    function showDiffReviewBar(filePath) {
        if (!diffReviewBar) return;
        diffReviewBar.hidden = false;
        diffReviewVisible = true;
        if (diffReviewFile) {
            const parts = filePath.split('/');
            diffReviewFile.textContent = parts[parts.length - 1] || filePath;
            diffReviewFile.title = filePath;
        }
    }

    function hideDiffReviewBar() {
        if (!diffReviewBar) return;
        diffReviewBar.hidden = true;
        diffReviewVisible = false;
    }

    if (diffAcceptBtn) {
        diffAcceptBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'acceptDiff' });
        });
    }
    if (diffRejectBtn) {
        diffRejectBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'rejectDiff' });
        });
    }

    // -----------------------------------------------------------------------
    // Step-usage bar graph (Kilo/Kline-style). Polls the hermes-telemetry
    // local dashboard for per-step token sizes. Purely cosmetic: every error
    // path hides the graph and stops silently, so a missing/unreachable
    // dashboard never affects the chat.
    // -----------------------------------------------------------------------
    (function initStepGraph() {
        const POLL_MS = 1500;
        const root = document.getElementById('stepGraph');
        const barsEl = document.getElementById('stepGraphBars');
        const totalEl = document.getElementById('stepGraphTotal');
        const legendEl = document.getElementById('stepGraphLegend');
        const detailEl = document.getElementById('stepGraphDetail');
        const toggleBtn = document.getElementById('stepGraphToggle');
        if (!root || !barsEl || !totalEl) return;

        let timer = null;
        let lastSession = '';
        let lastSig = '';
        let currentModel = '';
        let lastSummary = null;

        // --- Step-kind taxonomy -------------------------------------------
        // Fold the telemetry backend's inconsistent raw step_kind strings into
        // a small set of canonical kinds before colouring/labelling. Keeps the
        // bar + legend in sync and makes "mcp__vscode__propose_diff" and
        // "skills_list" first-class instead of missing (brown default).
        const KIND_ALIAS = {
            think: 'think', reasoning: 'think', reason: 'think',
            read: 'read', read_file: 'read', get_active_file: 'read',
            mcp__vscode__get_active_file: 'read',
            write: 'write', write_file: 'write', apply_diff: 'write',
            mcp__vscode__apply_diff: 'write',
            mcp__vscode__propose_diff: 'propose_diff', propose_diff: 'propose_diff',
            search: 'search', search_files: 'search', web_search: 'search',
            exec: 'exec', execute_command: 'exec', terminal: 'exec',
            act: 'act', message: 'act', assistant: 'act', respond: 'act',
            todo: 'todo',
            skill_list: 'skills_list', skills_list: 'skills_list',
            skill_manage: 'skills_list', skill_view: 'skills_list', skill: 'skills_list',
        };

        // Deterministic, single-source-of-truth colour + label table keyed by
        // canonical kind. Setting the colour inline (below) guarantees the bar
        // segment can never show the wrong colour the way the old CSS attribute
        // selectors did (e.g. 'think' rendering brown).
        const KIND_META = {
            think:        { label: 'think',        color: '#8b5cf6' },
            read:         { label: 'read',         color: '#3b82f6' },
            write:        { label: 'write',        color: '#22c55e' },
            propose_diff: { label: 'propose_diff', color: '#ec4899' },
            search:       { label: 'search',       color: '#eab308' },
            exec:         { label: 'exec',         color: '#ef4444' },
            act:          { label: 'act',          color: '#14b8a6' },
            todo:         { label: 'todo',         color: '#f59e0b' },
            skills_list:  { label: 'skills_list',  color: '#6366f1' },
            _other:       { label: 'other',        color: '#9ca3af' },
        };
        const CANON_ORDER = ['think', 'read', 'write', 'propose_diff', 'search', 'exec', 'act', 'todo', 'skills_list'];

        function normalizeKind(raw) {
            if (!raw) return 'act';
            const key = String(raw).toLowerCase();
            return KIND_ALIAS[key] || key;
        }
        function kindMeta(kind) { return KIND_META[kind] || KIND_META._other; }

        function fmtTokens(n) {
            n = Number(n) || 0;
            if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
            return String(n);
        }
        function fmtCost(c) {
            if (!c || c <= 0) return '';
            return '$' + (c < 0.01 ? c.toFixed(4) : c.toFixed(2));
        }

        function renderLegend() {
            if (!legendEl) return;
            legendEl.replaceChildren();
            CANON_ORDER.forEach(function (kind) {
                const meta = KIND_META[kind];
                const span = document.createElement('span');
                span.className = 'sl';
                const sw = document.createElement('span');
                sw.className = 'sl-sw';
                sw.style.background = meta.color;
                span.appendChild(sw);
                span.appendChild(document.createTextNode(meta.label));
                legendEl.appendChild(span);
            });
        }

        function renderDetail(sum) {
            if (!detailEl) return;
            detailEl.replaceChildren();
            if (!sum) return;
            const rows = [
                ['Session', (sum.sessionId || '').slice(0, 8) || '—'],
                ['Model', sum.model || '—'],
                ['Steps', String(sum.steps)],
                ['In tokens', fmtTokens(sum.in)],
                ['Out tokens', fmtTokens(sum.out)],
                ['Reason tokens', fmtTokens(sum.reason)],
                ['Cache read', fmtTokens(sum.cacheRead)],
                ['Cache write', fmtTokens(sum.cacheWrite)],
                ['Cache hit', sum.hitRate != null ? sum.hitRate.toFixed(1) + '%' : 'n/a'],
                ['Cost', fmtCost(sum.cost) || '—'],
            ];
            const dl = document.createElement('dl');
            dl.className = 'step-graph-detail-list';
            rows.forEach(function (r) {
                const dt = document.createElement('dt');
                dt.textContent = r[0];
                const dd = document.createElement('dd');
                dd.textContent = r[1];
                dl.appendChild(dt);
                dl.appendChild(dd);
            });
            detailEl.appendChild(dl);
        }

        function setDetailOpen(open) {
            if (!detailEl || !toggleBtn) return;
            detailEl.hidden = !open;
            toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) renderDetail(lastSummary);
        }

        function render(steps) {
            root.hidden = false;
            if (!steps || !steps.length) {
                root.classList.add('is-empty');
                barsEl.replaceChildren();
                totalEl.textContent = 'No step data yet';
                lastSummary = null;
                setDetailOpen(false);
                renderLegend();
                return;
            }
            root.classList.remove('is-empty');
            renderLegend();

            const costOf = function (s) { return (s.tokens_in || 0) + (s.tokens_out || 0) || 1; };
            const maxTokens = Math.max.apply(null, steps.map(costOf));

            let totalIn = 0, totalOut = 0, totalCost = 0, totalReason = 0;
            let totalCacheRead = 0, totalCacheWrite = 0;
            const frag = document.createDocumentFragment();
            steps.forEach(function (s) {
                const cost = costOf(s);
                totalIn += s.tokens_in || 0;
                totalOut += s.tokens_out || 0;
                totalCost += s.cost_usd || 0;
                totalReason += s.reasoning_tokens || 0;
                totalCacheRead += s.cache_read_tokens || 0;
                totalCacheWrite += s.cache_write_tokens || 0;
                const kind = normalizeKind(s.step_kind);
                const meta = kindMeta(kind);
                const seg = document.createElement('div');
                seg.className = 'step-seg';
                seg.dataset.kind = kind;
                // Deterministic colour — never the wrong one.
                seg.style.background = meta.color;
                // Strictly proportional height: a 2k-token step is clearly
                // taller than a 500-token step (no artificial floor).
                seg.style.height = Math.max(1, Math.round((cost / maxTokens) * 34)) + 'px';
                const extra = [];
                if (s.reasoning_tokens) extra.push('reason ' + fmtTokens(s.reasoning_tokens));
                if (s.cache_read_tokens) extra.push('cacheR ' + fmtTokens(s.cache_read_tokens));
                if (s.cache_write_tokens) extra.push('cacheW ' + fmtTokens(s.cache_write_tokens));
                seg.title = [
                    meta.label,
                    'in ' + fmtTokens(s.tokens_in || 0) + ' / out ' + fmtTokens(s.tokens_out || 0),
                    fmtCost(s.cost_usd),
                    extra.join('  ·  '),
                    (s.model || '') + ''
                ].filter(Boolean).join('  ·  ');
                frag.appendChild(seg);
            });
            barsEl.replaceChildren(frag);

            // Token counts + cache read/write/hit-rate on the summary line.
            const denom = totalCacheRead + totalIn;
            const hitRate = denom > 0 ? (totalCacheRead / denom) * 100 : null;
            const parts = ['Σ ' + fmtTokens(totalIn) + ' in', fmtTokens(totalOut) + ' out'];
            if (totalReason) parts.push(fmtTokens(totalReason) + ' reason');
            if (totalCacheRead || totalCacheWrite) {
                parts.push('cacheR ' + fmtTokens(totalCacheRead));
                parts.push('cacheW ' + fmtTokens(totalCacheWrite));
                if (hitRate != null) parts.push('hit ' + hitRate.toFixed(0) + '%');
            }
            const c = fmtCost(totalCost);
            if (c) parts.push(c);
            totalEl.textContent = parts.join('   ');

            lastSummary = {
                model: currentModel || (steps[0].model || ''),
                steps: steps.length,
                in: totalIn, out: totalOut, reason: totalReason,
                cacheRead: totalCacheRead, cacheWrite: totalCacheWrite,
                hitRate: hitRate, cost: totalCost,
                sessionId: lastSession || (steps[0].session_id || '')
            };
        }

        let pending = false;

        function fetchSteps(sessionId) {
            if (pending) return;
            pending = true;
            vscode.postMessage({
                type: 'telemetrySteps',
                session: sessionId || '',
                requestId: 'stepgraph'
            });
        }

        // The extension host performs the actual HTTP call (Node has no webview
        // CSP), then posts the result back as { type: 'telemetryStepsResult' }.
        window.addEventListener('message', function (event) {
            const msg = event.data;
            if (!msg || msg.type !== 'telemetryStepsResult') return;
            pending = false;
            const data = msg.data;
            if (!data || !data.steps || !data.steps.length) {
                // Show an empty state rather than hiding the graph entirely.
                root.hidden = false;
                root.classList.add('is-empty');
                barsEl.replaceChildren();
                totalEl.textContent = 'No step data yet';
                lastSummary = null;
                setDetailOpen(false);
                renderLegend();
                return;
            }
            currentModel = data.model || currentModel || '';
            render(data.steps);
            lastSession = data.session_id || lastSession || '';
        });

        // Fallback: if the extension never responds (e.g. dashboard not
        // running), keep the graph visible with an explanatory empty state
        // instead of hiding it.
        function armTimeout() {
            setTimeout(function () {
                if (pending) {
                    pending = false;
                    root.hidden = false;
                    root.classList.add('is-empty');
                    barsEl.replaceChildren();
                    totalEl.textContent = 'Telemetry unavailable';
                    lastSummary = null;
                    setDetailOpen(false);
                    renderLegend();
                }
            }, 4000);
        }

        function tick() {
            const sid = (typeof lastActiveSessionId !== 'undefined' && lastActiveSessionId)
                ? lastActiveSessionId : '';
            const sig = sid || 'latest';
            if (sig !== lastSig) {
                lastSig = sig;
                // session changed: clear and refetch immediately
                barsEl.replaceChildren();
                lastSession = '';
                currentModel = '';
                setDetailOpen(false);
            }
            fetchSteps(sid);
            armTimeout();
        }

        function start() {
            if (timer) return;
            tick();
            timer = setInterval(tick, POLL_MS);
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                setDetailOpen(detailEl.hidden);
            });
        }

        // Start polling once the panel is ready (postMessage 'ready' is sent
        // just after this IIFE). Refresh immediately on window focus too, so
        // bars never go stale while the webview is backgrounded.
        start();
        window.addEventListener('focus', function () { if (timer) tick(); });
    })();
    // -----------------------------------------------------------------------

    showHermesLoading('Connecting to Hermes');
    vscode.postMessage({ type: 'ready' });
})();
