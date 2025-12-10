"use strict";
(self["webpackChunk_hdsp_agent_extension"] = self["webpackChunk_hdsp_agent_extension"] || []).push([["lib_index_js"],{

/***/ "./lib/components/AgentPanel.js":
/*!**************************************!*\
  !*** ./lib/components/AgentPanel.js ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AgentPanelWidget: () => (/* binding */ AgentPanelWidget)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ "webpack/sharing/consume/default/react");
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/ui-components */ "webpack/sharing/consume/default/@jupyterlab/ui-components");
/* harmony import */ var _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _SettingsPanel__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./SettingsPanel */ "./lib/components/SettingsPanel.js");
/* harmony import */ var _services_AgentOrchestrator__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../services/AgentOrchestrator */ "./lib/services/AgentOrchestrator.js");
/* harmony import */ var _types_auto_agent__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../types/auto-agent */ "./lib/types/auto-agent.js");
/* harmony import */ var _utils_markdownRenderer__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../utils/markdownRenderer */ "./lib/utils/markdownRenderer.js");
/**
 * Agent Panel - Main sidebar panel for Jupyter Agent
 * Cursor AI Style: Unified Chat + Agent Interface
 */






// Agent 명령어 감지 함수
const isAgentCommand = (input) => {
    const trimmed = input.trim().toLowerCase();
    return trimmed.startsWith('/run ') ||
        trimmed.startsWith('@agent ') ||
        trimmed.startsWith('/agent ') ||
        trimmed.startsWith('/execute ');
};
// Agent 명령어에서 실제 요청 추출
const extractAgentRequest = (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase().startsWith('/run ')) {
        return trimmed.slice(5).trim();
    }
    if (trimmed.toLowerCase().startsWith('@agent ')) {
        return trimmed.slice(7).trim();
    }
    if (trimmed.toLowerCase().startsWith('/agent ')) {
        return trimmed.slice(7).trim();
    }
    if (trimmed.toLowerCase().startsWith('/execute ')) {
        return trimmed.slice(9).trim();
    }
    return trimmed;
};
const ChatPanel = (0,react__WEBPACK_IMPORTED_MODULE_0__.forwardRef)(({ apiService, notebookTracker }, ref) => {
    // 통합 메시지 목록 (Chat + Agent 실행)
    const [messages, setMessages] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
    const [input, setInput] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)('');
    const [isLoading, setIsLoading] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [isStreaming, setIsStreaming] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [streamingMessageId, setStreamingMessageId] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
    const [conversationId, setConversationId] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)('');
    const [showSettings, setShowSettings] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [llmConfig, setLlmConfig] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
    // Agent 실행 상태
    const [isAgentRunning, setIsAgentRunning] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [currentAgentMessageId, setCurrentAgentMessageId] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
    const [executionSpeed, setExecutionSpeed] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)('normal');
    // 입력 모드 (Cursor AI 스타일) - 로컬 스토리지에서 복원
    const [inputMode, setInputMode] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(() => {
        try {
            const saved = localStorage.getItem('hdsp-agent-input-mode');
            return (saved === 'agent' || saved === 'chat') ? saved : 'chat';
        }
        catch {
            return 'chat';
        }
    });
    const [showModeDropdown, setShowModeDropdown] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    // 모드 변경 시 로컬 스토리지에 저장
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        try {
            localStorage.setItem('hdsp-agent-input-mode', inputMode);
        }
        catch {
            // 로컬 스토리지 접근 불가 시 무시
        }
    }, [inputMode]);
    const messagesEndRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)(null);
    const pendingLlmPromptRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)(null);
    const allCodeBlocksRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)([]);
    const currentCellIdRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)(null);
    const currentCellIndexRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)(null);
    const orchestratorRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)(null);
    // Expose handleSendMessage via ref
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useImperativeHandle)(ref, () => ({
        handleSendMessage: async () => {
            await handleSendMessage();
        },
        setInput: (value) => {
            setInput(value);
        },
        setLlmPrompt: (prompt) => {
            pendingLlmPromptRef.current = prompt;
            // Find textarea and set data attribute
            const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input');
            if (textarea) {
                textarea.setAttribute('data-llm-prompt', prompt);
            }
        },
        setCurrentCellId: (cellId) => {
            console.log('[AgentPanel] setCurrentCellId called with:', cellId);
            currentCellIdRef.current = cellId;
        },
        setCurrentCellIndex: (cellIndex) => {
            console.log('[AgentPanel] setCurrentCellIndex called with:', cellIndex);
            currentCellIndexRef.current = cellIndex;
        }
    }));
    // Load config on mount
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        loadConfig();
    }, []);
    // Initialize AgentOrchestrator when notebook is available
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        const notebook = notebookTracker?.currentWidget;
        const sessionContext = notebook?.sessionContext;
        if (notebook && sessionContext) {
            const config = { ..._types_auto_agent__WEBPACK_IMPORTED_MODULE_4__.DEFAULT_AUTO_AGENT_CONFIG, executionSpeed };
            orchestratorRef.current = new _services_AgentOrchestrator__WEBPACK_IMPORTED_MODULE_3__.AgentOrchestrator(notebook, sessionContext, apiService, config);
        }
        return () => {
            orchestratorRef.current = null;
        };
    }, [notebookTracker?.currentWidget, apiService, executionSpeed]);
    // Agent 실행 핸들러
    const handleAgentExecution = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async (request) => {
        const notebook = notebookTracker?.currentWidget;
        if (!orchestratorRef.current || !notebook) {
            // 노트북이 없으면 에러 메시지 표시
            const errorMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: '노트북을 먼저 열어주세요. Agent 실행은 활성 노트북이 필요합니다.',
                timestamp: Date.now(),
            };
            setMessages(prev => [...prev, errorMessage]);
            return;
        }
        // Agent 실행 메시지 생성
        const agentMessageId = `agent-${Date.now()}`;
        const agentMessage = {
            id: agentMessageId,
            type: 'agent_execution',
            request,
            status: { phase: 'planning', message: '실행 계획 생성 중...' },
            plan: null,
            result: null,
            completedSteps: [],
            failedSteps: [],
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, agentMessage]);
        setCurrentAgentMessageId(agentMessageId);
        setIsAgentRunning(true);
        try {
            const result = await orchestratorRef.current.executeTask(request, notebook, (newStatus) => {
                // 실시간 상태 업데이트
                setMessages(prev => prev.map(msg => msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
                    ? {
                        ...msg,
                        status: newStatus,
                        plan: newStatus.plan || msg.plan,
                        completedSteps: newStatus.currentStep && newStatus.currentStep > 1
                            ? Array.from({ length: newStatus.currentStep - 1 }, (_, i) => i + 1)
                            : msg.completedSteps,
                        failedSteps: newStatus.phase === 'failed' && newStatus.currentStep
                            ? [...msg.failedSteps, newStatus.currentStep]
                            : msg.failedSteps,
                    }
                    : msg));
            });
            // 최종 결과 업데이트
            setMessages(prev => prev.map(msg => msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
                ? {
                    ...msg,
                    status: {
                        phase: result.success ? 'completed' : 'failed',
                        message: result.finalAnswer || (result.success ? '작업 완료' : '작업 실패'),
                    },
                    result,
                    completedSteps: result.plan?.steps.map(s => s.stepNumber) || [],
                }
                : msg));
        }
        catch (error) {
            setMessages(prev => prev.map(msg => msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
                ? {
                    ...msg,
                    status: { phase: 'failed', message: error.message || '실행 중 오류 발생' },
                }
                : msg));
        }
        finally {
            setIsAgentRunning(false);
            setCurrentAgentMessageId(null);
        }
    }, [notebookTracker, apiService]);
    const loadConfig = async () => {
        try {
            const config = await apiService.getConfig();
            // If config doesn't have provider, use default
            if (!config || !config.provider) {
                console.warn('Config missing provider, using default');
                const defaultConfig = {
                    provider: 'gemini',
                    gemini: {
                        apiKey: '',
                        model: 'gemini-2.5-pro'
                    },
                    vllm: {
                        endpoint: 'http://localhost:8000',
                        apiKey: 'test',
                        model: 'gpt-oss-120b'
                    },
                    openai: {
                        apiKey: '',
                        model: 'gpt-4'
                    }
                };
                setLlmConfig(defaultConfig);
                return;
            }
            setLlmConfig(config);
            // Log loaded model configuration
            const configData = config;
            console.log('=== HDSP Agent Model Configuration ===');
            console.log('Provider:', configData.provider);
            if (configData.provider === 'gemini') {
                console.log('Gemini Model:', configData.gemini?.model || 'gemini-pro (default)');
                console.log('Gemini API Key:', configData.gemini?.apiKey ? '✓ Configured' : '✗ Not configured');
            }
            else if (configData.provider === 'vllm') {
                console.log('vLLM Model:', configData.vllm?.model || 'default');
                console.log('vLLM Endpoint:', configData.vllm?.endpoint || 'http://localhost:8000');
                console.log('vLLM API Key:', configData.vllm?.apiKey ? '✓ Configured' : '✗ Not configured');
            }
            else if (configData.provider === 'openai') {
                console.log('OpenAI Model:', configData.openai?.model || 'gpt-4');
                console.log('OpenAI API Key:', configData.openai?.apiKey ? '✓ Configured' : '✗ Not configured');
            }
            console.log('=====================================');
        }
        catch (error) {
            console.error('Failed to load config:', error);
        }
    };
    const handleSaveConfig = async (config) => {
        try {
            console.log('=== handleSaveConfig 시작 ===');
            console.log('전송할 config:', JSON.stringify(config, null, 2));
            console.log('Provider:', config.provider);
            console.log('Gemini API Key:', config.gemini?.apiKey ? `${config.gemini.apiKey.substring(0, 10)}...` : 'empty');
            await apiService.saveConfig(config);
            console.log('서버 저장 완료, state 업데이트 중...');
            setLlmConfig(config);
            // Reload config from server to ensure consistency
            await loadConfig();
            console.log('=== handleSaveConfig 완료 ===');
            alert('설정이 성공적으로 저장되었습니다!');
        }
        catch (error) {
            console.error('=== handleSaveConfig 실패 ===');
            console.error('Error:', error);
            alert('설정 저장 실패. 다시 시도해주세요.');
        }
    };
    // Auto-scroll to bottom when messages change
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    // Extract and store code blocks from messages, setup button listeners
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        // Use a small delay to ensure DOM is updated after message rendering
        const timeoutId = setTimeout(() => {
            // Find messages container - try multiple selectors
            const messagesContainer = document.querySelector('.jp-agent-messages') ||
                messagesEndRef.current?.parentElement ||
                document.querySelector('[class*="jp-agent-messages"]');
            if (!messagesContainer) {
                console.log('[AgentPanel] Messages container not found');
                return;
            }
            // Extract code blocks from all assistant messages
            const codeBlocks = [];
            const containers = messagesContainer.querySelectorAll('.code-block-container');
            console.log(`[AgentPanel] Found ${containers.length} code block containers`);
            containers.forEach(container => {
                const blockId = container.getAttribute('data-block-id');
                if (!blockId) {
                    console.warn('[AgentPanel] Code block container missing data-block-id');
                    return;
                }
                const codeElement = container.querySelector(`#${blockId}`);
                if (!codeElement) {
                    console.warn(`[AgentPanel] Code element #${blockId} not found`);
                    return;
                }
                const codeText = codeElement.textContent || '';
                const langElement = container.querySelector('.code-block-language');
                const language = langElement?.textContent?.toLowerCase() || 'python';
                codeBlocks.push({
                    id: blockId,
                    code: codeText,
                    language: language
                });
            });
            // Update code blocks ref
            allCodeBlocksRef.current = codeBlocks;
            console.log(`[AgentPanel] Stored ${codeBlocks.length} code blocks`);
            // Use event delegation - attach single listener to container
            const handleContainerClick = async (e) => {
                const target = e.target;
                // Handle copy button
                if (target.classList.contains('code-block-copy') || target.closest('.code-block-copy')) {
                    const button = target.classList.contains('code-block-copy')
                        ? target
                        : target.closest('.code-block-copy');
                    e.stopPropagation();
                    e.preventDefault();
                    const blockId = button.getAttribute('data-block-id');
                    if (!blockId)
                        return;
                    const block = allCodeBlocksRef.current.find(b => b.id === blockId);
                    if (!block)
                        return;
                    try {
                        await navigator.clipboard.writeText(block.code);
                        const originalText = button.textContent;
                        button.textContent = '복사됨!';
                        setTimeout(() => {
                            button.textContent = originalText || '복사';
                        }, 2000);
                    }
                    catch (error) {
                        console.error('Failed to copy code:', error);
                        showNotification('복사에 실패했습니다.', 'error');
                    }
                    return;
                }
                // Handle apply button
                if (target.classList.contains('code-block-apply') || target.closest('.code-block-apply')) {
                    const button = target.classList.contains('code-block-apply')
                        ? target
                        : target.closest('.code-block-apply');
                    e.stopPropagation();
                    e.preventDefault();
                    const blockId = button.getAttribute('data-block-id');
                    console.log(`[AgentPanel] Apply button clicked via delegation, blockId: ${blockId}`);
                    if (!blockId) {
                        showNotification('코드 블록 ID를 찾을 수 없습니다.', 'error');
                        return;
                    }
                    const block = allCodeBlocksRef.current.find(b => b.id === blockId);
                    if (!block) {
                        showNotification('코드를 찾을 수 없습니다.', 'error');
                        return;
                    }
                    console.log(`[AgentPanel] Applying code to cell via delegation, code length: ${block.code.length}`);
                    await applyCodeToCell(block.code, blockId, button);
                    return;
                }
            };
            // Attach single event listener to container
            messagesContainer.addEventListener('click', handleContainerClick);
            // Cleanup - store handler reference for cleanup
            messagesContainer._agentPanelClickHandler = handleContainerClick;
        }, 100); // Small delay to ensure DOM is ready
        // Cleanup
        return () => {
            clearTimeout(timeoutId);
            // Remove event listener on cleanup
            const messagesContainer = document.querySelector('.jp-agent-messages') ||
                messagesEndRef.current?.parentElement ||
                document.querySelector('[class*="jp-agent-messages"]');
            if (messagesContainer && messagesContainer._agentPanelClickHandler) {
                messagesContainer.removeEventListener('click', messagesContainer._agentPanelClickHandler);
                delete messagesContainer._agentPanelClickHandler;
            }
        };
    }, [messages]);
    // Helper: Get notification background color
    const getNotificationColor = (type) => {
        switch (type) {
            case 'error': return '#f56565';
            case 'warning': return '#ed8936';
            default: return '#4299e1';
        }
    };
    // Helper: Create and show notification element
    const createNotificationElement = (message, backgroundColor) => {
        const notification = document.createElement('div');
        notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 6px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      z-index: 10001;
      opacity: 0;
      transition: opacity 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
      background: ${backgroundColor};
    `;
        notification.textContent = message;
        return notification;
    };
    // Helper: Animate notification in and out
    const animateNotification = (notification) => {
        setTimeout(() => notification.style.opacity = '1', 10);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    };
    // Show notification
    const showNotification = (message, type = 'info') => {
        const notification = createNotificationElement(message, getNotificationColor(type));
        document.body.appendChild(notification);
        animateNotification(notification);
    };
    // Apply code to Jupyter cell
    const applyCodeToCell = async (code, blockId, button) => {
        console.log('[AgentPanel] applyCodeToCell called', { codeLength: code.length, blockId });
        const originalText = button.textContent;
        try {
            button.disabled = true;
            button.textContent = '적용 중...';
            const app = window.jupyterapp;
            if (!app) {
                console.error('[AgentPanel] jupyterapp not found in window');
                showNotification('JupyterLab을 찾을 수 없습니다.', 'error');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                return;
            }
            console.log('[AgentPanel] Found jupyterapp');
            // Try to get notebook tracker from app
            // The notebookTracker is passed to cellButtonsPlugin, so we need to access it differently
            // Use shell to find current notebook widget
            const shell = app.shell;
            const currentWidget = shell.currentWidget;
            // Check if current widget is a notebook
            if (currentWidget && 'content' in currentWidget) {
                const notebook = currentWidget.content;
                // Check if it's a notebook (has model and cells)
                if (notebook && 'model' in notebook && notebook.model && 'cells' in notebook.model) {
                    await applyCodeToNotebookCell(code, notebook, blockId, button, originalText);
                    return;
                }
            }
            // Fallback: show cell selector dialog
            showCellSelectorDialog(code, button, originalText);
        }
        catch (error) {
            console.error('Failed to apply code to cell:', error);
            showNotification('코드 적용에 실패했습니다.', 'error');
            button.disabled = false;
            button.textContent = originalText || '셀에 적용';
        }
    };
    // Helper: Try different methods to set cell source
    const setCellSource = (cellModel, code) => {
        if (cellModel.sharedModel && typeof cellModel.sharedModel.setSource === 'function') {
            cellModel.sharedModel.setSource(code);
        }
        else if (cellModel.setSource && typeof cellModel.setSource === 'function') {
            cellModel.setSource(code);
        }
        else if (cellModel.value && typeof cellModel.value.setText === 'function') {
            cellModel.value.setText(code);
        }
        else if (cellModel.value && cellModel.value.text !== undefined) {
            cellModel.value.text = code;
        }
        else {
            throw new Error('Unable to set cell source - no compatible method found');
        }
    };
    // Helper: Reset button state
    const resetButtonState = (button, originalText) => {
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
    };
    // Apply code to a specific notebook cell
    const applyCodeToNotebookCell = async (code, notebook, blockId, button, originalText) => {
        try {
            console.log('[AgentPanel] applyCodeToNotebookCell called', {
                currentCellIndex: currentCellIndexRef.current,
                currentCellId: currentCellIdRef.current,
                blockId
            });
            // Try cell index first (most reliable)
            if (currentCellIndexRef.current !== null && currentCellIndexRef.current !== undefined) {
                console.log('[AgentPanel] Using cell index:', currentCellIndexRef.current);
                const cells = notebook.widgets || [];
                if (currentCellIndexRef.current >= 0 && currentCellIndexRef.current < cells.length) {
                    const cell = cells[currentCellIndexRef.current];
                    const cellModel = cell.model || cell;
                    console.log('[AgentPanel] Found cell at index, applying code...');
                    try {
                        setCellSource(cellModel, code);
                        console.log('[AgentPanel] Code applied successfully!');
                        showNotification('코드가 셀에 적용되었습니다!', 'info');
                        resetButtonState(button, originalText);
                        // Clear the cell index after successful application
                        currentCellIndexRef.current = null;
                        currentCellIdRef.current = null;
                        return;
                    }
                    catch (updateError) {
                        console.error('Failed to update cell content:', updateError);
                        showNotification('셀 내용 업데이트 실패: ' + updateError.message, 'error');
                        resetButtonState(button, originalText);
                        return;
                    }
                }
                else {
                    console.error('[AgentPanel] Cell index out of bounds:', currentCellIndexRef.current, 'cells.length:', cells.length);
                    showNotification('대상 셀을 찾을 수 없습니다. 셀이 삭제되었거나 이동했을 수 있습니다.', 'error');
                    resetButtonState(button, originalText);
                    currentCellIndexRef.current = null;
                    currentCellIdRef.current = null;
                    return;
                }
            }
            // Fallback: show selector dialog
            console.log('[AgentPanel] No current cell index set, showing selector dialog');
            showCellSelectorDialog(code, button, originalText);
        }
        catch (error) {
            console.error('Failed to apply code:', error);
            showNotification('코드 적용에 실패했습니다.', 'error');
            resetButtonState(button, originalText);
        }
    };
    // Show cell selector dialog (similar to chrome_agent)
    const showCellSelectorDialog = (code, button, originalText) => {
        try {
            const app = window.jupyterapp;
            if (!app) {
                showNotification('JupyterLab을 찾을 수 없습니다.', 'error');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                return;
            }
            // Find current notebook from shell
            const shell = app.shell;
            const currentWidget = shell.currentWidget;
            if (!currentWidget || !('content' in currentWidget)) {
                showNotification('활성 노트북을 찾을 수 없습니다.', 'warning');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                return;
            }
            const notebook = currentWidget.content;
            if (!notebook || !('model' in notebook) || !notebook.model || !('cells' in notebook.model)) {
                showNotification('활성 노트북을 찾을 수 없습니다.', 'warning');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                return;
            }
            const cells = notebook.widgets || [];
            const codeCells = [];
            // Collect code cells
            cells.forEach((cell, index) => {
                const cellModel = cell.model || cell;
                if (cellModel.type === 'code') {
                    const cellId = cellModel.metadata?.get?.('jupyterAgentCellId') ||
                        cellModel.id ||
                        `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    // Ensure cell has ID
                    try {
                        if (!cellModel.metadata?.get?.('jupyterAgentCellId')) {
                            if (cellModel.metadata?.set) {
                                cellModel.metadata.set('jupyterAgentCellId', cellId);
                            }
                        }
                    }
                    catch (e) {
                        // Metadata might not be accessible, continue anyway
                    }
                    const content = (cellModel.sharedModel?.getSource?.() ||
                        cellModel.value?.text ||
                        '').toString();
                    const preview = content.substring(0, 100).replace(/\n/g, ' ');
                    codeCells.push({
                        cell,
                        index,
                        id: cellId,
                        preview
                    });
                }
            });
            if (codeCells.length === 0) {
                showNotification('코드 셀을 찾을 수 없습니다.', 'warning');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                return;
            }
            // Remove existing dialog
            const existingDialog = document.querySelector('.jp-agent-cell-selector-dialog');
            if (existingDialog) {
                existingDialog.remove();
            }
            // Create dialog overlay
            const dialogOverlay = document.createElement('div');
            dialogOverlay.className = 'jp-agent-cell-selector-dialog';
            dialogOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
            // Create dialog container
            const dialogContainer = document.createElement('div');
            dialogContainer.style.cssText = `
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 24px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
            // Create cell list HTML
            const cellListHTML = codeCells.map(({ index, id, preview }) => {
                return `
          <div class="jp-agent-cell-selector-item" data-cell-id="${id}" style="
            padding: 12px;
            margin-bottom: 8px;
            background: white;
            border: 2px solid #e0e0e0;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="
                background: #667eea;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
              ">셀 ${index + 1}</span>
            </div>
            <div style="font-size: 12px; color: #757575; font-family: 'Menlo', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(preview)}${preview.length >= 100 ? '...' : ''}
            </div>
          </div>
        `;
            }).join('');
            // Dialog content
            dialogContainer.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px 0; color: #424242; font-size: 16px; font-weight: 500;">
            코드를 적용할 셀 선택
          </h3>
          <p style="margin: 0; color: #757575; font-size: 13px;">
            AI가 생성한 코드를 적용할 셀을 선택하세요
          </p>
        </div>
        <div class="jp-agent-cell-list" style="margin-bottom: 20px;">
          ${cellListHTML}
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="jp-agent-cell-selector-cancel-btn" style="
            background: transparent;
            color: #616161;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
          ">취소</button>
        </div>
      `;
            dialogOverlay.appendChild(dialogContainer);
            document.body.appendChild(dialogOverlay);
            // Cell item click handlers
            const cellItems = dialogContainer.querySelectorAll('.jp-agent-cell-selector-item');
            cellItems.forEach(item => {
                item.addEventListener('click', () => {
                    const cellId = item.getAttribute('data-cell-id');
                    if (!cellId)
                        return;
                    // Find the cell
                    const cellInfo = codeCells.find(c => c.id === cellId);
                    if (!cellInfo)
                        return;
                    const cellModel = cellInfo.cell.model || cellInfo.cell;
                    // Apply code to cell
                    try {
                        setCellSource(cellModel, code);
                        showNotification('코드가 셀에 적용되었습니다!', 'info');
                        dialogOverlay.remove();
                        resetButtonState(button, originalText);
                    }
                    catch (error) {
                        console.error('Failed to apply code to cell:', error);
                        showNotification('코드 적용에 실패했습니다.', 'error');
                        resetButtonState(button, originalText);
                    }
                });
                // Hover effects
                item.addEventListener('mouseenter', () => {
                    item.style.borderColor = '#667eea';
                    item.style.background = '#f8f9ff';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.borderColor = '#e0e0e0';
                    item.style.background = 'white';
                });
            });
            // Cancel button
            const cancelBtn = dialogContainer.querySelector('.jp-agent-cell-selector-cancel-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    dialogOverlay.remove();
                    button.disabled = false;
                    button.textContent = originalText || '셀에 적용';
                });
                cancelBtn.addEventListener('mouseenter', () => {
                    cancelBtn.style.background = '#f5f5f5';
                    cancelBtn.style.borderColor = '#9ca3af';
                });
                cancelBtn.addEventListener('mouseleave', () => {
                    cancelBtn.style.background = 'transparent';
                    cancelBtn.style.borderColor = '#d1d5db';
                });
            }
            // Close on overlay click
            dialogOverlay.addEventListener('click', (e) => {
                if (e.target === dialogOverlay) {
                    dialogOverlay.remove();
                    button.disabled = false;
                    button.textContent = originalText || '셀에 적용';
                }
            });
            // ESC key to close
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    dialogOverlay.remove();
                    document.removeEventListener('keydown', handleEsc);
                    button.disabled = false;
                    button.textContent = originalText || '셀에 적용';
                }
            };
            document.addEventListener('keydown', handleEsc);
        }
        catch (error) {
            console.error('Failed to show cell selector:', error);
            showNotification('셀 선택 다이얼로그 표시에 실패했습니다.', 'error');
            button.disabled = false;
            button.textContent = originalText || '셀에 적용';
        }
    };
    // Helper function to escape HTML
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    const handleSendMessage = async () => {
        // Check if there's an LLM prompt stored (from cell action)
        const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input');
        const llmPrompt = pendingLlmPromptRef.current || textarea?.getAttribute('data-llm-prompt');
        // Allow execution if we have an LLM prompt even if input is empty (for auto-execution)
        if ((!input.trim() && !llmPrompt) || isLoading || isStreaming || isAgentRunning)
            return;
        const currentInput = input.trim();
        // Agent 모드이면 Agent 실행
        if (inputMode === 'agent') {
            // User 메시지 추가
            const userMessage = {
                id: Date.now().toString(),
                role: 'user',
                content: `@agent ${currentInput}`,
                timestamp: Date.now(),
            };
            setMessages(prev => [...prev, userMessage]);
            setInput('');
            // Agent 실행
            await handleAgentExecution(currentInput);
            return;
        }
        // Chat 모드에서도 명령어로 Agent 실행 가능
        if (isAgentCommand(currentInput)) {
            const agentRequest = extractAgentRequest(currentInput);
            if (agentRequest) {
                // User 메시지 추가
                const userMessage = {
                    id: Date.now().toString(),
                    role: 'user',
                    content: currentInput,
                    timestamp: Date.now(),
                };
                setMessages(prev => [...prev, userMessage]);
                setInput('');
                // Agent 실행
                await handleAgentExecution(agentRequest);
                return;
            }
        }
        // Check if API key is configured before sending
        if (!llmConfig) {
            // Config not loaded yet, try to load it
            await loadConfig();
        }
        // Check API key based on provider
        const hasApiKey = (() => {
            if (!llmConfig || !llmConfig.provider) {
                return false;
            }
            const provider = llmConfig.provider;
            if (provider === 'gemini') {
                return !!(llmConfig.gemini?.apiKey && llmConfig.gemini.apiKey.trim());
            }
            else if (provider === 'vllm') {
                // vLLM may not require API key, but check if endpoint is configured
                return !!(llmConfig.vllm?.endpoint && llmConfig.vllm.endpoint.trim());
            }
            else if (provider === 'openai') {
                return !!(llmConfig.openai?.apiKey && llmConfig.openai.apiKey.trim());
            }
            return false;
        })();
        if (!hasApiKey) {
            // Show error message and open settings
            const providerName = llmConfig?.provider || 'LLM';
            const errorMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: `API Key가 설정되지 않았습니다.\n\n${providerName === 'gemini' ? 'Gemini' : providerName === 'openai' ? 'OpenAI' : 'vLLM'} API Key를 먼저 설정해주세요.\n\n설정 버튼을 클릭하여 API Key를 입력하세요.`,
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, errorMessage]);
            setShowSettings(true);
            return;
        }
        // Use the display prompt (input) for the user message, or use a fallback if input is empty
        const displayContent = currentInput || (llmPrompt ? '셀 분석 요청' : '');
        const userMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: displayContent,
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, userMessage]);
        // Only clear input if it was manually entered, keep it for auto-execution display
        if (currentInput) {
            setInput('');
        }
        setIsLoading(true);
        setIsStreaming(true);
        // Clear the data attribute and ref after using it
        if (textarea && llmPrompt) {
            textarea.removeAttribute('data-llm-prompt');
            pendingLlmPromptRef.current = null;
        }
        // Create assistant message ID for streaming updates
        const assistantMessageId = Date.now().toString() + '-assistant';
        let streamedContent = '';
        setStreamingMessageId(assistantMessageId);
        // Add empty assistant message that will be updated during streaming
        const initialAssistantMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, initialAssistantMessage]);
        try {
            // Use LLM prompt if available, otherwise use the display content
            const messageToSend = llmPrompt || displayContent;
            await apiService.sendMessageStream({
                message: messageToSend,
                conversationId: conversationId || undefined
            }, 
            // onChunk callback - update message content incrementally
            (chunk) => {
                streamedContent += chunk;
                setMessages(prev => prev.map(msg => msg.id === assistantMessageId && isChatMessage(msg)
                    ? { ...msg, content: streamedContent }
                    : msg));
            }, 
            // onMetadata callback - update conversationId and metadata
            (metadata) => {
                if (metadata.conversationId && !conversationId) {
                    setConversationId(metadata.conversationId);
                }
                if (metadata.provider || metadata.model) {
                    setMessages(prev => prev.map(msg => msg.id === assistantMessageId && isChatMessage(msg)
                        ? {
                            ...msg,
                            metadata: {
                                ...msg.metadata,
                                provider: metadata.provider,
                                model: metadata.model
                            }
                        }
                        : msg));
                }
            });
        }
        catch (error) {
            // Update the assistant message with error
            setMessages(prev => prev.map(msg => msg.id === assistantMessageId && isChatMessage(msg)
                ? {
                    ...msg,
                    content: streamedContent + `\n\nError: ${error instanceof Error ? error.message : 'Failed to send message'}`
                }
                : msg));
        }
        finally {
            setIsLoading(false);
            setIsStreaming(false);
            setStreamingMessageId(null);
        }
    };
    const handleKeyDown = (e) => {
        // Enter: 전송
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
        // Shift+Tab: 모드 전환 (chat ↔ agent)
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
            return;
        }
        // Cmd/Ctrl + . : 모드 전환 (대체 단축키)
        if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
        }
        // Tab (without Shift): Agent 모드일 때 드롭다운 토글
        if (e.key === 'Tab' && !e.shiftKey && inputMode === 'agent') {
            e.preventDefault();
            setShowModeDropdown(prev => !prev);
        }
    };
    // 모드 토글 함수
    const toggleMode = () => {
        setInputMode(prev => prev === 'chat' ? 'agent' : 'chat');
        setShowModeDropdown(false);
    };
    const clearChat = () => {
        setMessages([]);
        setConversationId('');
    };
    // Agent 실행 메시지 렌더링
    const renderAgentExecutionMessage = (msg) => {
        const { status, plan, result, completedSteps, failedSteps, request } = msg;
        const isActive = ['planning', 'executing', 'tool_calling', 'self_healing', 'replanning', 'validating', 'reflecting'].includes(status.phase);
        const getStepStatus = (stepNumber) => {
            if (failedSteps.includes(stepNumber))
                return 'failed';
            if (completedSteps.includes(stepNumber))
                return 'completed';
            if (status.currentStep === stepNumber)
                return 'current';
            return 'pending';
        };
        const progressPercent = plan ? (completedSteps.length / plan.totalSteps) * 100 : 0;
        return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-message" },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-header" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-badge" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor", width: "12", height: "12" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13z" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M8 3a.75.75 0 01.75.75v3.5h2.5a.75.75 0 010 1.5h-3.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 3z" })),
                    "Agent"),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-execution-request" }, request)),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: `jp-agent-execution-status jp-agent-execution-status--${status.phase}` },
                isActive && react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-spinner" }),
                status.phase === 'completed' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor", className: "jp-agent-execution-icon--success" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" }))),
                status.phase === 'failed' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor", className: "jp-agent-execution-icon--error" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" }))),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-execution-status-text" }, status.message || status.phase)),
            plan && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-plan" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-plan-header" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null, "\uC2E4\uD589 \uACC4\uD68D"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-execution-plan-progress" },
                        completedSteps.length,
                        " / ",
                        plan.totalSteps)),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-progress-bar" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-progress-fill", style: { width: `${progressPercent}%` } })),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-steps" }, plan.steps.map((step) => {
                    const stepStatus = getStepStatus(step.stepNumber);
                    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { key: step.stepNumber, className: `jp-agent-execution-step jp-agent-execution-step--${stepStatus}`, ref: (el) => {
                            // 현재 진행 중인 단계로 자동 스크롤
                            if (stepStatus === 'current' && el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        } },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-step-indicator" },
                            stepStatus === 'completed' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor" },
                                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" }))),
                            stepStatus === 'failed' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor" },
                                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" }))),
                            stepStatus === 'current' && react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-step-spinner" }),
                            stepStatus === 'pending' && react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null, step.stepNumber)),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-step-content" },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: `jp-agent-execution-step-desc ${stepStatus === 'completed' ? 'jp-agent-execution-step-desc--done' : ''}` }, step.description),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-step-tools" }, step.toolCalls.map((tc, i) => (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { key: i, className: "jp-agent-execution-tool-tag" }, tc.tool)))))));
                })))),
            result && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: `jp-agent-execution-result jp-agent-execution-result--${result.success ? 'success' : 'error'}` },
                result.finalAnswer && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("p", { className: "jp-agent-execution-result-message" }, result.finalAnswer)),
                result.error && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("p", { className: "jp-agent-execution-result-error" }, result.error)),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-execution-result-stats" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null,
                        result.createdCells.length,
                        "\uAC1C \uC140 \uC0DD\uC131"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null,
                        result.modifiedCells.length,
                        "\uAC1C \uC140 \uC218\uC815"),
                    result.executionTime && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null,
                        (result.executionTime / 1000).toFixed(1),
                        "\uCD08")))))));
    };
    // 메시지가 Chat 메시지인지 확인
    const isChatMessage = (msg) => {
        return !('type' in msg) || msg.type !== 'agent_execution';
    };
    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-panel" },
        showSettings && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_SettingsPanel__WEBPACK_IMPORTED_MODULE_2__.SettingsPanel, { onClose: () => setShowSettings(false), onSave: handleSaveConfig, currentConfig: llmConfig || undefined })),
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-header" },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("h2", null, "HDSP Agent"),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-header-buttons" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-clear-button", onClick: clearChat, title: "\uB300\uD654 \uCD08\uAE30\uD654" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("polyline", { points: "3 6 5 6 21 6" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "10", y1: "11", x2: "10", y2: "17" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "14", y1: "11", x2: "14", y2: "17" }))),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-settings-button-icon", onClick: () => setShowSettings(true), title: "\uC124\uC815" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("line", { x1: "17", y1: "16", x2: "23", y2: "16" }))))),
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-messages" },
            messages.length === 0 ? (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-empty-state" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("p", null, "\uC548\uB155\uD558\uC138\uC694! HDSP Agent\uC785\uB2C8\uB2E4."),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("p", { className: "jp-agent-empty-hint" }, inputMode === 'agent'
                    ? '노트북 작업을 자연어로 요청하세요. 예: "데이터 시각화 해줘"'
                    : '메시지를 입력하거나 아래 버튼으로 Agent 모드를 선택하세요.'))) : (messages.map(msg => {
                if (isChatMessage(msg)) {
                    // 일반 Chat 메시지
                    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { key: msg.id, className: `jp-agent-message jp-agent-message-${msg.role}` },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-message-header" },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-message-role" }, msg.role === 'user' ? '사용자' : 'Agent'),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-message-time" }, new Date(msg.timestamp).toLocaleTimeString())),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: `jp-agent-message-content${streamingMessageId === msg.id ? ' streaming' : ''}`, dangerouslySetInnerHTML: {
                                __html: msg.role === 'assistant'
                                    ? (0,_utils_markdownRenderer__WEBPACK_IMPORTED_MODULE_5__.formatMarkdownToHtml)(msg.content)
                                    : escapeHtml(msg.content).replace(/\n/g, '<br>')
                            } })));
                }
                else {
                    // Agent 실행 메시지
                    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { key: msg.id, className: "jp-agent-message jp-agent-message-agent-execution" }, renderAgentExecutionMessage(msg)));
                }
            })),
            isLoading && !isStreaming && !isAgentRunning && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-message jp-agent-message-assistant" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-message-header" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-message-role" }, "Agent")),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-message-content jp-agent-loading" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-loading-dot" }, "."),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-loading-dot" }, "."),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-loading-dot" }, ".")))),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { ref: messagesEndRef })),
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-input-container" },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-input-wrapper" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("textarea", { className: `jp-agent-input ${inputMode === 'agent' ? 'jp-agent-input--agent-mode' : ''}`, value: input, onChange: (e) => setInput(e.target.value), onKeyDown: handleKeyDown, placeholder: inputMode === 'agent'
                        ? '노트북 작업을 입력하세요... (예: 데이터 시각화 해줘)'
                        : '메시지를 입력하세요...', rows: 3, disabled: isLoading || isAgentRunning }),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-send-button", onClick: handleSendMessage, disabled: !input.trim() || isLoading || isStreaming || isAgentRunning, title: "\uC804\uC1A1 (Enter)" }, isAgentRunning ? '실행 중...' : '전송')),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-mode-bar" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-mode-toggle-container" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: `jp-agent-mode-toggle ${inputMode === 'agent' ? 'jp-agent-mode-toggle--active' : ''}`, onClick: toggleMode, title: `${inputMode === 'agent' ? 'Agent' : 'Chat'} 모드 (⇧Tab)` },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { className: "jp-agent-mode-icon", viewBox: "0 0 16 16", fill: "currentColor", width: "14", height: "14" }, inputMode === 'agent' ? (
                        // 무한대 아이콘 (Agent 모드)
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5zm6.88 1.3c.44-.72 1.22-1.2 2.12-1.2 1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5c-.9 0-1.68-.48-2.12-1.2L12.5 10.6c.3.24.68.4 1.1.4.83 0 1.5-.67 1.5-1.5S14.43 8 13.6 8c-.42 0-.8.16-1.1.4l-1.12 1.3zM7 9.5c-.42 0-.8-.16-1.1-.4L4.78 7.8c-.44.72-1.22 1.2-2.12 1.2C1.28 9 .17 7.88.17 6.5S1.29 4 2.67 4c.9 0 1.68.48 2.12 1.2L5.9 6.5c-.3-.24-.68-.4-1.1-.4C3.97 6.1 3.3 6.77 3.3 7.6s.67 1.5 1.5 1.5c.42 0 .8-.16 1.1-.4l1.12-1.3L8 8l-1 1.5z" })) : (
                        // 채팅 아이콘 (Chat 모드)
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z" }))),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-mode-label" }, inputMode === 'agent' ? 'Agent' : 'Chat'),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { className: "jp-agent-mode-chevron", viewBox: "0 0 16 16", fill: "currentColor", width: "12", height: "12" },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M4.47 5.47a.75.75 0 011.06 0L8 7.94l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" }))),
                    showModeDropdown && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-mode-dropdown" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: `jp-agent-mode-option ${inputMode === 'chat' ? 'jp-agent-mode-option--selected' : ''}`, onClick: () => { setInputMode('chat'); setShowModeDropdown(false); } },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor", width: "14", height: "14" },
                                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z" })),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null, "Chat"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-mode-shortcut" }, "\uC77C\uBC18 \uB300\uD654")),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: `jp-agent-mode-option ${inputMode === 'agent' ? 'jp-agent-mode-option--selected' : ''}`, onClick: () => { setInputMode('agent'); setShowModeDropdown(false); } },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("svg", { viewBox: "0 0 16 16", fill: "currentColor", width: "14", height: "14" },
                                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("path", { d: "M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5z" })),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", null, "Agent"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-mode-shortcut" }, "\uB178\uD2B8\uBD81 \uC790\uB3D9 \uC2E4\uD589"))))),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-mode-hints" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("span", { className: "jp-agent-mode-hint" }, "\u21E7Tab \uBAA8\uB4DC \uC804\uD658"))))));
});
ChatPanel.displayName = 'ChatPanel';
/**
 * Agent Panel Widget
 */
class AgentPanelWidget extends _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_1__.ReactWidget {
    constructor(apiService, notebookTracker) {
        super();
        this.chatPanelRef = react__WEBPACK_IMPORTED_MODULE_0___default().createRef();
        this.apiService = apiService;
        this.notebookTracker = notebookTracker;
        this.id = 'hdsp-agent-panel';
        this.title.label = 'HDSP';
        this.title.caption = 'HDSP Agent Assistant';
        // Using JupyterLab's built-in robot icon
        this.addClass('jp-agent-widget');
    }
    render() {
        return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(ChatPanel, { ref: this.chatPanelRef, apiService: this.apiService, notebookTracker: this.notebookTracker }));
    }
    /**
     * Add a message from cell action
     * @param action - The action type (explain, fix, custom_prompt)
     * @param cellContent - The cell content
     * @param displayPrompt - The user-facing prompt to show in the UI
     * @param llmPrompt - The actual prompt to send to the LLM
     * @param cellId - The cell ID for applying code (optional)
     * @param cellIndex - The cell index (0-based) for applying code (optional)
     */
    addCellActionMessage(action, cellContent, displayPrompt, llmPrompt, cellId, cellIndex) {
        console.log('[AgentPanel] Cell action:', action);
        console.log('[AgentPanel] Display prompt:', displayPrompt);
        console.log('[AgentPanel] LLM prompt:', llmPrompt);
        console.log('[AgentPanel] Cell ID:', cellId);
        console.log('[AgentPanel] Cell Index:', cellIndex);
        if (!this.chatPanelRef.current) {
            console.error('[AgentPanel] ChatPanel ref not available');
            return;
        }
        // Store cell index for code application (preferred method)
        if (cellIndex !== undefined && this.chatPanelRef.current.setCurrentCellIndex) {
            this.chatPanelRef.current.setCurrentCellIndex(cellIndex);
        }
        // Store cell ID for code application (fallback)
        if (cellId && this.chatPanelRef.current.setCurrentCellId) {
            this.chatPanelRef.current.setCurrentCellId(cellId);
        }
        // Set the display prompt in the input field
        this.chatPanelRef.current.setInput(displayPrompt);
        // Store the LLM prompt
        this.chatPanelRef.current.setLlmPrompt(llmPrompt);
        // Automatically execute after a short delay to ensure state is updated
        setTimeout(() => {
            if (this.chatPanelRef.current) {
                this.chatPanelRef.current.handleSendMessage().catch(error => {
                    console.error('[AgentPanel] Failed to send message automatically:', error);
                });
            }
        }, 100);
    }
    /**
     * Analyze entire notebook before saving
     * @param cells - Array of collected cells with content, output, and imports
     * @param onComplete - Callback to execute after analysis (perform save)
     */
    analyzeNotebook(cells, onComplete) {
        console.log('[AgentPanel] analyzeNotebook called with', cells.length, 'cells');
        if (!this.chatPanelRef.current) {
            console.error('[AgentPanel] ChatPanel ref not available');
            onComplete();
            return;
        }
        // Create summary of notebook
        const totalCells = cells.length;
        const cellsWithErrors = cells.filter(cell => cell.output && (cell.output.includes('Error') ||
            cell.output.includes('Traceback') ||
            cell.output.includes('Exception'))).length;
        const cellsWithImports = cells.filter(cell => cell.imports && cell.imports.length > 0).length;
        const localImports = cells.reduce((acc, cell) => {
            if (cell.imports) {
                return acc + cell.imports.filter((imp) => imp.isLocal).length;
            }
            return acc;
        }, 0);
        // Create display prompt
        const displayPrompt = `전체 노트북 검수 요청 (${totalCells}개 셀)`;
        // Create detailed LLM prompt with all cells
        let llmPrompt = `다음은 저장하기 전의 Jupyter 노트북 전체 내용입니다. 모든 셀을 검토하고 개선 사항을 제안해주세요.

## 노트북 요약
- 전체 셀 수: ${totalCells}개
- 에러가 있는 셀: ${cellsWithErrors}개
- Import가 있는 셀: ${cellsWithImports}개
- 로컬 모듈 import: ${localImports}개

## 전체 셀 내용

`;
        cells.forEach((cell, index) => {
            llmPrompt += `### 셀 ${index + 1} (ID: ${cell.id})
\`\`\`python
${cell.content}
\`\`\`
`;
            if (cell.output) {
                llmPrompt += `
**실행 결과:**
\`\`\`
${cell.output}
\`\`\`
`;
            }
            if (cell.imports && cell.imports.length > 0) {
                llmPrompt += `
**Imports:**
`;
                cell.imports.forEach((imp) => {
                    llmPrompt += `- \`${imp.module}\` (${imp.isLocal ? '로컬' : '표준 라이브러리'})\n`;
                });
            }
            llmPrompt += '\n---\n\n';
        });
        llmPrompt += `
## 검수 요청 사항

다음 형식으로 응답해주세요:

### 1. 전반적인 코드 품질 평가
(노트북 전체의 코드 품질, 구조, 일관성 등을 평가)

### 2. 발견된 주요 이슈
(에러, 경고, 잠재적 문제점 등을 나열)

### 3. 셀별 개선 제안
각 셀에 대해 구체적인 개선 사항이 있다면:
- **셀 X**: (개선 사항)
  \`\`\`python
  (개선된 코드)
  \`\`\`

### 4. 전반적인 개선 권장사항
(노트북 전체를 개선하기 위한 일반적인 제안)

### 5. 저장 권장 여부
- ✅ **저장 권장**: (이유)
- ⚠️ **수정 후 저장 권장**: (이유)
- ❌ **저장 비권장**: (이유)
`;
        // Set the display prompt in the input field
        this.chatPanelRef.current.setInput(displayPrompt);
        // Store the LLM prompt
        this.chatPanelRef.current.setLlmPrompt(llmPrompt);
        // Automatically execute after a short delay to ensure state is updated
        setTimeout(() => {
            if (this.chatPanelRef.current) {
                this.chatPanelRef.current.handleSendMessage().catch(error => {
                    console.error('[AgentPanel] Failed to send message automatically:', error);
                }).finally(() => {
                    // Store the onComplete callback to be executed after user reviews the analysis
                    // For now, we'll execute it immediately
                    // TODO: Add UI button to allow user to review and then save
                    console.log('[AgentPanel] Analysis complete, executing onComplete callback');
                    onComplete();
                });
            }
        }, 100);
    }
}


/***/ }),

/***/ "./lib/components/PromptGenerationDialog.js":
/*!**************************************************!*\
  !*** ./lib/components/PromptGenerationDialog.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   PromptGenerationDialog: () => (/* binding */ PromptGenerationDialog)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ "webpack/sharing/consume/default/react");
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @mui/material */ "webpack/sharing/consume/default/@mui/material/@mui/material");
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_mui_material__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _mui_icons_material_AutoFixHigh__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @mui/icons-material/AutoFixHigh */ "./node_modules/@mui/icons-material/esm/AutoFixHigh.js");
/**
 * Prompt Generation Dialog Component
 * Dialog for entering prompts to generate notebooks
 */



const EXAMPLE_PROMPTS = [
    '타이타닉 생존자 예측을 dask와 lgbm으로 생성해줘',
    '주식 데이터 분석 및 시각화 노트북 만들어줘',
    'Iris 데이터셋으로 분류 모델 학습하기',
    '시계열 데이터 분석 및 예측 모델 만들기'
];
const PromptGenerationDialog = ({ open, onClose, onGenerate }) => {
    const [prompt, setPrompt] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)('');
    const [isGenerating, setIsGenerating] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [progress, setProgress] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(0);
    const [statusMessage, setStatusMessage] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)('');
    const handleGenerate = () => {
        if (prompt.trim()) {
            setIsGenerating(true);
            onGenerate(prompt.trim());
            setPrompt('');
            setIsGenerating(false);
            onClose();
        }
    };
    const handleKeyPress = (event) => {
        if (event.key === 'Enter' && event.ctrlKey) {
            handleGenerate();
        }
    };
    const handleExampleClick = (example) => {
        setPrompt(example);
    };
    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Dialog, { open: open, onClose: onClose, maxWidth: "md", fullWidth: true, PaperProps: {
            sx: {
                borderRadius: 2,
                minHeight: '400px'
            }
        } },
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.DialogTitle, null,
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", alignItems: "center", gap: 1 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_AutoFixHigh__WEBPACK_IMPORTED_MODULE_2__["default"], { color: "primary" }),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "h6" }, "HDSP \uD504\uB86C\uD504\uD2B8\uB85C \uB178\uD2B8\uBD81 \uC0DD\uC131"))),
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.DialogContent, null,
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", flexDirection: "column", gap: 2, mt: 1 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "body2", color: "text.secondary" }, "\uC6D0\uD558\uB294 \uB178\uD2B8\uBD81\uC758 \uB0B4\uC6A9\uC744 \uC790\uC5F0\uC5B4\uB85C \uC124\uBA85\uD574\uC8FC\uC138\uC694. AI\uAC00 \uC790\uB3D9\uC73C\uB85C \uB178\uD2B8\uBD81\uC744 \uC0DD\uC131\uD569\uB2C8\uB2E4."),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.TextField, { autoFocus: true, multiline: true, rows: 6, fullWidth: true, variant: "outlined", placeholder: "\uC608: \uD0C0\uC774\uD0C0\uB2C9 \uC0DD\uC874\uC790 \uC608\uCE21\uC744 dask\uC640 lgbm\uC73C\uB85C \uC0DD\uC131\uD574\uC918", value: prompt, onChange: (e) => setPrompt(e.target.value), onKeyPress: handleKeyPress, disabled: isGenerating, sx: {
                        '& .MuiOutlinedInput-root': {
                            fontSize: '14px'
                        }
                    } }),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, null,
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary", display: "block", mb: 1 }, "\uC608\uC2DC \uD504\uB86C\uD504\uD2B8 (\uD074\uB9AD\uD558\uC5EC \uC0AC\uC6A9):"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", flexWrap: "wrap", gap: 1 }, EXAMPLE_PROMPTS.map((example, index) => (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Chip, { key: index, label: example, variant: "outlined", size: "small", onClick: () => handleExampleClick(example), sx: {
                            cursor: 'pointer',
                            '&:hover': {
                                backgroundColor: 'action.hover'
                            }
                        } }))))),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { sx: {
                        backgroundColor: 'action.hover',
                        borderRadius: 1,
                        padding: 2
                    } },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary" },
                        "\uD83D\uDCA1 ",
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("strong", null, "\uD301:"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("br", null),
                        "\u2022 \uC0AC\uC6A9\uD560 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uB97C \uBA85\uC2DC\uD558\uBA74 \uB354 \uC815\uD655\uD569\uB2C8\uB2E4",
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("br", null),
                        "\u2022 \uBD84\uC11D \uBAA9\uC801\uACFC \uB370\uC774\uD130\uB97C \uAD6C\uCCB4\uC801\uC73C\uB85C \uC124\uBA85\uD558\uC138\uC694",
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("br", null),
                        "\u2022 Ctrl + Enter\uB85C \uBE60\uB974\uAC8C \uC0DD\uC131\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4",
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("br", null),
                        "\u2022 \uC0DD\uC131\uC740 \uBC31\uADF8\uB77C\uC6B4\uB4DC\uC5D0\uC11C \uC9C4\uD589\uB418\uBA70, \uC644\uB8CC\uB418\uBA74 \uC54C\uB9BC\uC744 \uBC1B\uC2B5\uB2C8\uB2E4")))),
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.DialogActions, { sx: { padding: 2, paddingTop: 0 } },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Button, { onClick: onClose, disabled: isGenerating }, "\uCDE8\uC18C"),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Button, { onClick: handleGenerate, variant: "contained", disabled: !prompt.trim() || isGenerating, startIcon: react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_AutoFixHigh__WEBPACK_IMPORTED_MODULE_2__["default"], null) }, "\uC0DD\uC131 \uC2DC\uC791"))));
};


/***/ }),

/***/ "./lib/components/SettingsPanel.js":
/*!*****************************************!*\
  !*** ./lib/components/SettingsPanel.js ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SettingsPanel: () => (/* binding */ SettingsPanel)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ "webpack/sharing/consume/default/react");
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);
/**
 * Settings Panel Component
 * Allows users to configure LLM provider settings
 */

const SettingsPanel = ({ onClose, onSave, currentConfig }) => {
    const [provider, setProvider] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.provider || 'gemini');
    const [isTesting, setIsTesting] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const [testResult, setTestResult] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
    // Gemini settings
    const [geminiApiKey, setGeminiApiKey] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.gemini?.apiKey || '');
    // Validate gemini model - only allow valid options
    const validateGeminiModel = (model) => {
        const validModels = ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];
        if (model && validModels.includes(model)) {
            return model;
        }
        console.warn(`[SettingsPanel] Invalid Gemini model "${model}", defaulting to gemini-2.5-pro`);
        return 'gemini-2.5-pro';
    };
    const [geminiModel, setGeminiModel] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(validateGeminiModel(currentConfig?.gemini?.model));
    // vLLM settings
    const [vllmEndpoint, setVllmEndpoint] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.vllm?.endpoint || 'http://localhost:8000');
    const [vllmApiKey, setVllmApiKey] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.vllm?.apiKey || '');
    const [vllmModel, setVllmModel] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.vllm?.model || 'meta-llama/Llama-2-7b-chat-hf');
    // OpenAI settings
    const [openaiApiKey, setOpenaiApiKey] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.openai?.apiKey || '');
    const [openaiModel, setOpenaiModel] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(currentConfig?.openai?.model || 'gpt-4');
    // Update state when currentConfig changes
    (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
        if (currentConfig) {
            setProvider(currentConfig.provider || 'gemini');
            setGeminiApiKey(currentConfig.gemini?.apiKey || '');
            setGeminiModel(validateGeminiModel(currentConfig.gemini?.model));
            setVllmEndpoint(currentConfig.vllm?.endpoint || 'http://localhost:8000');
            setVllmApiKey(currentConfig.vllm?.apiKey || '');
            setVllmModel(currentConfig.vllm?.model || 'meta-llama/Llama-2-7b-chat-hf');
            setOpenaiApiKey(currentConfig.openai?.apiKey || '');
            setOpenaiModel(currentConfig.openai?.model || 'gpt-4');
        }
    }, [currentConfig]);
    // Helper: Get cookie value by name
    const getCookie = (name) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop()?.split(';').shift() || '';
        }
        return '';
    };
    // Helper: Build LLM config from state
    const buildLLMConfig = () => ({
        provider,
        gemini: {
            apiKey: geminiApiKey,
            model: geminiModel
        },
        vllm: {
            endpoint: vllmEndpoint,
            apiKey: vllmApiKey,
            model: vllmModel
        },
        openai: {
            apiKey: openaiApiKey,
            model: openaiModel
        }
    });
    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const config = buildLLMConfig();
            // Test API call
            const response = await fetch('/hdsp-agent/test-llm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-XSRFToken': getCookie('_xsrf')
                },
                body: JSON.stringify(config)
            });
            if (response.ok) {
                const data = await response.json();
                setTestResult(`✅ 성공: ${data.message}`);
            }
            else {
                const error = await response.json();
                setTestResult(`❌ 실패: ${error.error}`);
            }
        }
        catch (error) {
            setTestResult(`❌ 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
        finally {
            setIsTesting(false);
        }
    };
    const handleSave = () => {
        const config = buildLLMConfig();
        onSave(config);
        onClose();
    };
    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-overlay" },
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-dialog" },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-header" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("h2", null, "LLM \uC124\uC815"),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-settings-close", onClick: onClose, title: "\uB2EB\uAE30" }, "\u00D7")),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-content" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "\uD504\uB85C\uBC14\uC774\uB354"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("select", { className: "jp-agent-settings-select", value: provider, onChange: (e) => setProvider(e.target.value) },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gemini" }, "Google Gemini"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "vllm" }, "vLLM"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "openai" }, "OpenAI"))),
                provider === 'gemini' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-provider" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("h3", null, "Gemini \uC124\uC815"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "API \uD0A4"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("input", { type: "password", className: "jp-agent-settings-input", value: geminiApiKey, onChange: (e) => setGeminiApiKey(e.target.value), placeholder: "Gemini API \uD0A4\uB97C \uC785\uB825\uD558\uC138\uC694" })),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "\uBAA8\uB378"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("select", { className: "jp-agent-settings-select", value: geminiModel, onChange: (e) => setGeminiModel(e.target.value) },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gemini-3-pro-preview" }, "Gemini 3.0 Pro"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gemini-2.5-pro" }, "Gemini 2.5 Pro"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gemini-2.5-flash" }, "Gemini 2.5 Flash"))))),
                provider === 'vllm' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-provider" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("h3", null, "vLLM \uC124\uC815"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "\uC11C\uBC84 \uC8FC\uC18C"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("input", { type: "text", className: "jp-agent-settings-input", value: vllmEndpoint, onChange: (e) => setVllmEndpoint(e.target.value), placeholder: "http://localhost:8000" })),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "API \uD0A4 (\uC120\uD0DD\uC0AC\uD56D)"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("input", { type: "password", className: "jp-agent-settings-input", value: vllmApiKey, onChange: (e) => setVllmApiKey(e.target.value), placeholder: "API \uD0A4\uAC00 \uD544\uC694\uD55C \uACBD\uC6B0 \uC785\uB825" })),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "\uBAA8\uB378 \uC774\uB984"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("input", { type: "text", className: "jp-agent-settings-input", value: vllmModel, onChange: (e) => setVllmModel(e.target.value), placeholder: "meta-llama/Llama-2-7b-chat-hf" })))),
                provider === 'openai' && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-provider" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("h3", null, "OpenAI \uC124\uC815"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "API \uD0A4"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("input", { type: "password", className: "jp-agent-settings-input", value: openaiApiKey, onChange: (e) => setOpenaiApiKey(e.target.value), placeholder: "sk-..." })),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-group" },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("label", { className: "jp-agent-settings-label" }, "\uBAA8\uB378"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement("select", { className: "jp-agent-settings-select", value: openaiModel, onChange: (e) => setOpenaiModel(e.target.value) },
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gpt-4" }, "GPT-4"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gpt-4-turbo" }, "GPT-4 Turbo"),
                            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("option", { value: "gpt-3.5-turbo" }, "GPT-3.5 Turbo")))))),
            testResult && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-test-result" }, testResult)),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement("div", { className: "jp-agent-settings-footer" },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-settings-button jp-agent-settings-button-secondary", onClick: onClose }, "\uCDE8\uC18C"),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-settings-button jp-agent-settings-button-test", onClick: handleTest, disabled: isTesting }, isTesting ? '테스트 중...' : 'API 테스트'),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement("button", { className: "jp-agent-settings-button jp-agent-settings-button-primary", onClick: handleSave }, "\uC800\uC7A5")))));
};


/***/ }),

/***/ "./lib/components/TaskProgressWidget.js":
/*!**********************************************!*\
  !*** ./lib/components/TaskProgressWidget.js ***!
  \**********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TaskProgressWidget: () => (/* binding */ TaskProgressWidget)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ "webpack/sharing/consume/default/react");
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @mui/material */ "webpack/sharing/consume/default/@mui/material/@mui/material");
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_mui_material__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _mui_icons_material_Close__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @mui/icons-material/Close */ "./node_modules/@mui/icons-material/esm/Close.js");
/* harmony import */ var _mui_icons_material_ExpandMore__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @mui/icons-material/ExpandMore */ "./node_modules/@mui/icons-material/esm/ExpandMore.js");
/* harmony import */ var _mui_icons_material_ExpandLess__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! @mui/icons-material/ExpandLess */ "./node_modules/@mui/icons-material/esm/ExpandLess.js");
/* harmony import */ var _mui_icons_material_CheckCircle__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! @mui/icons-material/CheckCircle */ "./node_modules/@mui/icons-material/esm/CheckCircle.js");
/* harmony import */ var _mui_icons_material_Error__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! @mui/icons-material/Error */ "./node_modules/@mui/icons-material/esm/Error.js");
/* harmony import */ var _mui_icons_material_Cancel__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! @mui/icons-material/Cancel */ "./node_modules/@mui/icons-material/esm/Cancel.js");
/**
 * Task Progress Widget Component
 * Floating widget showing notebook generation progress
 */








const TaskProgressWidget = ({ taskStatus, onClose, onCancel, onOpenNotebook }) => {
    const [expanded, setExpanded] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(true);
    const [showDetails, setShowDetails] = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
    const { status, progress, message, prompt, error, notebookPath } = taskStatus;
    const isComplete = status === 'completed';
    const isFailed = status === 'failed';
    const isCancelled = status === 'cancelled';
    const isRunning = status === 'running';
    const isDone = isComplete || isFailed || isCancelled;
    // Helper: Map status to color
    const getStatusColor = (currentStatus) => {
        switch (currentStatus) {
            case 'completed': return 'success';
            case 'failed': return 'error';
            case 'cancelled': return 'default';
            default: return 'primary';
        }
    };
    // Helper: Map status to icon
    const getStatusIcon = (currentStatus) => {
        switch (currentStatus) {
            case 'completed': return react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_CheckCircle__WEBPACK_IMPORTED_MODULE_5__["default"], { fontSize: "small" });
            case 'failed': return react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_Error__WEBPACK_IMPORTED_MODULE_6__["default"], { fontSize: "small" });
            case 'cancelled': return react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_Cancel__WEBPACK_IMPORTED_MODULE_7__["default"], { fontSize: "small" });
            default: return null;
        }
    };
    // Helper: Map status to Korean text
    const getStatusText = (currentStatus) => {
        const statusTextMap = {
            'pending': '대기 중',
            'running': '생성 중',
            'completed': '완료',
            'failed': '실패',
            'cancelled': '취소됨'
        };
        return statusTextMap[currentStatus] || currentStatus;
    };
    return (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Card, { sx: {
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: expanded ? 380 : 320,
            maxWidth: '90vw',
            boxShadow: 3,
            zIndex: 1300,
            transition: 'all 0.3s ease'
        } },
        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.CardContent, { sx: { padding: 2, '&:last-child': { paddingBottom: 2 } } },
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", alignItems: "center", gap: 1 },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "subtitle2", fontWeight: "bold" }, "\uB178\uD2B8\uBD81 \uC0DD\uC131"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Chip, { label: getStatusText(status), size: "small", color: getStatusColor(status), icon: getStatusIcon(status) || undefined })),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex" },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.IconButton, { size: "small", onClick: () => setShowDetails(!showDetails) }, showDetails ? (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_ExpandLess__WEBPACK_IMPORTED_MODULE_4__["default"], { fontSize: "small" })) : (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_ExpandMore__WEBPACK_IMPORTED_MODULE_3__["default"], { fontSize: "small" }))),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.IconButton, { size: "small", onClick: onClose },
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_icons_material_Close__WEBPACK_IMPORTED_MODULE_2__["default"], { fontSize: "small" })))),
            !isDone && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { mb: 2 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.LinearProgress, { variant: "determinate", value: progress, sx: { height: 6, borderRadius: 1 } }),
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", justifyContent: "space-between", mt: 0.5 },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary" }, message),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary" },
                        progress,
                        "%")))),
            isComplete && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { mb: 2 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "body2", color: "success.main" },
                    "\u2713 ",
                    message))),
            isFailed && error && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { mb: 2 },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "body2", color: "error.main" },
                    "\u2717 ",
                    error))),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Collapse, { in: showDetails },
                react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { sx: {
                        backgroundColor: 'action.hover',
                        borderRadius: 1,
                        padding: 1.5,
                        mb: 2
                    } },
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary", display: "block", mb: 0.5 }, "\uD504\uB86C\uD504\uD2B8:"),
                    react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "body2", sx: { wordBreak: 'break-word' } }, prompt),
                    notebookPath && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement((react__WEBPACK_IMPORTED_MODULE_0___default().Fragment), null,
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", color: "text.secondary", display: "block", mt: 1, mb: 0.5 }, "\uC800\uC7A5 \uC704\uCE58:"),
                        react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Typography, { variant: "caption", sx: { wordBreak: 'break-all', fontFamily: 'monospace' } }, notebookPath))))),
            react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Box, { display: "flex", gap: 1, justifyContent: "flex-end" },
                isRunning && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Button, { size: "small", variant: "outlined", onClick: onCancel }, "\uCDE8\uC18C")),
                isComplete && notebookPath && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Button, { size: "small", variant: "contained", onClick: onOpenNotebook }, "\uB178\uD2B8\uBD81 \uC5F4\uAE30")),
                isDone && (react__WEBPACK_IMPORTED_MODULE_0___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_1__.Button, { size: "small", variant: "text", onClick: onClose }, "\uB2EB\uAE30"))))));
};


/***/ }),

/***/ "./lib/index.js":
/*!**********************!*\
  !*** ./lib/index.js ***!
  \**********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _plugins_sidebar_plugin__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./plugins/sidebar-plugin */ "./lib/plugins/sidebar-plugin.js");
/* harmony import */ var _plugins_cell_buttons_plugin__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./plugins/cell-buttons-plugin */ "./lib/plugins/cell-buttons-plugin.js");
/* harmony import */ var _plugins_prompt_generation_plugin__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./plugins/prompt-generation-plugin */ "./lib/plugins/prompt-generation-plugin.js");
/* harmony import */ var _plugins_save_interceptor_plugin__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./plugins/save-interceptor-plugin */ "./lib/plugins/save-interceptor-plugin.js");
/**
 * Jupyter Agent Extension Entry Point
 */
// Import plugins




// Import styles
// import '../style/index.css';
/**
 * The main plugin export
 * Note: sidebarPlugin must load before cellButtonsPlugin
 * saveInterceptorPlugin loads last to intercept save operations
 */
const plugins = [
    _plugins_sidebar_plugin__WEBPACK_IMPORTED_MODULE_0__.sidebarPlugin,
    _plugins_cell_buttons_plugin__WEBPACK_IMPORTED_MODULE_1__.cellButtonsPlugin,
    _plugins_prompt_generation_plugin__WEBPACK_IMPORTED_MODULE_2__.promptGenerationPlugin,
    _plugins_save_interceptor_plugin__WEBPACK_IMPORTED_MODULE_3__.saveInterceptorPlugin
];
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (plugins);


/***/ }),

/***/ "./lib/plugins/cell-buttons-plugin.js":
/*!********************************************!*\
  !*** ./lib/plugins/cell-buttons-plugin.js ***!
  \********************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   cellButtonsPlugin: () => (/* binding */ cellButtonsPlugin)
/* harmony export */ });
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/notebook */ "webpack/sharing/consume/default/@jupyterlab/notebook");
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _types__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../types */ "./lib/types/index.js");
/**
 * Cell Buttons Plugin
 * Injects E, F, ? action buttons into notebook cells
 * Communicates with sidebar panel instead of Chrome extension
 */


/**
 * Cell Buttons Plugin
 */
const cellButtonsPlugin = {
    id: '@hdsp-agent/cell-buttons',
    autoStart: true,
    requires: [_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__.INotebookTracker],
    activate: (app, notebookTracker) => {
        console.log('[CellButtonsPlugin] Activated');
        // Store app reference globally for later use
        window.jupyterapp = app;
        // Handle new notebooks
        notebookTracker.widgetAdded.connect((sender, panel) => {
            console.log('[CellButtonsPlugin] Notebook widget added:', panel.id);
            // Wait for session to be ready
            panel.sessionContext.ready.then(() => {
                observeNotebook(panel);
            }).catch(err => {
                console.error('[CellButtonsPlugin] Error waiting for session:', err);
            });
        });
        // Handle current notebook if exists
        if (notebookTracker.currentWidget) {
            observeNotebook(notebookTracker.currentWidget);
        }
        // Handle notebook focus changes
        notebookTracker.currentChanged.connect((sender, panel) => {
            if (panel) {
                observeNotebook(panel);
            }
        });
    }
};
/**
 * Observe a notebook for cell changes and inject buttons
 */
function observeNotebook(panel) {
    const notebook = panel.content;
    // Initial injection with delay to ensure cells are rendered
    setTimeout(() => {
        injectButtonsIntoAllCells(notebook, panel);
        // Retry after longer delay for cells that weren't ready
        setTimeout(() => {
            injectButtonsIntoAllCells(notebook, panel);
        }, 500);
    }, 200);
    // Watch for cell changes (add/remove/reorder)
    const cellsChangedHandler = () => {
        setTimeout(() => {
            injectButtonsIntoAllCells(notebook, panel);
        }, 100);
    };
    // Remove any previous listeners to avoid duplicates
    try {
        notebook.model?.cells.changed.disconnect(cellsChangedHandler);
    }
    catch {
        // Ignore if not connected
    }
    // Connect new listener
    notebook.model?.cells.changed.connect(cellsChangedHandler);
}
/**
 * Inject buttons into all cells in a notebook
 */
function injectButtonsIntoAllCells(notebook, panel) {
    for (let i = 0; i < notebook.widgets.length; i++) {
        const cell = notebook.widgets[i];
        injectButtonsIntoCell(cell, panel);
    }
}
/**
 * Inject buttons into a single cell
 * Buttons are placed outside the cell (above), aligned with code start position
 */
function injectButtonsIntoCell(cell, panel) {
    // Safety checks
    if (!cell || !cell.model) {
        return;
    }
    const cellNode = cell.node;
    if (!cellNode || !cellNode.classList.contains('jp-Cell')) {
        return;
    }
    // Check if buttons already exist (using our unique class name)
    if (cellNode.querySelector('.jp-hdsp-cell-buttons')) {
        return;
    }
    // Find the prompt area to get the correct left offset
    const promptNode = cellNode.querySelector('.jp-InputPrompt, .jp-OutputPrompt');
    const promptWidth = promptNode ? promptNode.getBoundingClientRect().width : 64;
    // Find the input wrapper to insert before
    const inputWrapper = cellNode.querySelector('.jp-Cell-inputWrapper');
    if (!inputWrapper) {
        return;
    }
    // Create button container with unique class name to avoid conflicts
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'jp-hdsp-cell-buttons';
    buttonContainer.style.cssText = `
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    padding-left: ${promptWidth}px;
    background: transparent;
  `;
    // Create E button (Explain)
    const explainBtn = createButton('E', '설명 요청', () => {
        handleCellAction(_types__WEBPACK_IMPORTED_MODULE_1__.CellAction.EXPLAIN, cell);
    });
    // Create F button (Fix)
    const fixBtn = createButton('F', '수정 제안 요청', () => {
        handleCellAction(_types__WEBPACK_IMPORTED_MODULE_1__.CellAction.FIX, cell);
    });
    // Create ? button (Custom Prompt)
    const customBtn = createButton('?', '질문하기', () => {
        handleCellAction(_types__WEBPACK_IMPORTED_MODULE_1__.CellAction.CUSTOM_PROMPT, cell);
    });
    buttonContainer.appendChild(explainBtn);
    buttonContainer.appendChild(fixBtn);
    buttonContainer.appendChild(customBtn);
    // Insert before the input wrapper (outside the cell, above it)
    inputWrapper.parentNode?.insertBefore(buttonContainer, inputWrapper);
}
/**
 * Create a button element
 */
function createButton(label, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'jp-agent-button';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.onclick = onClick;
    // Add inline styles as fallback
    btn.style.cssText = `
    width: 24px !important;
    height: 24px !important;
    border: 1px solid #ddd !important;
    border-radius: 4px !important;
    background: white !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 12px !important;
    font-weight: bold !important;
    color: #333 !important;
    padding: 0 !important;
    margin: 0 2px !important;
    opacity: 1 !important;
    visibility: visible !important;
  `;
    return btn;
}
/**
 * Handle cell action button click
 */
async function handleCellAction(action, cell) {
    const cellContent = cell?.model?.sharedModel?.getSource() || '';
    if (!cellContent.trim()) {
        showNotification('셀 내용이 비어있습니다.', 'warning');
        return;
    }
    const cellIndex = getCellIndex(cell);
    if (action === _types__WEBPACK_IMPORTED_MODULE_1__.CellAction.CUSTOM_PROMPT) {
        // For custom prompt, show dialog (no confirmation needed)
        showCustomPromptDialog(cell);
    }
    else {
        // Get cell output
        const cellOutput = getCellOutput(cell);
        // Determine confirmation dialog content based on action
        let title = '';
        let message = '';
        switch (action) {
            case _types__WEBPACK_IMPORTED_MODULE_1__.CellAction.EXPLAIN:
                title = `셀 ${cellIndex}번째: 설명 요청`;
                message = '이 셀의 코드 설명을 보시겠습니까?';
                break;
            case _types__WEBPACK_IMPORTED_MODULE_1__.CellAction.FIX:
                title = `셀 ${cellIndex}번째: 수정 제안 요청`;
                message = '이 셀의 코드 개선 제안을 받으시겠습니까?';
                break;
        }
        // Show confirmation dialog first
        const confirmed = await showConfirmDialog(title, message);
        if (confirmed) {
            // User confirmed, send to sidebar panel
            sendToSidebarPanel(action, cell, cellContent, cellIndex, cellOutput);
        }
    }
}
/**
 * Get the index of a cell in the notebook
 */
function getCellIndex(cell) {
    const app = window.jupyterapp;
    const notebookTracker = app?.shell?.currentWidget?.content;
    if (!notebookTracker) {
        return -1;
    }
    const widgets = notebookTracker.widgets;
    for (let i = 0; i < widgets.length; i++) {
        if (widgets[i] === cell) {
            return i + 1; // Return 1-based index
        }
    }
    return -1;
}
/**
 * Extract output from a code cell
 */
function getCellOutput(cell) {
    // cell.model이 null일 수 있으므로 안전하게 체크
    if (!cell?.model || cell.model.type !== 'code') {
        return '';
    }
    const codeCell = cell;
    const outputs = codeCell.model?.outputs;
    if (!outputs || outputs.length === 0) {
        return '';
    }
    const outputTexts = [];
    for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);
        const outputType = output.type;
        if (outputType === 'stream') {
            // stdout, stderr
            const text = output.text;
            if (Array.isArray(text)) {
                outputTexts.push(text.join(''));
            }
            else {
                outputTexts.push(text);
            }
        }
        else if (outputType === 'execute_result' || outputType === 'display_data') {
            // Execution results or display data
            const data = output.data;
            if (data['text/plain']) {
                const text = data['text/plain'];
                if (Array.isArray(text)) {
                    outputTexts.push(text.join(''));
                }
                else {
                    outputTexts.push(text);
                }
            }
        }
        else if (outputType === 'error') {
            // Error output
            const traceback = output.traceback;
            if (Array.isArray(traceback)) {
                outputTexts.push(traceback.join('\n'));
            }
        }
    }
    return outputTexts.join('\n');
}
/**
 * Get or assign cell ID to a cell
 */
function getOrAssignCellId(cell) {
    const cellModel = cell.model;
    let cellId;
    // Try to get cell ID from metadata
    try {
        if (cellModel.metadata && typeof cellModel.metadata.get === 'function') {
            cellId = cellModel.metadata.get('jupyterAgentCellId');
        }
        else if (cellModel.metadata?.jupyterAgentCellId) {
            cellId = cellModel.metadata.jupyterAgentCellId;
        }
    }
    catch (e) {
        // Ignore errors
    }
    if (!cellId) {
        cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Try to set cell ID in metadata
        try {
            if (cellModel.metadata && typeof cellModel.metadata.set === 'function') {
                cellModel.metadata.set('jupyterAgentCellId', cellId);
            }
            else if (cellModel.metadata) {
                cellModel.metadata.jupyterAgentCellId = cellId;
            }
        }
        catch (e) {
            // Ignore errors
        }
    }
    return cellId;
}
/**
 * Send cell action to sidebar panel
 */
function sendToSidebarPanel(action, cell, cellContent, cellIndex, cellOutput) {
    const agentPanel = window._hdspAgentPanel;
    if (!agentPanel) {
        console.error('[CellButtonsPlugin] Agent panel not found. Make sure sidebar plugin is loaded.');
        return;
    }
    // Get or assign cell ID
    const cellId = getOrAssignCellId(cell);
    // Activate the sidebar panel
    const app = window.jupyterapp;
    if (app) {
        app.shell.activateById(agentPanel.id);
    }
    // Create user-facing display prompt
    let displayPrompt = '';
    // Create actual LLM prompt (based on chrome_agent)
    // Note: Use original content, not escaped. JSON.stringify will handle escaping.
    let llmPrompt = '';
    switch (action) {
        case _types__WEBPACK_IMPORTED_MODULE_1__.CellAction.EXPLAIN:
            // User sees: "Cell x: 설명 요청" (chrome_agent와 동일)
            displayPrompt = `${cellIndex}번째 셀: 설명 요청`;
            // LLM receives: chrome_agent와 동일한 프롬프트
            llmPrompt = `다음 Jupyter 셀의 내용을 자세히 설명해주세요:

\`\`\`python
${cellContent}
\`\`\``;
            break;
        case _types__WEBPACK_IMPORTED_MODULE_1__.CellAction.FIX:
            // Check if there's an error in the output
            const hasError = cellOutput && (cellOutput.includes('Error') ||
                cellOutput.includes('Traceback') ||
                cellOutput.includes('Exception') ||
                cellOutput.includes('에러') ||
                cellOutput.includes('오류'));
            if (hasError && cellOutput) {
                // 에러가 있는 경우 (chrome_agent와 동일)
                displayPrompt = `${cellIndex}번째 셀: 에러 수정 요청`;
                llmPrompt = `다음 Jupyter 셀 코드에 에러가 발생했습니다.

원본 코드:
\`\`\`python
${cellContent}
\`\`\`

에러:
\`\`\`
${cellOutput}
\`\`\`

다음 형식으로 응답해주세요:

## 에러 원인
(에러가 발생한 원인을 간단히 설명)

## 수정 방법

### 방법 1: (수정 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

### 방법 2: (수정 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

### 방법 3: (수정 방법 제목) (있는 경우)
(이 방법에 대한 간단한 설명)
\`\`\`python
(수정된 코드)
\`\`\`

최소 2개, 최대 3개의 다양한 수정 방법을 제안해주세요.`;
            }
            else {
                // 에러가 없는 경우 - 코드 리뷰/개선 제안 (chrome_agent와 동일)
                displayPrompt = `${cellIndex}번째 셀: 개선 제안 요청`;
                llmPrompt = `다음 Jupyter 셀 코드를 리뷰하고 개선 방법을 제안해주세요.

코드:
\`\`\`python
${cellContent}
\`\`\`

다음 형식으로 응답해주세요:

## 코드 분석
(현재 코드의 기능과 특징을 간단히 설명)

## 개선 방법

### 방법 1: (개선 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

### 방법 2: (개선 방법 제목)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

### 방법 3: (개선 방법 제목) (있는 경우)
(이 방법에 대한 간단한 설명)
\`\`\`python
(개선된 코드)
\`\`\`

최소 2개, 최대 3개의 다양한 개선 방법을 제안해주세요.`;
            }
            break;
    }
    // Send both prompts to panel with cell ID and cell index
    if (agentPanel.addCellActionMessage) {
        // cellIndex is 1-based (for display), convert to 0-based for array access
        const cellIndexZeroBased = cellIndex - 1;
        agentPanel.addCellActionMessage(action, cellContent, displayPrompt, llmPrompt, cellId, cellIndexZeroBased);
    }
}
/**
 * Helper: Remove existing dialog if present
 */
function removeExistingDialog(className) {
    const existingDialog = document.querySelector(`.${className}`);
    if (existingDialog) {
        existingDialog.remove();
    }
}
/**
 * Helper: Create dialog overlay element
 */
function createDialogOverlay(className) {
    const dialogOverlay = document.createElement('div');
    dialogOverlay.className = className;
    dialogOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.3);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
    return dialogOverlay;
}
/**
 * Helper: Create dialog container element
 */
function createDialogContainer(maxWidth = '400px') {
    const dialogContainer = document.createElement('div');
    dialogContainer.style.cssText = `
    background: #fafafa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 24px;
    max-width: ${maxWidth};
    width: 90%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
    return dialogContainer;
}
/**
 * Show confirmation dialog
 * Based on chrome_agent's showConfirmDialog implementation
 */
function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        removeExistingDialog('jp-agent-confirm-dialog');
        const dialogOverlay = createDialogOverlay('jp-agent-confirm-dialog');
        const dialogContainer = createDialogContainer();
        // Dialog content
        dialogContainer.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px 0; color: #424242; font-size: 16px; font-weight: 500;">
          ${escapeHtml(title)}
        </h3>
        <p style="margin: 0; color: #616161; font-size: 14px; line-height: 1.5;">
          ${escapeHtml(message)}
        </p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="jp-agent-confirm-cancel-btn" style="
          background: transparent;
          color: #616161;
          border: 1px solid #d1d5db;
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">취소</button>
        <button class="jp-agent-confirm-submit-btn" style="
          background: #1976d2;
          color: white;
          border: 1px solid #1976d2;
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">확인</button>
      </div>
    `;
        dialogOverlay.appendChild(dialogContainer);
        document.body.appendChild(dialogOverlay);
        // Button event listeners
        const cancelBtn = dialogContainer.querySelector('.jp-agent-confirm-cancel-btn');
        const submitBtn = dialogContainer.querySelector('.jp-agent-confirm-submit-btn');
        // Cancel button
        cancelBtn.addEventListener('click', () => {
            dialogOverlay.remove();
            resolve(false);
        });
        cancelBtn.addEventListener('mouseenter', () => {
            cancelBtn.style.background = '#f5f5f5';
        });
        cancelBtn.addEventListener('mouseleave', () => {
            cancelBtn.style.background = 'transparent';
        });
        // Submit button
        submitBtn.addEventListener('click', () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '처리 중...';
            // Small delay to show processing state
            setTimeout(() => {
                dialogOverlay.remove();
                resolve(true);
            }, 100);
        });
        submitBtn.addEventListener('mouseenter', () => {
            if (!submitBtn.disabled) {
                submitBtn.style.background = '#1565c0';
            }
        });
        submitBtn.addEventListener('mouseleave', () => {
            if (!submitBtn.disabled) {
                submitBtn.style.background = '#1976d2';
            }
        });
        // ESC key to close
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                dialogOverlay.remove();
                document.removeEventListener('keydown', handleEsc);
                resolve(false);
            }
        };
        document.addEventListener('keydown', handleEsc);
        // Close on overlay click
        dialogOverlay.addEventListener('click', (e) => {
            if (e.target === dialogOverlay) {
                dialogOverlay.remove();
                document.removeEventListener('keydown', handleEsc);
                resolve(false);
            }
        });
    });
}
/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Escape content for markdown code blocks
 * Based on chrome_agent's escapeContent function
 */
function escapeContent(content) {
    if (!content)
        return '';
    // 백슬래시를 먼저 escape (다른 escape 처리 전에 수행)
    let escaped = content.replace(/\\/g, '\\\\');
    // 백틱 escape (마크다운 코드 블록 안에서 문제 방지)
    escaped = escaped.replace(/`/g, '\\`');
    return escaped;
}
/**
 * Get notification background color
 */
function getNotificationColor(type) {
    switch (type) {
        case 'error': return '#f56565';
        case 'warning': return '#ed8936';
        default: return '#4299e1';
    }
}
/**
 * Create notification element with styles
 */
function createNotificationElement(message, backgroundColor) {
    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10001;
    opacity: 0;
    transition: opacity 0.3s ease;
    max-width: 300px;
    word-wrap: break-word;
    background: ${backgroundColor};
  `;
    notification.textContent = message;
    return notification;
}
/**
 * Animate notification appearance and removal
 */
function animateNotification(notification) {
    // Show animation
    setTimeout(() => notification.style.opacity = '1', 10);
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}
/**
 * Show notification (simple implementation)
 */
function showNotification(message, type = 'info') {
    const notification = createNotificationElement(message, getNotificationColor(type));
    document.body.appendChild(notification);
    animateNotification(notification);
}
/**
 * Show custom prompt dialog
 * Based on chrome_agent's showCustomPromptDialog implementation
 */
function showCustomPromptDialog(cell) {
    const cellContent = cell?.model?.sharedModel?.getSource() || '';
    const cellIndex = getCellIndex(cell);
    const cellId = getOrAssignCellId(cell);
    console.log('커스텀 프롬프트 다이얼로그 표시', cellIndex, cellId);
    removeExistingDialog('jp-agent-custom-prompt-dialog');
    const dialogOverlay = createDialogOverlay('jp-agent-custom-prompt-dialog');
    const dialogContainer = createDialogContainer('500px');
    // 다이얼로그 내용
    dialogContainer.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; color: #424242; font-size: 16px; font-weight: 500;">
        셀에 대해 질문하기
      </h3>
      <p style="margin: 0; color: #757575; font-size: 13px;">
        물리적 위치: 셀 ${cellIndex + 1}번째 (위에서 아래로 카운트)
      </p>
    </div>
    <div style="margin-bottom: 20px;">
      <textarea class="jp-agent-custom-prompt-input"
        placeholder="이 셀에 대해 질문할 내용을 입력하세요..."
        style="
          width: 100%;
          min-height: 100px;
          padding: 12px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 14px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          resize: vertical;
          box-sizing: border-box;
        "
      ></textarea>
    </div>
    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button class="jp-agent-custom-prompt-cancel-btn" style="
        background: transparent;
        color: #616161;
        border: 1px solid #d1d5db;
        border-radius: 3px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      ">취소</button>
      <button class="jp-agent-custom-prompt-submit-btn" style="
        background: transparent;
        color: #1976d2;
        border: 1px solid #1976d2;
        border-radius: 3px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      ">질문</button>
    </div>
  `;
    dialogOverlay.appendChild(dialogContainer);
    document.body.appendChild(dialogOverlay);
    // 입력 필드에 포커스
    const inputField = dialogContainer.querySelector('.jp-agent-custom-prompt-input');
    setTimeout(() => inputField?.focus(), 100);
    // 버튼 이벤트 리스너
    const cancelBtn = dialogContainer.querySelector('.jp-agent-custom-prompt-cancel-btn');
    const submitBtn = dialogContainer.querySelector('.jp-agent-custom-prompt-submit-btn');
    // 취소 버튼
    cancelBtn.addEventListener('click', () => {
        dialogOverlay.remove();
    });
    cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = '#f5f5f5';
        cancelBtn.style.borderColor = '#9ca3af';
    });
    cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = 'transparent';
        cancelBtn.style.borderColor = '#d1d5db';
    });
    // 제출 버튼
    const handleSubmit = async () => {
        const promptText = inputField?.value.trim() || '';
        if (!promptText) {
            showNotification('질문 내용을 입력해주세요.', 'warning');
            return;
        }
        dialogOverlay.remove();
        // Get cell output
        const cellOutput = getCellOutput(cell);
        // Create display prompt: "Cell x: Custom request"
        const displayPrompt = `${cellIndex}번째 셀: ${promptText}`;
        // Create LLM prompt with code and output
        let llmPrompt = `${promptText}\n\n셀 내용:\n\`\`\`\n${cellContent}\n\`\`\``;
        if (cellOutput) {
            llmPrompt += `\n\n실행 결과:\n\`\`\`\n${cellOutput}\n\`\`\``;
        }
        const agentPanel = window._hdspAgentPanel;
        if (agentPanel) {
            // Activate the sidebar panel
            const app = window.jupyterapp;
            if (app) {
                app.shell.activateById(agentPanel.id);
            }
            // Send both prompts with cell ID and cell index
            if (agentPanel.addCellActionMessage) {
                // cellIndex is 1-based (for display), convert to 0-based for array access
                const cellIndexZeroBased = cellIndex - 1;
                agentPanel.addCellActionMessage(_types__WEBPACK_IMPORTED_MODULE_1__.CellAction.CUSTOM_PROMPT, cellContent, displayPrompt, llmPrompt, cellId, cellIndexZeroBased);
            }
        }
    };
    submitBtn.addEventListener('click', handleSubmit);
    submitBtn.addEventListener('mouseenter', () => {
        submitBtn.style.background = 'rgba(25, 118, 210, 0.1)';
    });
    submitBtn.addEventListener('mouseleave', () => {
        submitBtn.style.background = 'transparent';
    });
    // Enter 키로 제출 (Shift+Enter는 줄바꿈)
    inputField?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    });
    // 오버레이 클릭 시 다이얼로그 닫기
    dialogOverlay.addEventListener('click', (e) => {
        if (e.target === dialogOverlay) {
            dialogOverlay.remove();
        }
    });
    // ESC 키로 다이얼로그 닫기
    const handleEscapeKey = (e) => {
        if (e.key === 'Escape') {
            dialogOverlay.remove();
            document.removeEventListener('keydown', handleEscapeKey);
        }
    };
    document.addEventListener('keydown', handleEscapeKey);
}


/***/ }),

/***/ "./lib/plugins/prompt-generation-plugin.js":
/*!*************************************************!*\
  !*** ./lib/plugins/prompt-generation-plugin.js ***!
  \*************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   promptGenerationPlugin: () => (/* binding */ promptGenerationPlugin)
/* harmony export */ });
/* harmony import */ var _jupyterlab_launcher__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/launcher */ "webpack/sharing/consume/default/@jupyterlab/launcher");
/* harmony import */ var _jupyterlab_launcher__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_launcher__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/apputils */ "webpack/sharing/consume/default/@jupyterlab/apputils");
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _jupyterlab_docmanager__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @jupyterlab/docmanager */ "webpack/sharing/consume/default/@jupyterlab/docmanager");
/* harmony import */ var _jupyterlab_docmanager__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_docmanager__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @jupyterlab/ui-components */ "webpack/sharing/consume/default/@jupyterlab/ui-components");
/* harmony import */ var _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _lumino_widgets__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! @lumino/widgets */ "webpack/sharing/consume/default/@lumino/widgets");
/* harmony import */ var _lumino_widgets__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_lumino_widgets__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! react */ "webpack/sharing/consume/default/react");
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! @mui/material */ "webpack/sharing/consume/default/@mui/material/@mui/material");
/* harmony import */ var _mui_material__WEBPACK_IMPORTED_MODULE_6___default = /*#__PURE__*/__webpack_require__.n(_mui_material__WEBPACK_IMPORTED_MODULE_6__);
/* harmony import */ var _styles_icons_hdsp_icon_svg__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../styles/icons/hdsp-icon.svg */ "./lib/styles/icons/hdsp-icon.svg");
/* harmony import */ var _components_PromptGenerationDialog__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../components/PromptGenerationDialog */ "./lib/components/PromptGenerationDialog.js");
/* harmony import */ var _components_TaskProgressWidget__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ../components/TaskProgressWidget */ "./lib/components/TaskProgressWidget.js");
/* harmony import */ var _services_TaskService__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ../services/TaskService */ "./lib/services/TaskService.js");
/**
 * Prompt Generation Plugin
 * Adds "프롬프트 생성" to Jupyter Launcher
 */











/**
 * Plugin constants
 */
const PLUGIN_ID = '@hdsp-agent/prompt-generation';
const COMMAND_ID = 'hdsp-agent:generate-from-prompt';
const CATEGORY = 'HDSP Agent';
/**
 * HDSP Icon
 */
const hdspIcon = new _jupyterlab_ui_components__WEBPACK_IMPORTED_MODULE_3__.LabIcon({
    name: 'hdsp-agent:hdsp-icon',
    svgstr: _styles_icons_hdsp_icon_svg__WEBPACK_IMPORTED_MODULE_7__
});
/**
 * Task Manager Widget
 * Manages active notebook generation tasks
 */
class TaskManagerWidget extends _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.ReactWidget {
    constructor(app, docManager) {
        super();
        this.app = app;
        this.docManager = docManager;
        this.taskService = new _services_TaskService__WEBPACK_IMPORTED_MODULE_10__.TaskService();
        this.activeTasks = new Map();
        this.addClass('jp-TaskManagerWidget');
    }
    /**
     * Start a new notebook generation task
     */
    async startGeneration(prompt) {
        try {
            // Start generation
            const response = await this.taskService.generateNotebook({ prompt });
            const taskId = response.taskId;
            // Subscribe to progress
            this.taskService.subscribeToTaskProgress(taskId, (status) => {
                this.activeTasks.set(taskId, status);
                this.update();
                // Show notification on completion
                if (status.status === 'completed' && status.notebookPath) {
                    _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.success(`노트북 생성 완료: ${status.notebookPath.split('/').pop()}`, {
                        autoClose: 5000
                    });
                }
                else if (status.status === 'failed') {
                    _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.error(`노트북 생성 실패: ${status.error}`, {
                        autoClose: 10000
                    });
                }
            }, (error) => {
                console.error('Task progress error:', error);
                _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.error('진행상황 연결 실패', { autoClose: 5000 });
            }, () => {
                // Task completed, keep in list for user to review
                this.update();
            });
            // Show initial notification
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.info('노트북 생성을 시작했습니다', { autoClose: 3000 });
            this.update();
        }
        catch (error) {
            console.error('Failed to start generation:', error);
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.error(`생성 시작 실패: ${error.message}`, {
                autoClose: 5000
            });
        }
    }
    /**
     * Cancel a task
     */
    async cancelTask(taskId) {
        try {
            await this.taskService.cancelTask(taskId);
            this.activeTasks.delete(taskId);
            this.update();
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.info('작업을 취소했습니다', { autoClose: 3000 });
        }
        catch (error) {
            console.error('Failed to cancel task:', error);
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.error(`취소 실패: ${error.message}`, { autoClose: 5000 });
        }
    }
    /**
     * Close/remove task from display
     */
    closeTask(taskId) {
        this.taskService.unsubscribeFromTask(taskId);
        this.activeTasks.delete(taskId);
        this.update();
    }
    /**
     * Open generated notebook
     */
    async openNotebook(notebookPath, taskId) {
        try {
            // Extract just the filename from the path
            const filename = notebookPath.split('/').pop() || notebookPath;
            // Open the notebook
            await this.docManager.openOrReveal(filename);
            // Close the task widget after opening
            this.closeTask(taskId);
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.success(`노트북을 열었습니다: ${filename}`, {
                autoClose: 3000
            });
        }
        catch (error) {
            console.error('Failed to open notebook:', error);
            _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.Notification.error(`노트북 열기 실패: ${error.message}`, {
                autoClose: 5000
            });
        }
    }
    render() {
        const theme = (0,_mui_material__WEBPACK_IMPORTED_MODULE_6__.createTheme)();
        const tasks = Array.from(this.activeTasks.entries());
        return (react__WEBPACK_IMPORTED_MODULE_5___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_6__.ThemeProvider, { theme: theme },
            react__WEBPACK_IMPORTED_MODULE_5___default().createElement("div", { style: { position: 'fixed', bottom: 0, right: 0, zIndex: 1300 } }, tasks.map(([taskId, status], index) => (react__WEBPACK_IMPORTED_MODULE_5___default().createElement("div", { key: taskId, style: {
                    marginBottom: index < tasks.length - 1 ? '10px' : '0'
                } },
                react__WEBPACK_IMPORTED_MODULE_5___default().createElement(_components_TaskProgressWidget__WEBPACK_IMPORTED_MODULE_9__.TaskProgressWidget, { taskStatus: status, onClose: () => this.closeTask(taskId), onCancel: () => this.cancelTask(taskId), onOpenNotebook: () => status.notebookPath &&
                        this.openNotebook(status.notebookPath, taskId) })))))));
    }
    dispose() {
        this.taskService.dispose();
        super.dispose();
    }
}
/**
 * Dialog Widget for prompt input
 */
class PromptDialogWidget extends _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.ReactWidget {
    constructor(onGenerate, onClose) {
        super();
        this._onGenerate = onGenerate;
        this._onClose = onClose;
    }
    render() {
        const theme = (0,_mui_material__WEBPACK_IMPORTED_MODULE_6__.createTheme)();
        return (react__WEBPACK_IMPORTED_MODULE_5___default().createElement(_mui_material__WEBPACK_IMPORTED_MODULE_6__.ThemeProvider, { theme: theme },
            react__WEBPACK_IMPORTED_MODULE_5___default().createElement(_components_PromptGenerationDialog__WEBPACK_IMPORTED_MODULE_8__.PromptGenerationDialog, { open: true, onClose: this._onClose, onGenerate: this._onGenerate })));
    }
}
/**
 * Prompt Generation Plugin
 */
const promptGenerationPlugin = {
    id: PLUGIN_ID,
    autoStart: true,
    requires: [_jupyterlab_docmanager__WEBPACK_IMPORTED_MODULE_2__.IDocumentManager],
    optional: [_jupyterlab_launcher__WEBPACK_IMPORTED_MODULE_0__.ILauncher, _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.ICommandPalette],
    activate: (app, docManager, launcher, palette) => {
        console.log('[PromptGenerationPlugin] Activating');
        try {
            // Create task manager widget
            const taskManager = new TaskManagerWidget(app, docManager);
            taskManager.id = 'hdsp-agent-task-manager';
            taskManager.title.label = 'Task Manager';
            // Add to shell but keep it as a floating overlay (not in main area)
            // The widget renders itself as a fixed position element
            _lumino_widgets__WEBPACK_IMPORTED_MODULE_4__.Widget.attach(taskManager, document.body);
            // Add command
            app.commands.addCommand(COMMAND_ID, {
                label: '프롬프트로 노트북 만들기',
                caption: '프롬프트로 노트북 만들기',
                icon: hdspIcon,
                execute: () => {
                    // Create dialog widget
                    let dialogWidget = null;
                    const onGenerate = async (prompt) => {
                        if (dialogWidget) {
                            dialogWidget.dispose();
                            dialogWidget = null;
                        }
                        await taskManager.startGeneration(prompt);
                    };
                    const onClose = () => {
                        if (dialogWidget) {
                            dialogWidget.dispose();
                            dialogWidget = null;
                        }
                    };
                    dialogWidget = new PromptDialogWidget(onGenerate, onClose);
                    dialogWidget.id = 'hdsp-agent-prompt-dialog';
                    dialogWidget.title.label = '';
                    app.shell.add(dialogWidget, 'main');
                }
            });
            // Add to launcher
            if (launcher) {
                launcher.add({
                    command: COMMAND_ID,
                    category: 'Notebook',
                    rank: 1
                });
            }
            // Add to command palette
            if (palette) {
                palette.addItem({
                    command: COMMAND_ID,
                    category: CATEGORY
                });
            }
            console.log('[PromptGenerationPlugin] Activated successfully');
        }
        catch (error) {
            console.error('[PromptGenerationPlugin] Failed to activate:', error);
        }
    }
};


/***/ }),

/***/ "./lib/plugins/save-interceptor-plugin.js":
/*!************************************************!*\
  !*** ./lib/plugins/save-interceptor-plugin.js ***!
  \************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   saveInterceptorPlugin: () => (/* binding */ saveInterceptorPlugin)
/* harmony export */ });
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/notebook */ "webpack/sharing/consume/default/@jupyterlab/notebook");
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/apputils */ "webpack/sharing/consume/default/@jupyterlab/apputils");
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__);
/**
 * Save Interceptor Plugin
 * Intercepts notebook save operations to offer code review before saving
 * Based on chrome_agent's save interception functionality
 */


/**
 * Save Interceptor Plugin
 */
const saveInterceptorPlugin = {
    id: '@hdsp-agent/save-interceptor',
    autoStart: true,
    requires: [_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__.INotebookTracker],
    optional: [_jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.ICommandPalette],
    activate: (app, notebookTracker, palette) => {
        console.log('[SaveInterceptorPlugin] Activated');
        let isSaving = false;
        let originalSaveCommand = null;
        // Store original save command and wrap it
        if (app.commands.hasCommand('docmanager:save')) {
            console.log('[SaveInterceptorPlugin] Found docmanager:save command');
            const commandRegistry = app.commands;
            const commandId = 'docmanager:save';
            // Get the original command's execute function
            const originalCommand = commandRegistry._commands.get(commandId);
            if (originalCommand) {
                originalSaveCommand = originalCommand.execute.bind(originalCommand);
                console.log('[SaveInterceptorPlugin] Stored original save command');
                // Replace the execute function
                originalCommand.execute = async (args) => {
                    const currentWidget = notebookTracker.currentWidget;
                    console.log('[SaveInterceptorPlugin] Save command triggered', {
                        hasCurrentWidget: !!currentWidget,
                        isSaving: isSaving,
                        widgetType: currentWidget?.constructor?.name
                    });
                    // Only intercept for notebooks
                    if (!currentWidget) {
                        console.log('[SaveInterceptorPlugin] No current widget, allowing default save');
                        return originalSaveCommand(args);
                    }
                    if (isSaving) {
                        console.log('[SaveInterceptorPlugin] Already in save process, executing actual save');
                        return originalSaveCommand(args);
                    }
                    console.log('[SaveInterceptorPlugin] Intercepting save, showing modal');
                    await handleSaveIntercept(currentWidget, app, originalSaveCommand, args, () => isSaving = true, () => isSaving = false);
                };
                console.log('[SaveInterceptorPlugin] Wrapped save command installed');
            }
            else {
                console.error('[SaveInterceptorPlugin] Could not find original save command');
            }
        }
        // Also intercept keyboard shortcut as backup
        document.addEventListener('keydown', async (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                const currentWidget = notebookTracker.currentWidget;
                if (!currentWidget) {
                    return; // Not in a notebook, let default save happen
                }
                console.log('[SaveInterceptorPlugin] Save shortcut (Ctrl/Cmd+S) detected');
                e.preventDefault();
                e.stopPropagation();
                if (isSaving) {
                    console.log('[SaveInterceptorPlugin] Already saving, ignoring duplicate request');
                    return;
                }
                if (!originalSaveCommand) {
                    console.error('[SaveInterceptorPlugin] No original save command stored');
                    return;
                }
                await handleSaveIntercept(currentWidget, app, originalSaveCommand, undefined, () => isSaving = true, () => isSaving = false);
            }
        }, true); // Use capture phase to intercept before JupyterLab
        console.log('[SaveInterceptorPlugin] Save interception enabled');
    }
};
/**
 * Handle save intercept - show modal and collect cells if needed
 */
async function handleSaveIntercept(panel, app, originalSaveCommand, args, setSaving, clearSaving) {
    // Show confirmation modal
    const shouldAnalyze = await showSaveConfirmModal();
    if (shouldAnalyze === null) {
        // User cancelled
        clearSaving();
        return;
    }
    if (shouldAnalyze) {
        // Collect all cells and send for analysis
        await performAnalysisSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
    }
    else {
        // Direct save without analysis
        await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
    }
}
/**
 * Show save confirmation modal
 * Returns: true for analysis, false for direct save, null for cancel
 */
function showSaveConfirmModal() {
    return new Promise((resolve) => {
        // Remove existing modal if any
        const existingModal = document.querySelector('.jp-agent-save-confirm-modal');
        if (existingModal) {
            existingModal.remove();
        }
        // Create modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'jp-agent-save-confirm-modal';
        modalOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
        // Create modal container
        const modalContainer = document.createElement('div');
        modalContainer.style.cssText = `
      background: var(--jp-layout-color1);
      border: 1px solid var(--jp-border-color1);
      border-radius: 4px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      font-family: var(--jp-ui-font-family);
    `;
        // Modal content
        modalContainer.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px 0; color: var(--jp-ui-font-color1); font-size: 16px; font-weight: 500;">
          저장 전에 코드 검수를 하겠습니까?
        </h3>
        <p style="margin: 0; color: var(--jp-ui-font-color2); font-size: 14px; line-height: 1.5;">
          노트북을 저장하기 전에 모든 셀의 코드와 출력을 분석하여 최적화 제안을 받으시겠습니까?
        </p>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="jp-agent-save-direct-btn" style="
          background: transparent;
          color: var(--jp-ui-font-color2);
          border: 1px solid var(--jp-border-color2);
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">그냥 저장하기</button>
        <button class="jp-agent-save-analysis-btn" style="
          background: var(--jp-brand-color1);
          color: white;
          border: 1px solid var(--jp-brand-color1);
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        ">검수 후 저장하기</button>
      </div>
    `;
        modalOverlay.appendChild(modalContainer);
        document.body.appendChild(modalOverlay);
        // Button event listeners
        const directSaveBtn = modalContainer.querySelector('.jp-agent-save-direct-btn');
        const analysisSaveBtn = modalContainer.querySelector('.jp-agent-save-analysis-btn');
        // Direct save button
        directSaveBtn.addEventListener('click', () => {
            console.log('[SaveInterceptorPlugin] User chose direct save');
            modalOverlay.remove();
            resolve(false);
        });
        directSaveBtn.addEventListener('mouseenter', () => {
            directSaveBtn.style.background = 'var(--jp-layout-color2)';
        });
        directSaveBtn.addEventListener('mouseleave', () => {
            directSaveBtn.style.background = 'transparent';
        });
        // Analysis save button
        analysisSaveBtn.addEventListener('click', () => {
            console.log('[SaveInterceptorPlugin] User chose analysis save');
            modalOverlay.remove();
            resolve(true);
        });
        analysisSaveBtn.addEventListener('mouseenter', () => {
            analysisSaveBtn.style.opacity = '0.9';
        });
        analysisSaveBtn.addEventListener('mouseleave', () => {
            analysisSaveBtn.style.opacity = '1';
        });
        // Close on overlay click
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                console.log('[SaveInterceptorPlugin] User cancelled save');
                modalOverlay.remove();
                resolve(null);
            }
        });
        // ESC key to close
        const handleEscapeKey = (e) => {
            if (e.key === 'Escape') {
                console.log('[SaveInterceptorPlugin] User cancelled save with ESC');
                modalOverlay.remove();
                document.removeEventListener('keydown', handleEscapeKey);
                resolve(null);
            }
        };
        document.addEventListener('keydown', handleEscapeKey);
    });
}
/**
 * Perform direct save without analysis
 */
async function performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving) {
    console.log('[SaveInterceptorPlugin] Performing direct save');
    setSaving();
    try {
        // Use the original save command
        if (originalSaveCommand) {
            await originalSaveCommand(args);
            showNotification('저장이 완료되었습니다.', 'success');
        }
        else {
            // Fallback: Use JupyterLab's document manager to save
            const context = panel.context;
            if (context) {
                await context.save();
                showNotification('저장이 완료되었습니다.', 'success');
            }
        }
    }
    catch (error) {
        console.error('[SaveInterceptorPlugin] Save failed:', error);
        showNotification('저장에 실패했습니다.', 'error');
    }
    finally {
        clearSaving();
    }
}
/**
 * Perform analysis save - collect cells and send to AgentPanel
 */
async function performAnalysisSave(panel, app, originalSaveCommand, args, setSaving, clearSaving) {
    console.log('[SaveInterceptorPlugin] Performing analysis save');
    try {
        // Collect all code cells
        const cells = await collectAllCodeCells(panel);
        if (cells.length === 0) {
            showNotification('분석할 코드 셀이 없습니다. 그냥 저장합니다.', 'warning');
            await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
            return;
        }
        showNotification('코드 분석을 시작합니다...', 'info');
        // Get AgentPanel instance
        const agentPanel = window._hdspAgentPanel;
        if (!agentPanel) {
            console.error('[SaveInterceptorPlugin] Agent panel not found');
            showNotification('Agent panel을 찾을 수 없습니다. 그냥 저장합니다.', 'warning');
            await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
            return;
        }
        // Activate the sidebar panel
        if (app) {
            app.shell.activateById(agentPanel.id);
        }
        // Send cells to AgentPanel for analysis
        if (agentPanel.analyzeNotebook) {
            agentPanel.analyzeNotebook(cells, async () => {
                // Callback after analysis complete - perform save
                await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
            });
        }
        else {
            console.error('[SaveInterceptorPlugin] analyzeNotebook method not found on AgentPanel');
            showNotification('분석 기능을 사용할 수 없습니다. 그냥 저장합니다.', 'warning');
            await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
        }
    }
    catch (error) {
        console.error('[SaveInterceptorPlugin] Analysis save failed:', error);
        showNotification('분석에 실패했습니다. 그냥 저장합니다.', 'warning');
        await performDirectSave(panel, app, originalSaveCommand, args, setSaving, clearSaving);
    }
}
/**
 * Collect all code cells with content, output, and imports
 * Based on chrome_agent's collectAllCodeCells implementation
 */
async function collectAllCodeCells(panel) {
    const notebook = panel.content;
    const cells = [];
    for (let i = 0; i < notebook.widgets.length; i++) {
        const cell = notebook.widgets[i];
        // Only collect code cells - null safety 추가
        if (!cell?.model || cell.model.type !== 'code') {
            continue;
        }
        const content = cell.model.sharedModel?.getSource() || '';
        if (!content.trim()) {
            continue;
        }
        // Get or assign cell ID
        const cellId = getOrAssignCellId(cell);
        // Extract output
        const output = getCellOutput(cell);
        // Extract imports
        const imports = extractImports(content);
        // Get local module sources (simplified - would need kernel API access for full implementation)
        const localImports = imports.filter(imp => imp.isLocal);
        const localModuleSources = {};
        // Note: Full module source extraction would require kernel websocket connection
        // This is a simplified version for now
        for (const imp of localImports) {
            if (!imp.module.startsWith('.')) {
                // Could implement kernel-based source extraction here
                localModuleSources[imp.module] = `# Source for ${imp.module} would be fetched from kernel`;
            }
        }
        cells.push({
            index: i,
            id: cellId,
            content: content,
            type: 'code',
            output: output,
            imports: imports,
            localModuleSources: Object.keys(localModuleSources).length > 0 ? localModuleSources : undefined
        });
    }
    console.log(`[SaveInterceptorPlugin] Collected ${cells.length} code cells`);
    return cells;
}
/**
 * Get or assign cell ID to a cell
 */
function getOrAssignCellId(cell) {
    const cellModel = cell.model;
    let cellId;
    // Try to get cell ID from metadata
    try {
        if (cellModel.metadata && typeof cellModel.metadata.get === 'function') {
            cellId = cellModel.metadata.get('jupyterAgentCellId');
        }
        else if (cellModel.metadata?.jupyterAgentCellId) {
            cellId = cellModel.metadata.jupyterAgentCellId;
        }
    }
    catch (e) {
        // Ignore errors
    }
    if (!cellId) {
        cellId = `cell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Try to set cell ID in metadata
        try {
            if (cellModel.metadata && typeof cellModel.metadata.set === 'function') {
                cellModel.metadata.set('jupyterAgentCellId', cellId);
            }
            else if (cellModel.metadata) {
                cellModel.metadata.jupyterAgentCellId = cellId;
            }
        }
        catch (e) {
            // Ignore errors
        }
    }
    return cellId;
}
/**
 * Extract output from a code cell
 */
function getCellOutput(cell) {
    // cell.model이 null일 수 있으므로 안전하게 체크
    if (!cell?.model || cell.model.type !== 'code') {
        return '';
    }
    const codeCell = cell;
    const outputs = codeCell.model?.outputs;
    if (!outputs || outputs.length === 0) {
        return '';
    }
    const outputTexts = [];
    for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);
        const outputType = output.type;
        if (outputType === 'stream') {
            // stdout, stderr
            const text = output.text;
            if (Array.isArray(text)) {
                outputTexts.push(text.join(''));
            }
            else {
                outputTexts.push(text);
            }
        }
        else if (outputType === 'execute_result' || outputType === 'display_data') {
            // Execution results or display data
            const data = output.data;
            if (data['text/plain']) {
                const text = data['text/plain'];
                if (Array.isArray(text)) {
                    outputTexts.push(text.join(''));
                }
                else {
                    outputTexts.push(text);
                }
            }
        }
        else if (outputType === 'error') {
            // Error output
            const traceback = output.traceback;
            if (Array.isArray(traceback)) {
                outputTexts.push(traceback.join('\n'));
            }
        }
    }
    return outputTexts.join('\n');
}
/**
 * Extract imports from Python code
 * Based on chrome_agent's extractImports implementation
 */
function extractImports(cellContent) {
    const imports = [];
    const lines = cellContent.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '')
            continue;
        // Relative import: from . import ... or from .. import ...
        const relativeMatch = trimmed.match(/^from\s+(\.+[\w.]*)\s+import\s+([\w,\s*]+)/);
        if (relativeMatch) {
            imports.push({
                module: relativeMatch[1],
                items: relativeMatch[2],
                isLocal: true
            });
            continue;
        }
        // from X import Y form
        const fromImportMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+([\w,\s*]+)/);
        if (fromImportMatch) {
            const moduleName = fromImportMatch[1];
            imports.push({
                module: moduleName,
                items: fromImportMatch[2],
                isLocal: isLocalImport(moduleName)
            });
            continue;
        }
        // import X, Y, Z form
        const importMatch = trimmed.match(/^import\s+([\w,\s.]+)/);
        if (importMatch) {
            const modules = importMatch[1].split(',').map(m => m.trim().split(' as ')[0]);
            modules.forEach(moduleName => {
                imports.push({
                    module: moduleName,
                    items: moduleName,
                    isLocal: isLocalImport(moduleName)
                });
            });
        }
    }
    return imports;
}
/**
 * Determine if a module import is local (not a standard library)
 */
function isLocalImport(moduleName) {
    // Relative paths are always local
    if (moduleName.startsWith('.')) {
        return true;
    }
    // Common Python libraries (not exhaustive)
    const commonLibraries = [
        'numpy', 'np', 'pandas', 'pd', 'matplotlib', 'sklearn', 'scipy',
        'torch', 'tensorflow', 'tf', 'keras', 'PIL', 'cv2', 'requests',
        'json', 'os', 'sys', 'datetime', 'time', 'math', 'random',
        'collections', 'itertools', 'functools', 're', 'pathlib',
        'typing', 'dataclasses', 'abc', 'argparse', 'logging',
        'pickle', 'csv', 'sqlite3', 'http', 'urllib', 'email',
        'plotly', 'seaborn', 'statsmodels', 'xgboost', 'lightgbm',
        'transformers', 'datasets', 'accelerate', 'peft',
        'openai', 'anthropic', 'langchain', 'llama_index'
    ];
    // Get top-level module name
    const topLevelModule = moduleName.split('.')[0];
    // If not in common libraries, consider it local
    return !commonLibraries.includes(topLevelModule);
}
/**
 * Get notification background color based on type
 */
function getNotificationColor(type) {
    const colors = {
        success: '#48bb78',
        error: '#f56565',
        warning: '#ed8936',
        info: '#4299e1'
    };
    return colors[type] || colors.info;
}
/**
 * Create notification element with styles
 */
function createNotificationElement(message, backgroundColor) {
    const notification = document.createElement('div');
    notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10001;
    opacity: 0;
    transition: opacity 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    max-width: 300px;
    word-wrap: break-word;
    background: ${backgroundColor};
  `;
    notification.textContent = message;
    return notification;
}
/**
 * Animate notification appearance and removal
 */
function animateNotification(notification) {
    // Show animation
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 10);
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}
/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    const notification = createNotificationElement(message, getNotificationColor(type));
    document.body.appendChild(notification);
    animateNotification(notification);
}


/***/ }),

/***/ "./lib/plugins/sidebar-plugin.js":
/*!***************************************!*\
  !*** ./lib/plugins/sidebar-plugin.js ***!
  \***************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   sidebarPlugin: () => (/* binding */ sidebarPlugin)
/* harmony export */ });
/* harmony import */ var _jupyterlab_application__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/application */ "webpack/sharing/consume/default/@jupyterlab/application");
/* harmony import */ var _jupyterlab_application__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_application__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @jupyterlab/apputils */ "webpack/sharing/consume/default/@jupyterlab/apputils");
/* harmony import */ var _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @jupyterlab/notebook */ "webpack/sharing/consume/default/@jupyterlab/notebook");
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _components_AgentPanel__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../components/AgentPanel */ "./lib/components/AgentPanel.js");
/* harmony import */ var _services_ApiService__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../services/ApiService */ "./lib/services/ApiService.js");
/**
 * Sidebar Plugin
 * Adds Agent panel to JupyterLab sidebar
 */





/**
 * Sidebar plugin namespace
 */
const PLUGIN_ID = '@hdsp-agent/sidebar';
const COMMAND_ID = 'hdsp-agent:toggle-sidebar';
/**
 * Agent Sidebar Plugin
 */
const sidebarPlugin = {
    id: PLUGIN_ID,
    autoStart: true,
    requires: [],
    optional: [_jupyterlab_application__WEBPACK_IMPORTED_MODULE_0__.ILayoutRestorer, _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.ICommandPalette, _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_2__.INotebookTracker],
    activate: (app, restorer, palette, notebookTracker) => {
        console.log('[SidebarPlugin] Activating Jupyter Agent Sidebar');
        try {
            // Create API service
            const apiService = new _services_ApiService__WEBPACK_IMPORTED_MODULE_4__.ApiService();
            // Create agent panel widget with notebook tracker
            const agentPanel = new _components_AgentPanel__WEBPACK_IMPORTED_MODULE_3__.AgentPanelWidget(apiService, notebookTracker);
            // Create tracker for panel state restoration if restorer available
            if (restorer) {
                const tracker = new _jupyterlab_apputils__WEBPACK_IMPORTED_MODULE_1__.WidgetTracker({
                    namespace: 'hdsp-agent'
                });
                // Add panel to tracker
                tracker.add(agentPanel);
                // Restore panel state
                restorer.restore(tracker, {
                    command: COMMAND_ID,
                    name: () => 'hdsp-agent'
                });
            }
            // Add panel to right sidebar
            app.shell.add(agentPanel, 'right', { rank: 100 });
            // Add command to toggle sidebar
            app.commands.addCommand(COMMAND_ID, {
                label: 'HDSP Agent 사이드바 토글',
                caption: 'HDSP Agent 패널 표시/숨기기',
                execute: () => {
                    if (agentPanel.isVisible) {
                        agentPanel.close();
                    }
                    else {
                        app.shell.activateById(agentPanel.id);
                    }
                }
            });
            // Add command to palette
            if (palette) {
                palette.addItem({
                    command: COMMAND_ID,
                    category: 'HDSP Agent',
                    args: {}
                });
            }
            // Store reference globally for cell buttons to access
            window._hdspAgentPanel = agentPanel;
            console.log('[SidebarPlugin] HDSP Agent Sidebar activated successfully');
        }
        catch (error) {
            console.error('[SidebarPlugin] Failed to activate:', error);
        }
    }
};


/***/ }),

/***/ "./lib/services/AgentOrchestrator.js":
/*!*******************************************!*\
  !*** ./lib/services/AgentOrchestrator.js ***!
  \*******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AgentOrchestrator: () => (/* binding */ AgentOrchestrator),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _ApiService__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./ApiService */ "./lib/services/ApiService.js");
/* harmony import */ var _ToolExecutor__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./ToolExecutor */ "./lib/services/ToolExecutor.js");
/* harmony import */ var _utils_SafetyChecker__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../utils/SafetyChecker */ "./lib/utils/SafetyChecker.js");
/* harmony import */ var _types_auto_agent__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../types/auto-agent */ "./lib/types/auto-agent.js");
/**
 * AgentOrchestrator - Plan-and-Execute 오케스트레이터
 *
 * HuggingFace Jupyter Agent 패턴 기반:
 * - 사용자 요청을 단계별 실행 계획으로 분해
 * - Tool Calling을 통한 순차 실행
 * - Self-Healing (에러 발생 시 자동 수정 및 재시도)
 */




class AgentOrchestrator {
    constructor(notebook, sessionContext, apiService, config) {
        this.abortController = null;
        this.isRunning = false;
        // Step-by-step 모드를 위한 상태
        this.stepByStepResolver = null;
        this.isPaused = false;
        // Validation & Reflection 설정
        this.enablePreValidation = true;
        this.enableReflection = true;
        // ★ 현재 Plan 실행 중 정의된 변수 추적 (cross-step validation용)
        this.executedStepVariables = new Set();
        this.notebook = notebook;
        this.apiService = apiService || new _ApiService__WEBPACK_IMPORTED_MODULE_0__.ApiService();
        this.toolExecutor = new _ToolExecutor__WEBPACK_IMPORTED_MODULE_1__.ToolExecutor(notebook, sessionContext);
        this.safetyChecker = new _utils_SafetyChecker__WEBPACK_IMPORTED_MODULE_2__.SafetyChecker({
            enableSafetyCheck: config?.enableSafetyCheck ?? true,
            maxExecutionTime: (config?.executionTimeout ?? 30000) / 1000,
        });
        this.config = { ..._types_auto_agent__WEBPACK_IMPORTED_MODULE_3__.DEFAULT_AUTO_AGENT_CONFIG, ...config };
        console.log('[Orchestrator] Initialized with config:', {
            executionSpeed: this.config.executionSpeed,
            stepDelay: this.config.stepDelay,
        });
        // ToolExecutor에 자동 스크롤 설정 연동
        this.toolExecutor.setAutoScroll(this.config.autoScrollToCell);
    }
    /**
     * 메인 실행 함수: 사용자 요청을 받아 자동 실행
     */
    async executeTask(userRequest, notebook, onProgress) {
        if (this.isRunning) {
            return {
                success: false,
                plan: null,
                executedSteps: [],
                createdCells: [],
                modifiedCells: [],
                error: 'Auto-Agent가 이미 실행 중입니다',
                totalAttempts: 0,
            };
        }
        this.isRunning = true;
        this.abortController = new AbortController();
        // ★ 새 실행 시작 시 이전 실행에서 추적된 변수 초기화
        this.executedStepVariables.clear();
        const createdCells = [];
        const modifiedCells = [];
        const executedSteps = [];
        const startTime = Date.now();
        try {
            // ═══════════════════════════════════════════════════════════════════════
            // PHASE 1: PLANNING - 작업 분해
            // ═══════════════════════════════════════════════════════════════════════
            onProgress({ phase: 'planning', message: '작업 계획 수립 중...' });
            const notebookContext = this.extractNotebookContext(notebook);
            const planResponse = await this.apiService.generateExecutionPlan({
                request: userRequest,
                notebookContext,
                availableTools: ['jupyter_cell', 'markdown', 'final_answer'],
            });
            const plan = planResponse.plan;
            onProgress({
                phase: 'planned',
                plan,
                message: `${plan.totalSteps}단계 실행 계획 생성됨`,
            });
            // ═══════════════════════════════════════════════════════════════════════
            // PHASE 2: EXECUTION - 단계별 실행 (Adaptive Replanning 포함)
            // ═══════════════════════════════════════════════════════════════════════
            console.log('[Orchestrator] Starting execution phase with', plan.steps.length, 'steps');
            let currentPlan = plan;
            let stepIndex = 0;
            let replanAttempts = 0;
            const MAX_REPLAN_ATTEMPTS = 3;
            while (stepIndex < currentPlan.steps.length) {
                const step = currentPlan.steps[stepIndex];
                console.log('[Orchestrator] Executing step', step.stepNumber, ':', step.description);
                // 중단 요청 확인
                if (this.abortController.signal.aborted) {
                    return {
                        success: false,
                        plan: currentPlan,
                        executedSteps,
                        createdCells,
                        modifiedCells,
                        error: '사용자에 의해 취소됨',
                        totalAttempts: this.countTotalAttempts(executedSteps),
                        executionTime: Date.now() - startTime,
                    };
                }
                onProgress({
                    phase: 'executing',
                    currentStep: step.stepNumber,
                    totalSteps: currentPlan.totalSteps,
                    description: step.description,
                });
                const stepResult = await this.executeStepWithRetry(step, notebook, onProgress);
                // 생성/수정된 셀 추적 및 하이라이트/스크롤
                stepResult.toolResults.forEach((tr) => {
                    if (tr.cellIndex !== undefined) {
                        if (tr.wasModified) {
                            modifiedCells.push(tr.cellIndex);
                        }
                        else {
                            createdCells.push(tr.cellIndex);
                        }
                        // 셀 하이라이트 및 스크롤
                        this.scrollToAndHighlightCell(tr.cellIndex);
                    }
                });
                // 단계 실패 시 Adaptive Replanning 시도
                if (!stepResult.success) {
                    console.log('[Orchestrator] Step failed, attempting adaptive replanning');
                    if (replanAttempts >= MAX_REPLAN_ATTEMPTS) {
                        onProgress({
                            phase: 'failed',
                            message: `최대 재계획 시도 횟수(${MAX_REPLAN_ATTEMPTS})를 초과했습니다.`,
                        });
                        return {
                            success: false,
                            plan: currentPlan,
                            executedSteps,
                            createdCells,
                            modifiedCells,
                            error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
                            totalAttempts: this.countTotalAttempts(executedSteps),
                            executionTime: Date.now() - startTime,
                        };
                    }
                    onProgress({
                        phase: 'replanning',
                        message: '계획 수정 중...',
                        currentStep: step.stepNumber,
                    });
                    // 실패 정보 구성
                    const executionError = {
                        type: 'runtime',
                        message: stepResult.error || '알 수 없는 오류',
                        traceback: stepResult.toolResults.find(r => r.traceback)?.traceback || [],
                        recoverable: true,
                    };
                    // 마지막 실행 출력
                    const lastOutput = stepResult.toolResults
                        .map(r => r.output)
                        .filter(Boolean)
                        .join('\n');
                    try {
                        const replanResponse = await this.apiService.replanExecution({
                            originalRequest: userRequest,
                            executedSteps: executedSteps.map(s => currentPlan.steps.find(p => p.stepNumber === s.stepNumber)).filter(Boolean),
                            failedStep: step,
                            error: executionError,
                            executionOutput: lastOutput,
                        });
                        console.log('[Orchestrator] Replan decision:', replanResponse.decision);
                        console.log('[Orchestrator] Replan reasoning:', replanResponse.reasoning);
                        // 실패한 스텝에서 생성된 셀 인덱스 추출 (재사용 위해)
                        const failedCellIndex = stepResult.toolResults.find(r => r.cellIndex !== undefined)?.cellIndex;
                        console.log('[Orchestrator] Failed cell index for reuse:', failedCellIndex);
                        // Replan 결과에 따른 계획 수정 (실패한 셀 인덱스 전달)
                        currentPlan = this.applyReplanChanges(currentPlan, stepIndex, replanResponse, failedCellIndex);
                        // ★ 업데이트된 계획을 UI에 반영 (plan item list에 새 스텝 표시)
                        onProgress({
                            phase: 'planned',
                            plan: currentPlan,
                            message: `계획 수정됨 (${this.getReplanDecisionLabel(replanResponse.decision)})`,
                            currentStep: step.stepNumber,
                            totalSteps: currentPlan.totalSteps,
                        });
                        replanAttempts++;
                        // stepIndex는 그대로 유지 (수정된 현재 단계를 다시 실행)
                        continue;
                    }
                    catch (replanError) {
                        console.error('[Orchestrator] Replan failed:', replanError);
                        onProgress({
                            phase: 'failed',
                            message: `Step ${step.stepNumber} 실패 (재계획 실패): ${stepResult.error}`,
                        });
                        return {
                            success: false,
                            plan: currentPlan,
                            executedSteps,
                            createdCells,
                            modifiedCells,
                            error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
                            totalAttempts: this.countTotalAttempts(executedSteps),
                            executionTime: Date.now() - startTime,
                        };
                    }
                }
                // 성공한 단계 기록
                executedSteps.push(stepResult);
                replanAttempts = 0; // 성공 시 재계획 시도 횟수 리셋
                // ★ 성공한 Step에서 정의된 변수 추적 (cross-step validation용)
                this.trackVariablesFromStep(step);
                // ═══════════════════════════════════════════════════════════════════════
                // REFLECTION: 실행 결과 분석 및 적응적 조정
                // ═══════════════════════════════════════════════════════════════════════
                if (this.enableReflection && stepResult.toolResults.length > 0) {
                    // Reflection 시작 알림
                    onProgress({
                        phase: 'reflecting',
                        reflectionStatus: 'analyzing',
                        currentStep: step.stepNumber,
                        message: '실행 결과 분석 중...',
                    });
                    const remainingSteps = currentPlan.steps.slice(stepIndex + 1);
                    const reflection = await this.performReflection(step, stepResult.toolResults, remainingSteps);
                    if (reflection) {
                        const { shouldContinue, action, reason } = this.shouldContinueAfterReflection(reflection);
                        console.log('[Orchestrator] Reflection decision:', { shouldContinue, action, reason });
                        // Reflection 결과 UI 업데이트
                        if (reflection.evaluation.checkpoint_passed) {
                            onProgress({
                                phase: 'reflecting',
                                reflectionStatus: 'passed',
                                currentStep: step.stepNumber,
                                message: '검증 통과',
                            });
                        }
                        else {
                            onProgress({
                                phase: 'reflecting',
                                reflectionStatus: 'adjusting',
                                currentStep: step.stepNumber,
                                message: `조정 권고: ${reason}`,
                            });
                        }
                        // Reflection 결과가 retry 또는 replan을 요구하면 해당 로직으로 이동
                        if (!shouldContinue) {
                            if (action === 'replan') {
                                console.log('[Orchestrator] Reflection recommends replan, triggering adaptive replanning');
                            }
                            else if (action === 'retry') {
                                console.log('[Orchestrator] Reflection recommends retry - but step succeeded, continuing');
                            }
                        }
                    }
                }
                // 다음 스텝 전에 지연 적용 (사용자가 결과를 확인할 시간)
                await this.applyStepDelay();
                // final_answer 도구 호출 시 완료
                if (stepResult.isFinalAnswer) {
                    onProgress({
                        phase: 'completed',
                        message: stepResult.finalAnswer || '작업 완료',
                    });
                    return {
                        success: true,
                        plan: currentPlan,
                        executedSteps,
                        createdCells,
                        modifiedCells,
                        finalAnswer: stepResult.finalAnswer,
                        totalAttempts: this.countTotalAttempts(executedSteps),
                        executionTime: Date.now() - startTime,
                    };
                }
                stepIndex++;
            }
            // 모든 단계 성공
            onProgress({
                phase: 'completed',
                message: '모든 단계 성공적으로 완료',
            });
            return {
                success: true,
                plan,
                executedSteps,
                createdCells,
                modifiedCells,
                totalAttempts: this.countTotalAttempts(executedSteps),
                executionTime: Date.now() - startTime,
            };
        }
        catch (error) {
            onProgress({
                phase: 'failed',
                message: error.message || '알 수 없는 오류 발생',
            });
            return {
                success: false,
                plan: null,
                executedSteps,
                createdCells,
                modifiedCells,
                error: error.message || '알 수 없는 오류 발생',
                totalAttempts: this.countTotalAttempts(executedSteps),
                executionTime: Date.now() - startTime,
            };
        }
        finally {
            this.isRunning = false;
            this.abortController = null;
        }
    }
    /**
     * 출력 결과가 부정적인지 분석 (에러는 아니지만 실패 의미를 가진 출력)
     * Fast Fail: 모든 에러 → Adaptive Replanning으로 처리
     */
    analyzeOutputForFailure(output) {
        if (!output) {
            return { isNegative: false };
        }
        const negativePatterns = [
            // 환경/의존성 에러
            { pattern: /ModuleNotFoundError/i, reason: '모듈을 찾을 수 없음 (패키지 설치 필요)' },
            { pattern: /ImportError/i, reason: 'import 에러 (패키지 설치 필요)' },
            { pattern: /No module named/i, reason: '모듈이 없음 (패키지 설치 필요)' },
            { pattern: /cannot import name/i, reason: 'import 실패' },
            // 파일/경로 관련 오류
            { pattern: /FileNotFoundError|No such file or directory|파일을 찾을 수 없습니다/i, reason: '파일을 찾을 수 없음' },
            // 런타임 에러
            { pattern: /NameError:\s*name\s*'([^']+)'\s*is not defined/i, reason: '변수가 정의되지 않음' },
            { pattern: /KeyError/i, reason: '키를 찾을 수 없음' },
            { pattern: /IndexError/i, reason: '인덱스 범위 초과' },
            { pattern: /TypeError/i, reason: '타입 오류' },
            { pattern: /ValueError/i, reason: '값 오류' },
            { pattern: /AttributeError/i, reason: '속성 오류' },
            // 명시적 실패 메시지
            { pattern: /실패|failed|Fail/i, reason: '명시적 오류 메시지 감지' },
            { pattern: /not found|cannot find|찾을 수 없/i, reason: '리소스를 찾을 수 없음' },
            // Note: Empty DataFrame, 0 rows 등은 정상적인 분석 결과일 수 있으므로 부정적 패턴에서 제외
        ];
        for (const { pattern, reason } of negativePatterns) {
            if (pattern.test(output)) {
                console.log('[Orchestrator] Negative output detected:', reason);
                return { isNegative: true, reason };
            }
        }
        return { isNegative: false };
    }
    /**
     * 단계 실행 (Fast Fail 방식)
     * 에러 발생 시 재시도 없이 바로 실패 반환 → Adaptive Replanning으로 처리
     * + Pre-Validation: 실행 전 Pyflakes/AST 검증
     */
    async executeStepWithRetry(step, notebook, onProgress) {
        console.log('[Orchestrator] executeStep called for step:', step.stepNumber);
        console.log('[Orchestrator] Step toolCalls:', JSON.stringify(step.toolCalls, null, 2));
        const toolResults = [];
        try {
            // Tool Calling 실행
            console.log('[Orchestrator] Processing', step.toolCalls.length, 'tool calls');
            for (const toolCall of step.toolCalls) {
                console.log('[Orchestrator] Processing toolCall:', toolCall.tool);
                // 중단 요청 확인
                if (this.abortController?.signal.aborted) {
                    return {
                        success: false,
                        stepNumber: step.stepNumber,
                        toolResults,
                        attempts: 1,
                        error: '사용자에 의해 취소됨',
                    };
                }
                onProgress({
                    phase: 'tool_calling',
                    tool: toolCall.tool,
                    attempt: 1,
                    currentStep: step.stepNumber,
                });
                // jupyter_cell인 경우: 안전성 검사 + Pre-Validation
                if (toolCall.tool === 'jupyter_cell') {
                    const params = toolCall.parameters;
                    // 1. 안전성 검사
                    const safetyResult = this.safetyChecker.checkCodeSafety(params.code);
                    if (!safetyResult.safe) {
                        return {
                            success: false,
                            stepNumber: step.stepNumber,
                            toolResults,
                            attempts: 1,
                            error: `안전성 검사 실패: ${safetyResult.blockedPatterns?.join(', ')}`,
                        };
                    }
                    // 2. Pre-Validation (Pyflakes/AST 기반)
                    onProgress({
                        phase: 'validating',
                        validationStatus: 'checking',
                        currentStep: step.stepNumber,
                        message: '코드 품질 검증 중...',
                    });
                    const validation = await this.validateCodeBeforeExecution(params.code);
                    if (validation) {
                        if (validation.hasErrors) {
                            // ★ 디버깅용 상세 로그 (robust version)
                            console.log('');
                            console.log('╔══════════════════════════════════════════════════════════════╗');
                            console.log('║  🔴 [Orchestrator] PRE-VALIDATION FAILED                     ║');
                            console.log('╠══════════════════════════════════════════════════════════════╣');
                            console.log(`║  Step: ${step.stepNumber} - ${step.description?.substring(0, 45) || 'N/A'}...`);
                            console.log(`║  Summary: ${validation.summary || 'No summary'}`);
                            console.log('╠══════════════════════════════════════════════════════════════╣');
                            console.log('║  Code:');
                            console.log('║  ' + (params.code || '').split('\n').join('\n║  '));
                            console.log('╠══════════════════════════════════════════════════════════════╣');
                            console.log('║  Issues:');
                            if (validation.issues && validation.issues.length > 0) {
                                validation.issues.forEach((issue, idx) => {
                                    console.log(`║    ${idx + 1}. [${issue.severity || 'unknown'}] ${issue.category || 'unknown'}: ${issue.message || 'no message'}`);
                                    if (issue.line)
                                        console.log(`║       Line ${issue.line}${issue.column ? `:${issue.column}` : ''}`);
                                    if (issue.code_snippet)
                                        console.log(`║       Snippet: ${issue.code_snippet}`);
                                });
                            }
                            else {
                                console.log('║    (No issues array available)');
                            }
                            if (validation.dependencies) {
                                console.log('╠══════════════════════════════════════════════════════════════╣');
                                console.log('║  Dependencies:', JSON.stringify(validation.dependencies));
                            }
                            console.log('╚══════════════════════════════════════════════════════════════╝');
                            console.log('');
                            onProgress({
                                phase: 'validating',
                                validationStatus: 'failed',
                                currentStep: step.stepNumber,
                                message: `검증 실패: ${validation.summary}`,
                            });
                            // Fast Fail: 검증 오류 → 바로 Adaptive Replanning
                            return {
                                success: false,
                                stepNumber: step.stepNumber,
                                toolResults,
                                attempts: 1,
                                error: `사전 검증 오류: ${validation.summary}`,
                            };
                        }
                        else if (validation.hasWarnings) {
                            console.log('[Orchestrator] ⚠️ Pre-validation warnings:', validation.issues.map(i => i.message).join('; '));
                            onProgress({
                                phase: 'validating',
                                validationStatus: 'warning',
                                currentStep: step.stepNumber,
                                message: `경고 감지: ${validation.issues.length}건 (실행 계속)`,
                            });
                        }
                        else {
                            console.log('[Orchestrator] ✅ Pre-validation passed for step', step.stepNumber);
                            onProgress({
                                phase: 'validating',
                                validationStatus: 'passed',
                                currentStep: step.stepNumber,
                                message: '코드 검증 통과',
                            });
                        }
                    }
                }
                // 타임아웃과 함께 실행
                console.log('[Orchestrator] Calling toolExecutor.executeTool for:', toolCall.tool);
                const result = await this.executeWithTimeout(() => this.toolExecutor.executeTool(toolCall), this.config.executionTimeout);
                console.log('[Orchestrator] Tool execution result:', JSON.stringify(result));
                toolResults.push(result);
                // jupyter_cell 실행 실패 시 → Fast Fail
                if (!result.success && toolCall.tool === 'jupyter_cell') {
                    const errorMsg = result.error || '알 수 없는 오류';
                    console.log('[Orchestrator] jupyter_cell execution failed:', errorMsg.substring(0, 100));
                    return {
                        success: false,
                        stepNumber: step.stepNumber,
                        toolResults,
                        attempts: 1,
                        error: errorMsg,
                    };
                }
                // final_answer 도구 감지
                if (toolCall.tool === 'final_answer') {
                    return {
                        success: true,
                        stepNumber: step.stepNumber,
                        toolResults,
                        attempts: 1,
                        isFinalAnswer: true,
                        finalAnswer: result.output,
                    };
                }
            }
            // 모든 도구 실행 성공
            if (toolResults.length > 0 && toolResults.every((r) => r.success)) {
                // 출력 결과 분석: 실행은 성공했지만 출력이 부정적인 경우
                const allOutputs = toolResults
                    .map((r) => {
                    const output = r.output;
                    if (!output)
                        return '';
                    if (typeof output === 'string')
                        return output;
                    if (typeof output === 'object' && output !== null) {
                        // Jupyter output format: {text/plain: ..., text/html: ...}
                        if ('text/plain' in output) {
                            const textPlain = output['text/plain'];
                            return typeof textPlain === 'string' ? textPlain : String(textPlain || '');
                        }
                        try {
                            return JSON.stringify(output);
                        }
                        catch {
                            return '[object]';
                        }
                    }
                    // Primitive types (number, boolean, etc.)
                    try {
                        return String(output);
                    }
                    catch {
                        return '[unknown]';
                    }
                })
                    .join('\n');
                const outputAnalysis = this.analyzeOutputForFailure(allOutputs);
                if (outputAnalysis.isNegative) {
                    console.log('[Orchestrator] Negative output detected:', outputAnalysis.reason);
                    // Fast Fail: 부정적 출력 → 바로 Adaptive Replanning
                    return {
                        success: false,
                        stepNumber: step.stepNumber,
                        toolResults,
                        attempts: 1,
                        error: outputAnalysis.reason || '출력 결과에서 문제 감지',
                    };
                }
                return {
                    success: true,
                    stepNumber: step.stepNumber,
                    toolResults,
                    attempts: 1,
                };
            }
            // 도구 실행 결과가 없는 경우
            return {
                success: false,
                stepNumber: step.stepNumber,
                toolResults,
                attempts: 1,
                error: '도구 실행 결과 없음',
            };
        }
        catch (error) {
            const isTimeout = error.message?.includes('timeout');
            if (isTimeout) {
                // 타임아웃 시 커널 인터럽트
                await this.toolExecutor.interruptKernel();
            }
            return {
                success: false,
                stepNumber: step.stepNumber,
                toolResults,
                attempts: 1,
                error: error.message || '알 수 없는 오류',
            };
        }
    }
    /**
     * 노트북 컨텍스트 추출
     */
    extractNotebookContext(notebook) {
        const cells = notebook.content.model?.cells;
        const cellCount = cells?.length || 0;
        // 최근 3개 셀 정보 추출
        const recentCells = [];
        if (cells) {
            const startIndex = Math.max(0, cellCount - 3);
            for (let i = startIndex; i < cellCount; i++) {
                const cell = cells.get(i);
                recentCells.push({
                    index: i,
                    type: cell.type,
                    source: cell.sharedModel.getSource().slice(0, 500),
                    output: this.toolExecutor.getCellOutput(i).slice(0, 300), // 처음 300자만
                });
            }
        }
        return {
            cellCount,
            recentCells,
            importedLibraries: this.detectImportedLibraries(notebook),
            definedVariables: this.detectDefinedVariables(notebook),
            notebookPath: notebook.context?.path,
        };
    }
    /**
     * import된 라이브러리 감지
     */
    detectImportedLibraries(notebook) {
        const libraries = new Set();
        const cells = notebook.content.model?.cells;
        if (!cells)
            return [];
        for (let i = 0; i < cells.length; i++) {
            const cell = cells.get(i);
            if (cell.type === 'code') {
                const source = cell.sharedModel.getSource();
                // import xxx 패턴
                const importMatches = source.matchAll(/^import\s+(\w+)/gm);
                for (const match of importMatches) {
                    libraries.add(match[1]);
                }
                // from xxx import 패턴
                const fromMatches = source.matchAll(/^from\s+(\w+)/gm);
                for (const match of fromMatches) {
                    libraries.add(match[1]);
                }
            }
        }
        return Array.from(libraries);
    }
    /**
     * 정의된 변수 감지
     *
     * ★ 수정: 인덴트된 코드 (try/except, with, if 블록 내부)에서도 변수 감지
     * 기존 regex: /^(\w+)\s*=/gm - 라인 시작에서만 매칭
     * 수정 regex: /^[ \t]*(\w+)\s*=/gm - 인덴트된 할당문도 매칭
     */
    detectDefinedVariables(notebook) {
        const variables = new Set();
        const cells = notebook.content.model?.cells;
        if (!cells)
            return [];
        for (let i = 0; i < cells.length; i++) {
            const cell = cells.get(i);
            if (cell.type === 'code') {
                const source = cell.sharedModel.getSource();
                // ★ 인덴트 허용하는 할당 패턴: [공백/탭]* variable = ...
                const assignMatches = source.matchAll(/^[ \t]*(\w+)\s*=/gm);
                for (const match of assignMatches) {
                    // 예약어 및 비교 연산자 제외
                    // == 는 비교연산자이므로 제외 (예: if x == 1)
                    const varName = match[1];
                    if (!['if', 'for', 'while', 'def', 'class', 'import', 'from', 'elif', 'return', 'yield', 'assert', 'raise', 'del', 'pass', 'break', 'continue', 'global', 'nonlocal', 'lambda', 'with', 'as', 'try', 'except', 'finally'].includes(varName)) {
                        // == 비교 연산자 체크 (matchAll 결과에서 원래 문자열 확인)
                        const fullMatch = match[0];
                        if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('<=') && !fullMatch.includes('>=')) {
                            variables.add(varName);
                        }
                    }
                }
                // ★ 추가: 튜플 언패킹 패턴도 감지 (예: x, y = func())
                const tupleMatches = source.matchAll(/^[ \t]*(\w+(?:\s*,\s*\w+)+)\s*=/gm);
                for (const match of tupleMatches) {
                    const tupleVars = match[1].split(',').map(v => v.trim());
                    for (const varName of tupleVars) {
                        if (varName && /^\w+$/.test(varName)) {
                            variables.add(varName);
                        }
                    }
                }
                // ★ 추가: for 루프 변수 감지 (예: for x in items:, for i, v in enumerate())
                const forMatches = source.matchAll(/^[ \t]*for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+/gm);
                for (const match of forMatches) {
                    const loopVars = match[1].split(',').map(v => v.trim());
                    for (const varName of loopVars) {
                        if (varName && /^\w+$/.test(varName)) {
                            variables.add(varName);
                        }
                    }
                }
                // ★ 추가: with 문 변수 감지 (예: with open() as f:)
                const withMatches = source.matchAll(/^[ \t]*with\s+.*\s+as\s+(\w+)/gm);
                for (const match of withMatches) {
                    variables.add(match[1]);
                }
                // ★ 추가: except 문 변수 감지 (예: except Exception as e:)
                const exceptMatches = source.matchAll(/^[ \t]*except\s+.*\s+as\s+(\w+)/gm);
                for (const match of exceptMatches) {
                    variables.add(match[1]);
                }
            }
        }
        return Array.from(variables);
    }
    /**
     * ★ 단일 코드 문자열에서 정의된 변수 추출
     * detectDefinedVariables와 동일한 로직을 단일 코드 블록에 적용
     */
    extractVariablesFromCode(code) {
        const variables = new Set();
        const reservedWords = ['if', 'for', 'while', 'def', 'class', 'import', 'from', 'elif', 'return', 'yield', 'assert', 'raise', 'del', 'pass', 'break', 'continue', 'global', 'nonlocal', 'lambda', 'with', 'as', 'try', 'except', 'finally'];
        // 인덴트 허용하는 할당 패턴
        const assignMatches = code.matchAll(/^[ \t]*(\w+)\s*=/gm);
        for (const match of assignMatches) {
            const varName = match[1];
            if (!reservedWords.includes(varName)) {
                const fullMatch = match[0];
                if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('<=') && !fullMatch.includes('>=')) {
                    variables.add(varName);
                }
            }
        }
        // 튜플 언패킹
        const tupleMatches = code.matchAll(/^[ \t]*(\w+(?:\s*,\s*\w+)+)\s*=/gm);
        for (const match of tupleMatches) {
            const tupleVars = match[1].split(',').map(v => v.trim());
            for (const varName of tupleVars) {
                if (varName && /^\w+$/.test(varName)) {
                    variables.add(varName);
                }
            }
        }
        // for 루프 변수
        const forMatches = code.matchAll(/^[ \t]*for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+/gm);
        for (const match of forMatches) {
            const loopVars = match[1].split(',').map(v => v.trim());
            for (const varName of loopVars) {
                if (varName && /^\w+$/.test(varName)) {
                    variables.add(varName);
                }
            }
        }
        // with 문 변수
        const withMatches = code.matchAll(/^[ \t]*with\s+.*\s+as\s+(\w+)/gm);
        for (const match of withMatches) {
            variables.add(match[1]);
        }
        // except 문 변수
        const exceptMatches = code.matchAll(/^[ \t]*except\s+.*\s+as\s+(\w+)/gm);
        for (const match of exceptMatches) {
            variables.add(match[1]);
        }
        return Array.from(variables);
    }
    /**
     * ★ 실행된 Step의 코드에서 변수를 추적
     */
    trackVariablesFromStep(step) {
        for (const toolCall of step.toolCalls) {
            if (toolCall.tool === 'jupyter_cell') {
                const params = toolCall.parameters;
                const vars = this.extractVariablesFromCode(params.code);
                vars.forEach(v => this.executedStepVariables.add(v));
                console.log('[Orchestrator] Tracked variables from step', step.stepNumber, ':', vars);
            }
        }
    }
    /**
     * Adaptive Replanning 결과 적용
     *
     * ★ 순차 실행 원칙: 모든 새 셀은 항상 맨 끝에 추가됨
     * - 기존 셀 재사용(cellIndex 주입) 제거 → 항상 새 셀 생성
     * - 이렇게 하면 셀이 항상 위에서 아래로 순서대로 추가됨
     */
    applyReplanChanges(plan, currentStepIndex, replanResponse, failedCellIndex // 이제 사용하지 않음 (API 호환성 유지)
    ) {
        const { decision, changes } = replanResponse;
        const steps = [...plan.steps];
        const currentStep = steps[currentStepIndex];
        console.log('[Orchestrator] Applying replan changes:', decision, '(always append new cells)');
        switch (decision) {
            case 'refine':
                // 현재 단계의 코드만 수정 - 새 셀 생성 (맨 끝에 추가됨)
                if (changes.refined_code) {
                    const newToolCalls = currentStep.toolCalls.map(tc => {
                        if (tc.tool === 'jupyter_cell') {
                            return {
                                ...tc,
                                parameters: {
                                    ...tc.parameters,
                                    code: changes.refined_code,
                                    // cellIndex 제거 → 항상 새 셀 생성
                                },
                            };
                        }
                        return tc;
                    });
                    // cellIndex 속성 명시적 제거
                    newToolCalls.forEach(tc => {
                        if (tc.tool === 'jupyter_cell' && tc.parameters) {
                            delete tc.parameters.cellIndex;
                        }
                    });
                    steps[currentStepIndex] = {
                        ...currentStep,
                        toolCalls: newToolCalls,
                    };
                }
                break;
            case 'insert_steps':
                // 새로운 단계들을 현재 위치에 삽입 (예: pip install)
                // 실행 시 모든 셀은 순차적으로 맨 끝에 추가됨
                if (changes.new_steps && changes.new_steps.length > 0) {
                    const newSteps = changes.new_steps.map((newStep, idx) => ({
                        ...newStep,
                        stepNumber: currentStep.stepNumber + idx * 0.1,
                        isNew: true, // Replan으로 새로 추가된 스텝 표시
                    }));
                    steps.splice(currentStepIndex, 0, ...newSteps);
                    // 단계 번호 재정렬
                    steps.forEach((step, idx) => {
                        step.stepNumber = idx + 1;
                    });
                }
                break;
            case 'replace_step':
                // 현재 단계를 완전히 교체 - 새 셀 생성
                if (changes.replacement) {
                    const replacementStep = {
                        ...changes.replacement,
                        stepNumber: currentStep.stepNumber,
                        toolCalls: changes.replacement.toolCalls || [],
                    };
                    // cellIndex 속성 명시적 제거
                    replacementStep.toolCalls.forEach(tc => {
                        if (tc.tool === 'jupyter_cell' && tc.parameters) {
                            delete tc.parameters.cellIndex;
                        }
                    });
                    steps[currentStepIndex] = replacementStep;
                }
                break;
            case 'replan_remaining':
                // 현재 단계부터 끝까지 새로운 계획으로 교체
                if (changes.new_plan && changes.new_plan.length > 0) {
                    const existingSteps = steps.slice(0, currentStepIndex);
                    const newPlanSteps = changes.new_plan.map((newStep, idx) => ({
                        ...newStep,
                        stepNumber: currentStepIndex + idx + 1,
                        isNew: true, // Replan으로 새로 추가된 스텝 표시
                    }));
                    // 새 계획에 final_answer가 없으면 경고 로그
                    const hasFinalAnswer = newPlanSteps.some(step => step.toolCalls?.some((tc) => tc.tool === 'final_answer'));
                    if (!hasFinalAnswer) {
                        console.warn('[Orchestrator] replan_remaining: new_plan does not include final_answer');
                    }
                    steps.length = 0;
                    steps.push(...existingSteps, ...newPlanSteps);
                }
                break;
        }
        return {
            ...plan,
            steps,
            totalSteps: steps.length,
        };
    }
    /**
     * 총 시도 횟수 계산
     */
    countTotalAttempts(steps) {
        return steps.reduce((sum, step) => sum + step.attempts, 0);
    }
    /**
     * 타임아웃 래퍼
     */
    async executeWithTimeout(fn, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`실행 타임아웃 (${timeoutMs}ms)`));
            }, timeoutMs);
            fn()
                .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
                .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }
    /**
     * 지연 유틸리티
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * 실행 취소
     */
    cancel() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }
    /**
     * 실행 상태 확인
     */
    getIsRunning() {
        return this.isRunning;
    }
    /**
     * 설정 업데이트
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.safetyChecker.updateConfig({
            enableSafetyCheck: this.config.enableSafetyCheck,
            maxExecutionTime: this.config.executionTimeout / 1000,
        });
        // ToolExecutor 자동 스크롤 설정 동기화
        if (config.autoScrollToCell !== undefined) {
            this.toolExecutor.setAutoScroll(this.config.autoScrollToCell);
        }
    }
    /**
     * 현재 실행 중인 셀로 스크롤 및 하이라이트
     */
    scrollToAndHighlightCell(cellIndex) {
        if (!this.config.autoScrollToCell && !this.config.highlightCurrentCell) {
            return;
        }
        const notebookContent = this.notebook.content;
        const cell = notebookContent.widgets[cellIndex];
        if (!cell)
            return;
        // 셀로 스크롤
        if (this.config.autoScrollToCell) {
            cell.node.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
        // 셀 하이라이트 (CSS 클래스 추가)
        if (this.config.highlightCurrentCell) {
            // 기존 하이라이트 제거
            notebookContent.widgets.forEach((w) => {
                w.node.classList.remove('aa-cell-executing');
            });
            // 새 하이라이트 추가
            cell.node.classList.add('aa-cell-executing');
            // 실행 완료 후 하이라이트 제거 (지연 후)
            setTimeout(() => {
                cell.node.classList.remove('aa-cell-executing');
            }, this.getEffectiveDelay() + 500);
        }
    }
    /**
     * 현재 설정에 맞는 지연 시간 반환
     */
    getEffectiveDelay() {
        // executionSpeed 프리셋 사용 (stepDelay는 무시하고 프리셋 값을 우선)
        const presetDelay = _types_auto_agent__WEBPACK_IMPORTED_MODULE_3__.EXECUTION_SPEED_DELAYS[this.config.executionSpeed];
        if (presetDelay !== undefined) {
            return presetDelay;
        }
        // 프리셋이 없으면 stepDelay 사용
        return this.config.stepDelay || 0;
    }
    /**
     * 스텝 사이 지연 적용 (step-by-step 모드 포함)
     */
    async applyStepDelay() {
        const delay = this.getEffectiveDelay();
        console.log(`[Orchestrator] applyStepDelay called: speed=${this.config.executionSpeed}, delay=${delay}ms`);
        // step-by-step 모드: 사용자가 다음 버튼을 누를 때까지 대기
        if (this.config.executionSpeed === 'step-by-step' || delay < 0) {
            this.isPaused = true;
            await new Promise((resolve) => {
                this.stepByStepResolver = resolve;
            });
            this.isPaused = false;
            this.stepByStepResolver = null;
            return;
        }
        // 일반 지연
        if (delay > 0) {
            await this.delay(delay);
        }
    }
    /**
     * Step-by-step 모드에서 다음 스텝 진행
     */
    proceedToNextStep() {
        if (this.stepByStepResolver) {
            this.stepByStepResolver();
        }
    }
    /**
     * 일시 정지 상태 확인
     */
    getIsPaused() {
        return this.isPaused;
    }
    /**
     * 현재 실행 속도 설정 반환
     */
    getExecutionSpeed() {
        return this.config.executionSpeed;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Code Validation & Reflection Methods
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * 실행 전 코드 검증 (Pyflakes/AST 기반)
     *
     * @param code 검증할 코드
     * @returns 검증 결과
     */
    async validateCodeBeforeExecution(code) {
        if (!this.enablePreValidation) {
            return null;
        }
        try {
            console.log('[Orchestrator] Pre-validation: Checking code quality');
            const notebookContext = this.extractNotebookContext(this.notebook);
            // ★ 이전 Step에서 추적된 변수들을 notebookContext에 병합
            const allDefinedVariables = new Set([
                ...notebookContext.definedVariables,
                ...this.executedStepVariables,
            ]);
            notebookContext.definedVariables = Array.from(allDefinedVariables);
            console.log('[Orchestrator] Validation context - tracked vars:', Array.from(this.executedStepVariables));
            const validationResult = await this.apiService.validateCode({
                code,
                notebookContext,
            });
            console.log('[Orchestrator] Validation result:', {
                valid: validationResult.valid,
                hasErrors: validationResult.hasErrors,
                issueCount: validationResult.issues.length,
            });
            return validationResult;
        }
        catch (error) {
            console.warn('[Orchestrator] Pre-validation failed:', error.message);
            // 검증 실패 시에도 실행은 계속 진행 (graceful degradation)
            return null;
        }
    }
    /**
     * 실행 후 Reflection 수행
     *
     * @param step 실행된 단계
     * @param toolResults 도구 실행 결과
     * @param remainingSteps 남은 단계들
     * @returns Reflection 결과
     */
    async performReflection(step, toolResults, remainingSteps) {
        if (!this.enableReflection) {
            return null;
        }
        try {
            // jupyter_cell 실행 결과 추출
            const jupyterResult = toolResults.find(r => r.cellIndex !== undefined);
            if (!jupyterResult) {
                return null;
            }
            // 실행된 코드 추출
            const jupyterToolCall = step.toolCalls.find(tc => tc.tool === 'jupyter_cell');
            const executedCode = jupyterToolCall
                ? jupyterToolCall.parameters.code
                : '';
            // Checkpoint 정보 추출 (EnhancedPlanStep인 경우)
            const enhancedStep = step;
            const checkpoint = enhancedStep.checkpoint;
            // ★ 프론트엔드에서 먼저 출력 분석 수행
            const outputString = (() => {
                const output = jupyterResult.output;
                if (!output)
                    return '';
                if (typeof output === 'string')
                    return output;
                if (typeof output === 'object' && output !== null) {
                    if ('text/plain' in output) {
                        const textPlain = output['text/plain'];
                        return typeof textPlain === 'string' ? textPlain : String(textPlain || '');
                    }
                    try {
                        return JSON.stringify(output);
                    }
                    catch {
                        return '[object]';
                    }
                }
                // Primitive types (number, boolean, etc.)
                try {
                    return String(output);
                }
                catch {
                    return '[unknown]';
                }
            })();
            const localOutputAnalysis = this.analyzeOutputForFailure(outputString);
            // 부정적 출력이 감지되면 에러 메시지에 추가
            let effectiveErrorMessage = jupyterResult.error;
            let effectiveStatus = jupyterResult.success ? 'ok' : 'error';
            if (localOutputAnalysis.isNegative) {
                console.log('[Orchestrator] Reflection: Local output analysis detected issue:', localOutputAnalysis.reason);
                effectiveErrorMessage = effectiveErrorMessage
                    ? `${effectiveErrorMessage}; 출력 분석: ${localOutputAnalysis.reason}`
                    : `출력 분석: ${localOutputAnalysis.reason}`;
                // 실행은 성공했지만 출력이 부정적인 경우도 'error'로 표시
                if (jupyterResult.success && localOutputAnalysis.isNegative) {
                    effectiveStatus = 'warning'; // 백엔드에 경고 상태 전달
                }
            }
            console.log('[Orchestrator] Performing reflection for step', step.stepNumber);
            const reflectResponse = await this.apiService.reflectOnExecution({
                stepNumber: step.stepNumber,
                stepDescription: step.description,
                executedCode,
                executionStatus: effectiveStatus,
                executionOutput: outputString,
                errorMessage: effectiveErrorMessage,
                expectedOutcome: checkpoint?.expectedOutcome,
                validationCriteria: checkpoint?.validationCriteria,
                remainingSteps,
            });
            console.log('[Orchestrator] Reflection result:', {
                checkpointPassed: reflectResponse.reflection.evaluation.checkpoint_passed,
                confidenceScore: reflectResponse.reflection.evaluation.confidence_score,
                action: reflectResponse.reflection.recommendations.action,
            });
            return reflectResponse.reflection;
        }
        catch (error) {
            console.warn('[Orchestrator] Reflection failed:', error.message);
            // Reflection 실패 시에도 실행은 계속 진행
            return null;
        }
    }
    /**
     * Reflection 결과에 따른 액션 결정
     *
     * @param reflection Reflection 결과
     * @returns true면 계속 진행, false면 재시도/재계획 필요
     */
    shouldContinueAfterReflection(reflection) {
        if (!reflection) {
            return { shouldContinue: true, action: 'continue', reason: 'No reflection data' };
        }
        const { evaluation, recommendations } = reflection;
        // Checkpoint 통과 및 신뢰도 70% 이상이면 계속 진행
        if (evaluation.checkpoint_passed && evaluation.confidence_score >= 0.7) {
            return {
                shouldContinue: true,
                action: 'continue',
                reason: 'Checkpoint passed with high confidence'
            };
        }
        // Recommendation에 따른 결정
        switch (recommendations.action) {
            case 'continue':
                return {
                    shouldContinue: true,
                    action: 'continue',
                    reason: recommendations.reasoning
                };
            case 'adjust':
                // 경미한 조정은 계속 진행 (다음 단계에서 보정)
                return {
                    shouldContinue: true,
                    action: 'adjust',
                    reason: recommendations.reasoning
                };
            case 'retry':
                return {
                    shouldContinue: false,
                    action: 'retry',
                    reason: recommendations.reasoning
                };
            case 'replan':
                return {
                    shouldContinue: false,
                    action: 'replan',
                    reason: recommendations.reasoning
                };
            default:
                return { shouldContinue: true, action: 'continue', reason: 'Default continue' };
        }
    }
    /**
     * 검증 결과에 따른 코드 자동 수정 시도
     *
     * @param code 원본 코드
     * @param validation 검증 결과
     * @returns 수정된 코드 (수정 불가 시 null)
     */
    async attemptAutoFix(code, validation) {
        // 자동 수정 가능한 경우만 처리
        const autoFixableIssues = validation.issues.filter(issue => issue.category === 'unused_import' || issue.category === 'unused_variable');
        // 심각한 오류가 있으면 자동 수정 불가
        if (validation.hasErrors) {
            return null;
        }
        // 경고만 있는 경우 코드 그대로 반환 (실행 가능)
        if (!validation.hasErrors && autoFixableIssues.length > 0) {
            console.log('[Orchestrator] Code has warnings but is executable');
            return code;
        }
        return null;
    }
    /**
     * Validation & Reflection 설정 업데이트
     */
    setValidationEnabled(enabled) {
        this.enablePreValidation = enabled;
        console.log('[Orchestrator] Pre-validation:', enabled ? 'enabled' : 'disabled');
    }
    setReflectionEnabled(enabled) {
        this.enableReflection = enabled;
        console.log('[Orchestrator] Reflection:', enabled ? 'enabled' : 'disabled');
    }
    /**
     * 현재 설정 확인
     */
    getValidationEnabled() {
        return this.enablePreValidation;
    }
    getReflectionEnabled() {
        return this.enableReflection;
    }
    /**
     * Replan decision 레이블 반환
     */
    getReplanDecisionLabel(decision) {
        switch (decision) {
            case 'refine':
                return '코드 수정';
            case 'insert_steps':
                return '단계 추가';
            case 'replace_step':
                return '단계 교체';
            case 'replan_remaining':
                return '남은 계획 재수립';
            default:
                return decision;
        }
    }
}
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (AgentOrchestrator);


/***/ }),

/***/ "./lib/services/ApiService.js":
/*!************************************!*\
  !*** ./lib/services/ApiService.js ***!
  \************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ApiService: () => (/* binding */ ApiService)
/* harmony export */ });
/* harmony import */ var _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/coreutils */ "webpack/sharing/consume/default/@jupyterlab/coreutils");
/* harmony import */ var _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__);
/**
 * API Service Layer for REST communication with backend
 */
// ✅ 핵심 변경 1: ServerConnection 대신 PageConfig 임포트

class ApiService {
    // 생성자에서 baseUrl을 선택적으로 받도록 하되, 없으면 자동으로 계산
    constructor(baseUrl) {
        if (baseUrl) {
            this.baseUrl = baseUrl;
        }
        else {
            // ✅ 핵심 변경 2: ServerConnection 대신 PageConfig로 URL 가져오기
            // PageConfig.getBaseUrl()은 '/user/아이디/프로젝트/' 형태의 주소를 정확히 가져옵니다.
            const serverRoot = _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__.PageConfig.getBaseUrl();
            // 3. 경로 합치기
            // 결과: /user/453467/pl2wadmprj/hdsp-agent
            this.baseUrl = _jupyterlab_coreutils__WEBPACK_IMPORTED_MODULE_0__.URLExt.join(serverRoot, 'hdsp-agent');
        }
        console.log('[ApiService] Base URL initialized:', this.baseUrl); // 디버깅용 로그
    }
    /**
     * Get cookie value by name
     */
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop()?.split(';').shift() || '';
        }
        return '';
    }
    /**
     * Get CSRF token from cookie
     */
    getCsrfToken() {
        return this.getCookie('_xsrf');
    }
    /**
     * Get headers with CSRF token for POST requests
     */
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-XSRFToken': this.getCsrfToken()
        };
    }
    /**
     * Execute cell action (explain, fix, custom)
     */
    async cellAction(request) {
        const response = await fetch(`${this.baseUrl}/cell/action`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'API request failed' }));
            throw new Error(error.message || 'API request failed');
        }
        return response.json();
    }
    /**
     * Send chat message
     */
    async sendMessage(request) {
        const response = await fetch(`${this.baseUrl}/chat/message`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({
                message: `Failed to send message (${response.status})`,
                error: `HTTP ${response.status}: ${response.statusText}`
            }));
            console.error('Chat API error:', error);
            console.error('Response status:', response.status);
            console.error('Request:', request);
            throw new Error(error.message || error.error || `Failed to send message (${response.status})`);
        }
        return response.json();
    }
    /**
     * Send chat message with streaming response
     */
    async sendMessageStream(request, onChunk, onMetadata) {
        const response = await fetch(`${this.baseUrl}/chat/stream`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to send message: ${error}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body is not readable');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // Process complete SSE messages
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            // Handle errors
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            // Handle metadata (conversationId, messageId, etc.)
                            if (data.conversationId && onMetadata) {
                                onMetadata({
                                    conversationId: data.conversationId,
                                    messageId: data.messageId,
                                    provider: data.metadata?.provider,
                                    model: data.metadata?.model
                                });
                            }
                            // Handle content chunks
                            if (data.content) {
                                onChunk(data.content);
                            }
                            // Final metadata update
                            if (data.done && data.metadata && onMetadata) {
                                onMetadata({
                                    provider: data.metadata.provider,
                                    model: data.metadata.model
                                });
                            }
                        }
                        catch (e) {
                            if (e instanceof SyntaxError) {
                                console.warn('Failed to parse SSE data:', line);
                            }
                            else {
                                throw e;
                            }
                        }
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    /**
     * Save configuration
     */
    async saveConfig(config) {
        const response = await fetch(`${this.baseUrl}/config`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(config)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Failed to save configuration' }));
            throw new Error(error.message || 'Failed to save configuration');
        }
    }
    /**
     * Get current configuration
     */
    async getConfig() {
        const response = await fetch(`${this.baseUrl}/config`);
        if (!response.ok) {
            throw new Error('Failed to load configuration');
        }
        return response.json();
    }
    /**
     * Get health status
     */
    async getStatus() {
        const response = await fetch(`${this.baseUrl}/status`);
        if (!response.ok) {
            throw new Error('Failed to get status');
        }
        return response.json();
    }
    /**
     * Get available models
     */
    async getModels() {
        const response = await fetch(`${this.baseUrl}/models`);
        if (!response.ok) {
            throw new Error('Failed to load models');
        }
        return response.json();
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Auto-Agent API Methods
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Generate execution plan for auto-agent task
     */
    async generateExecutionPlan(request) {
        console.log('[ApiService] generateExecutionPlan request:', request);
        const response = await fetch(`${this.baseUrl}/auto-agent/plan`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ApiService] Plan API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
                url: `${this.baseUrl}/auto-agent/plan`
            });
            let errorMessage = '계획 생성 실패';
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorMessage;
            }
            catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        const result = await response.json();
        console.log('[ApiService] Plan API Success:', result);
        return result;
    }
    /**
     * Refine step code after error (Self-Healing)
     */
    async refineStepCode(request) {
        console.log('[ApiService] refineStepCode request:', request);
        const response = await fetch(`${this.baseUrl}/auto-agent/refine`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ApiService] Refine API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
                url: `${this.baseUrl}/auto-agent/refine`
            });
            let errorMessage = '코드 수정 실패';
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorMessage;
            }
            catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        const result = await response.json();
        console.log('[ApiService] Refine API Success:', result);
        return result;
    }
    /**
     * Adaptive Replanning - 에러 분석 후 계획 재수립
     */
    async replanExecution(request) {
        console.log('[ApiService] replanExecution request:', request);
        const response = await fetch(`${this.baseUrl}/auto-agent/replan`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ApiService] Replan API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
                url: `${this.baseUrl}/auto-agent/replan`
            });
            let errorMessage = '계획 재수립 실패';
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorMessage;
            }
            catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        const result = await response.json();
        console.log('[ApiService] Replan API Success:', result);
        return result;
    }
    /**
     * Validate code before execution - 사전 코드 품질 검증 (Pyflakes/AST 기반)
     */
    async validateCode(request) {
        console.log('[ApiService] validateCode request:', request);
        const response = await fetch(`${this.baseUrl}/auto-agent/validate`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ApiService] Validate API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
                url: `${this.baseUrl}/auto-agent/validate`
            });
            let errorMessage = '코드 검증 실패';
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorMessage;
            }
            catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        const result = await response.json();
        console.log('[ApiService] Validate API Success:', result);
        return result;
    }
    /**
     * Reflect on step execution - 실행 결과 분석 및 적응적 조정
     */
    async reflectOnExecution(request) {
        console.log('[ApiService] reflectOnExecution request:', request);
        const response = await fetch(`${this.baseUrl}/auto-agent/reflect`, {
            method: 'POST',
            headers: this.getHeaders(),
            credentials: 'include',
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ApiService] Reflect API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
                url: `${this.baseUrl}/auto-agent/reflect`
            });
            let errorMessage = 'Reflection 실패';
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorJson.message || errorMessage;
            }
            catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        const result = await response.json();
        console.log('[ApiService] Reflect API Success:', result);
        return result;
    }
    /**
     * Stream execution plan generation with real-time updates
     */
    async generateExecutionPlanStream(request, onPlanUpdate, onReasoning) {
        const response = await fetch(`${this.baseUrl}/auto-agent/plan/stream`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to generate plan: ${error}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body is not readable');
        }
        const decoder = new TextDecoder();
        let buffer = '';
        let finalPlan = null;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            if (data.reasoning && onReasoning) {
                                onReasoning(data.reasoning);
                            }
                            if (data.plan) {
                                onPlanUpdate(data.plan);
                                if (data.done) {
                                    finalPlan = data.plan;
                                }
                            }
                        }
                        catch (e) {
                            if (!(e instanceof SyntaxError)) {
                                throw e;
                            }
                        }
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        if (!finalPlan) {
            throw new Error('No plan received from server');
        }
        return finalPlan;
    }
}


/***/ }),

/***/ "./lib/services/TaskService.js":
/*!*************************************!*\
  !*** ./lib/services/TaskService.js ***!
  \*************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TaskService: () => (/* binding */ TaskService)
/* harmony export */ });
/**
 * Task Service - Handles notebook generation tasks and progress tracking
 */
class TaskService {
    constructor(baseUrl = '/hdsp-agent') {
        this.baseUrl = baseUrl;
        this.eventSources = new Map();
    }
    /**
     * Get cookie value by name
     */
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop()?.split(';').shift() || '';
        }
        return '';
    }
    /**
     * Get CSRF token from cookie
     */
    getCsrfToken() {
        return this.getCookie('_xsrf');
    }
    /**
     * Get headers with CSRF token for POST requests
     */
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-XSRFToken': this.getCsrfToken()
        };
    }
    /**
     * Start a new notebook generation task
     */
    async generateNotebook(request) {
        const response = await fetch(`${this.baseUrl}/notebook/generate`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ message: 'Failed to start notebook generation' }));
            throw new Error(error.message || 'Failed to start notebook generation');
        }
        return response.json();
    }
    /**
     * Get current task status
     */
    async getTaskStatus(taskId) {
        const response = await fetch(`${this.baseUrl}/task/${taskId}/status`);
        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ message: 'Failed to get task status' }));
            throw new Error(error.message || 'Failed to get task status');
        }
        return response.json();
    }
    /**
     * Subscribe to task progress updates via Server-Sent Events
     */
    subscribeToTaskProgress(taskId, onProgress, onError, onComplete) {
        // Close existing connection if any
        this.unsubscribeFromTask(taskId);
        const eventSource = new EventSource(`${this.baseUrl}/task/${taskId}/stream`);
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onProgress(data);
                // Close connection if task is done
                if (['completed', 'failed', 'cancelled'].includes(data.status)) {
                    this.unsubscribeFromTask(taskId);
                    if (onComplete) {
                        onComplete();
                    }
                }
            }
            catch (error) {
                console.error('Failed to parse SSE message:', error);
                if (onError) {
                    onError(error);
                }
            }
        };
        eventSource.onerror = (event) => {
            console.error('SSE connection error:', event);
            this.unsubscribeFromTask(taskId);
            if (onError) {
                onError(new Error('Connection to server lost'));
            }
        };
        this.eventSources.set(taskId, eventSource);
        // Return unsubscribe function
        return () => this.unsubscribeFromTask(taskId);
    }
    /**
     * Unsubscribe from task progress updates
     */
    unsubscribeFromTask(taskId) {
        const eventSource = this.eventSources.get(taskId);
        if (eventSource) {
            eventSource.close();
            this.eventSources.delete(taskId);
        }
    }
    /**
     * Cancel a running task
     */
    async cancelTask(taskId) {
        const response = await fetch(`${this.baseUrl}/task/${taskId}/cancel`, {
            method: 'POST',
            headers: this.getHeaders()
        });
        if (!response.ok) {
            const error = await response
                .json()
                .catch(() => ({ message: 'Failed to cancel task' }));
            throw new Error(error.message || 'Failed to cancel task');
        }
        // Close SSE connection
        this.unsubscribeFromTask(taskId);
    }
    /**
     * Clean up all active connections
     */
    dispose() {
        for (const [taskId, _] of this.eventSources) {
            this.unsubscribeFromTask(taskId);
        }
    }
}


/***/ }),

/***/ "./lib/services/ToolExecutor.js":
/*!**************************************!*\
  !*** ./lib/services/ToolExecutor.js ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ToolExecutor: () => (/* binding */ ToolExecutor),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @jupyterlab/notebook */ "webpack/sharing/consume/default/@jupyterlab/notebook");
/* harmony import */ var _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__);
/**
 * ToolExecutor - HF Jupyter Agent 스타일의 Tool 실행기
 *
 * 3가지 도구 실행 및 결과 캡처:
 * - jupyter_cell: 코드 셀 생성/수정/실행
 * - markdown: 마크다운 셀 생성/수정
 * - final_answer: 작업 완료 신호
 */

class ToolExecutor {
    constructor(notebook, sessionContext) {
        this.autoScrollEnabled = true;
        /**
         * 마지막으로 생성된 셀 인덱스 추적 (순차 삽입용)
         */
        this.lastCreatedCellIndex = -1;
        this.notebook = notebook;
        this.sessionContext = sessionContext;
    }
    /**
     * 자동 스크롤 설정
     */
    setAutoScroll(enabled) {
        this.autoScrollEnabled = enabled;
    }
    /**
     * 특정 셀로 스크롤 및 포커스
     */
    scrollToCell(cellIndex) {
        if (!this.autoScrollEnabled)
            return;
        const notebookContent = this.notebook.content;
        const cell = notebookContent.widgets[cellIndex];
        if (cell) {
            // 셀로 부드럽게 스크롤
            cell.node.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }
    /**
     * Tool 실행 라우터
     */
    async executeTool(call) {
        console.log('[ToolExecutor] executeTool called:', JSON.stringify(call, null, 2));
        let result;
        switch (call.tool) {
            case 'jupyter_cell':
                console.log('[ToolExecutor] Executing jupyter_cell tool');
                result = await this.executeJupyterCell(call.parameters);
                break;
            case 'markdown':
                console.log('[ToolExecutor] Executing markdown tool');
                result = await this.executeMarkdown(call.parameters);
                break;
            case 'final_answer':
                console.log('[ToolExecutor] Executing final_answer tool');
                result = await this.executeFinalAnswer(call.parameters);
                break;
            default:
                result = {
                    success: false,
                    error: `Unknown tool: ${call.tool}`,
                };
        }
        console.log('[ToolExecutor] Tool result:', JSON.stringify(result, null, 2));
        return result;
    }
    /**
     * jupyter_cell 도구: 셀 생성/수정/실행
     */
    async executeJupyterCell(params) {
        console.log('[ToolExecutor] executeJupyterCell params:', params);
        const notebookContent = this.notebook.content;
        console.log('[ToolExecutor] notebook content available:', !!notebookContent);
        console.log('[ToolExecutor] notebook model available:', !!notebookContent?.model);
        let cellIndex;
        let wasModified = false;
        try {
            if (params.cellIndex !== undefined) {
                // 기존 셀 수정
                console.log('[ToolExecutor] Modifying existing cell at index:', params.cellIndex);
                cellIndex = params.cellIndex;
                this.updateCellContent(cellIndex, params.code);
                wasModified = true;
            }
            else {
                // 새 셀 생성
                console.log('[ToolExecutor] Creating new code cell');
                cellIndex = await this.createCodeCell(params.code, params.insertAfter);
                console.log('[ToolExecutor] Created cell at index:', cellIndex);
            }
            // 셀 생성/수정 후 해당 셀로 스크롤 (실행 전)
            this.scrollToCell(cellIndex);
            // 셀 실행 및 결과 캡처
            console.log('[ToolExecutor] Executing cell at index:', cellIndex);
            const result = await this.executeCellAndCapture(cellIndex);
            console.log('[ToolExecutor] Cell execution result:', result.status);
            return {
                success: result.status === 'ok',
                output: result.result || result.stdout,
                error: result.error?.evalue,
                traceback: result.error?.traceback,
                cellIndex,
                wasModified,
            };
        }
        catch (error) {
            console.error('[ToolExecutor] executeJupyterCell error:', error);
            return {
                success: false,
                error: error.message || 'Failed to execute jupyter_cell',
                cellIndex: cellIndex,
                wasModified,
            };
        }
    }
    /**
     * markdown 도구: 마크다운 셀 생성/수정
     */
    async executeMarkdown(params) {
        try {
            let cellIndex;
            let wasModified = false;
            if (params.cellIndex !== undefined) {
                cellIndex = params.cellIndex;
                this.updateCellContent(cellIndex, params.content);
                wasModified = true;
            }
            else {
                cellIndex = await this.createMarkdownCell(params.content);
            }
            // 마크다운 셀도 생성 후 스크롤
            this.scrollToCell(cellIndex);
            return {
                success: true,
                cellIndex,
                wasModified,
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message || 'Failed to execute markdown',
            };
        }
    }
    /**
     * final_answer 도구: 작업 완료 신호
     */
    async executeFinalAnswer(params) {
        return {
            success: true,
            output: params.answer,
        };
    }
    /**
     * 순차 실행 시작 시 호출 (마지막 셀 인덱스 초기화)
     */
    resetSequentialExecution() {
        const model = this.notebook.content.model;
        // 현재 노트북 맨 끝 셀 인덱스로 초기화
        this.lastCreatedCellIndex = model ? model.cells.length - 1 : -1;
        console.log('[ToolExecutor] Reset sequential execution, lastCreatedCellIndex:', this.lastCreatedCellIndex);
    }
    /**
     * 코드 셀 생성 (항상 순차적으로 맨 끝에 추가)
     */
    async createCodeCell(code, insertAfter) {
        const notebookContent = this.notebook.content;
        const model = notebookContent.model;
        if (!model) {
            throw new Error('Notebook model not available');
        }
        // 노트북 맨 끝의 활성 셀이 빈 코드 셀이면 재사용 (첫 셀 생성 시에만)
        const activeIndex = notebookContent.activeCellIndex;
        const isAtEnd = activeIndex === model.cells.length - 1;
        if (activeIndex >= 0 && insertAfter === undefined && isAtEnd) {
            const activeCell = model.cells.get(activeIndex);
            if (activeCell && activeCell.type === 'code') {
                const source = activeCell.sharedModel.getSource().trim();
                if (source === '') {
                    // 빈 셀 재사용
                    activeCell.sharedModel.setSource(code);
                    this.lastCreatedCellIndex = activeIndex;
                    return activeIndex;
                }
            }
        }
        // ★ 순차 삽입: 항상 노트북 맨 끝에 추가 (중간 삽입 금지)
        // 이렇게 하면 셀이 항상 아래로만 추가됨
        const insertIndex = model.cells.length;
        // 새 코드 셀 생성
        model.sharedModel.insertCell(insertIndex, {
            cell_type: 'code',
            source: code,
            metadata: {},
        });
        // 마지막 생성 셀 인덱스 업데이트
        this.lastCreatedCellIndex = insertIndex;
        // 새 셀로 포커스 이동
        notebookContent.activeCellIndex = insertIndex;
        console.log('[ToolExecutor] Created cell at index:', insertIndex, '(always at end)');
        return insertIndex;
    }
    /**
     * 마크다운 셀 생성 (항상 순차적으로 맨 끝에 추가)
     */
    async createMarkdownCell(content, insertAfter) {
        const notebookContent = this.notebook.content;
        const model = notebookContent.model;
        if (!model) {
            throw new Error('Notebook model not available');
        }
        // ★ 순차 삽입: 항상 노트북 맨 끝에 추가 (중간 삽입 금지)
        const insertIndex = model.cells.length;
        // 새 마크다운 셀 생성
        model.sharedModel.insertCell(insertIndex, {
            cell_type: 'markdown',
            source: content,
            metadata: {},
        });
        // 마크다운 셀 렌더링
        const cell = notebookContent.widgets[insertIndex];
        if (cell && cell.rendered !== undefined) {
            cell.rendered = true;
        }
        // 마지막 생성 셀 인덱스 업데이트
        this.lastCreatedCellIndex = insertIndex;
        // 새 셀로 활성 셀 업데이트
        notebookContent.activeCellIndex = insertIndex;
        console.log('[ToolExecutor] Created markdown cell at index:', insertIndex, '(always at end)');
        return insertIndex;
    }
    /**
     * 셀 내용 업데이트
     */
    updateCellContent(cellIndex, content) {
        const notebookContent = this.notebook.content;
        const cell = notebookContent.widgets[cellIndex];
        if (!cell || !cell.model?.sharedModel) {
            throw new Error(`Cell at index ${cellIndex} not found or model not available`);
        }
        cell.model.sharedModel.setSource(content);
    }
    /**
     * 셀 실행 및 결과 캡처
     * NotebookActions.run()을 사용하여 정식으로 셀 실행 (execution_count 업데이트 포함)
     */
    async executeCellAndCapture(cellIndex) {
        const notebookContent = this.notebook.content;
        const cell = notebookContent.widgets[cellIndex];
        if (!cell) {
            throw new Error(`Cell at index ${cellIndex} not found`);
        }
        const startTime = Date.now();
        // 해당 셀 선택
        notebookContent.activeCellIndex = cellIndex;
        // NotebookActions.run()을 사용하여 정식 실행 (execution_count 업데이트됨)
        const success = await _jupyterlab_notebook__WEBPACK_IMPORTED_MODULE_0__.NotebookActions.run(notebookContent, this.sessionContext);
        // 실행 완료 후 결과 캡처
        const executionTime = Date.now() - startTime;
        // 셀 출력 분석
        let stdout = '';
        let stderr = '';
        let result = null;
        let error = undefined;
        // cell.model과 outputs가 존재하는지 안전하게 체크
        const outputs = cell.model?.outputs;
        console.log('[ToolExecutor] Cell outputs count:', outputs?.length ?? 0);
        if (outputs && outputs.length > 0) {
            for (let i = 0; i < outputs.length; i++) {
                const output = outputs.get(i);
                console.log(`[ToolExecutor] Output ${i} type:`, output.type);
                if (output.type === 'stream') {
                    const streamOutput = output;
                    if (streamOutput.name === 'stdout') {
                        stdout += streamOutput.text || '';
                    }
                    else if (streamOutput.name === 'stderr') {
                        stderr += streamOutput.text || '';
                    }
                }
                else if (output.type === 'execute_result' || output.type === 'display_data') {
                    const data = output.data;
                    if (!result) {
                        result = data;
                    }
                }
                else if (output.type === 'error') {
                    const errorOutput = output;
                    console.log('[ToolExecutor] Error output detected:', JSON.stringify(errorOutput));
                    // 실제로 에러 내용이 있는 경우에만 에러로 처리
                    if (errorOutput.ename || errorOutput.evalue) {
                        error = {
                            ename: errorOutput.ename,
                            evalue: errorOutput.evalue,
                            traceback: errorOutput.traceback,
                        };
                    }
                }
            }
        }
        const status = error ? 'error' : 'ok';
        console.log('[ToolExecutor] Final status:', status, 'error:', error);
        return {
            status,
            stdout,
            stderr,
            result,
            error,
            executionTime,
            cellIndex,
        };
    }
    /**
     * 현재 노트북의 셀 개수 반환
     */
    getCellCount() {
        return this.notebook.content.model?.cells.length || 0;
    }
    /**
     * 특정 셀의 내용 반환
     */
    getCellContent(cellIndex) {
        const cell = this.notebook.content.widgets[cellIndex];
        return cell?.model?.sharedModel?.getSource() || '';
    }
    /**
     * 특정 셀의 출력 반환
     */
    getCellOutput(cellIndex) {
        const cell = this.notebook.content.widgets[cellIndex];
        // cell, cell.model, cell.model.outputs 모두 안전하게 체크
        const cellOutputs = cell?.model?.outputs;
        if (!cell || !cellOutputs) {
            return '';
        }
        const outputs = [];
        for (let i = 0; i < cellOutputs.length; i++) {
            const output = cellOutputs.get(i);
            if (output.type === 'stream') {
                outputs.push(output.text || '');
            }
            else if (output.type === 'execute_result' || output.type === 'display_data') {
                const data = output.data;
                if (data?.['text/plain']) {
                    outputs.push(data['text/plain']);
                }
            }
            else if (output.type === 'error') {
                const errorOutput = output;
                outputs.push(`${errorOutput.ename}: ${errorOutput.evalue}`);
            }
        }
        return outputs.join('\n');
    }
    /**
     * 커널 인터럽트
     */
    async interruptKernel() {
        const kernel = this.sessionContext.session?.kernel;
        if (kernel) {
            await kernel.interrupt();
        }
    }
    /**
     * 셀 삭제
     */
    deleteCell(cellIndex) {
        const model = this.notebook.content.model;
        if (model && cellIndex >= 0 && cellIndex < model.cells.length) {
            model.sharedModel.deleteCell(cellIndex);
        }
    }
    /**
     * 여러 셀 실행 (순차)
     */
    async executeMultipleCells(cellIndices) {
        const results = [];
        for (const index of cellIndices) {
            const result = await this.executeCellAndCapture(index);
            results.push(result);
            if (result.status === 'error') {
                break; // 에러 발생 시 중단
            }
        }
        return results;
    }
}
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (ToolExecutor);


/***/ }),

/***/ "./lib/styles/icons/hdsp-icon.svg":
/*!****************************************!*\
  !*** ./lib/styles/icons/hdsp-icon.svg ***!
  \****************************************/
/***/ ((module) => {

module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\">\n  <path fill=\"currentColor\" d=\"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z\"/>\n</svg>\n";

/***/ }),

/***/ "./lib/types/auto-agent.js":
/*!*********************************!*\
  !*** ./lib/types/auto-agent.js ***!
  \*********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DEFAULT_AUTO_AGENT_CONFIG: () => (/* binding */ DEFAULT_AUTO_AGENT_CONFIG),
/* harmony export */   EXECUTION_SPEED_DELAYS: () => (/* binding */ EXECUTION_SPEED_DELAYS)
/* harmony export */ });
/**
 * Auto-Agent Type Definitions
 * HuggingFace Jupyter Agent 패턴 기반 Tool Calling 구조
 */
// 속도 프리셋 (ms 단위 지연) - 전반적으로 느리게 조정
const EXECUTION_SPEED_DELAYS = {
    'instant': 0,
    'fast': 800,
    'normal': 1500,
    'slow': 3000,
    'step-by-step': -1, // -1은 수동 진행 의미
};
const DEFAULT_AUTO_AGENT_CONFIG = {
    maxRetriesPerStep: 3,
    executionTimeout: 30000,
    enableSafetyCheck: true,
    showDetailedProgress: true,
    executionSpeed: 'normal',
    stepDelay: 1500,
    autoScrollToCell: true,
    highlightCurrentCell: true,
};


/***/ }),

/***/ "./lib/types/index.js":
/*!****************************!*\
  !*** ./lib/types/index.js ***!
  \****************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AgentEvent: () => (/* binding */ AgentEvent),
/* harmony export */   CellAction: () => (/* binding */ CellAction)
/* harmony export */ });
/**
 * Core type definitions for Jupyter Agent extension
 */
var CellAction;
(function (CellAction) {
    CellAction["EXPLAIN"] = "explain";
    CellAction["FIX"] = "fix";
    CellAction["CUSTOM_PROMPT"] = "custom_prompt";
})(CellAction || (CellAction = {}));
var AgentEvent;
(function (AgentEvent) {
    AgentEvent["CELL_ACTION"] = "hdsp-agent:cell-action";
    AgentEvent["CONFIG_CHANGED"] = "hdsp-agent:config-changed";
    AgentEvent["MESSAGE_SENT"] = "hdsp-agent:message-sent";
    AgentEvent["MESSAGE_RECEIVED"] = "hdsp-agent:message-received";
})(AgentEvent || (AgentEvent = {}));


/***/ }),

/***/ "./lib/utils/SafetyChecker.js":
/*!************************************!*\
  !*** ./lib/utils/SafetyChecker.js ***!
  \************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   SafetyChecker: () => (/* binding */ SafetyChecker),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/**
 * SafetyChecker - 코드 안전 검사기
 *
 * 위험한 코드 패턴을 사전에 검출하여 실행 전 경고
 * NBI (Notebook Intelligence) 패턴 참조
 */
const DANGEROUS_PATTERNS = [
    // 시스템 명령 관련
    {
        pattern: /rm\s+-rf\s+[\/~]/,
        description: '재귀 삭제 명령 (rm -rf)',
        severity: 'critical',
        category: 'system',
    },
    {
        pattern: /os\.system\s*\(/,
        description: '시스템 명령 실행 (os.system)',
        severity: 'critical',
        category: 'system',
    },
    {
        pattern: /subprocess\.(run|call|Popen|check_output)\s*\(/,
        description: '서브프로세스 실행 (subprocess)',
        severity: 'warning',
        category: 'system',
    },
    {
        pattern: /os\.exec\w*\s*\(/,
        description: 'OS exec 명령 실행',
        severity: 'critical',
        category: 'system',
    },
    // 동적 코드 실행
    {
        pattern: /\beval\s*\(/,
        description: '동적 코드 실행 (eval)',
        severity: 'critical',
        category: 'security',
    },
    {
        pattern: /\bexec\s*\(/,
        description: '동적 코드 실행 (exec)',
        severity: 'critical',
        category: 'security',
    },
    {
        pattern: /__import__\s*\(/,
        description: '동적 모듈 임포트 (__import__)',
        severity: 'warning',
        category: 'security',
    },
    {
        pattern: /compile\s*\([^)]*exec/,
        description: '동적 코드 컴파일 (compile)',
        severity: 'critical',
        category: 'security',
    },
    // 파일 시스템 관련
    {
        pattern: /open\s*\([^)]*,\s*['"]w/,
        description: '파일 쓰기 모드 열기',
        severity: 'warning',
        category: 'file',
    },
    {
        pattern: /shutil\.(rmtree|move|copy)/,
        description: '파일/디렉토리 조작 (shutil)',
        severity: 'warning',
        category: 'file',
    },
    {
        pattern: /os\.(remove|unlink|rmdir|makedirs|rename)/,
        description: '파일 시스템 변경 (os)',
        severity: 'warning',
        category: 'file',
    },
    {
        pattern: /pathlib\.Path[^)]*\.(unlink|rmdir|write)/,
        description: '파일 시스템 변경 (pathlib)',
        severity: 'warning',
        category: 'file',
    },
    // 네트워크 관련
    {
        pattern: /requests\.(get|post|put|delete|patch)\s*\([^)]*\)/,
        description: 'HTTP 요청 (requests)',
        severity: 'info',
        category: 'network',
    },
    {
        pattern: /urllib\.(request|urlopen)/,
        description: 'URL 요청 (urllib)',
        severity: 'info',
        category: 'network',
    },
    {
        pattern: /socket\./,
        description: '소켓 통신 (socket)',
        severity: 'warning',
        category: 'network',
    },
    // 무한 루프 패턴
    {
        pattern: /while\s+True\s*:/,
        description: '무한 루프 (while True)',
        severity: 'warning',
        category: 'loop',
    },
    {
        pattern: /while\s+1\s*:/,
        description: '무한 루프 (while 1)',
        severity: 'warning',
        category: 'loop',
    },
    {
        pattern: /for\s+\w+\s+in\s+iter\s*\(\s*int\s*,/,
        description: '무한 반복자 (iter(int, ...))',
        severity: 'warning',
        category: 'loop',
    },
    // 민감 정보 관련
    {
        pattern: /os\.environ\s*\[/,
        description: '환경 변수 접근',
        severity: 'info',
        category: 'security',
    },
    {
        pattern: /(password|secret|api_key|token)\s*=\s*['"][^'"]+['"]/i,
        description: '하드코딩된 민감 정보',
        severity: 'warning',
        category: 'security',
    },
    // 위험한 모듈
    {
        pattern: /import\s+pickle|from\s+pickle\s+import/,
        description: 'Pickle 모듈 (역직렬화 취약점)',
        severity: 'info',
        category: 'security',
    },
    {
        pattern: /import\s+ctypes|from\s+ctypes\s+import/,
        description: 'ctypes 모듈 (저수준 메모리 접근)',
        severity: 'warning',
        category: 'security',
    },
];
class SafetyChecker {
    constructor(config) {
        this.config = {
            enableSafetyCheck: true,
            blockDangerousPatterns: false,
            requireConfirmation: true,
            maxExecutionTime: 30,
            ...config,
        };
    }
    /**
     * 코드 안전성 검사
     */
    checkCodeSafety(code) {
        if (!this.config.enableSafetyCheck) {
            return { safe: true, warnings: [] };
        }
        const warnings = [];
        const blockedPatterns = [];
        for (const dangerous of DANGEROUS_PATTERNS) {
            if (dangerous.pattern.test(code)) {
                const message = `[${dangerous.severity.toUpperCase()}] ${dangerous.description}`;
                if (dangerous.severity === 'critical' && this.config.blockDangerousPatterns) {
                    blockedPatterns.push(message);
                }
                else {
                    warnings.push(message);
                }
            }
        }
        const safe = blockedPatterns.length === 0;
        return {
            safe,
            warnings,
            blockedPatterns: blockedPatterns.length > 0 ? blockedPatterns : undefined,
        };
    }
    /**
     * 여러 코드 블록 검사
     */
    checkMultipleCodeBlocks(codes) {
        const allWarnings = [];
        const allBlockedPatterns = [];
        for (let i = 0; i < codes.length; i++) {
            const result = this.checkCodeSafety(codes[i]);
            result.warnings.forEach((w) => allWarnings.push(`[Block ${i + 1}] ${w}`));
            if (result.blockedPatterns) {
                result.blockedPatterns.forEach((b) => allBlockedPatterns.push(`[Block ${i + 1}] ${b}`));
            }
        }
        return {
            safe: allBlockedPatterns.length === 0,
            warnings: allWarnings,
            blockedPatterns: allBlockedPatterns.length > 0 ? allBlockedPatterns : undefined,
        };
    }
    /**
     * 무한 루프 가능성 검사
     */
    checkInfiniteLoopRisk(code) {
        const loopPatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'loop');
        return loopPatterns.some((p) => p.pattern.test(code));
    }
    /**
     * 파일 시스템 변경 위험 검사
     */
    checkFileSystemRisk(code) {
        const filePatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'file');
        return filePatterns.some((p) => p.pattern.test(code));
    }
    /**
     * 네트워크 활동 검사
     */
    checkNetworkActivity(code) {
        const networkPatterns = DANGEROUS_PATTERNS.filter((p) => p.category === 'network');
        return networkPatterns.some((p) => p.pattern.test(code));
    }
    /**
     * 실행 시간 제한 값 반환
     */
    getMaxExecutionTime() {
        return this.config.maxExecutionTime * 1000; // ms로 변환
    }
    /**
     * 확인 필요 여부
     */
    requiresConfirmation(result) {
        if (!this.config.requireConfirmation) {
            return false;
        }
        return result.warnings.length > 0 || (result.blockedPatterns?.length || 0) > 0;
    }
    /**
     * 설정 업데이트
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * 현재 설정 반환
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * 사용자 친화적 경고 메시지 생성
     */
    formatWarningsForDisplay(result) {
        if (result.warnings.length === 0 && !result.blockedPatterns?.length) {
            return '';
        }
        const lines = [];
        if (result.blockedPatterns && result.blockedPatterns.length > 0) {
            lines.push('⛔ 차단된 패턴:');
            result.blockedPatterns.forEach((p) => lines.push(`  • ${p}`));
        }
        if (result.warnings.length > 0) {
            lines.push('⚠️ 경고:');
            result.warnings.forEach((w) => lines.push(`  • ${w}`));
        }
        return lines.join('\n');
    }
}
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (SafetyChecker);


/***/ }),

/***/ "./lib/utils/markdownRenderer.js":
/*!***************************************!*\
  !*** ./lib/utils/markdownRenderer.js ***!
  \***************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   escapeHtml: () => (/* binding */ escapeHtml),
/* harmony export */   formatInlineMarkdown: () => (/* binding */ formatInlineMarkdown),
/* harmony export */   formatMarkdownToHtml: () => (/* binding */ formatMarkdownToHtml),
/* harmony export */   highlightJavaScript: () => (/* binding */ highlightJavaScript),
/* harmony export */   highlightPython: () => (/* binding */ highlightPython),
/* harmony export */   normalizeIndentation: () => (/* binding */ normalizeIndentation),
/* harmony export */   parseMarkdownTable: () => (/* binding */ parseMarkdownTable)
/* harmony export */ });
/**
 * Markdown to HTML converter with syntax highlighting
 * Based on chrome_agent's formatMarkdownToHtml implementation
 */
/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
/**
 * Normalize indentation in code blocks
 */
function normalizeIndentation(code) {
    const lines = code.split('\n');
    // Find minimum indent from non-empty lines
    let minIndent = Infinity;
    const nonEmptyLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length > 0) {
            const match = line.match(/^(\s*)/);
            const indent = match ? match[1].length : 0;
            minIndent = Math.min(minIndent, indent);
            nonEmptyLines.push(i);
        }
    }
    // If no indent or no non-empty lines, return original
    if (minIndent === Infinity || minIndent === 0) {
        return code;
    }
    // Remove minimum indent from all lines
    const normalized = lines.map(line => {
        if (line.trim().length === 0) {
            return '';
        }
        return line.substring(minIndent);
    });
    return normalized.join('\n');
}
/**
 * Highlight Python code with inline styles
 */
function highlightPython(code) {
    let highlighted = code;
    // Color styles (matching chrome_agent)
    const styles = {
        COMMENT: 'color: #6a9955; font-style: italic;',
        STRING: 'color: #ce9178;',
        NUMBER: 'color: #b5cea8;',
        KEYWORD: 'color: #c586c0; font-weight: bold;',
        BUILTIN: 'color: #dcdcaa;',
        FUNCTION: 'color: #4fc1ff; font-weight: bold;',
        OPERATOR: 'color: #d4d4d4;',
        BRACKET: 'color: #d4d4d4;'
    };
    // Use placeholders to preserve order
    const placeholders = [];
    let placeholderIndex = 0;
    // Comments (process first)
    highlighted = highlighted.replace(/(#.*$)/gm, (match) => {
        const id = `__PH${placeholderIndex++}__`;
        placeholders.push({
            id,
            html: `<span style="${styles.COMMENT}">${escapeHtml(match)}</span>`
        });
        return id;
    });
    // Triple-quoted strings
    highlighted = highlighted.replace(/(['"]{3})([\s\S]*?)(\1)/g, (match) => {
        const id = `__PH${placeholderIndex++}__`;
        placeholders.push({
            id,
            html: `<span style="${styles.STRING}">${escapeHtml(match)}</span>`
        });
        return id;
    });
    // Regular strings
    highlighted = highlighted.replace(/(['"])([^'"]*?)(\1)/g, (match) => {
        const id = `__PH${placeholderIndex++}__`;
        placeholders.push({
            id,
            html: `<span style="${styles.STRING}">${escapeHtml(match)}</span>`
        });
        return id;
    });
    // Numbers
    highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, (match) => {
        const id = `__PH${placeholderIndex++}__`;
        placeholders.push({
            id,
            html: `<span style="${styles.NUMBER}">${match}</span>`
        });
        return id;
    });
    // Python keywords
    const keywords = [
        'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import',
        'from', 'as', 'try', 'except', 'finally', 'with', 'lambda', 'yield',
        'async', 'await', 'pass', 'break', 'continue', 'raise', 'assert', 'del',
        'global', 'nonlocal', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is'
    ];
    keywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'g');
        highlighted = highlighted.replace(regex, (match) => {
            const id = `__PH${placeholderIndex++}__`;
            placeholders.push({
                id,
                html: `<span style="${styles.KEYWORD}">${match}</span>`
            });
            return id;
        });
    });
    // Built-in functions
    const builtins = [
        'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'tuple',
        'set', 'bool', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr',
        'setattr', 'delattr', 'dir', 'vars', 'locals', 'globals', 'input', 'open',
        'file', 'abs', 'all', 'any', 'bin', 'chr', 'ord', 'hex', 'oct', 'pow',
        'round', 'sum', 'min', 'max', 'sorted', 'reversed', 'enumerate', 'zip',
        'map', 'filter', 'reduce'
    ];
    builtins.forEach(builtin => {
        const regex = new RegExp(`\\b${builtin}\\b`, 'g');
        highlighted = highlighted.replace(regex, (match) => {
            const id = `__PH${placeholderIndex++}__`;
            placeholders.push({
                id,
                html: `<span style="${styles.BUILTIN}">${match}</span>`
            });
            return id;
        });
    });
    // Function definitions - def keyword followed by function name
    highlighted = highlighted.replace(/(__PH\d+__\s+)([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, defPart, funcName) => {
        const defPlaceholder = placeholders.find(p => p.id === defPart.trim());
        if (defPlaceholder && defPlaceholder.html.includes('def')) {
            const id = `__PH${placeholderIndex++}__`;
            placeholders.push({
                id,
                html: `<span style="${styles.FUNCTION}">${funcName}</span>`
            });
            return defPart + id;
        }
        return match;
    });
    // Process remaining text - escape HTML and handle operators/brackets
    highlighted = highlighted.split(/(__PH\d+__)/g).map(part => {
        if (part.match(/^__PH\d+__$/)) {
            return part; // Keep placeholder as is
        }
        // Escape HTML
        part = escapeHtml(part);
        // Operators
        part = part.replace(/([+\-*/%=<>!&|^~]+)/g, `<span style="${styles.OPERATOR}">$1</span>`);
        // Brackets and delimiters
        part = part.replace(/([()[\]{}])/g, `<span style="${styles.BRACKET}">$1</span>`);
        return part;
    }).join('');
    // Replace placeholders with actual HTML
    placeholders.forEach(ph => {
        highlighted = highlighted.replace(ph.id, ph.html);
    });
    return highlighted;
}
/**
 * Highlight JavaScript code
 */
function highlightJavaScript(code) {
    const escaped = escapeHtml(code);
    const lines = escaped.split('\n');
    const keywords = [
        'function', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
        'return', 'class', 'import', 'export', 'from', 'async', 'await',
        'new', 'this', 'null', 'undefined', 'true', 'false', 'typeof'
    ];
    let inMultilineComment = false;
    const highlightedLines = lines.map(line => {
        // Check for multiline comment continuation
        if (inMultilineComment) {
            const endIndex = line.indexOf('*/');
            if (endIndex !== -1) {
                inMultilineComment = false;
                return `<span style="color: #6a9955; font-style: italic;">${line.substring(0, endIndex + 2)}</span>` +
                    highlightJSTokens(line.substring(endIndex + 2), keywords);
            }
            return `<span style="color: #6a9955; font-style: italic;">${line}</span>`;
        }
        // Single-line comment
        const commentMatch = line.match(/^(\s*)(\/\/.*)$/);
        if (commentMatch) {
            return commentMatch[1] + `<span style="color: #6a9955; font-style: italic;">${commentMatch[2]}</span>`;
        }
        // Multiline comment start
        const multiCommentStart = line.indexOf('/*');
        if (multiCommentStart !== -1) {
            const multiCommentEnd = line.indexOf('*/', multiCommentStart);
            if (multiCommentEnd !== -1) {
                return highlightJSTokens(line.substring(0, multiCommentStart), keywords) +
                    `<span style="color: #6a9955; font-style: italic;">${line.substring(multiCommentStart, multiCommentEnd + 2)}</span>` +
                    highlightJSTokens(line.substring(multiCommentEnd + 2), keywords);
            }
            else {
                inMultilineComment = true;
                return highlightJSTokens(line.substring(0, multiCommentStart), keywords) +
                    `<span style="color: #6a9955; font-style: italic;">${line.substring(multiCommentStart)}</span>`;
            }
        }
        // Comment in middle of line
        const commentIndex = line.indexOf('//');
        if (commentIndex !== -1) {
            return highlightJSTokens(line.substring(0, commentIndex), keywords) +
                `<span style="color: #6a9955; font-style: italic;">${line.substring(commentIndex)}</span>`;
        }
        return highlightJSTokens(line, keywords);
    });
    return highlightedLines.join('\n');
}
/**
 * Highlight JavaScript tokens (keywords, strings, numbers)
 */
function highlightJSTokens(line, keywords) {
    const container = document.createElement('span');
    let i = 0;
    while (i < line.length) {
        // String check (template literal, double quote, single quote)
        if (line[i] === '`') {
            let j = i + 1;
            let escaped = false;
            while (j < line.length) {
                if (line[j] === '\\' && !escaped) {
                    escaped = true;
                    j++;
                    continue;
                }
                if (line[j] === '`' && !escaped)
                    break;
                escaped = false;
                j++;
            }
            if (j < line.length && line[j] === '`') {
                const span = document.createElement('span');
                span.style.color = '#ce9178';
                span.textContent = line.substring(i, j + 1);
                container.appendChild(span);
                i = j + 1;
                continue;
            }
        }
        if (line[i] === '"') {
            let j = i + 1;
            let escaped = false;
            while (j < line.length) {
                if (line[j] === '\\' && !escaped) {
                    escaped = true;
                    j++;
                    continue;
                }
                if (line[j] === '"' && !escaped)
                    break;
                escaped = false;
                j++;
            }
            if (j < line.length && line[j] === '"') {
                const span = document.createElement('span');
                span.style.color = '#ce9178';
                span.textContent = line.substring(i, j + 1);
                container.appendChild(span);
                i = j + 1;
                continue;
            }
            // Unclosed string - treat rest as string
            const span = document.createElement('span');
            span.style.color = '#ce9178';
            span.textContent = line.substring(i);
            container.appendChild(span);
            break;
        }
        if (line[i] === '\'') {
            let j = i + 1;
            let escaped = false;
            while (j < line.length) {
                if (line[j] === '\\' && !escaped) {
                    escaped = true;
                    j++;
                    continue;
                }
                if (line[j] === '\'' && !escaped)
                    break;
                escaped = false;
                j++;
            }
            if (j < line.length && line[j] === '\'') {
                const span = document.createElement('span');
                span.style.color = '#ce9178';
                span.textContent = line.substring(i, j + 1);
                container.appendChild(span);
                i = j + 1;
                continue;
            }
            // Unclosed string
            const span = document.createElement('span');
            span.style.color = '#ce9178';
            span.textContent = line.substring(i);
            container.appendChild(span);
            break;
        }
        // Number check
        if (/\d/.test(line[i])) {
            let j = i;
            while (j < line.length && /[\d.]/.test(line[j])) {
                j++;
            }
            const span = document.createElement('span');
            span.style.color = '#b5cea8';
            span.textContent = line.substring(i, j);
            container.appendChild(span);
            i = j;
            continue;
        }
        // Word check (keyword or identifier)
        if (/[a-zA-Z_$]/.test(line[i])) {
            let j = i;
            while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) {
                j++;
            }
            const word = line.substring(i, j);
            if (keywords.includes(word)) {
                const span = document.createElement('span');
                span.style.color = '#569cd6';
                span.style.fontWeight = '500';
                span.textContent = word;
                container.appendChild(span);
            }
            else {
                const textNode = document.createTextNode(word);
                container.appendChild(textNode);
            }
            i = j;
            continue;
        }
        // Regular character
        const textNode = document.createTextNode(line[i]);
        container.appendChild(textNode);
        i++;
    }
    return container.innerHTML;
}
/**
 * Format inline markdown (bold, italic, inline code) within text
 */
function formatInlineMarkdown(text) {
    let html = escapeHtml(text);
    // Inline code first (to protect from other transformations)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Bold text (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic text (*text*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
}
/**
 * Parse markdown table to HTML
 */
function parseMarkdownTable(tableText) {
    const lines = tableText.trim().split('\n');
    if (lines.length < 2)
        return escapeHtml(tableText);
    // Check if it's a valid table (has header separator)
    const separatorIndex = lines.findIndex(line => /^\|?\s*[-:]+[-|\s:]+\s*\|?$/.test(line));
    if (separatorIndex === -1 || separatorIndex === 0)
        return escapeHtml(tableText);
    const headerLines = lines.slice(0, separatorIndex);
    const separatorLine = lines[separatorIndex];
    const bodyLines = lines.slice(separatorIndex + 1);
    // Parse alignment from separator
    const alignments = [];
    const separatorCells = separatorLine.split('|').filter(cell => cell.trim());
    separatorCells.forEach(cell => {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
            alignments.push('center');
        }
        else if (trimmed.endsWith(':')) {
            alignments.push('right');
        }
        else {
            alignments.push('left');
        }
    });
    // Build HTML table with wrapper for horizontal scroll
    let html = '<div class="markdown-table-wrapper"><table class="markdown-table">';
    // Header
    html += '<thead>';
    headerLines.forEach(line => {
        html += '<tr>';
        const cells = line.split('|').filter((cell, idx, arr) => {
            // Filter out empty cells from leading/trailing |
            if (idx === 0 && cell.trim() === '')
                return false;
            if (idx === arr.length - 1 && cell.trim() === '')
                return false;
            return true;
        });
        cells.forEach((cell, idx) => {
            const align = alignments[idx] || 'left';
            html += `<th style="text-align: ${align};">${formatInlineMarkdown(cell.trim())}</th>`;
        });
        html += '</tr>';
    });
    html += '</thead>';
    // Body
    if (bodyLines.length > 0) {
        html += '<tbody>';
        bodyLines.forEach(line => {
            if (!line.trim())
                return;
            html += '<tr>';
            const cells = line.split('|').filter((cell, idx, arr) => {
                if (idx === 0 && cell.trim() === '')
                    return false;
                if (idx === arr.length - 1 && cell.trim() === '')
                    return false;
                return true;
            });
            cells.forEach((cell, idx) => {
                const align = alignments[idx] || 'left';
                html += `<td style="text-align: ${align};">${formatInlineMarkdown(cell.trim())}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody>';
    }
    html += '</table></div>';
    return html;
}
/**
 * Format markdown text to HTML with syntax highlighting
 */
function formatMarkdownToHtml(text) {
    // Decode HTML entities if present
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    let html = textarea.value;
    // Step 1: Protect code blocks by replacing with placeholders
    const codeBlocks = [];
    const codeBlockPlaceholders = [];
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
        const lang = (language || 'python').toLowerCase();
        const trimmedCode = normalizeIndentation(code.trim());
        const blockId = 'code-block-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const placeholder = '__CODE_BLOCK_' + blockId + '__';
        codeBlocks.push({
            id: blockId,
            code: trimmedCode,
            language: lang
        });
        // Create HTML for code block
        const highlightedCode = lang === 'python' || lang === 'py'
            ? highlightPython(trimmedCode)
            : lang === 'javascript' || lang === 'js'
                ? highlightJavaScript(trimmedCode)
                : escapeHtml(trimmedCode);
        const htmlBlock = '<div class="code-block-container" data-block-id="' + blockId + '">' +
            '<div class="code-block-header">' +
            '<span class="code-block-language">' + escapeHtml(lang) + '</span>' +
            '<div class="code-block-actions">' +
            '<button class="code-block-apply" data-block-id="' + blockId + '" title="셀에 적용">셀에 적용</button>' +
            '<button class="code-block-copy" data-block-id="' + blockId + '" title="복사">복사</button>' +
            '</div>' +
            '</div>' +
            '<pre class="code-block language-' + escapeHtml(lang) + '"><code id="' + blockId + '">' + highlightedCode + '</code></pre>' +
            '</div>';
        codeBlockPlaceholders.push({
            placeholder: placeholder,
            html: htmlBlock
        });
        return placeholder;
    });
    // Step 2: Protect inline code
    const inlineCodePlaceholders = [];
    html = html.replace(/`([^`]+)`/g, (match, code) => {
        const placeholder = '__INLINE_CODE_' + Math.random().toString(36).substr(2, 9) + '__';
        inlineCodePlaceholders.push({
            placeholder: placeholder,
            html: '<code class="inline-code">' + escapeHtml(code) + '</code>'
        });
        return placeholder;
    });
    // Step 3: Parse and protect markdown tables
    const tablePlaceholders = [];
    // Improved table detection: look for lines with | separators and a separator row
    // Match pattern: header row(s), separator row (with ---), body rows
    // More flexible regex to handle various table formats
    const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\n?)+\|[-:| ]+\|(?:\n\|[^\n]+\|)*)/gm;
    html = html.replace(tableRegex, (match, tableBlock) => {
        const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
        const tableHtml = parseMarkdownTable(tableBlock.trim());
        tablePlaceholders.push({
            placeholder: placeholder,
            html: tableHtml
        });
        return '\n' + placeholder + '\n';
    });
    // Alternative: tables without leading/trailing | (GFM style)
    // Pattern: "header | header\n---|---\ndata | data"
    const gfmTableRegex = /(?:^|\n)((?:[^\n|]+\|[^\n]+\n)+[-:|\s]+[-|]+\n(?:[^\n|]+\|[^\n]+\n?)*)/gm;
    html = html.replace(gfmTableRegex, (match, tableBlock) => {
        // Skip if already processed (contains placeholder)
        if (tableBlock.includes('__TABLE_'))
            return match;
        const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
        const tableHtml = parseMarkdownTable(tableBlock.trim());
        tablePlaceholders.push({
            placeholder: placeholder,
            html: tableHtml
        });
        return '\n' + placeholder + '\n';
    });
    // Third pattern: catch any remaining tables with | characters and --- separator
    const fallbackTableRegex = /(?:^|\n)(\|[^\n]*\|\n\|[-:| ]*\|(?:\n\|[^\n]*\|)*)/gm;
    html = html.replace(fallbackTableRegex, (match, tableBlock) => {
        if (tableBlock.includes('__TABLE_'))
            return match;
        const placeholder = '__TABLE_' + Math.random().toString(36).substr(2, 9) + '__';
        const tableHtml = parseMarkdownTable(tableBlock.trim());
        tablePlaceholders.push({
            placeholder: placeholder,
            html: tableHtml
        });
        return '\n' + placeholder + '\n';
    });
    // Step 4: Escape HTML for non-placeholder text
    html = html.split(/(__(?:CODE_BLOCK|INLINE_CODE|TABLE)_[a-z0-9-]+__)/gi)
        .map((part, index) => {
        // Odd indices are placeholders - keep as is
        if (index % 2 === 1)
            return part;
        // Even indices are regular text - escape HTML
        return escapeHtml(part);
    })
        .join('');
    // Step 5: Convert markdown to HTML
    // Headings (process from h6 to h1 to avoid conflicts)
    html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
    html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    // Horizontal rule (---)
    html = html.replace(/^---+$/gim, '<hr>');
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Lists - process BEFORE bold/italic to handle "* item" correctly
    // Unordered lists: - or * at start of line
    html = html.replace(/^[\-\*]\s+(.*$)/gim, '<li>$1</li>');
    // Numbered lists: 1. 2. etc
    html = html.replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>');
    // Bold text (must be before italic)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic text - only match single * not at line start (to avoid conflict with lists)
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    // Step 6: Restore table placeholders
    tablePlaceholders.forEach(item => {
        html = html.replace(item.placeholder, item.html);
    });
    // Step 7: Restore inline code placeholders
    inlineCodePlaceholders.forEach(item => {
        html = html.replace(item.placeholder, item.html);
    });
    // Step 8: Restore code block placeholders
    codeBlockPlaceholders.forEach(item => {
        html = html.replace(item.placeholder, item.html);
    });
    return html;
}


/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/AutoFixHigh.js":
/*!*************************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/AutoFixHigh.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M7.5 5.6 10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29a.996.996 0 0 0-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41zm-1.03 5.49-2.12-2.12 2.44-2.44 2.12 2.12z"
}), 'AutoFixHigh'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/Cancel.js":
/*!********************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/Cancel.js ***!
  \********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z"
}), 'Cancel'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/CheckCircle.js":
/*!*************************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/CheckCircle.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z"
}), 'CheckCircle'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/Close.js":
/*!*******************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/Close.js ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
}), 'Close'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/Error.js":
/*!*******************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/Error.js ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-2h2zm0-4h-2V7h2z"
}), 'Error'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/ExpandLess.js":
/*!************************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/ExpandLess.js ***!
  \************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "m12 8-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"
}), 'ExpandLess'));

/***/ }),

/***/ "./node_modules/@mui/icons-material/esm/ExpandMore.js":
/*!************************************************************!*\
  !*** ./node_modules/@mui/icons-material/esm/ExpandMore.js ***!
  \************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./utils/createSvgIcon.js */ "./node_modules/@mui/material/utils/createSvgIcon.js");
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! react/jsx-runtime */ "./node_modules/react/jsx-runtime.js");
"use client";



/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ((0,_utils_createSvgIcon_js__WEBPACK_IMPORTED_MODULE_0__["default"])(/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_1__.jsx)("path", {
  d: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"
}), 'ExpandMore'));

/***/ })

}]);
//# sourceMappingURL=lib_index_js.14edf3ee7f79b9d12ace.js.map