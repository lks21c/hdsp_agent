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
}

/**
 * Chat Panel Component
 */
const ChatPanel = forwardRef<ChatPanelHandle, AgentPanelProps>(({ apiService }, ref) => {
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingLlmPromptRef = useRef<string | null>(null);
  const allCodeBlocksRef = useRef<Array<{ id: string; code: string; language: string }>>([]);
  const currentCellIdRef = useRef<string | null>(null);

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
    }
  }));

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await apiService.getConfig();
      setLlmConfig(config as any);
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

  // Show notification
  const showNotification = (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
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
    `;

    if (type === 'error') {
      notification.style.background = '#f56565';
    } else if (type === 'warning') {
      notification.style.background = '#ed8936';
    } else {
      notification.style.background = '#4299e1';
    }

    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '1';
    }, 10);

    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
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
        currentCellId: currentCellIdRef.current,
        blockId 
      });
      
      // If we have a current cell ID, apply directly
      if (currentCellIdRef.current) {
        console.log('[AgentPanel] Looking for cell with ID:', currentCellIdRef.current);
        const cells = notebook.widgets || [];
        if (cells && cells.length > 0) {
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const cellModel = cell.model || cell;
            
            // Check if this is the target cell
            let cellId: string | undefined;
            try {
              cellId = cellModel.metadata?.get?.('jupyterAgentCellId') as string | undefined;
            } catch (e) {
              // Try alternative methods
              cellId = cellModel.id || 
                      (cellModel.metadata as any)?.jupyterAgentCellId ||
                      undefined;
            }
            
            console.log(`[AgentPanel] Cell ${i} has ID:`, cellId);
            
            if (cellId === currentCellIdRef.current) {
              console.log('[AgentPanel] Found target cell! Applying code...');
              // Update cell content using sharedModel (JupyterLab standard API)
              try {
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
                
                console.log('[AgentPanel] Code applied successfully!');
                showNotification('코드가 셀에 적용되었습니다!', 'info');
                button.disabled = false;
                button.textContent = originalText || '셀에 적용';
                // Clear the cell ID after successful application
                currentCellIdRef.current = null;
                return;
              } catch (updateError) {
                console.error('Failed to update cell content:', updateError);
                // Fall through to show selector dialog
              }
            }
          }
        }
        console.log('[AgentPanel] Target cell not found, showing selector dialog');
      } else {
        console.log('[AgentPanel] No current cell ID set, showing selector dialog');
      }

      // No current cell ID or cell not found, show selector dialog
      showCellSelectorDialog(code, button, originalText);
    } catch (error) {
      console.error('Failed to apply code:', error);
      showNotification('코드 적용에 실패했습니다.', 'error');
      button.disabled = false;
      button.textContent = originalText || '셀에 적용';
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
            // Try different methods to set cell content
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

            showNotification('코드가 셀에 적용되었습니다!', 'info');
            dialogOverlay.remove();
            button.disabled = false;
            button.textContent = originalText || '셀에 적용';
          } catch (error) {
            console.error('Failed to apply code to cell:', error);
            showNotification('코드 적용에 실패했습니다.', 'error');
            button.disabled = false;
            button.textContent = originalText || '셀에 적용';
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
    if ((!input.trim() && !llmPrompt) || isLoading) return;

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

    // Clear the data attribute and ref after using it
    if (textarea && llmPrompt) {
      textarea.removeAttribute('data-llm-prompt');
      pendingLlmPromptRef.current = null;
    }

    try {
      // Use LLM prompt if available, otherwise use the display content
      const messageToSend = llmPrompt || displayContent;

      const response = await apiService.sendMessage({
        message: messageToSend,
        conversationId: conversationId || undefined
      });

      if (!conversationId) {
        setConversationId(response.conversationId);
      }

      const assistantMessage: IChatMessage = {
        id: response.messageId,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        metadata: response.metadata
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: IChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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
                className="jp-agent-message-content"
                dangerouslySetInnerHTML={{
                  __html: msg.role === 'assistant' 
                    ? formatMarkdownToHtml(msg.content)
                    : escapeHtml(msg.content).replace(/\n/g, '<br>')
                }}
              />
            </div>
          ))
        )}
        {isLoading && (
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
            disabled={!input.trim() || isLoading}
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
    this.id = 'jupyter-agent-panel';
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
   */
  addCellActionMessage(
    action: string,
    cellContent: string,
    displayPrompt: string,
    llmPrompt: string,
    cellId?: string
  ): void {
    console.log('[AgentPanel] Cell action:', action);
    console.log('[AgentPanel] Display prompt:', displayPrompt);
    console.log('[AgentPanel] LLM prompt:', llmPrompt);
    console.log('[AgentPanel] Cell ID:', cellId);

    if (!this.chatPanelRef.current) {
      console.error('[AgentPanel] ChatPanel ref not available');
      return;
    }

    // Store cell ID for code application
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
}
