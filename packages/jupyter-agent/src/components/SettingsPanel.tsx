/**
 * Settings Panel Component
 * Allows users to configure LLM provider settings
 */

import React, { useState, useEffect } from 'react';

export interface LLMConfig {
  provider: 'gemini' | 'vllm' | 'openai';
  gemini?: {
    apiKey: string;
    model: string;
  };
  vllm?: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
}

interface SettingsPanelProps {
  onClose: () => void;
  onSave: (config: LLMConfig) => void;
  currentConfig?: LLMConfig;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onClose,
  onSave,
  currentConfig
}) => {
  const [provider, setProvider] = useState<'gemini' | 'vllm' | 'openai'>(
    currentConfig?.provider || 'gemini'
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Gemini settings
  const [geminiApiKey, setGeminiApiKey] = useState(
    currentConfig?.gemini?.apiKey || ''
  );
  const [geminiModel, setGeminiModel] = useState(
    currentConfig?.gemini?.model || 'gemini-2.5-pro'
  );

  // vLLM settings
  const [vllmEndpoint, setVllmEndpoint] = useState(
    currentConfig?.vllm?.endpoint || 'http://localhost:8000'
  );
  const [vllmApiKey, setVllmApiKey] = useState(
    currentConfig?.vllm?.apiKey || ''
  );
  const [vllmModel, setVllmModel] = useState(
    currentConfig?.vllm?.model || 'meta-llama/Llama-2-7b-chat-hf'
  );

  // OpenAI settings
  const [openaiApiKey, setOpenaiApiKey] = useState(
    currentConfig?.openai?.apiKey || ''
  );
  const [openaiModel, setOpenaiModel] = useState(
    currentConfig?.openai?.model || 'gpt-4'
  );

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const config: LLMConfig = {
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
      };

      // Get CSRF token from cookie
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return '';
      };

      // Test API call
      const response = await fetch('/jupyter-agent/test-llm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRFToken': getCookie('_xsrf') || ''
        },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        const data = await response.json();
        setTestResult(`✅ 성공: ${data.message}`);
      } else {
        const error = await response.json();
        setTestResult(`❌ 실패: ${error.error}`);
      }
    } catch (error) {
      setTestResult(`❌ 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const config: LLMConfig = {
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
    };

    onSave(config);
    onClose();
  };

  return (
    <div className="jp-agent-settings-overlay">
      <div className="jp-agent-settings-dialog">
        <div className="jp-agent-settings-header">
          <h2>LLM 설정</h2>
          <button
            className="jp-agent-settings-close"
            onClick={onClose}
            title="닫기"
          >
            ×
          </button>
        </div>

        <div className="jp-agent-settings-content">
          {/* Provider Selection */}
          <div className="jp-agent-settings-group">
            <label className="jp-agent-settings-label">프로바이더</label>
            <select
              className="jp-agent-settings-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as any)}
            >
              <option value="gemini">Google Gemini</option>
              <option value="vllm">vLLM</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          {/* Gemini Settings */}
          {provider === 'gemini' && (
            <div className="jp-agent-settings-provider">
              <h3>Gemini 설정</h3>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">API 키</label>
                <input
                  type="password"
                  className="jp-agent-settings-input"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="Gemini API 키를 입력하세요"
                />
              </div>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">모델</label>
                <select
                  className="jp-agent-settings-select"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                >
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
              </div>
            </div>
          )}

          {/* vLLM Settings */}
          {provider === 'vllm' && (
            <div className="jp-agent-settings-provider">
              <h3>vLLM 설정</h3>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">서버 주소</label>
                <input
                  type="text"
                  className="jp-agent-settings-input"
                  value={vllmEndpoint}
                  onChange={(e) => setVllmEndpoint(e.target.value)}
                  placeholder="http://localhost:8000"
                />
              </div>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">API 키 (선택사항)</label>
                <input
                  type="password"
                  className="jp-agent-settings-input"
                  value={vllmApiKey}
                  onChange={(e) => setVllmApiKey(e.target.value)}
                  placeholder="API 키가 필요한 경우 입력"
                />
              </div>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">모델 이름</label>
                <input
                  type="text"
                  className="jp-agent-settings-input"
                  value={vllmModel}
                  onChange={(e) => setVllmModel(e.target.value)}
                  placeholder="meta-llama/Llama-2-7b-chat-hf"
                />
              </div>
            </div>
          )}

          {/* OpenAI Settings */}
          {provider === 'openai' && (
            <div className="jp-agent-settings-provider">
              <h3>OpenAI 설정</h3>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">API 키</label>
                <input
                  type="password"
                  className="jp-agent-settings-input"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">모델</label>
                <select
                  className="jp-agent-settings-select"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <div className="jp-agent-settings-test-result">
            {testResult}
          </div>
        )}

        <div className="jp-agent-settings-footer">
          <button
            className="jp-agent-settings-button jp-agent-settings-button-secondary"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="jp-agent-settings-button jp-agent-settings-button-test"
            onClick={handleTest}
            disabled={isTesting}
          >
            {isTesting ? '테스트 중...' : 'API 테스트'}
          </button>
          <button
            className="jp-agent-settings-button jp-agent-settings-button-primary"
            onClick={handleSave}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
};
