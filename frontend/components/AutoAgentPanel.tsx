/**
 * AutoAgentPanel - Claude/Cursor Style Auto-Agent UI
 * Minimal, matte design with no emojis
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ISessionContext } from '@jupyterlab/apputils';

import { ApiService } from '../services/ApiService';
import { AgentOrchestrator } from '../services/AgentOrchestrator';
import {
  AgentStatus,
  AutoAgentResult,
  ExecutionPlan,
  PlanStep,
  AutoAgentConfig,
  DEFAULT_AUTO_AGENT_CONFIG,
} from '../types/auto-agent';

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

interface AutoAgentPanelProps {
  notebook?: NotebookPanel | null;
  sessionContext?: ISessionContext | null;
  notebookTracker?: any;
  apiService?: ApiService;
  onComplete?: (result: AutoAgentResult) => void;
  onCancel?: () => void;
  config?: Partial<AutoAgentConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Execution Plan View
// ═══════════════════════════════════════════════════════════════════════════

interface ExecutionPlanViewProps {
  plan: ExecutionPlan;
  currentStep?: number;
  completedSteps: number[];
  failedSteps: number[];
}

const ExecutionPlanView: React.FC<ExecutionPlanViewProps> = ({
  plan,
  currentStep,
  completedSteps,
  failedSteps,
}) => {
  const getStepStatus = (stepNumber: number): 'failed' | 'completed' | 'current' | 'pending' => {
    if (failedSteps.includes(stepNumber)) return 'failed';
    if (completedSteps.includes(stepNumber)) return 'completed';
    if (currentStep === stepNumber) return 'current';
    return 'pending';
  };

  return (
    <div className="aa-plan">
      <div className="aa-plan-header">
        <span className="aa-plan-title">실행 계획</span>
        <span className="aa-plan-progress">
          {completedSteps.length} / {plan.totalSteps}
        </span>
      </div>
      <div className="aa-plan-steps">
        {plan.steps.map((step) => {
          const status = getStepStatus(step.stepNumber);
          return (
            <div key={step.stepNumber} className={`aa-step aa-step--${status}`}>
              <div className="aa-step-indicator">
                {status === 'completed' && (
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                  </svg>
                )}
                {status === 'failed' && (
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
                  </svg>
                )}
                {status === 'current' && <div className="aa-step-spinner" />}
                {status === 'pending' && <span className="aa-step-number">{step.stepNumber}</span>}
              </div>
              <div className="aa-step-content">
                <span className="aa-step-desc">{step.description}</span>
                <div className="aa-step-tools">
                  {step.toolCalls.map((tc, i) => (
                    <span key={i} className="aa-tool-tag">{tc.tool}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Status Indicator
// ═══════════════════════════════════════════════════════════════════════════

interface StatusIndicatorProps {
  status: AgentStatus;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const getMessage = (): string => {
    switch (status.phase) {
      case 'idle': return '준비됨';
      case 'planning': return '계획 생성 중...';
      case 'planned': return status.message || '계획 완료';
      case 'executing': return `실행 중 (${status.currentStep}/${status.totalSteps})`;
      case 'tool_calling': return `${status.tool} 실행 중`;
      case 'self_healing': return `재시도 중 (${status.attempt}/3)`;
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return '처리 중...';
    }
  };

  const isActive = ['planning', 'executing', 'tool_calling', 'self_healing'].includes(status.phase);

  return (
    <div className={`aa-status aa-status--${status.phase}`}>
      {isActive && <div className="aa-status-spinner" />}
      <span className="aa-status-text">{getMessage()}</span>
      {status.phase === 'self_healing' && status.error && (
        <span className="aa-status-error">{status.error.message}</span>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export const AutoAgentPanel: React.FC<AutoAgentPanelProps> = ({
  notebook: propNotebook,
  sessionContext: propSessionContext,
  notebookTracker,
  apiService: propApiService,
  onComplete,
  onCancel,
  config,
}) => {
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<AgentStatus>({ phase: 'idle' });
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<AutoAgentResult | null>(null);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [failedSteps, setFailedSteps] = useState<number[]>([]);

  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mergedConfig = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config };

  const notebook = propNotebook || (notebookTracker?.currentWidget as NotebookPanel | null);
  const sessionContext = propSessionContext || (notebook?.sessionContext as ISessionContext | null);
  const apiService = propApiService || new ApiService();

  useEffect(() => {
    if (notebook && sessionContext) {
      orchestratorRef.current = new AgentOrchestrator(notebook, sessionContext, apiService, mergedConfig);
    }
    return () => { orchestratorRef.current = null; };
  }, [notebook, sessionContext, apiService]);

  const handleProgress = useCallback((newStatus: AgentStatus) => {
    setStatus(newStatus);
    if (newStatus.plan) setPlan(newStatus.plan);
    if (newStatus.phase === 'executing' && newStatus.currentStep && newStatus.currentStep > 1) {
      setCompletedSteps(Array.from({ length: newStatus.currentStep - 1 }, (_, i) => i + 1));
    }
    if (newStatus.phase === 'failed' && newStatus.currentStep) {
      setFailedSteps(prev => [...prev, newStatus.currentStep!]);
    }
  }, []);

  const handleExecute = useCallback(async () => {
    if (!orchestratorRef.current || !notebook || !request.trim()) return;

    setIsRunning(true);
    setResult(null);
    setPlan(null);
    setCompletedSteps([]);
    setFailedSteps([]);
    setStatus({ phase: 'planning', message: 'Creating execution plan...' });

    try {
      const taskResult = await orchestratorRef.current.executeTask(request.trim(), notebook, handleProgress);
      setResult(taskResult);
      if (taskResult.success && taskResult.plan) {
        setCompletedSteps(taskResult.plan.steps.map(s => s.stepNumber));
        setStatus({ phase: 'completed', message: taskResult.finalAnswer || 'Task completed successfully' });
      }
      onComplete?.(taskResult);
    } catch (error: any) {
      setStatus({ phase: 'failed', message: error.message || 'Execution failed' });
    } finally {
      setIsRunning(false);
    }
  }, [notebook, request, handleProgress, onComplete]);

  const handleCancel = useCallback(() => {
    orchestratorRef.current?.cancel();
    setStatus({ phase: 'idle', message: 'Cancelled' });
    setIsRunning(false);
    onCancel?.();
  }, [onCancel]);

  const handleReset = useCallback(() => {
    setRequest('');
    setStatus({ phase: 'idle' });
    setPlan(null);
    setResult(null);
    setCompletedSteps([]);
    setFailedSteps([]);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isRunning && request.trim()) {
      e.preventDefault();
      handleExecute();
    }
  }, [handleExecute, isRunning, request]);

  if (!notebook || !sessionContext) {
    return (
      <div className="aa-panel">
        <div className="aa-empty">
          <span className="aa-empty-text">노트북을 열어주세요</span>
        </div>
      </div>
    );
  }

  return (
    <div className="aa-panel">
      {/* Input */}
      <div className="aa-input-section">
        <textarea
          ref={textareaRef}
          className="aa-textarea"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="원하는 작업을 설명해주세요..."
          disabled={isRunning}
          rows={3}
        />
        <div className="aa-actions">
          {!isRunning ? (
            <button
              className="aa-btn aa-btn--primary"
              onClick={handleExecute}
              disabled={!request.trim()}
            >
              실행
            </button>
          ) : (
            <button className="aa-btn aa-btn--cancel" onClick={handleCancel}>
              취소
            </button>
          )}
          {result && !isRunning && (
            <button className="aa-btn aa-btn--secondary" onClick={handleReset}>
              초기화
            </button>
          )}
        </div>
      </div>

      {/* Status */}
      {status.phase !== 'idle' && <StatusIndicator status={status} />}

      {/* Plan */}
      {plan && (
        <ExecutionPlanView
          plan={plan}
          currentStep={status.currentStep}
          completedSteps={completedSteps}
          failedSteps={failedSteps}
        />
      )}

      {/* Result */}
      {result && (
        <div className={`aa-result aa-result--${result.success ? 'success' : 'error'}`}>
          <div className="aa-result-header">
            <span className="aa-result-title">{result.success ? '완료' : '실패'}</span>
            {result.executionTime && (
              <span className="aa-result-time">{(result.executionTime / 1000).toFixed(1)}s</span>
            )}
          </div>
          {result.finalAnswer && (
            <p className="aa-result-message">{result.finalAnswer}</p>
          )}
          {result.error && (
            <p className="aa-result-error">{result.error}</p>
          )}
          <div className="aa-result-stats">
            <span>{result.createdCells.length}개 셀 생성</span>
            <span>{result.modifiedCells.length}개 셀 수정</span>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {status.phase === 'idle' && !result && (
        <div className="aa-hint">
          <p>작업을 입력하고 Enter 또는 실행 버튼을 클릭하세요.</p>
          <p className="aa-hint-sub">Shift+Enter로 줄바꿈</p>
        </div>
      )}
    </div>
  );
};

export default AutoAgentPanel;
