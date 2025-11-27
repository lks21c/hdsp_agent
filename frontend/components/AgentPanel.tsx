/**
 * Agent Panel - Main sidebar panel for Jupyter Agent
 */

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { ReactWidget } from '@jupyterlab/ui-components';
import { ApiService } from '../services/ApiService';
import { IChatMessage } from '../types';
import { SettingsPanel, LLMConfig } from './SettingsPanel';
import { formatMarkdownToHtml, escapeHtml } from '../utils/markdownRenderer';

interface AgentPanelProps {
  apiService: ApiService;
}

export interface ChatPanelHandle {
  handleSendMessage: () => Promise<void>;
  setInput: (value: string) => void;
  setLlmPrompt: (prompt: string) => void;
  setCurrentCellId: (cellId: string) => void;
  setCurrentCellIndex: (cellIndex: number) => void;
}

/**
 * Chat Panel Component
 */
const ChatPanel = forwardRef<ChatPanelHandle, AgentPanelProps>(({ apiService }, ref) => {
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingLlmPromptRef = useRef<string | null>(null);
  const allCodeBlocksRef = useRef<Array<{ id: string; code: string; language: string }>>([]);
  const currentCellIdRef = useRef<string | null>(null);
  const currentCellIndexRef = useRef<number | null>(null);

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
            apiKey: '',
            model: 'meta-llama/Llama-2-7b-chat-hf'
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
    if ((!input.trim() && !llmPrompt) || isLoading || isStreaming) return;

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
        content: `⚠️ API Key가 설정되지 않았습니다.\n\n${providerName === 'gemini' ? 'Gemini' : providerName === 'openai' ? 'OpenAI' : 'vLLM'} API Key를 먼저 설정해주세요.\n\n설정 버튼을 클릭하여 API Key를 입력하세요.`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
      setShowSettings(true);
      return;
    }

    // Use the display prompt (input) for the user message, or use a fallback if input is empty
    const displayContent = input.trim() || (llmPrompt ? '셀 분석 요청' : '');
    const userMessage: IChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: displayContent,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    // Only clear input if it was manually entered, keep it for auto-execution display
    if (input.trim()) {
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
              msg.id === assistantMessageId
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
                msg.id === assistantMessageId
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
          msg.id === assistantMessageId
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId('');
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
        <h2>HDSP Agent</h2>
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

      {/* Messages */}
      <div className="jp-agent-messages">
        {messages.length === 0 ? (
          <div className="jp-agent-empty-state">
            <p>안녕하세요! HDSP Agent입니다.</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`jp-agent-message jp-agent-message-${msg.role}`}>
              <div className="jp-agent-message-header">
                <span className="jp-agent-message-role">
                  {msg.role === 'user' ? '사용자' : 'Agent'}
                </span>
                <span className="jp-agent-message-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div
                className={`jp-agent-message-content${streamingMessageId === msg.id ? ' streaming' : ''}`}
                dangerouslySetInnerHTML={{
                  __html: msg.role === 'assistant'
                    ? formatMarkdownToHtml(msg.content)
                    : escapeHtml(msg.content).replace(/\n/g, '<br>')
                }}
              />
            </div>
          ))
        )}
        {isLoading && !isStreaming && (
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

      {/* Input */}
      <div className="jp-agent-input-container">
        <div className="jp-agent-input-wrapper">
          <textarea
            className="jp-agent-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="코드에 대해 무엇이든 물어보세요..."
            rows={3}
            disabled={isLoading}
          />
          <button
            className="jp-agent-send-button"
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || isStreaming}
            title="메시지 전송 (Enter)"
          >
            전송
          </button>
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
  private chatPanelRef = React.createRef<ChatPanelHandle>();

  constructor(apiService: ApiService) {
    super();
    this.apiService = apiService;
    this.id = 'hdsp-agent-panel';
    this.title.label = 'HDSP';
    this.title.caption = 'HDSP Agent Assistant';
    // Using JupyterLab's built-in robot icon
    this.addClass('jp-agent-widget');
  }

  render(): JSX.Element {
    return <ChatPanel ref={this.chatPanelRef} apiService={this.apiService} />;
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
