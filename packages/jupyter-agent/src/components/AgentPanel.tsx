/**
 * Agent Panel - Main sidebar panel for Jupyter Agent
 */

import React, { useState, useEffect, useRef } from 'react';
import { ReactWidget } from '@jupyterlab/ui-components';
import { ApiService } from '../services/ApiService';
import { IChatMessage } from '../types';
import { SettingsPanel, LLMConfig } from './SettingsPanel';

interface AgentPanelProps {
  apiService: ApiService;
}

/**
 * Chat Panel Component
 */
const ChatPanel: React.FC<AgentPanelProps> = ({ apiService }) => {
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: IChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await apiService.sendMessage({
        message: input,
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
            className="jp-agent-settings-button-icon"
            onClick={() => setShowSettings(true)}
            title="설정"
          >
            ⚙️
          </button>
          <button
            className="jp-agent-clear-button"
            onClick={clearChat}
            title="대화 초기화"
          >
            초기화
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="jp-agent-messages">
        {messages.length === 0 ? (
          <div className="jp-agent-empty-state">
            <p>👋 안녕하세요! HDSP Agent입니다.</p>
            <p>코드 설명, 오류 수정, 노트북 작업을 도와드립니다.</p>
            <div className="jp-agent-suggestions">
              <button onClick={() => setInput("선택한 셀의 코드를 설명해주세요")}>
                코드 설명
              </button>
              <button onClick={() => setInput("코드의 오류를 수정해주세요")}>
                오류 수정
              </button>
              <button onClick={() => setInput("이 함수를 최적화해주세요")}>
                코드 최적화
              </button>
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`jp-agent-message jp-agent-message-${msg.role}`}>
              <div className="jp-agent-message-header">
                <span className="jp-agent-message-role">
                  {msg.role === 'user' ? '👤 사용자' : '🤖 Agent'}
                </span>
                <span className="jp-agent-message-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="jp-agent-message-content">
                {msg.content}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="jp-agent-message jp-agent-message-assistant">
            <div className="jp-agent-message-header">
              <span className="jp-agent-message-role">🤖 Agent</span>
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
  );
};

/**
 * Agent Panel Widget
 */
export class AgentPanelWidget extends ReactWidget {
  private apiService: ApiService;

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
    return <ChatPanel apiService={this.apiService} />;
  }

  /**
   * Add a message from cell action
   */
  addCellActionMessage(action: string, cellContent: string, message: string): void {
    console.log('[AgentPanel] Cell action:', action);

    // Trigger a re-render by setting the input value
    // This is a workaround - in production you'd use a proper state management
    const panel = this.node.querySelector('.jp-agent-input') as HTMLTextAreaElement;
    if (panel) {
      panel.value = message;
      // Trigger React's onChange
      const event = new Event('input', { bubbles: true });
      panel.dispatchEvent(event);
    }
  }
}
