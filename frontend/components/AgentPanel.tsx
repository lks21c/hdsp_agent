/**
 * Agent Panel - Main sidebar panel for Jupyter Agent
 * Cursor AI Style: Unified Chat + Agent Interface
 */

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { ReactWidget, LabIcon } from '@jupyterlab/ui-components';
import { ApiService } from '../services/ApiService';
import { IChatMessage } from '../types';
import { SettingsPanel, LLMConfig } from './SettingsPanel';
import { AgentOrchestrator } from '../services/AgentOrchestrator';
import {
  AgentStatus,
  AutoAgentResult,
  ExecutionPlan,
  DEFAULT_AUTO_AGENT_CONFIG,
  ExecutionSpeed,
} from '../types/auto-agent';
import { formatMarkdownToHtml, escapeHtml } from '../utils/markdownRenderer';

// 로고 이미지 (SVG) - TypeScript 모듈에서 인라인 문자열로 import
import { headerLogoSvg, tabbarLogoSvg } from '../logoSvg';

// 탭바 아이콘 생성
const hdspTabIcon = new LabIcon({
  name: 'hdsp-agent:tab-icon',
  svgstr: tabbarLogoSvg
});

// Agent 실행 메시지 타입 (채팅에 inline으로 표시)
interface AgentExecutionMessage {
  id: string;
  type: 'agent_execution';
  request: string;
  status: AgentStatus;
  plan: ExecutionPlan | null;
  result: AutoAgentResult | null;
  completedSteps: number[];
  failedSteps: number[];
  timestamp: number;
}

// 통합 메시지 타입 (Chat 메시지 또는 Agent 실행)
type UnifiedMessage = IChatMessage | AgentExecutionMessage;

interface AgentPanelProps {
  apiService: ApiService;
  notebookTracker?: any;
}

export interface ChatPanelHandle {
  handleSendMessage: () => Promise<void>;
  setInput: (value: string) => void;
  setLlmPrompt: (prompt: string) => void;
  setCurrentCellId: (cellId: string) => void;
  setCurrentCellIndex: (cellIndex: number) => void;
}

// Agent 명령어 감지 함수
const isAgentCommand = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase();
  return trimmed.startsWith('/run ') ||
         trimmed.startsWith('@agent ') ||
         trimmed.startsWith('/agent ') ||
         trimmed.startsWith('/execute ');
};

// Agent 명령어에서 실제 요청 추출
const extractAgentRequest = (input: string): string => {
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

/**
 * Chat Panel Component - Cursor AI Style Unified Interface
 */
// 입력 모드 타입
type InputMode = 'chat' | 'agent';

const ChatPanel = forwardRef<ChatPanelHandle, AgentPanelProps>(({ apiService, notebookTracker }, ref) => {
  // 통합 메시지 목록 (Chat + Agent 실행)
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  // Agent 실행 상태
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentAgentMessageId, setCurrentAgentMessageId] = useState<string | null>(null);
  const [executionSpeed, setExecutionSpeed] = useState<ExecutionSpeed>('normal');
  // 입력 모드 (Cursor AI 스타일) - 로컬 스토리지에서 복원
  const [inputMode, setInputMode] = useState<InputMode>(() => {
    try {
      const saved = localStorage.getItem('hdsp-agent-input-mode');
      return (saved === 'agent' || saved === 'chat') ? saved : 'chat';
    } catch {
      return 'chat';
    }
  });
  const [showModeDropdown, setShowModeDropdown] = useState(false);

  // 모드 변경 시 로컬 스토리지에 저장
  useEffect(() => {
    try {
      localStorage.setItem('hdsp-agent-input-mode', inputMode);
    } catch {
      // 로컬 스토리지 접근 불가 시 무시
    }
  }, [inputMode]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingLlmPromptRef = useRef<string | null>(null);
  const allCodeBlocksRef = useRef<Array<{ id: string; code: string; language: string }>>([]);
  const currentCellIdRef = useRef<string | null>(null);
  const currentCellIndexRef = useRef<number | null>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);

  // Expose handleSendMessage via ref
  useImperativeHandle(ref, () => ({
    handleSendMessage: async () => {
      await handleSendMessage();
    },
    setInput: (value: string) => {
      setInput(value);
    },
    setLlmPrompt: (prompt: string) => {
      pendingLlmPromptRef.current = prompt;
      // Find textarea and set data attribute
      const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.setAttribute('data-llm-prompt', prompt);
      }
    },
    setCurrentCellId: (cellId: string) => {
      console.log('[AgentPanel] setCurrentCellId called with:', cellId);
      currentCellIdRef.current = cellId;
    },
    setCurrentCellIndex: (cellIndex: number) => {
      console.log('[AgentPanel] setCurrentCellIndex called with:', cellIndex);
      currentCellIndexRef.current = cellIndex;
    }
  }));

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  // Initialize AgentOrchestrator when notebook is available
  useEffect(() => {
    const notebook = notebookTracker?.currentWidget;
    const sessionContext = notebook?.sessionContext;

    if (notebook && sessionContext) {
      const config = { ...DEFAULT_AUTO_AGENT_CONFIG, executionSpeed };
      orchestratorRef.current = new AgentOrchestrator(notebook, sessionContext, apiService, config);
    }

    return () => {
      orchestratorRef.current = null;
    };
  }, [notebookTracker?.currentWidget, apiService, executionSpeed]);

  // Agent 실행 핸들러
  const handleAgentExecution = useCallback(async (request: string) => {
    const notebook = notebookTracker?.currentWidget;
    if (!orchestratorRef.current || !notebook) {
      // 노트북이 없으면 에러 메시지 표시
      const errorMessage: IChatMessage = {
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
    const agentMessage: AgentExecutionMessage = {
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
      const result = await orchestratorRef.current.executeTask(
        request,
        notebook,
        (newStatus: AgentStatus) => {
          // 실시간 상태 업데이트
          setMessages(prev =>
            prev.map(msg =>
              msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
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
                : msg
            )
          );
        }
      );

      // 최종 결과 업데이트
      setMessages(prev =>
        prev.map(msg =>
          msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
            ? {
                ...msg,
                status: {
                  phase: result.success ? 'completed' : 'failed',
                  message: result.finalAnswer || (result.success ? '작업 완료' : '작업 실패'),
                },
                result,
                completedSteps: result.plan?.steps.map(s => s.stepNumber) || [],
              }
            : msg
        )
      );
    } catch (error: any) {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === agentMessageId && 'type' in msg && msg.type === 'agent_execution'
            ? {
                ...msg,
                status: { phase: 'failed', message: error.message || '실행 중 오류 발생' },
              }
            : msg
        )
      );
    } finally {
      setIsAgentRunning(false);
      setCurrentAgentMessageId(null);
    }
  }, [notebookTracker, apiService]);

  const loadConfig = async () => {
    try {
      const config = await apiService.getConfig();
      
      // If config doesn't have provider, use default
      if (!config || !(config as any).provider) {
        console.warn('Config missing provider, using default');
        const defaultConfig: LLMConfig = {
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
      
      setLlmConfig(config as any);

      // Log loaded model configuration
      const configData = config as any;
      console.log('=== HDSP Agent Model Configuration ===');
      console.log('Provider:', configData.provider);

      if (configData.provider === 'gemini') {
        console.log('Gemini Model:', configData.gemini?.model || 'gemini-pro (default)');
        console.log('Gemini API Key:', configData.gemini?.apiKey ? '✓ Configured' : '✗ Not configured');
      } else if (configData.provider === 'vllm') {
        console.log('vLLM Model:', configData.vllm?.model || 'default');
        console.log('vLLM Endpoint:', configData.vllm?.endpoint || 'http://localhost:8000');
        console.log('vLLM API Key:', configData.vllm?.apiKey ? '✓ Configured' : '✗ Not configured');
      } else if (configData.provider === 'openai') {
        console.log('OpenAI Model:', configData.openai?.model || 'gpt-4');
        console.log('OpenAI API Key:', configData.openai?.apiKey ? '✓ Configured' : '✗ Not configured');
      }

      console.log('=====================================');
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const handleSaveConfig = async (config: LLMConfig) => {
    try {
      console.log('=== handleSaveConfig 시작 ===');
      console.log('전송할 config:', JSON.stringify(config, null, 2));
      console.log('Provider:', config.provider);
      console.log('Gemini API Key:', config.gemini?.apiKey ? `${config.gemini.apiKey.substring(0, 10)}...` : 'empty');

      await apiService.saveConfig(config as any);

      console.log('서버 저장 완료, state 업데이트 중...');
      setLlmConfig(config);
      
      // Reload config from server to ensure consistency
      await loadConfig();
      
      console.log('=== handleSaveConfig 완료 ===');
      alert('설정이 성공적으로 저장되었습니다!');
    } catch (error) {
      console.error('=== handleSaveConfig 실패 ===');
      console.error('Error:', error);
      alert('설정 저장 실패. 다시 시도해주세요.');
    }
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Extract and store code blocks from messages, setup button listeners
  useEffect(() => {
    // Use a small delay to ensure DOM is updated after message rendering
    const timeoutId = setTimeout(() => {
      // Find messages container - try multiple selectors
      const messagesContainer = 
        document.querySelector('.jp-agent-messages') ||
        messagesEndRef.current?.parentElement ||
        document.querySelector('[class*="jp-agent-messages"]');
      
      if (!messagesContainer) {
        console.log('[AgentPanel] Messages container not found');
        return;
      }

      // Extract code blocks from all assistant messages
      const codeBlocks: Array<{ id: string; code: string; language: string }> = [];
      const containers = messagesContainer.querySelectorAll('.code-block-container');
      
      console.log(`[AgentPanel] Found ${containers.length} code block containers`);
      
      containers.forEach(container => {
        const blockId = container.getAttribute('data-block-id');
        if (!blockId) {
          console.warn('[AgentPanel] Code block container missing data-block-id');
          return;
        }

        const codeElement = container.querySelector(`#${blockId}`) as HTMLElement;
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
      const handleContainerClick = async (e: Event) => {
        const target = e.target as HTMLElement;
        
        // Handle copy button
        if (target.classList.contains('code-block-copy') || target.closest('.code-block-copy')) {
          const button = target.classList.contains('code-block-copy') 
            ? target as HTMLButtonElement 
            : target.closest('.code-block-copy') as HTMLButtonElement;
          
          e.stopPropagation();
          e.preventDefault();
          
          const blockId = button.getAttribute('data-block-id');
          if (!blockId) return;

          const block = allCodeBlocksRef.current.find(b => b.id === blockId);
          if (!block) return;

          try {
            await navigator.clipboard.writeText(block.code);
            const originalText = button.textContent;
            button.textContent = '복사됨!';
            setTimeout(() => {
              button.textContent = originalText || '복사';
            }, 2000);
          } catch (error) {
            console.error('Failed to copy code:', error);
            showNotification('복사에 실패했습니다.', 'error');
          }
          return;
        }
        
        // Handle apply button
        if (target.classList.contains('code-block-apply') || target.closest('.code-block-apply')) {
          const button = target.classList.contains('code-block-apply') 
            ? target as HTMLButtonElement 
            : target.closest('.code-block-apply') as HTMLButtonElement;
          
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
      (messagesContainer as any)._agentPanelClickHandler = handleContainerClick;

    }, 100); // Small delay to ensure DOM is ready

    // Cleanup
    return () => {
      clearTimeout(timeoutId);
      // Remove event listener on cleanup
      const messagesContainer = 
        document.querySelector('.jp-agent-messages') ||
        messagesEndRef.current?.parentElement ||
        document.querySelector('[class*="jp-agent-messages"]');
      
      if (messagesContainer && (messagesContainer as any)._agentPanelClickHandler) {
        messagesContainer.removeEventListener('click', (messagesContainer as any)._agentPanelClickHandler);
        delete (messagesContainer as any)._agentPanelClickHandler;
      }
    };
  }, [messages]);

  // Helper: Get notification background color
  const getNotificationColor = (type: 'info' | 'warning' | 'error'): string => {
    switch (type) {
      case 'error': return '#f56565';
      case 'warning': return '#ed8936';
      default: return '#4299e1';
    }
  };

  // Helper: Create and show notification element
  const createNotificationElement = (message: string, backgroundColor: string): HTMLDivElement => {
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
  const animateNotification = (notification: HTMLDivElement) => {
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
  const showNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    const notification = createNotificationElement(message, getNotificationColor(type));
    document.body.appendChild(notification);
    animateNotification(notification);
  };

  // Apply code to Jupyter cell
  const applyCodeToCell = async (code: string, blockId: string, button: HTMLButtonElement) => {
    console.log('[AgentPanel] applyCodeToCell called', { codeLength: code.length, blockId });
    
    const originalText = button.textContent;
    
    try {
      button.disabled = true;
      button.textContent = '적용 중...';

      const app = (window as any).jupyterapp;
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
        const notebook = (currentWidget as any).content;
        
        // Check if it's a notebook (has model and cells)
        if (notebook && 'model' in notebook && notebook.model && 'cells' in notebook.model) {
          await applyCodeToNotebookCell(code, notebook, blockId, button, originalText);
          return;
        }
      }

      // Fallback: show cell selector dialog
      showCellSelectorDialog(code, button, originalText);
    } catch (error) {
      console.error('Failed to apply code to cell:', error);
      showNotification('코드 적용에 실패했습니다.', 'error');
      button.disabled = false;
      button.textContent = originalText || '셀에 적용';
    }
  };

  // Helper: Try different methods to set cell source
  const setCellSource = (cellModel: any, code: string): void => {
    if (cellModel.sharedModel && typeof cellModel.sharedModel.setSource === 'function') {
      cellModel.sharedModel.setSource(code);
    } else if (cellModel.setSource && typeof cellModel.setSource === 'function') {
      cellModel.setSource(code);
    } else if (cellModel.value && typeof cellModel.value.setText === 'function') {
      cellModel.value.setText(code);
    } else if (cellModel.value && cellModel.value.text !== undefined) {
      cellModel.value.text = code;
    } else {
      throw new Error('Unable to set cell source - no compatible method found');
    }
  };

  // Helper: Reset button state
  const resetButtonState = (button: HTMLButtonElement, originalText: string | null) => {
    button.disabled = false;
    button.textContent = originalText || '셀에 적용';
  };

  // Apply code to a specific notebook cell
  const applyCodeToNotebookCell = async (
    code: string,
    notebook: any,
    blockId: string,
    button: HTMLButtonElement,
    originalText: string | null
  ) => {
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
          } catch (updateError) {
            console.error('Failed to update cell content:', updateError);
            showNotification('셀 내용 업데이트 실패: ' + (updateError as Error).message, 'error');
            resetButtonState(button, originalText);
            return;
          }
        } else {
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
    } catch (error) {
      console.error('Failed to apply code:', error);
      showNotification('코드 적용에 실패했습니다.', 'error');
      resetButtonState(button, originalText);
    }
  };

  // Show cell selector dialog (similar to chrome_agent)
  const showCellSelectorDialog = (
    code: string,
    button: HTMLButtonElement,
    originalText: string | null
  ) => {
    try {
      const app = (window as any).jupyterapp;
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

      const notebook = (currentWidget as any).content;
      
      if (!notebook || !('model' in notebook) || !notebook.model || !('cells' in notebook.model)) {
        showNotification('활성 노트북을 찾을 수 없습니다.', 'warning');
        button.disabled = false;
        button.textContent = originalText || '셀에 적용';
        return;
      }

      const cells = notebook.widgets || [];
      const codeCells: Array<{ cell: any; index: number; id: string; preview: string }> = [];

      // Collect code cells
      cells.forEach((cell: any, index: number) => {
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
          } catch (e) {
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
          if (!cellId) return;

          // Find the cell
          const cellInfo = codeCells.find(c => c.id === cellId);
          if (!cellInfo) return;

          const cellModel = cellInfo.cell.model || cellInfo.cell;

          // Apply code to cell
          try {
            setCellSource(cellModel, code);
            showNotification('코드가 셀에 적용되었습니다!', 'info');
            dialogOverlay.remove();
            resetButtonState(button, originalText);
          } catch (error) {
            console.error('Failed to apply code to cell:', error);
            showNotification('코드 적용에 실패했습니다.', 'error');
            resetButtonState(button, originalText);
          }
        });

        // Hover effects
        item.addEventListener('mouseenter', () => {
          (item as HTMLElement).style.borderColor = '#667eea';
          (item as HTMLElement).style.background = '#f8f9ff';
        });

        item.addEventListener('mouseleave', () => {
          (item as HTMLElement).style.borderColor = '#e0e0e0';
          (item as HTMLElement).style.background = 'white';
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

        (cancelBtn as HTMLElement).addEventListener('mouseenter', () => {
          (cancelBtn as HTMLElement).style.background = '#f5f5f5';
          (cancelBtn as HTMLElement).style.borderColor = '#9ca3af';
        });

        (cancelBtn as HTMLElement).addEventListener('mouseleave', () => {
          (cancelBtn as HTMLElement).style.background = 'transparent';
          (cancelBtn as HTMLElement).style.borderColor = '#d1d5db';
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
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          dialogOverlay.remove();
          document.removeEventListener('keydown', handleEsc);
          button.disabled = false;
          button.textContent = originalText || '셀에 적용';
        }
      };
      document.addEventListener('keydown', handleEsc);
    } catch (error) {
      console.error('Failed to show cell selector:', error);
      showNotification('셀 선택 다이얼로그 표시에 실패했습니다.', 'error');
      button.disabled = false;
      button.textContent = originalText || '셀에 적용';
    }
  };

  // Helper function to escape HTML
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const handleSendMessage = async () => {
    // Check if there's an LLM prompt stored (from cell action)
    const textarea = messagesEndRef.current?.parentElement?.querySelector('.jp-agent-input') as HTMLTextAreaElement;
    const llmPrompt = pendingLlmPromptRef.current || textarea?.getAttribute('data-llm-prompt');

    // Allow execution if we have an LLM prompt even if input is empty (for auto-execution)
    if ((!input.trim() && !llmPrompt) || isLoading || isStreaming || isAgentRunning) return;

    const currentInput = input.trim();

    // Agent 모드이면 Agent 실행
    if (inputMode === 'agent') {
      // User 메시지 추가
      const userMessage: IChatMessage = {
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
        const userMessage: IChatMessage = {
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
      } else if (provider === 'vllm') {
        // vLLM may not require API key, but check if endpoint is configured
        return !!(llmConfig.vllm?.endpoint && llmConfig.vllm.endpoint.trim());
      } else if (provider === 'openai') {
        return !!(llmConfig.openai?.apiKey && llmConfig.openai.apiKey.trim());
      }
      return false;
    })();

    if (!hasApiKey) {
      // Show error message and open settings
      const providerName = llmConfig?.provider || 'LLM';
      const errorMessage: IChatMessage = {
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
    const userMessage: IChatMessage = {
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
    const initialAssistantMessage: IChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, initialAssistantMessage]);

    try {
      // Use LLM prompt if available, otherwise use the display content
      const messageToSend = llmPrompt || displayContent;

      await apiService.sendMessageStream(
        {
          message: messageToSend,
          conversationId: conversationId || undefined
        },
        // onChunk callback - update message content incrementally
        (chunk: string) => {
          streamedContent += chunk;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMessageId && isChatMessage(msg)
                ? { ...msg, content: streamedContent }
                : msg
            )
          );
        },
        // onMetadata callback - update conversationId and metadata
        (metadata) => {
          if (metadata.conversationId && !conversationId) {
            setConversationId(metadata.conversationId);
          }
          if (metadata.provider || metadata.model) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === assistantMessageId && isChatMessage(msg)
                  ? {
                      ...msg,
                      metadata: {
                        ...msg.metadata,
                        provider: metadata.provider,
                        model: metadata.model
                      }
                    }
                  : msg
              )
            );
          }
        }
      );
    } catch (error) {
      // Update the assistant message with error
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMessageId && isChatMessage(msg)
            ? {
                ...msg,
                content: streamedContent + `\n\nError: ${error instanceof Error ? error.message : 'Failed to send message'}`
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingMessageId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  const renderAgentExecutionMessage = (msg: AgentExecutionMessage) => {
    const { status, plan, result, completedSteps, failedSteps, request } = msg;
    const isActive = ['planning', 'executing', 'tool_calling', 'self_healing', 'replanning', 'validating', 'reflecting'].includes(status.phase);

    const getStepStatus = (stepNumber: number): 'completed' | 'failed' | 'current' | 'pending' => {
      if (failedSteps.includes(stepNumber)) return 'failed';
      if (completedSteps.includes(stepNumber)) return 'completed';
      if (status.currentStep === stepNumber) return 'current';
      return 'pending';
    };

    const progressPercent = plan ? (completedSteps.length / plan.totalSteps) * 100 : 0;

    return (
      <div className="jp-agent-execution-message">
        {/* Agent 요청 헤더 */}
        <div className="jp-agent-execution-header">
          <div className="jp-agent-execution-badge">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 14.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13z"/>
              <path d="M8 3a.75.75 0 01.75.75v3.5h2.5a.75.75 0 010 1.5h-3.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 3z"/>
            </svg>
            Agent
          </div>
          <span className="jp-agent-execution-request">{request}</span>
        </div>

        {/* 실행 상태 */}
        <div className={`jp-agent-execution-status jp-agent-execution-status--${status.phase}`}>
          {isActive && <div className="jp-agent-execution-spinner" />}
          {status.phase === 'completed' && (
            <svg viewBox="0 0 16 16" fill="currentColor" className="jp-agent-execution-icon--success">
              <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
            </svg>
          )}
          {status.phase === 'failed' && (
            <svg viewBox="0 0 16 16" fill="currentColor" className="jp-agent-execution-icon--error">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          )}
          <span className="jp-agent-execution-status-text">
            {status.message || status.phase}
          </span>
        </div>

        {/* 실행 계획 */}
        {plan && (
          <div className="jp-agent-execution-plan">
            <div className="jp-agent-execution-plan-header">
              <span>실행 계획</span>
              <span className="jp-agent-execution-plan-progress">
                {completedSteps.length} / {plan.totalSteps}
              </span>
            </div>
            {/* Progress Bar */}
            <div className="jp-agent-execution-progress-bar">
              <div
                className="jp-agent-execution-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Steps */}
            <div className="jp-agent-execution-steps">
              {plan.steps.map((step) => {
                const stepStatus = getStepStatus(step.stepNumber);
                return (
                  <div
                    key={step.stepNumber}
                    className={`jp-agent-execution-step jp-agent-execution-step--${stepStatus}`}
                    ref={(el) => {
                      // 현재 진행 중인 단계로 자동 스크롤
                      if (stepStatus === 'current' && el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }
                    }}
                  >
                    <div className="jp-agent-execution-step-indicator">
                      {stepStatus === 'completed' && (
                        <svg viewBox="0 0 16 16" fill="currentColor">
                          <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                        </svg>
                      )}
                      {stepStatus === 'failed' && (
                        <svg viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
                        </svg>
                      )}
                      {stepStatus === 'current' && <div className="jp-agent-execution-step-spinner" />}
                      {stepStatus === 'pending' && <span>{step.stepNumber}</span>}
                    </div>
                    <div className="jp-agent-execution-step-content">
                      <span className={`jp-agent-execution-step-desc ${stepStatus === 'completed' ? 'jp-agent-execution-step-desc--done' : ''}`}>
                        {step.description}
                      </span>
                      <div className="jp-agent-execution-step-tools">
                        {step.toolCalls.map((tc, i) => (
                          <span key={i} className="jp-agent-execution-tool-tag">{tc.tool}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 최종 결과 */}
        {result && (
          <div className={`jp-agent-execution-result jp-agent-execution-result--${result.success ? 'success' : 'error'}`}>
            {result.finalAnswer && (
              <div
                className="jp-agent-execution-result-message jp-RenderedHTMLCommon"
                dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(result.finalAnswer) }}
              />
            )}
            {result.error && (
              <p className="jp-agent-execution-result-error">{result.error}</p>
            )}
            <div className="jp-agent-execution-result-stats">
              <span>{result.createdCells.length}개 셀 생성</span>
              <span>{result.modifiedCells.length}개 셀 수정</span>
              {result.executionTime && (
                <span>{(result.executionTime / 1000).toFixed(1)}초</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 메시지가 Chat 메시지인지 확인
  const isChatMessage = (msg: UnifiedMessage): msg is IChatMessage => {
    return !('type' in msg) || msg.type !== 'agent_execution';
  };

  return (
    <div className="jp-agent-panel">
      {/* Settings Dialog */}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSave={handleSaveConfig}
          currentConfig={llmConfig || undefined}
        />
      )}

      {/* Header */}
      <div className="jp-agent-header">
        <div
          className="jp-agent-header-logo"
          dangerouslySetInnerHTML={{ __html: headerLogoSvg }}
        />
        <div className="jp-agent-header-buttons">
          <button
            className="jp-agent-clear-button"
            onClick={clearChat}
            title="대화 초기화"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
          <button
            className="jp-agent-settings-button-icon"
            onClick={() => setShowSettings(true)}
            title="설정"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"></line>
              <line x1="4" y1="10" x2="4" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12" y2="3"></line>
              <line x1="20" y1="21" x2="20" y2="16"></line>
              <line x1="20" y1="12" x2="20" y2="3"></line>
              <line x1="1" y1="14" x2="7" y2="14"></line>
              <line x1="9" y1="8" x2="15" y2="8"></line>
              <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Unified Messages (Chat + Agent Execution) */}
      <div className="jp-agent-messages">
        {messages.length === 0 ? (
          <div className="jp-agent-empty-state">
            <p>안녕하세요! HDSP Agent입니다.</p>
            <p className="jp-agent-empty-hint">
              {inputMode === 'agent'
                ? '노트북 작업을 자연어로 요청하세요. 예: "데이터 시각화 해줘"'
                : '메시지를 입력하거나 아래 버튼으로 Agent 모드를 선택하세요.'
              }
            </p>
          </div>
        ) : (
          messages.map(msg => {
            if (isChatMessage(msg)) {
              // 일반 Chat 메시지
              return (
                <div key={msg.id} className={`jp-agent-message jp-agent-message-${msg.role}`}>
                  <div className="jp-agent-message-header">
                    <span className="jp-agent-message-role">
                      {msg.role === 'user' ? '사용자' : 'Agent'}
                    </span>
                    <span className="jp-agent-message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className={`jp-agent-message-content${streamingMessageId === msg.id ? ' streaming' : ''}`}>
                    {msg.role === 'assistant' ? (
                      // Assistant(AI) 메시지: 마크다운 HTML 렌더링 + Jupyter 스타일 적용
                      <div
                        className="jp-RenderedHTMLCommon"
                        style={{ padding: '0 5px' }}
                        dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(msg.content) }}
                      />
                    ) : (
                      // User(사용자) 메시지: 텍스트 그대로 줄바꿈만 처리
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              );
            } else {
              // Agent 실행 메시지
              return (
                <div key={msg.id} className="jp-agent-message jp-agent-message-agent-execution">
                  {renderAgentExecutionMessage(msg)}
                </div>
              );
            }
          })
        )}
        {isLoading && !isStreaming && !isAgentRunning && (
          <div className="jp-agent-message jp-agent-message-assistant">
            <div className="jp-agent-message-header">
              <span className="jp-agent-message-role">Agent</span>
            </div>
            <div className="jp-agent-message-content jp-agent-loading">
              <span className="jp-agent-loading-dot">.</span>
              <span className="jp-agent-loading-dot">.</span>
              <span className="jp-agent-loading-dot">.</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Unified Input Container - Cursor AI Style */}
      <div className="jp-agent-input-container">
        <div className="jp-agent-input-wrapper">
          <textarea
            className={`jp-agent-input ${inputMode === 'agent' ? 'jp-agent-input--agent-mode' : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputMode === 'agent'
              ? '노트북 작업을 입력하세요... (예: 데이터 시각화 해줘)'
              : '메시지를 입력하세요...'
            }
            rows={3}
            disabled={isLoading || isAgentRunning}
          />
          <button
            className="jp-agent-send-button"
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || isStreaming || isAgentRunning}
            title="전송 (Enter)"
          >
            {isAgentRunning ? '실행 중...' : '전송'}
          </button>
        </div>

        {/* Mode Toggle Bar - Cursor AI Style */}
        <div className="jp-agent-mode-bar">
          <div className="jp-agent-mode-toggle-container">
            <button
              className={`jp-agent-mode-toggle ${inputMode === 'agent' ? 'jp-agent-mode-toggle--active' : ''}`}
              onClick={toggleMode}
              title={`${inputMode === 'agent' ? 'Agent' : 'Chat'} 모드 (⇧Tab)`}
            >
              {/* Agent 아이콘 */}
              <svg className="jp-agent-mode-icon" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                {inputMode === 'agent' ? (
                  // 무한대 아이콘 (Agent 모드)
                  <path d="M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5zm6.88 1.3c.44-.72 1.22-1.2 2.12-1.2 1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5c-.9 0-1.68-.48-2.12-1.2L12.5 10.6c.3.24.68.4 1.1.4.83 0 1.5-.67 1.5-1.5S14.43 8 13.6 8c-.42 0-.8.16-1.1.4l-1.12 1.3zM7 9.5c-.42 0-.8-.16-1.1-.4L4.78 7.8c-.44.72-1.22 1.2-2.12 1.2C1.28 9 .17 7.88.17 6.5S1.29 4 2.67 4c.9 0 1.68.48 2.12 1.2L5.9 6.5c-.3-.24-.68-.4-1.1-.4C3.97 6.1 3.3 6.77 3.3 7.6s.67 1.5 1.5 1.5c.42 0 .8-.16 1.1-.4l1.12-1.3L8 8l-1 1.5z"/>
                ) : (
                  // 채팅 아이콘 (Chat 모드)
                  <path d="M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z"/>
                )}
              </svg>
              <span className="jp-agent-mode-label">
                {inputMode === 'agent' ? 'Agent' : 'Chat'}
              </span>
              <svg className="jp-agent-mode-chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <path d="M4.47 5.47a.75.75 0 011.06 0L8 7.94l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z"/>
              </svg>
            </button>

            {/* Mode Dropdown */}
            {showModeDropdown && (
              <div className="jp-agent-mode-dropdown">
                <button
                  className={`jp-agent-mode-option ${inputMode === 'chat' ? 'jp-agent-mode-option--selected' : ''}`}
                  onClick={() => { setInputMode('chat'); setShowModeDropdown(false); }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                    <path d="M8 1C3.58 1 0 4.13 0 8c0 1.5.5 2.88 1.34 4.04L.5 15l3.37-.92A8.56 8.56 0 008 15c4.42 0 8-3.13 8-7s-3.58-7-8-7zM4.5 9a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2zm3.5 0a1 1 0 110-2 1 1 0 010 2z"/>
                  </svg>
                  <span>Chat</span>
                  <span className="jp-agent-mode-shortcut">일반 대화</span>
                </button>
                <button
                  className={`jp-agent-mode-option ${inputMode === 'agent' ? 'jp-agent-mode-option--selected' : ''}`}
                  onClick={() => { setInputMode('agent'); setShowModeDropdown(false); }}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                    <path d="M4.5 8c0-1.38 1.12-2.5 2.5-2.5.9 0 1.68.48 2.12 1.2L8 8l1.12 1.3c-.44.72-1.22 1.2-2.12 1.2-1.38 0-2.5-1.12-2.5-2.5z"/>
                  </svg>
                  <span>Agent</span>
                  <span className="jp-agent-mode-shortcut">노트북 자동 실행</span>
                </button>
              </div>
            )}
          </div>

          {/* 단축키 힌트 */}
          <div className="jp-agent-mode-hints">
            <span className="jp-agent-mode-hint">⇧Tab 모드 전환</span>
          </div>
        </div>
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

/**
 * Agent Panel Widget
 */
export class AgentPanelWidget extends ReactWidget {
  private apiService: ApiService;
  private notebookTracker: any;
  private chatPanelRef = React.createRef<ChatPanelHandle>();

  constructor(apiService: ApiService, notebookTracker?: any) {
    super();
    this.apiService = apiService;
    this.notebookTracker = notebookTracker;
    this.id = 'hdsp-agent-panel';
    this.title.caption = 'HDSP Agent Assistant';
    this.title.icon = hdspTabIcon;
    this.addClass('jp-agent-widget');
  }

  render(): JSX.Element {
    return (
      <ChatPanel
        ref={this.chatPanelRef}
        apiService={this.apiService}
        notebookTracker={this.notebookTracker}
      />
    );
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
  addCellActionMessage(
    action: string,
    cellContent: string,
    displayPrompt: string,
    llmPrompt: string,
    cellId?: string,
    cellIndex?: number
  ): void {
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
  analyzeNotebook(cells: any[], onComplete: () => void): void {
    console.log('[AgentPanel] analyzeNotebook called with', cells.length, 'cells');

    if (!this.chatPanelRef.current) {
      console.error('[AgentPanel] ChatPanel ref not available');
      onComplete();
      return;
    }

    // Create summary of notebook
    const totalCells = cells.length;
    const cellsWithErrors = cells.filter(cell =>
      cell.output && (
        cell.output.includes('Error') ||
        cell.output.includes('Traceback') ||
        cell.output.includes('Exception')
      )
    ).length;
    const cellsWithImports = cells.filter(cell => cell.imports && cell.imports.length > 0).length;
    const localImports = cells.reduce((acc, cell) => {
      if (cell.imports) {
        return acc + cell.imports.filter((imp: any) => imp.isLocal).length;
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
        cell.imports.forEach((imp: any) => {
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
