/**
 * Settings Panel Component
 * Allows users to configure LLM provider settings
 *
 * API keys are stored in browser localStorage and sent with each request.
 * The Agent Server does not store API keys - it receives them with each request.
 */

import React, { useState, useEffect } from 'react';
import {
  getLLMConfig,
  saveLLMConfig,
  hasValidApiKey,
  testApiKey,
  getDefaultLLMConfig,
  LLMConfig
} from '../services/ApiKeyManager';

// Re-export LLMConfig type for use by other components
export type { LLMConfig } from '../services/ApiKeyManager';

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
  // Initialize from localStorage or props
  const initConfig = currentConfig || getLLMConfig() || getDefaultLLMConfig();

  const [provider, setProvider] = useState<'gemini' | 'vllm' | 'openai'>(
    initConfig.provider || 'gemini'
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<number, 'success' | 'error' | 'testing' | null>>({});

  // Track active key index (first valid key by default)
  const [activeKeyIndex, setActiveKeyIndex] = useState(0);

  // Gemini settings - support multiple keys (max 10)
  const [geminiApiKeys, setGeminiApiKeys] = useState<string[]>(
    initConfig.gemini?.apiKeys?.length
      ? initConfig.gemini.apiKeys
      : initConfig.gemini?.apiKey
        ? [initConfig.gemini.apiKey]
        : ['']
  );

  // Legacy single key for backward compatibility
  const geminiApiKey = geminiApiKeys[0] || '';

  // Validate gemini model - only allow valid options
  const validateGeminiModel = (model: string | undefined): string => {
    const validModels = ['gemini-2.5-pro', 'gemini-2.5-flash'];
    if (model && validModels.includes(model)) {
      return model;
    }
    return 'gemini-2.5-flash';
  };

  const [geminiModel, setGeminiModel] = useState(
    validateGeminiModel(initConfig.gemini?.model)
  );

  // vLLM settings
  const [vllmEndpoint, setVllmEndpoint] = useState(
    initConfig.vllm?.endpoint || 'http://localhost:8000'
  );
  const [vllmApiKey, setVllmApiKey] = useState(
    initConfig.vllm?.apiKey || ''
  );
  const [vllmModel, setVllmModel] = useState(
    initConfig.vllm?.model || 'meta-llama/Llama-2-7b-chat-hf'
  );

  // OpenAI settings
  const [openaiApiKey, setOpenaiApiKey] = useState(
    initConfig.openai?.apiKey || ''
  );
  const [openaiModel, setOpenaiModel] = useState(
    initConfig.openai?.model || 'gpt-4'
  );

  // Update state when currentConfig changes
  useEffect(() => {
    if (currentConfig) {
      setProvider(currentConfig.provider || 'gemini');
      // Handle multiple keys
      if (currentConfig.gemini?.apiKeys?.length) {
        setGeminiApiKeys(currentConfig.gemini.apiKeys);
      } else if (currentConfig.gemini?.apiKey) {
        setGeminiApiKeys([currentConfig.gemini.apiKey]);
      } else {
        setGeminiApiKeys(['']);
      }
      setGeminiModel(validateGeminiModel(currentConfig.gemini?.model));
      setVllmEndpoint(currentConfig.vllm?.endpoint || 'http://localhost:8000');
      setVllmApiKey(currentConfig.vllm?.apiKey || '');
      setVllmModel(currentConfig.vllm?.model || 'meta-llama/Llama-2-7b-chat-hf');
      setOpenaiApiKey(currentConfig.openai?.apiKey || '');
      setOpenaiModel(currentConfig.openai?.model || 'gpt-4');
    }
  }, [currentConfig]);

  // Helper: Build LLM config from state
  const buildLLMConfig = (): LLMConfig => ({
    provider,
    gemini: {
      apiKey: geminiApiKeys[0] || '',  // Primary key for backward compatibility
      apiKeys: geminiApiKeys.filter(k => k && k.trim()),  // All valid keys
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

  // Handlers for multiple API keys
  const handleAddKey = () => {
    if (geminiApiKeys.length < 10) {
      setGeminiApiKeys([...geminiApiKeys, '']);
    }
  };

  const handleRemoveKey = (index: number) => {
    if (geminiApiKeys.length > 1) {
      const newKeys = geminiApiKeys.filter((_, i) => i !== index);
      setGeminiApiKeys(newKeys);
    }
  };

  const handleKeyChange = (index: number, value: string) => {
    const newKeys = [...geminiApiKeys];
    newKeys[index] = value;
    setGeminiApiKeys(newKeys);
  };

  const validKeyCount = geminiApiKeys.filter(k => k && k.trim()).length;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResults({});

    if (provider === 'gemini') {
      // Test each Gemini key individually
      const validKeys = geminiApiKeys.map((k, i) => ({ key: k, index: i }))
        .filter(({ key }) => key && key.trim());

      for (const { key, index } of validKeys) {
        setTestResults(prev => ({ ...prev, [index]: 'testing' }));

        const testConfig: LLMConfig = {
          provider: 'gemini',
          gemini: { apiKey: key, apiKeys: [key], model: geminiModel }
        };

        try {
          const result = await testApiKey(testConfig);
          setTestResults(prev => ({ ...prev, [index]: result.success ? 'success' : 'error' }));
        } catch {
          setTestResults(prev => ({ ...prev, [index]: 'error' }));
        }
      }
    } else {
      // For other providers, just test the single config
      try {
        const config = buildLLMConfig();
        const result = await testApiKey(config);
        setTestResults({ 0: result.success ? 'success' : 'error' });
      } catch {
        setTestResults({ 0: 'error' });
      }
    }

    setIsTesting(false);
  };

  // Handle clicking a key row to set it as active
  const handleSetActiveKey = (index: number) => {
    if (geminiApiKeys[index] && geminiApiKeys[index].trim()) {
      setActiveKeyIndex(index);
    }
  };

  const handleSave = () => {
    const config = buildLLMConfig();

    // Save to localStorage
    saveLLMConfig(config);

    // Notify parent component
    onSave(config);
    onClose();
  };

  // Get test status icon for a key
  const getTestStatusIcon = (index: number): string => {
    const status = testResults[index];
    if (status === 'testing') return '⏳';
    if (status === 'success') return '✅';
    if (status === 'error') return '❌';
    return '';
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
          {/* Info notice about localStorage */}
          <div className="jp-agent-settings-notice">
            <span>API 키는 브라우저에 안전하게 저장되며, 요청 시에만 서버로 전송됩니다.</span>
          </div>

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

              {/* Multiple API Keys */}
              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">
                  API 키 ({validKeyCount}/10)
                  <small style={{ fontWeight: 'normal', marginLeft: '8px', color: '#666' }}>
                    Rate limit 시 자동 로테이션
                  </small>
                </label>

                {geminiApiKeys.map((key, index) => (
                  <div key={index} className="jp-agent-settings-key-row" style={{
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '8px',
                    alignItems: 'center',
                    padding: '4px',
                    borderRadius: '4px',
                    background: activeKeyIndex === index && key && key.trim() ? 'rgba(66, 133, 244, 0.1)' : 'transparent',
                    border: activeKeyIndex === index && key && key.trim() ? '1px solid rgba(66, 133, 244, 0.3)' : '1px solid transparent'
                  }}>
                    {/* Active indicator (radio button) */}
                    <input
                      type="radio"
                      name="activeKey"
                      checked={activeKeyIndex === index && key && key.trim() !== ''}
                      onChange={() => handleSetActiveKey(index)}
                      disabled={!key || !key.trim()}
                      title="활성 키로 설정"
                      style={{ cursor: key && key.trim() ? 'pointer' : 'default' }}
                    />
                    <span style={{
                      minWidth: '20px',
                      color: '#666',
                      fontSize: '12px'
                    }}>
                      {index + 1}.
                    </span>
                    <input
                      type="password"
                      className="jp-agent-settings-input"
                      style={{ flex: 1 }}
                      value={key}
                      onChange={(e) => handleKeyChange(index, e.target.value)}
                      placeholder="AIza..."
                    />
                    {/* Test status icon */}
                    {getTestStatusIcon(index) && (
                      <span style={{ fontSize: '14px', minWidth: '20px' }}>
                        {getTestStatusIcon(index)}
                      </span>
                    )}
                    {geminiApiKeys.length > 1 && (
                      <button
                        type="button"
                        className="jp-agent-settings-button-icon"
                        onClick={() => handleRemoveKey(index)}
                        title="키 삭제"
                        style={{
                          padding: '4px 8px',
                          background: '#ff4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {geminiApiKeys.length < 10 && (
                  <button
                    type="button"
                    className="jp-agent-settings-button jp-agent-settings-button-secondary"
                    onClick={handleAddKey}
                    style={{ marginTop: '8px' }}
                  >
                    + 키 추가
                  </button>
                )}
              </div>

              <div className="jp-agent-settings-group">
                <label className="jp-agent-settings-label">모델</label>
                <select
                  className="jp-agent-settings-select"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
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
