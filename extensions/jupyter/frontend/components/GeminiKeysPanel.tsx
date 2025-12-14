/**
 * Gemini API Keys Management Panel
 * Displays list of keys with status and allows add/remove operations
 */

import React, { useState, useEffect, useCallback } from 'react';

interface IGeminiKeyStatus {
  id: string;
  maskedKey: string;
  status: 'active' | 'cooldown' | 'disabled';
  cooldownRemaining: number;  // seconds
  lastUsed: string | null;
  failureCount: number;
  isActive: boolean;
  enabled: boolean;
}

interface GeminiKeysPanelProps {
  onKeysChange?: () => void;
}

export const GeminiKeysPanel: React.FC<GeminiKeysPanelProps> = ({ onKeysChange }) => {
  const [keys, setKeys] = useState<IGeminiKeyStatus[]>([]);
  const [maxKeys, setMaxKeys] = useState(10);
  const [newKey, setNewKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCookie = (name: string): string => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      return parts.pop()?.split(';').shift() || '';
    }
    return '';
  };

  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch('/hdsp-agent/gemini-keys', {
        headers: {
          'X-XSRFToken': getCookie('_xsrf')
        }
      });

      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys);
        setMaxKeys(data.maxKeys);
      }
    } catch (err) {
      console.error('Failed to fetch keys:', err);
    }
  }, []);

  useEffect(() => {
    fetchKeys();

    // Auto-refresh every 5 seconds to update cooldown timers
    const interval = setInterval(fetchKeys, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [fetchKeys]);

  const handleAddKey = async () => {
    if (!newKey.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/hdsp-agent/gemini-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRFToken': getCookie('_xsrf')
        },
        body: JSON.stringify({ apiKey: newKey.trim() })
      });

      const data = await response.json();

      if (response.ok) {
        setKeys(data.keys);
        setNewKey('');
        onKeysChange?.();
      } else {
        setError(data.error || 'Failed to add key');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveKey = async (keyId: string) => {
    if (!confirm('이 API 키를 삭제하시겠습니까?')) return;

    setIsLoading(true);

    try {
      const response = await fetch('/hdsp-agent/gemini-keys', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRFToken': getCookie('_xsrf')
        },
        body: JSON.stringify({ keyId })
      });

      const data = await response.json();

      if (response.ok) {
        setKeys(data.keys);
        onKeysChange?.();
      } else {
        setError(data.error || 'Failed to remove key');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleKey = async (keyId: string, enabled: boolean) => {
    try {
      const response = await fetch('/hdsp-agent/gemini-keys/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRFToken': getCookie('_xsrf')
        },
        body: JSON.stringify({ keyId, enabled })
      });

      const data = await response.json();

      if (response.ok) {
        setKeys(data.keys);
        onKeysChange?.();
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const formatCooldown = (seconds: number): string => {
    if (seconds <= 0) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}분 ${secs}초`;
    }
    return `${secs}초`;
  };

  const getStatusBadge = (key: IGeminiKeyStatus) => {
    switch (key.status) {
      case 'active':
        return <span className="jp-agent-key-status jp-agent-key-status-active">활성</span>;
      case 'cooldown':
        return (
          <span className="jp-agent-key-status jp-agent-key-status-cooldown">
            대기 중 ({formatCooldown(key.cooldownRemaining)})
          </span>
        );
      case 'disabled':
        return <span className="jp-agent-key-status jp-agent-key-status-disabled">비활성</span>;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newKey.trim() && !isLoading) {
      handleAddKey();
    }
  };

  return (
    <div className="jp-agent-keys-panel">
      <div className="jp-agent-keys-header">
        <h4>API 키 관리</h4>
        <span className="jp-agent-keys-count">
          {keys.length} / {maxKeys} 키
        </span>
      </div>

      {error && (
        <div className="jp-agent-keys-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Key List */}
      <div className="jp-agent-keys-list">
        {keys.length === 0 ? (
          <div className="jp-agent-keys-empty">
            등록된 API 키가 없습니다
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className={`jp-agent-key-item ${key.isActive ? 'jp-agent-key-item-active' : ''}`}
            >
              <div className="jp-agent-key-info">
                <span className="jp-agent-key-masked">{key.maskedKey}</span>
                {getStatusBadge(key)}
                {key.isActive && (
                  <span className="jp-agent-key-current">현재</span>
                )}
              </div>
              <div className="jp-agent-key-actions">
                <button
                  className={`jp-agent-settings-button jp-agent-settings-button-small ${key.enabled ? 'jp-agent-settings-button-secondary' : 'jp-agent-settings-button-outline'}`}
                  onClick={() => handleToggleKey(key.id, !key.enabled)}
                  title={key.enabled ? '비활성화' : '활성화'}
                >
                  {key.enabled ? '비활성화' : '활성화'}
                </button>
                <button
                  className="jp-agent-settings-button jp-agent-settings-button-small jp-agent-settings-button-danger"
                  onClick={() => handleRemoveKey(key.id)}
                  title="삭제"
                  disabled={isLoading}
                >
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Key Form */}
      {keys.length < maxKeys && (
        <div className="jp-agent-keys-add">
          <input
            type="password"
            className="jp-agent-settings-input"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="새 API 키 입력 (AIza...)"
            disabled={isLoading}
          />
          <button
            className="jp-agent-settings-button jp-agent-settings-button-primary"
            onClick={handleAddKey}
            disabled={isLoading || !newKey.trim()}
          >
            {isLoading ? '검증 중...' : '추가'}
          </button>
        </div>
      )}

      <div className="jp-agent-keys-info-text">
        <small>
          키 추가 시 API 유효성을 검증합니다.
          Rate limit 발생 시 자동으로 다음 키로 전환됩니다.
        </small>
      </div>
    </div>
  );
};

export default GeminiKeysPanel;
