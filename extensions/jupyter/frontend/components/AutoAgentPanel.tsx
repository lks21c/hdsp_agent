/**
 * AutoAgentPanel - Claude/Cursor Style Auto-Agent UI
 * Minimal, matte design with no emojis
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { NotebookPanel } from '@jupyterlab/notebook';
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
  ApprovalRequest,
  ApprovalResult,
  // Checkpoint Types (Phase 3)
  ExecutionCheckpoint,
  RollbackResult,
} from '../types/auto-agent';
import { ApprovalDialog } from './ApprovalDialog';
import { FileSelectionDialog } from './FileSelectionDialog';

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
  replanInfo?: AgentStatus['replanInfo']; // 계획 수정 상세 정보
}

const ExecutionPlanView: React.FC<ExecutionPlanViewProps> = ({
  plan,
  currentStep,
  completedSteps,
  failedSteps,
  isReplanning,
  originalStepCount,
  replanInfo,
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

  // replanInfo 기반 헤더 메시지 생성
  const getReplanHeaderMessage = (): string => {
    if (!isReplanning || !replanInfo) return '계획 수정 중...';
    const { errorType, decision, missingPackage } = replanInfo;
    if (decision) {
      // 결정이 완료된 경우
      if (decision === 'insert_steps' && missingPackage) {
        return `패키지 설치 추가: ${missingPackage}`;
      }
      switch (decision) {
        case 'refine': return '코드 수정 중...';
        case 'insert_steps': return '단계 추가 중...';
        case 'replace_step': return '단계 교체 중...';
        case 'replan_remaining': return '남은 계획 재수립 중...';
        default: return '계획 수정 중...';
      }
    }
    // 아직 분석 중인 경우
    return `에러 분석: ${errorType || '오류'}`;
  };

  return (
    <div className={`aa-plan ${isReplanning ? 'aa-plan--replanning' : ''}`}>
      <div className="aa-plan-header">
        <span className="aa-plan-title">
          {isReplanning ? getReplanHeaderMessage() : '실행 계획'}
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
                  <span className="aa-step-replanning">
                    {replanInfo?.decision
                      ? (replanInfo.decision === 'insert_steps' && replanInfo.missingPackage
                          ? `pip install ${replanInfo.missingPackage}`
                          : '수정 적용 중...')
                      : `분석 중: ${replanInfo?.errorType || '오류'}`}
                  </span>
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
      case 'replanning': {
        // replanInfo가 있으면 상세 표시
        if (status.replanInfo) {
          const { errorType, decision, missingPackage } = status.replanInfo;
          if (decision) {
            // 결정 완료 상태
            if (decision === 'insert_steps' && missingPackage) {
              return `패키지 설치: pip install ${missingPackage}`;
            }
            return status.message || `계획 수정 (Step ${status.currentStep})`;
          }
          // 에러 분석 중
          return `에러 분석 중: ${errorType || '오류'}`;
        }
        return `계획 수정 중 (Step ${status.currentStep})`;
      }
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

  // Tool Approval State (Phase 1)
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolverRef = useRef<((result: ApprovalResult) => void) | null>(null);

  // Checkpoint/Rollback State (Phase 3)
  const [checkpoints, setCheckpoints] = useState<ExecutionCheckpoint[]>([]);
  const [showRollbackUI, setShowRollbackUI] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);

  // File Selection State
  const [fileSelectionState, setFileSelectionState] = useState<{
    isOpen: boolean;
    filename: string;
    options: Array<{ path: string; relative: string; dir: string }>;
    message: string;
  } | null>(null);

  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mergedConfig = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config, executionSpeed };

  // Use app.shell.currentWidget for reliable active tab detection
  const isNotebookWidget = (widget: any): widget is NotebookPanel => {
    if (!widget) return false;
    if (widget instanceof NotebookPanel) return true;
    const model = widget?.content?.model;
    return Boolean(model && (model.cells || model.sharedModel?.cells));
  };

  const getCurrentNotebook = (): NotebookPanel | null => {
    if (propNotebook) return propNotebook;

    const app = (window as any).jupyterapp;
    if (app?.shell?.currentWidget) {
      const currentWidget = app.shell.currentWidget;
      if (isNotebookWidget(currentWidget)) {
        return currentWidget as NotebookPanel;
      }
    }

    if (notebookTracker?.currentWidget && isNotebookWidget(notebookTracker.currentWidget)) {
      return notebookTracker.currentWidget as NotebookPanel;
    }
    return null;
  };

  // Initial notebook for render check (propNotebook takes priority)
  const notebook = propNotebook || getCurrentNotebook();
  const sessionContext = propSessionContext || (notebook?.sessionContext as ISessionContext | null);
  const apiService = propApiService || new ApiService();

  // Approval Callback - 승인 요청 시 다이얼로그 표시
  const handleApprovalRequest = useCallback(async (request: ApprovalRequest): Promise<ApprovalResult> => {
    return new Promise((resolve) => {
      setPendingApproval(request);
      setApprovalDialogOpen(true);
      approvalResolverRef.current = resolve;
    });
  }, []);

  // Approval Dialog Handlers
  const handleApprove = useCallback((requestId: string) => {
    if (approvalResolverRef.current) {
      approvalResolverRef.current({
        approved: true,
        requestId,
        timestamp: Date.now(),
      });
      approvalResolverRef.current = null;
    }
    setApprovalDialogOpen(false);
    setPendingApproval(null);
  }, []);

  const handleReject = useCallback((requestId: string, reason?: string) => {
    if (approvalResolverRef.current) {
      approvalResolverRef.current({
        approved: false,
        requestId,
        reason: reason || '사용자가 거부함',
        timestamp: Date.now(),
      });
      approvalResolverRef.current = null;
    }
    setApprovalDialogOpen(false);
    setPendingApproval(null);
  }, []);

  const handleApprovalDialogClose = useCallback(() => {
    if (pendingApproval) {
      handleReject(pendingApproval.id, '다이얼로그 닫힘');
    }
  }, [pendingApproval, handleReject]);

  // Rollback Handlers (Phase 3)
  const handleShowRollbackUI = useCallback(() => {
    if (orchestratorRef.current) {
      const currentCheckpoints = orchestratorRef.current.getCheckpoints();
      setCheckpoints(currentCheckpoints);
      setShowRollbackUI(true);
      setRollbackResult(null);
    }
  }, []);

  const handleHideRollbackUI = useCallback(() => {
    setShowRollbackUI(false);
    setRollbackResult(null);
  }, []);

  const handleRollbackToCheckpoint = useCallback(async (stepNumber: number) => {
    if (!orchestratorRef.current) return;

    setIsRollingBack(true);
    setRollbackResult(null);

    try {
      const result = await orchestratorRef.current.rollbackToCheckpoint(stepNumber);
      setRollbackResult(result);

      if (result.success) {
        // 롤백 성공 시 체크포인트 목록 업데이트
        const updatedCheckpoints = orchestratorRef.current.getCheckpoints();
        setCheckpoints(updatedCheckpoints);
        // 실패한 스텝 목록에서 롤백된 스텝 이후 제거
        setFailedSteps(prev => prev.filter(s => s <= stepNumber));
        // 완료된 스텝 목록 업데이트
        setCompletedSteps(prev => prev.filter(s => s <= stepNumber));
      }
    } catch (error: any) {
      setRollbackResult({
        success: false,
        rolledBackTo: stepNumber,
        deletedCells: [],
        restoredCells: [],
        error: error.message || '롤백 중 오류 발생',
      });
    } finally {
      setIsRollingBack(false);
    }
  }, []);

  const handleRollbackToLatest = useCallback(async () => {
    if (!orchestratorRef.current) return;

    const latestCheckpoint = orchestratorRef.current.getLatestCheckpoint();
    if (latestCheckpoint) {
      await handleRollbackToCheckpoint(latestCheckpoint.stepNumber);
    }
  }, [handleRollbackToCheckpoint]);

  useEffect(() => {
    // Always get fresh notebook (not stale)
    const nb = propNotebook || getCurrentNotebook();
    const sc = propSessionContext || nb?.sessionContext;

    if (nb && sc) {
      orchestratorRef.current = new AgentOrchestrator(nb, sc, apiService, mergedConfig);
      // 승인 콜백 설정
      orchestratorRef.current.setApprovalCallback(handleApprovalRequest);
    }
    return () => { orchestratorRef.current = null; };
  }, [notebookTracker, propNotebook, propSessionContext, apiService, handleApprovalRequest]);

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
    // ★ Use app.shell.currentWidget for reliable active tab detection
    const app = (window as any).jupyterapp;
    let currentNotebook = null;

    // Try to get notebook from shell.currentWidget (most reliable)
      if (app?.shell?.currentWidget && isNotebookWidget(app.shell.currentWidget)) {
        currentNotebook = app.shell.currentWidget;
      }

    // Fallback: get fresh notebook (not stale variable)
    if (!currentNotebook) {
      currentNotebook = propNotebook || getCurrentNotebook();
    }

    console.log('[AutoAgentPanel] shell.currentWidget:', app?.shell?.currentWidget?.context?.path);
    console.log('[AutoAgentPanel] tracker.currentWidget:', notebookTracker?.currentWidget?.context?.path);
    console.log('[AutoAgentPanel] Using notebook:', currentNotebook?.context?.path);

    const currentSessionContext = currentNotebook?.sessionContext;

    if (!currentNotebook || !currentSessionContext || !request.trim()) return;

    // ★ NEW: File Resolution - 파일명 추출 및 검색
    const filePattern = /['"]?([a-zA-Z0-9_-]+\.(?:csv|xlsx|json|txt|py|parquet|feather|pkl|pickle))['"]?/gi;
    const matches = request.match(filePattern);

    if (matches && matches.length > 0) {
      // 첫 번째 파일명만 검색 (추후 여러 파일 지원 가능)
      const filename = matches[0].replace(/['"]/g, '');
      console.log('[AutoAgentPanel] Detected filename:', filename);

      try {
        const notebookDir = currentNotebook?.context?.path
          ? currentNotebook.context.path.substring(0, currentNotebook.context.path.lastIndexOf('/'))
          : undefined;

        const resolveResult = await apiService.resolveFile({
          filename,
          notebookDir,
        });

        if (resolveResult.requiresSelection && resolveResult.options) {
          // 여러 파일 발견 - 사용자 선택 필요
          console.log('[AutoAgentPanel] Multiple files found, showing selection dialog');
          setFileSelectionState({
            isOpen: true,
            filename: resolveResult.filename!,
            options: resolveResult.options,
            message: resolveResult.message!,
          });
          return; // 실행 중단, 사용자 선택 대기
        }

        if (resolveResult.path && resolveResult.relative) {
          // 단일 파일 발견 - request에 상대 경로로 교체
          console.log('[AutoAgentPanel] Single file found:', resolveResult.relative);
          // Note: request는 이미 trim()되어 사용되므로 여기서는 로깅만
        }
      } catch (error: any) {
        console.warn('[AutoAgentPanel] File resolution failed:', error.message);
        // 파일 검색 실패해도 계속 진행 (원본 request 사용)
      }
    }

    // ★ 현재 활성화된 노트북으로 AgentOrchestrator 재생성
    const mergedConfig = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config };
    const orchestrator = new AgentOrchestrator(currentNotebook, currentSessionContext, apiService || new ApiService(), mergedConfig);

    // CRITICAL: Update orchestratorRef so other code (cancel/reset/nextStep) uses correct instance
    orchestratorRef.current = orchestrator;

    setIsRunning(true);
    setResult(null);
    setPlan(null);
    setCompletedSteps([]);
    setFailedSteps([]);
    setOriginalStepCount(undefined);
    setStatus({ phase: 'planning', message: 'Creating execution plan...' });

    try {
      const taskResult = await orchestrator.executeTask(request.trim(), currentNotebook, handleProgress);
      setResult(taskResult);
      if (taskResult.success && taskResult.plan) {
        setCompletedSteps(taskResult.plan.steps.map(s => s.stepNumber));
        setStatus({ phase: 'completed', message: '작업 완료' });
      }
      onComplete?.(taskResult);
    } catch (error: any) {
      console.log('[AutoAgentPanel] Caught error:', error);
      console.log('[AutoAgentPanel] Error name:', error.name);
      console.log('[AutoAgentPanel] Error has fileSelectionMetadata:', !!error.fileSelectionMetadata);

      // Handle FILE_SELECTION_REQUIRED specially
      if (error.name === 'FileSelectionError' && error.fileSelectionMetadata) {
        console.log('[AutoAgentPanel] File selection required, showing dialog');
        setFileSelectionState({
          isOpen: true,
          filename: error.fileSelectionMetadata.pattern || 'file',
          options: error.fileSelectionMetadata.options || [],
          message: error.fileSelectionMetadata.message || 'Select a file',
        });
        setStatus({ phase: 'idle', message: 'Waiting for file selection...' });
        setIsRunning(false);
        return;
      }

      setStatus({ phase: 'failed', message: error.message || 'Execution failed' });
    } finally {
      setIsRunning(false);
    }
  }, [propNotebook, notebookTracker, request, handleProgress, onComplete, config, propApiService]);

  const handleCancel = useCallback(() => {
    orchestratorRef.current?.cancel();
    setStatus({ phase: 'idle', message: 'Cancelled' });
    setIsRunning(false);
    onCancel?.();
  }, [onCancel]);

  // File Selection Handler
  const handleFileSelect = useCallback(async (index: number) => {
    if (!fileSelectionState) return;

    try {
      const selected = await apiService.selectFile({
        selection: String(index),
        options: fileSelectionState.options,
      });

      console.log('[AutoAgentPanel] File selected:', selected.relative);

      // 선택한 경로로 request 업데이트
      const updatedRequest = request.replace(
        fileSelectionState.filename,
        selected.relative
      );
      setRequest(updatedRequest);
      setFileSelectionState(null);

      // 자동으로 실행 재시도
      setTimeout(() => handleExecute(), 100);
    } catch (error: any) {
      console.error('[AutoAgentPanel] File selection failed:', error.message);
      setFileSelectionState(null);
    }
  }, [fileSelectionState, request, apiService, handleExecute]);

  const handleReset = useCallback(() => {
    setRequest('');
    setStatus({ phase: 'idle' });
    setPlan(null);
    setResult(null);
    setCompletedSteps([]);
    setFailedSteps([]);
    setIsPaused(false);
    // Phase 3: Checkpoint 관련 상태 초기화
    setCheckpoints([]);
    setShowRollbackUI(false);
    setRollbackResult(null);
    // Orchestrator 체크포인트 클리어
    if (orchestratorRef.current) {
      orchestratorRef.current.clearAllCheckpoints();
    }
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
          replanInfo={status.replanInfo}
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
          {/* Phase 3: 실패 시 롤백 버튼 */}
          {!result.success && !isRunning && (
            <button
              className="aa-btn aa-btn--rollback"
              onClick={handleShowRollbackUI}
              disabled={isRollingBack}
            >
              체크포인트로 롤백
            </button>
          )}
        </div>
      )}

      {/* Rollback UI (Phase 3) */}
      {showRollbackUI && (
        <div className="aa-rollback-panel">
          <div className="aa-rollback-header">
            <span className="aa-rollback-title">체크포인트 롤백</span>
            <button className="aa-rollback-close" onClick={handleHideRollbackUI}>
              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
              </svg>
            </button>
          </div>

          {/* 롤백 결과 메시지 */}
          {rollbackResult && (
            <div className={`aa-rollback-result aa-rollback-result--${rollbackResult.success ? 'success' : 'error'}`}>
              {rollbackResult.success ? (
                <span>
                  Step {rollbackResult.rolledBackTo}로 롤백 완료
                  ({rollbackResult.deletedCells.length}개 셀 삭제, {rollbackResult.restoredCells.length}개 셀 복원)
                </span>
              ) : (
                <span>롤백 실패: {rollbackResult.error}</span>
              )}
            </div>
          )}

          {/* 체크포인트 목록 */}
          {checkpoints.length > 0 ? (
            <div className="aa-checkpoint-list">
              {checkpoints.map((cp) => (
                <div key={cp.id} className="aa-checkpoint-item">
                  <div className="aa-checkpoint-info">
                    <span className="aa-checkpoint-step">Step {cp.stepNumber}</span>
                    <span className="aa-checkpoint-desc">{cp.description}</span>
                    <span className="aa-checkpoint-time">
                      {new Date(cp.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <button
                    className="aa-btn aa-btn--small"
                    onClick={() => handleRollbackToCheckpoint(cp.stepNumber)}
                    disabled={isRollingBack}
                  >
                    {isRollingBack ? '롤백 중...' : '롤백'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="aa-checkpoint-empty">
              저장된 체크포인트가 없습니다.
            </div>
          )}

          {/* 최신 체크포인트로 롤백 버튼 */}
          {checkpoints.length > 0 && (
            <div className="aa-rollback-actions">
              <button
                className="aa-btn aa-btn--primary"
                onClick={handleRollbackToLatest}
                disabled={isRollingBack}
              >
                {isRollingBack ? '롤백 중...' : '마지막 성공 지점으로 롤백'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state hint */}
      {status.phase === 'idle' && !result && (
        <div className="aa-hint">
          <p>작업을 입력하고 Enter 또는 실행 버튼을 클릭하세요.</p>
          <p className="aa-hint-sub">Shift+Enter로 줄바꿈</p>
        </div>
      )}

      {/* Approval Dialog (Phase 1) */}
      <ApprovalDialog
        open={approvalDialogOpen}
        request={pendingApproval}
        onApprove={handleApprove}
        onReject={handleReject}
        onClose={handleApprovalDialogClose}
        autoRejectTimeout={30}  // 30초 후 자동 거부
      />

      {/* File Selection Dialog */}
      {fileSelectionState?.isOpen && (
        <FileSelectionDialog
          filename={fileSelectionState.filename}
          options={fileSelectionState.options}
          message={fileSelectionState.message}
          onSelect={handleFileSelect}
          onCancel={() => setFileSelectionState(null)}
        />
      )}
    </div>
  );
};

export default AutoAgentPanel;
