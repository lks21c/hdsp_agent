/**
 * AutoAgentPanel - Claude/Cursor Style Auto-Agent UI
 * Minimal, matte design with no emojis
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ISessionContext } from '@jupyterlab/apputils';

import { ApiService } from '../services/ApiService';
import { AgentOrchestrator } from '../services/AgentOrchestrator';
import { formatMarkdownToHtml } from '../utils/markdownRenderer';
import {
  AgentStatus,
  AutoAgentResult,
  ExecutionPlan,
  PlanStep,
  AutoAgentConfig,
  DEFAULT_AUTO_AGENT_CONFIG,
  ExecutionSpeed,
  EXECUTION_SPEED_DELAYS,
  CellOperation,
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
  isReplanning?: boolean;
  originalStepCount?: number; // 원래 계획의 스텝 수
}

const ExecutionPlanView: React.FC<ExecutionPlanViewProps> = ({
  plan,
  currentStep,
  completedSteps,
  failedSteps,
  isReplanning,
  originalStepCount,
}) => {
  const getStepStatus = (stepNumber: number): 'failed' | 'completed' | 'current' | 'pending' | 'replanning' => {
    if (isReplanning && currentStep === stepNumber) return 'replanning';
    if (failedSteps.includes(stepNumber)) return 'failed';
    if (completedSteps.includes(stepNumber)) return 'completed';
    if (currentStep === stepNumber) return 'current';
    return 'pending';
  };

  // 새로 추가된 스텝인지 확인 (step.isNew 플래그 또는 originalStepCount 비교)
  const isNewStep = (step: PlanStep): boolean => {
    // step.isNew 플래그가 있으면 우선 사용
    if (step.isNew !== undefined) {
      return step.isNew;
    }
    // fallback: originalStepCount 기반 비교
    return originalStepCount !== undefined && step.stepNumber > originalStepCount;
  };

  // 셀 작업 유형에 따른 배지 텍스트 및 CSS 클래스 반환
  const getOperationBadge = (step: PlanStep): { text: string; className: string } | null => {
    const operation = step.cellOperation;
    if (!operation) return null;

    switch (operation) {
      case 'MODIFY':
        return { text: 'MODIFIED', className: 'aa-operation-badge aa-operation-badge--modify' };
      case 'INSERT_AFTER':
      case 'INSERT_BEFORE':
        return { text: 'INSERTED', className: 'aa-operation-badge aa-operation-badge--insert' };
      case 'CREATE':
        // CREATE는 기본 동작이므로 NEW가 아닌 경우에만 표시하지 않음
        return null;
      default:
        return null;
    }
  };

  // 스텝의 셀 작업 유형에 따른 CSS 클래스
  const getStepOperationClass = (step: PlanStep): string => {
    const operation = step.cellOperation;
    if (!operation) return '';

    switch (operation) {
      case 'MODIFY':
        return 'aa-step--modified';
      case 'INSERT_AFTER':
      case 'INSERT_BEFORE':
        return 'aa-step--inserted';
      default:
        return '';
    }
  };

  // 대상 셀 인덱스 표시
  const getCellIndexDisplay = (step: PlanStep): number | null => {
    // wasReplanned나 isReplaced면서 targetCellIndex가 있는 경우
    if (step.targetCellIndex !== undefined) {
      return step.targetCellIndex;
    }
    return null;
  };

  const progressPercent = (completedSteps.length / plan.totalSteps) * 100;

  return (
    <div className={`aa-plan ${isReplanning ? 'aa-plan--replanning' : ''}`}>
      <div className="aa-plan-header">
        <span className="aa-plan-title">
          {isReplanning ? '계획 수정 중...' : '실행 계획'}
        </span>
        <span className="aa-plan-progress">
          {completedSteps.length} / {plan.totalSteps}
          {originalStepCount !== undefined && plan.totalSteps !== originalStepCount && (
            <span className="aa-plan-changed">
              ({plan.totalSteps > originalStepCount ? '+' : ''}{plan.totalSteps - originalStepCount})
            </span>
          )}
        </span>
      </div>
      {/* Progress Bar */}
      <div className="aa-progress-bar">
        <div
          className="aa-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="aa-plan-steps">
        {plan.steps.map((step) => {
          const status = getStepStatus(step.stepNumber);
          const isNew = isNewStep(step);
          const operationBadge = getOperationBadge(step);
          const operationClass = getStepOperationClass(step);
          const cellIndex = getCellIndexDisplay(step);
          const isReplaced = step.isReplaced;
          const wasReplanned = step.wasReplanned;

          return (
            <div
              key={step.stepNumber}
              className={`aa-step aa-step--${status} ${isNew ? 'aa-step--new' : ''} ${operationClass} ${isReplaced ? 'aa-step--replaced' : ''}`}
            >
              <div className="aa-step-indicator">
                {/* 상태 아이콘 */}
                {status === 'completed' && (
                  <svg className="aa-step-status-icon aa-step-status-icon--completed" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                  </svg>
                )}
                {status === 'failed' && (
                  <svg className="aa-step-status-icon aa-step-status-icon--failed" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
                  </svg>
                )}
                {status === 'replanning' && (
                  <svg className="aa-step-status-icon aa-icon-spin" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z"/>
                    <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966a.25.25 0 010 .384L8.41 4.658A.25.25 0 018 4.466z"/>
                  </svg>
                )}
                {status === 'current' && <div className="aa-step-spinner" />}
                {status === 'pending' && <span className="aa-step-pending-dot" />}
                {/* Step 번호를 항상 표시 */}
                <span className="aa-step-number">
                  {isNew && status === 'pending' ? '+' : ''}{step.stepNumber}
                </span>
              </div>
              <div className="aa-step-content">
                <span className={`aa-step-desc ${status === 'completed' ? 'aa-step-desc--done' : ''} ${isNew ? 'aa-step-desc--new' : ''}`}>
                  {/* 셀 작업 배지 표시: NEW, MODIFIED, INSERTED, REPLACED */}
                  {isNew && <span className="aa-new-badge">NEW</span>}
                  {!isNew && isReplaced && <span className="aa-operation-badge aa-operation-badge--replace">REPLACED</span>}
                  {!isNew && !isReplaced && operationBadge && (
                    <span className={operationBadge.className}>{operationBadge.text}</span>
                  )}
                  {!isNew && !isReplaced && !operationBadge && wasReplanned && (
                    <span className="aa-operation-badge aa-operation-badge--modify">REFINED</span>
                  )}
                  <span className="aa-step-label">Step {step.stepNumber}:</span> {step.description}
                  {/* 대상 셀 인덱스 표시 */}
                  {cellIndex !== null && (
                    <span className={`aa-cell-index ${step.cellOperation === 'MODIFY' ? 'aa-cell-index--target' : ''}`}>
                      Cell #{cellIndex}
                    </span>
                  )}
                </span>
                {status === 'current' && (
                  <span className="aa-step-executing">실행 중...</span>
                )}
                {status === 'replanning' && (
                  <span className="aa-step-replanning">계획 수정 중...</span>
                )}
                <div className="aa-step-tools">
                  {step.toolCalls
                    .filter(tc => !['jupyter_cell', 'final_answer', 'markdown'].includes(tc.tool))
                    .map((tc, i) => (
                      <span key={i} className={`aa-tool-tag ${status === 'completed' ? 'aa-tool-tag--done' : ''}`}>
                        {tc.tool}
                      </span>
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
      case 'validating': return status.message || '코드 검증 중...';
      case 'replanning': return `계획 수정 중 (Step ${status.currentStep})`;
      case 'reflecting': return status.message || '결과 분석 중...';
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return '처리 중...';
    }
  };

  const isActive = ['planning', 'executing', 'tool_calling', 'replanning', 'validating', 'reflecting'].includes(status.phase);

  // Validation/Reflection 상태 아이콘
  const getStatusIcon = () => {
    if (status.phase === 'validating') {
      switch (status.validationStatus) {
        case 'checking':
          return <div className="aa-status-spinner" />;
        case 'passed':
        case 'warning':
          // warning도 passed와 동일하게 표시 (별도 경고 아이콘 없음)
          return (
            <svg className="aa-status-icon aa-status-icon--success" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
            </svg>
          );
        case 'failed':
          return (
            <svg className="aa-status-icon aa-status-icon--error" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
            </svg>
          );
      }
    }

    if (status.phase === 'reflecting') {
      switch (status.reflectionStatus) {
        case 'analyzing':
          return <div className="aa-status-spinner" />;
        case 'passed':
          return (
            <svg className="aa-status-icon aa-status-icon--success" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
            </svg>
          );
        case 'adjusting':
          return (
            <svg className="aa-status-icon aa-status-icon--warning" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966a.25.25 0 010 .384L8.41 4.658A.25.25 0 018 4.466z"/>
            </svg>
          );
      }
    }

    return isActive ? <div className="aa-status-spinner" /> : null;
  };

  return (
    <div className={`aa-status aa-status--${status.phase} ${status.validationStatus ? `aa-status--validation-${status.validationStatus}` : ''} ${status.reflectionStatus ? `aa-status--reflection-${status.reflectionStatus}` : ''}`}>
      {getStatusIcon()}
      <span className="aa-status-text">{getMessage()}</span>
      {status.phase === 'failed' && status.error && (
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
  const [originalStepCount, setOriginalStepCount] = useState<number | undefined>(undefined);
  const [executionSpeed, setExecutionSpeed] = useState<ExecutionSpeed>('normal');
  const [isPaused, setIsPaused] = useState(false);

  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mergedConfig = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config, executionSpeed };

  const notebook = propNotebook || (notebookTracker?.currentWidget as NotebookPanel | null);
  const sessionContext = propSessionContext || (notebook?.sessionContext as ISessionContext | null);
  const apiService = propApiService || new ApiService();

  useEffect(() => {
    if (notebook && sessionContext) {
      orchestratorRef.current = new AgentOrchestrator(notebook, sessionContext, apiService, mergedConfig);
    }
    return () => { orchestratorRef.current = null; };
  }, [notebook, sessionContext, apiService]);

  // 일시정지 상태 폴링 (step-by-step 모드용)
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (orchestratorRef.current) {
        setIsPaused(orchestratorRef.current.getIsPaused());
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  // 속도 변경 시 오케스트레이터 설정 업데이트
  useEffect(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.updateConfig({ executionSpeed });
    }
  }, [executionSpeed]);

  const handleProgress = useCallback((newStatus: AgentStatus) => {
    setStatus(newStatus);
    if (newStatus.plan) {
      setPlan(newStatus.plan);
      // 첫 계획이면 원래 스텝 수 저장
      if (newStatus.phase === 'planned' && originalStepCount === undefined) {
        setOriginalStepCount(newStatus.plan.totalSteps);
      }
    }
    if (newStatus.phase === 'executing' && newStatus.currentStep && newStatus.currentStep > 1) {
      setCompletedSteps(Array.from({ length: newStatus.currentStep - 1 }, (_, i) => i + 1));
    }
    // 실패한 step 처리 (failedStep 필드 우선 사용)
    if (newStatus.failedStep) {
      console.log('[AutoAgentPanel] failedStep detected:', newStatus.failedStep);
      setFailedSteps(prev => {
        if (!prev.includes(newStatus.failedStep!)) {
          console.log('[AutoAgentPanel] Adding to failedSteps:', newStatus.failedStep);
          return [...prev, newStatus.failedStep!];
        }
        console.log('[AutoAgentPanel] failedStep already in list');
        return prev;
      });
    }
  }, [originalStepCount]);

  const handleExecute = useCallback(async () => {
    if (!orchestratorRef.current || !notebook || !request.trim()) return;

    setIsRunning(true);
    setResult(null);
    setPlan(null);
    setCompletedSteps([]);
    setFailedSteps([]);
    setOriginalStepCount(undefined);
    setStatus({ phase: 'planning', message: 'Creating execution plan...' });

    try {
      const taskResult = await orchestratorRef.current.executeTask(request.trim(), notebook, handleProgress);
      setResult(taskResult);
      if (taskResult.success && taskResult.plan) {
        setCompletedSteps(taskResult.plan.steps.map(s => s.stepNumber));
        setStatus({ phase: 'completed', message: '작업 완료' });
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
    setIsPaused(false);
    textareaRef.current?.focus();
  }, []);

  const handleNextStep = useCallback(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.proceedToNextStep();
    }
  }, []);

  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setExecutionSpeed(e.target.value as ExecutionSpeed);
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

      {/* Speed Control */}
      <div className="aa-speed-control">
        <span className="aa-speed-label">실행 속도:</span>
        <select
          className="aa-speed-select"
          value={executionSpeed}
          onChange={handleSpeedChange}
          disabled={isRunning && executionSpeed !== 'step-by-step'}
        >
          <option value="instant">즉시 (지연 없음)</option>
          <option value="fast">빠름 (0.8초)</option>
          <option value="normal">보통 (1.5초)</option>
          <option value="slow">느림 (3초)</option>
          <option value="step-by-step">단계별 (수동)</option>
        </select>
      </div>

      {/* Step-by-step 모드 일시정지 표시 */}
      {isPaused && (
        <div className="aa-paused-indicator">
          <svg className="aa-paused-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 3.5A1.5 1.5 0 017 5v6a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zm5 0A1.5 1.5 0 0112 5v6a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5z"/>
          </svg>
          <span>다음 단계 대기 중...</span>
          <button className="aa-btn aa-btn--next" onClick={handleNextStep}>
            다음 단계
          </button>
        </div>
      )}

      {/* Status */}
      {status.phase !== 'idle' && <StatusIndicator status={status} />}

      {/* Plan */}
      {plan && (
        <ExecutionPlanView
          plan={plan}
          currentStep={status.currentStep}
          completedSteps={completedSteps}
          failedSteps={failedSteps}
          isReplanning={status.phase === 'replanning'}
          originalStepCount={originalStepCount}
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
            <div
              className="aa-result-message"
              dangerouslySetInnerHTML={{ __html: formatMarkdownToHtml(result.finalAnswer) }}
            />
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
