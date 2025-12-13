/**
 * AgentOrchestrator - Plan-and-Execute 오케스트레이터
 *
 * HuggingFace Jupyter Agent 패턴 기반:
 * - 사용자 요청을 단계별 실행 계획으로 분해
 * - Tool Calling을 통한 순차 실행
 * - Self-Healing (에러 발생 시 자동 수정 및 재시도)
 */

import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ISessionContext } from '@jupyterlab/apputils';

import { ApiService } from './ApiService';
import { ToolExecutor } from './ToolExecutor';
import { SafetyChecker } from '../utils/SafetyChecker';
import { StateVerifier } from './StateVerifier';
import {
  ToolCall,
  ToolResult,
  ExecutionPlan,
  PlanStep,
  StepResult,
  AgentStatus,
  AutoAgentResult,
  ExecutionError,
  NotebookContext,
  CellContext,
  AutoAgentConfig,
  DEFAULT_AUTO_AGENT_CONFIG,
  JupyterCellParams,
  AutoAgentReplanResponse,
  ReplanDecision,
  EXECUTION_SPEED_DELAYS,
  CellOperation,
  // Validation & Reflection Types
  AutoAgentValidateResponse,
  ReflectionResult,
  ReflectionAction,
  EnhancedPlanStep,
  Checkpoint,
  // State Verification Types (Phase 1)
  StateVerificationResult,
  VerificationContext,
  ExecutionResult,
  StateExpectation,
  CONFIDENCE_THRESHOLDS,
} from '../types/auto-agent';

export class AgentOrchestrator {
  private apiService: ApiService;
  private toolExecutor: ToolExecutor;
  private safetyChecker: SafetyChecker;
  private stateVerifier: StateVerifier;
  private config: AutoAgentConfig;
  private abortController: AbortController | null = null;
  private isRunning: boolean = false;
  private notebook: NotebookPanel;

  // Step-by-step 모드를 위한 상태
  private stepByStepResolver: (() => void) | null = null;
  private isPaused: boolean = false;

  // Validation & Reflection 설정
  private enablePreValidation: boolean = true;
  private enableReflection: boolean = true;

  // ★ State Verification 설정 (Phase 1)
  private enableStateVerification: boolean = true;

  // ★ 현재 Plan 실행 중 정의된 변수 추적 (cross-step validation용)
  private executedStepVariables: Set<string> = new Set();

  // ★ 현재 Plan 실행 중 import된 이름 추적 (cross-step validation용)
  private executedStepImports: Set<string> = new Set();

  // ★ 실행된 변수의 실제 값 추적 (finalAnswer 변수 치환용)
  private executedStepVariableValues: Record<string, string> = {};

  constructor(
    notebook: NotebookPanel,
    sessionContext: ISessionContext,
    apiService?: ApiService,
    config?: Partial<AutoAgentConfig>
  ) {
    this.notebook = notebook;
    this.apiService = apiService || new ApiService();
    this.toolExecutor = new ToolExecutor(notebook, sessionContext);
    this.safetyChecker = new SafetyChecker({
      enableSafetyCheck: config?.enableSafetyCheck ?? true,
      maxExecutionTime: (config?.executionTimeout ?? 30000) / 1000,
    });
    // ★ State Verifier 초기화 (Phase 1)
    this.stateVerifier = new StateVerifier(this.apiService);
    this.config = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config };
    console.log('[Orchestrator] Initialized with config:', {
      executionSpeed: this.config.executionSpeed,
      stepDelay: this.config.stepDelay,
    });

    // ToolExecutor에 자동 스크롤 설정 연동
    this.toolExecutor.setAutoScroll(this.config.autoScrollToCell);
  }

  /**
   * 메인 실행 함수: 사용자 요청을 받아 자동 실행
   */
  async executeTask(
    userRequest: string,
    notebook: NotebookPanel,
    onProgress: (status: AgentStatus) => void
  ): Promise<AutoAgentResult> {
    if (this.isRunning) {
      return {
        success: false,
        plan: null,
        executedSteps: [],
        createdCells: [],
        modifiedCells: [],
        error: 'Auto-Agent가 이미 실행 중입니다',
        totalAttempts: 0,
      };
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    // ★ 새 실행 시작 시 이전 실행에서 추적된 변수/import 초기화
    this.executedStepVariables.clear();
    this.executedStepImports.clear();
    this.executedStepVariableValues = {};
    // ★ State Verification 이력 초기화 (Phase 1)
    this.stateVerifier.clearHistory();

    const createdCells: number[] = [];
    const modifiedCells: number[] = [];
    const executedSteps: StepResult[] = [];
    const startTime = Date.now();

    try {
      // ═══════════════════════════════════════════════════════════════════════
      // PHASE 1: PLANNING - 작업 분해
      // ═══════════════════════════════════════════════════════════════════════
      onProgress({ phase: 'planning', message: '작업 계획 수립 중...' });

      const notebookContext = this.extractNotebookContext(notebook);
      const planResponse = await this.apiService.generateExecutionPlan({
        request: userRequest,
        notebookContext,
        availableTools: ['jupyter_cell', 'markdown', 'final_answer'],
      });

      const plan = planResponse.plan;

      onProgress({
        phase: 'planned',
        plan,
        message: `${plan.totalSteps}단계 실행 계획 생성됨`,
      });

      // ═══════════════════════════════════════════════════════════════════════
      // PHASE 2: EXECUTION - 단계별 실행 (Adaptive Replanning 포함)
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Orchestrator] Starting execution phase with', plan.steps.length, 'steps');
      let currentPlan = plan;
      let stepIndex = 0;
      let replanAttempts = 0;
      const MAX_REPLAN_ATTEMPTS = 3;

      while (stepIndex < currentPlan.steps.length) {
        const step = currentPlan.steps[stepIndex];
        console.log('[Orchestrator] Executing step', step.stepNumber, ':', step.description);

        // 중단 요청 확인
        if (this.abortController.signal.aborted) {
          return {
            success: false,
            plan: currentPlan,
            executedSteps,
            createdCells,
            modifiedCells,
            error: '사용자에 의해 취소됨',
            totalAttempts: this.countTotalAttempts(executedSteps),
            executionTime: Date.now() - startTime,
          };
        }

        onProgress({
          phase: 'executing',
          currentStep: step.stepNumber,
          totalSteps: currentPlan.totalSteps,
          description: step.description,
        });

        const stepResult = await this.executeStepWithRetry(
          step,
          notebook,
          onProgress
        );

        // 생성/수정된 셀 추적 및 하이라이트/스크롤
        stepResult.toolResults.forEach((tr) => {
          if (tr.cellIndex !== undefined) {
            if (tr.wasModified) {
              modifiedCells.push(tr.cellIndex);
            } else {
              createdCells.push(tr.cellIndex);
            }
            // 셀 하이라이트 및 스크롤
            this.scrollToAndHighlightCell(tr.cellIndex);
          }
        });

        // 단계 실패 시 Adaptive Replanning 시도
        if (!stepResult.success) {
          console.log('[Orchestrator] Step failed, attempting adaptive replanning');

          if (replanAttempts >= MAX_REPLAN_ATTEMPTS) {
            onProgress({
              phase: 'failed',
              message: `최대 재계획 시도 횟수(${MAX_REPLAN_ATTEMPTS})를 초과했습니다.`,
              failedStep: step.stepNumber,  // 실패한 step UI에 표시
            });
            return {
              success: false,
              plan: currentPlan,
              executedSteps,
              createdCells,
              modifiedCells,
              error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
              totalAttempts: this.countTotalAttempts(executedSteps),
              executionTime: Date.now() - startTime,
            };
          }

          // 실패 정보 구성 (errorName 포함 - ModuleNotFoundError 등 식별용)
          const executionError: ExecutionError = {
            type: 'runtime',
            message: stepResult.error || '알 수 없는 오류',
            errorName: stepResult.toolResults.find(r => r.errorName)?.errorName,
            traceback: stepResult.toolResults.find(r => r.traceback)?.traceback || [],
            recoverable: true,
          };

          // 에러 타입에서 핵심 정보 추출
          const errorName = executionError.errorName || '런타임 에러';
          const shortErrorMsg = executionError.message.length > 80
            ? executionError.message.substring(0, 80) + '...'
            : executionError.message;

          onProgress({
            phase: 'replanning',
            message: `에러 분석 중: ${errorName}`,
            currentStep: step.stepNumber,
            failedStep: step.stepNumber,
            replanInfo: {
              errorType: errorName,
              rootCause: shortErrorMsg,
            },
          });

          // 마지막 실행 출력
          const lastOutput = stepResult.toolResults
            .map(r => r.output)
            .filter(Boolean)
            .join('\n');

          try {
            const replanResponse = await this.apiService.replanExecution({
              originalRequest: userRequest,
              executedSteps: executedSteps.map(s => currentPlan.steps.find(p => p.stepNumber === s.stepNumber)!).filter(Boolean),
              failedStep: step,
              error: executionError,
              executionOutput: lastOutput,
            });

            console.log('[Orchestrator] Replan decision:', replanResponse.decision);
            console.log('[Orchestrator] Replan reasoning:', replanResponse.reasoning);

            // ★ 결정 결과를 UI에 즉시 반영 (에러 분석 → 결정 완료)
            const decisionLabel = this.getReplanDecisionLabel(replanResponse.decision);
            // ModuleNotFoundError일 때 패키지명 추출
            const missingPackage = errorName === 'ModuleNotFoundError'
              ? this.extractMissingPackage(executionError.message)
              : undefined;

            onProgress({
              phase: 'replanning',
              message: `결정: ${decisionLabel}`,
              currentStep: step.stepNumber,
              failedStep: step.stepNumber,
              replanInfo: {
                errorType: errorName,
                rootCause: shortErrorMsg,
                decision: replanResponse.decision,
                reasoning: replanResponse.reasoning,
                missingPackage,
              },
            });

            // 실패한 스텝에서 생성된 셀 인덱스 추출 (재사용 위해)
            const failedCellIndex = stepResult.toolResults.find(r => r.cellIndex !== undefined)?.cellIndex;
            console.log('[Orchestrator] Failed cell index for reuse:', failedCellIndex);

            // Replan 결과에 따른 계획 수정 (실패한 셀 인덱스 전달)
            currentPlan = this.applyReplanChanges(
              currentPlan,
              stepIndex,
              replanResponse,
              failedCellIndex
            );

            // ★ 업데이트된 계획을 UI에 반영 (plan item list에 새 스텝 표시)
            onProgress({
              phase: 'planned',
              plan: currentPlan,
              message: `계획 수정됨 (${this.getReplanDecisionLabel(replanResponse.decision)})`,
              currentStep: step.stepNumber,
              totalSteps: currentPlan.totalSteps,
            });

            replanAttempts++;
            // stepIndex는 그대로 유지 (수정된 현재 단계를 다시 실행)
            continue;
          } catch (replanError: any) {
            console.error('[Orchestrator] Replan failed:', replanError);
            onProgress({
              phase: 'failed',
              message: `Step ${step.stepNumber} 실패 (재계획 실패): ${stepResult.error}`,
            });
            return {
              success: false,
              plan: currentPlan,
              executedSteps,
              createdCells,
              modifiedCells,
              error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
              totalAttempts: this.countTotalAttempts(executedSteps),
              executionTime: Date.now() - startTime,
            };
          }
        }

        // 성공한 단계 기록
        executedSteps.push(stepResult);
        replanAttempts = 0; // 성공 시 재계획 시도 횟수 리셋

        // ★ 성공한 Step에서 정의된 변수 추적 (cross-step validation용)
        this.trackVariablesFromStep(step);

        // ═══════════════════════════════════════════════════════════════════════
        // STATE VERIFICATION (Phase 1): 상태 검증 레이어
        // ═══════════════════════════════════════════════════════════════════════
        if (this.enableStateVerification && stepResult.toolResults.length > 0) {
          const stateVerificationResult = await this.verifyStepStateAfterExecution(
            step,
            stepResult,
            onProgress
          );

          // 검증 결과에 따른 처리
          if (stateVerificationResult) {
            const { recommendation, confidence } = stateVerificationResult;
            console.log('[Orchestrator] State verification result:', {
              confidence,
              recommendation,
              isValid: stateVerificationResult.isValid,
            });

            // 권장 사항에 따른 액션
            if (recommendation === 'replan') {
              console.log('[Orchestrator] State verification recommends replan (confidence:', confidence, ')');
              // Replan을 위한 에러 상태로 전환 (다음 반복에서 replanning 트리거)
              onProgress({
                phase: 'replanning',
                message: `상태 검증 신뢰도 낮음: ${(confidence * 100).toFixed(0)}%`,
                currentStep: step.stepNumber,
                replanInfo: {
                  errorType: 'StateVerificationFailed',
                  rootCause: stateVerificationResult.mismatches.map(m => m.description).join('; '),
                },
              });
              // Note: 현재는 로깅만 수행, 향후 자동 replanning 트리거 구현
            } else if (recommendation === 'escalate') {
              console.log('[Orchestrator] State verification recommends escalation (confidence:', confidence, ')');
              onProgress({
                phase: 'failed',
                message: `상태 검증 실패 - 사용자 개입 필요: ${stateVerificationResult.mismatches.map(m => m.description).join(', ')}`,
              });
              // 심각한 상태 불일치 시 실행 중단
              return {
                success: false,
                plan: currentPlan,
                executedSteps,
                createdCells,
                modifiedCells,
                error: `상태 검증 실패 (신뢰도: ${(confidence * 100).toFixed(0)}%): ${stateVerificationResult.mismatches.map(m => m.description).join('; ')}`,
                totalAttempts: this.countTotalAttempts(executedSteps),
                executionTime: Date.now() - startTime,
              };
            } else if (recommendation === 'warning') {
              console.log('[Orchestrator] State verification warning (confidence:', confidence, ')');
              onProgress({
                phase: 'verifying',
                message: `상태 검증 경고: ${(confidence * 100).toFixed(0)}% 신뢰도`,
                currentStep: step.stepNumber,
              });
            }
            // 'proceed'는 별도 처리 없이 계속 진행
          }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // REFLECTION: 실행 결과 분석 및 적응적 조정
        // ═══════════════════════════════════════════════════════════════════════
        if (this.enableReflection && stepResult.toolResults.length > 0) {
          // Reflection 시작 알림
          onProgress({
            phase: 'reflecting',
            reflectionStatus: 'analyzing',
            currentStep: step.stepNumber,
            message: '실행 결과 분석 중...',
          });

          const remainingSteps = currentPlan.steps.slice(stepIndex + 1);
          const reflection = await this.performReflection(step, stepResult.toolResults, remainingSteps);

          if (reflection) {
            const { shouldContinue, action, reason } = this.shouldContinueAfterReflection(reflection);
            console.log('[Orchestrator] Reflection decision:', { shouldContinue, action, reason });

            // Reflection 결과 UI 업데이트
            if (reflection.evaluation.checkpoint_passed) {
              onProgress({
                phase: 'reflecting',
                reflectionStatus: 'passed',
                currentStep: step.stepNumber,
                message: '검증 통과',
              });
            } else {
              onProgress({
                phase: 'reflecting',
                reflectionStatus: 'adjusting',
                currentStep: step.stepNumber,
                message: `조정 권고: ${reason}`,
              });
            }

            // Reflection 결과가 retry 또는 replan을 요구하면 해당 로직으로 이동
            if (!shouldContinue) {
              if (action === 'replan') {
                console.log('[Orchestrator] Reflection recommends replan, triggering adaptive replanning');
              } else if (action === 'retry') {
                console.log('[Orchestrator] Reflection recommends retry - but step succeeded, continuing');
              }
            }
          }
        }

        // 다음 스텝 전에 지연 적용 (사용자가 결과를 확인할 시간)
        await this.applyStepDelay();

        // final_answer 도구 호출 시 완료
        if (stepResult.isFinalAnswer) {
          onProgress({
            phase: 'completed',
            message: stepResult.finalAnswer || '작업 완료',
          });

          return {
            success: true,
            plan: currentPlan,
            executedSteps,
            createdCells,
            modifiedCells,
            finalAnswer: stepResult.finalAnswer,
            totalAttempts: this.countTotalAttempts(executedSteps),
            executionTime: Date.now() - startTime,
          };
        }

        stepIndex++;
      }

      // 모든 단계 성공
      onProgress({
        phase: 'completed',
        message: '모든 단계 성공적으로 완료',
      });

      return {
        success: true,
        plan,
        executedSteps,
        createdCells,
        modifiedCells,
        totalAttempts: this.countTotalAttempts(executedSteps),
        executionTime: Date.now() - startTime,
      };
    } catch (error: any) {
      onProgress({
        phase: 'failed',
        message: error.message || '알 수 없는 오류 발생',
      });

      return {
        success: false,
        plan: null,
        executedSteps,
        createdCells,
        modifiedCells,
        error: error.message || '알 수 없는 오류 발생',
        totalAttempts: this.countTotalAttempts(executedSteps),
        executionTime: Date.now() - startTime,
      };
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * 출력 결과가 부정적인지 분석 (에러는 아니지만 실패 의미를 가진 출력)
   * Fast Fail: 모든 에러 → Adaptive Replanning으로 처리
   */
  private analyzeOutputForFailure(output: string): {
    isNegative: boolean;
    reason?: string;
  } {
    if (!output) {
      return { isNegative: false };
    }

    const negativePatterns = [
      // 환경/의존성 에러
      { pattern: /ModuleNotFoundError/i, reason: '모듈을 찾을 수 없음 (패키지 설치 필요)' },
      { pattern: /ImportError/i, reason: 'import 에러 (패키지 설치 필요)' },
      { pattern: /No module named/i, reason: '모듈이 없음 (패키지 설치 필요)' },
      { pattern: /cannot import name/i, reason: 'import 실패' },
      // 파일/경로 관련 오류
      { pattern: /FileNotFoundError|No such file or directory|파일을 찾을 수 없습니다/i, reason: '파일을 찾을 수 없음' },
      // 런타임 에러
      { pattern: /NameError:\s*name\s*'([^']+)'\s*is not defined/i, reason: '변수가 정의되지 않음' },
      { pattern: /KeyError/i, reason: '키를 찾을 수 없음' },
      { pattern: /IndexError/i, reason: '인덱스 범위 초과' },
      { pattern: /TypeError/i, reason: '타입 오류' },
      { pattern: /ValueError/i, reason: '값 오류' },
      { pattern: /AttributeError/i, reason: '속성 오류' },
      // 데이터 검증 에러 (GridSearchCV, NaN/Inf 등)
      { pattern: /사전\s*검증.*실패|사전\s*검증.*오류|pre-?validation.*fail|validation.*fail/i, reason: '사전 검증 실패' },
      { pattern: /NaN.*값|Inf.*값|invalid value|contains NaN|contains Inf/i, reason: 'NaN 또는 Inf 값 감지' },
      { pattern: /수행되지\s*않음|was not performed|did not execute|not executed/i, reason: '실행되지 않음' },
      { pattern: /fit.*fail|GridSearchCV.*fail|학습.*실패/i, reason: '모델 학습 실패' },
      // 명시적 실패 메시지
      { pattern: /실패|failed|Fail/i, reason: '명시적 오류 메시지 감지' },
      { pattern: /not found|cannot find|찾을 수 없/i, reason: '리소스를 찾을 수 없음' },
      // Note: Empty DataFrame, 0 rows 등은 정상적인 분석 결과일 수 있으므로 부정적 패턴에서 제외
    ];

    for (const { pattern, reason } of negativePatterns) {
      if (pattern.test(output)) {
        console.log('[Orchestrator] Negative output detected:', reason);
        return { isNegative: true, reason };
      }
    }

    return { isNegative: false };
  }

  /**
   * 단계 실행 (Fast Fail 방식)
   * 에러 발생 시 재시도 없이 바로 실패 반환 → Adaptive Replanning으로 처리
   * + Pre-Validation: 실행 전 Pyflakes/AST 검증
   */
  private async executeStepWithRetry(
    step: PlanStep,
    notebook: NotebookPanel,
    onProgress: (status: AgentStatus) => void
  ): Promise<StepResult> {
    console.log('[Orchestrator] executeStep called for step:', step.stepNumber);
    console.log('[Orchestrator] Step toolCalls:', JSON.stringify(step.toolCalls, null, 2));

    const toolResults: ToolResult[] = [];

    try {
      // Tool Calling 실행
      console.log('[Orchestrator] Processing', step.toolCalls.length, 'tool calls');
      for (const toolCall of step.toolCalls) {
        console.log('[Orchestrator] Processing toolCall:', toolCall.tool);

        // 중단 요청 확인
        if (this.abortController?.signal.aborted) {
          return {
            success: false,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: 1,
            error: '사용자에 의해 취소됨',
          };
        }

        onProgress({
          phase: 'tool_calling',
          tool: toolCall.tool,
          attempt: 1,
          currentStep: step.stepNumber,
        });

        // jupyter_cell인 경우: 안전성 검사 + Pre-Validation
        if (toolCall.tool === 'jupyter_cell') {
          const params = toolCall.parameters as JupyterCellParams;

          // 1. 안전성 검사
          const safetyResult = this.safetyChecker.checkCodeSafety(params.code);
          if (!safetyResult.safe) {
            return {
              success: false,
              stepNumber: step.stepNumber,
              toolResults,
              attempts: 1,
              error: `안전성 검사 실패: ${safetyResult.blockedPatterns?.join(', ')}`,
            };
          }

          // 2. Pre-Validation (Pyflakes/AST 기반)
          onProgress({
            phase: 'validating',
            validationStatus: 'checking',
            currentStep: step.stepNumber,
            message: '코드 품질 검증 중...',
          });

          const validation = await this.validateCodeBeforeExecution(params.code);

          if (validation) {
            if (validation.hasErrors) {
              // ★ 디버깅용 상세 로그 (robust version)
              console.log('');
              console.log('╔══════════════════════════════════════════════════════════════╗');
              console.log('║  🔴 [Orchestrator] PRE-VALIDATION FAILED                     ║');
              console.log('╠══════════════════════════════════════════════════════════════╣');
              console.log(`║  Step: ${step.stepNumber} - ${step.description?.substring(0, 45) || 'N/A'}...`);
              console.log(`║  Summary: ${validation.summary || 'No summary'}`);
              console.log('╠══════════════════════════════════════════════════════════════╣');
              console.log('║  Code:');
              console.log('║  ' + (params.code || '').split('\n').join('\n║  '));
              console.log('╠══════════════════════════════════════════════════════════════╣');
              console.log('║  Issues:');
              if (validation.issues && validation.issues.length > 0) {
                validation.issues.forEach((issue, idx) => {
                  console.log(`║    ${idx + 1}. [${issue.severity || 'unknown'}] ${issue.category || 'unknown'}: ${issue.message || 'no message'}`);
                  if (issue.line) console.log(`║       Line ${issue.line}${issue.column ? `:${issue.column}` : ''}`);
                  if (issue.code_snippet) console.log(`║       Snippet: ${issue.code_snippet}`);
                });
              } else {
                console.log('║    (No issues array available)');
              }
              if (validation.dependencies) {
                console.log('╠══════════════════════════════════════════════════════════════╣');
                console.log('║  Dependencies:', JSON.stringify(validation.dependencies));
              }
              console.log('╚══════════════════════════════════════════════════════════════╝');
              console.log('');

              onProgress({
                phase: 'validating',
                validationStatus: 'failed',
                currentStep: step.stepNumber,
                message: `검증 실패: ${validation.summary}`,
              });

              // Fast Fail: 검증 오류 → 바로 Adaptive Replanning
              return {
                success: false,
                stepNumber: step.stepNumber,
                toolResults,
                attempts: 1,
                error: `사전 검증 오류: ${validation.summary}`,
              };
            } else if (validation.hasWarnings) {
              console.log('[Orchestrator] ⚠️ Pre-validation warnings:', validation.issues.map(i => i.message).join('; '));
              onProgress({
                phase: 'validating',
                validationStatus: 'warning',
                currentStep: step.stepNumber,
                message: `경고 감지: ${validation.issues.length}건 (실행 계속)`,
              });
            } else {
              console.log('[Orchestrator] ✅ Pre-validation passed for step', step.stepNumber);
              onProgress({
                phase: 'validating',
                validationStatus: 'passed',
                currentStep: step.stepNumber,
                message: '코드 검증 통과',
              });
            }
          }
        }

        // 타임아웃과 함께 실행 (stepNumber 전달)
        console.log('[Orchestrator] Calling toolExecutor.executeTool for:', toolCall.tool, 'step:', step.stepNumber);
        const result = await this.executeWithTimeout(
          () => this.toolExecutor.executeTool(toolCall, step.stepNumber),
          this.config.executionTimeout
        );
        console.log('[Orchestrator] Tool execution result:', JSON.stringify(result));

        toolResults.push(result);

        // jupyter_cell 실행 실패 시 → Fast Fail
        if (!result.success && toolCall.tool === 'jupyter_cell') {
          const errorMsg = result.error || '알 수 없는 오류';
          console.log('[Orchestrator] jupyter_cell execution failed:', errorMsg.substring(0, 100));

          return {
            success: false,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: 1,
            error: errorMsg,
          };
        }

        // final_answer 도구 감지
        if (toolCall.tool === 'final_answer') {
          let finalAnswerText = result.output as string;

          // ★ 변수 값 추출 및 치환
          try {
            // finalAnswer에서 {변수명} 패턴 찾기
            const varPattern = /\{(\w+)\}/g;
            const matches = [...finalAnswerText.matchAll(varPattern)];
            const varNames = [...new Set(matches.map(m => m[1]))];

            if (varNames.length > 0) {
              console.log('[Orchestrator] Extracting variable values for finalAnswer:', varNames);
              // Jupyter kernel에서 변수 값 추출
              const variableValues = await this.toolExecutor.getVariableValues(varNames);
              console.log('[Orchestrator] Extracted variable values:', variableValues);

              // 변수 치환
              finalAnswerText = finalAnswerText.replace(varPattern, (match, varName) => {
                return variableValues[varName] ?? match;
              });
              console.log('[Orchestrator] Final answer after substitution:', finalAnswerText);
            }
          } catch (error) {
            console.error('[Orchestrator] Failed to substitute variables in finalAnswer:', error);
            // 실패해도 원본 텍스트 사용
          }

          return {
            success: true,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: 1,
            isFinalAnswer: true,
            finalAnswer: finalAnswerText,
          };
        }
      }

      // 모든 도구 실행 성공
      if (toolResults.length > 0 && toolResults.every((r) => r.success)) {
        // 출력 결과 분석: 실행은 성공했지만 출력이 부정적인 경우
        const allOutputs = toolResults
          .map((r) => {
            const output = r.output;
            if (!output) return '';
            if (typeof output === 'string') return output;
            if (typeof output === 'object' && output !== null) {
              // Jupyter output format: {text/plain: ..., text/html: ...}
              if ('text/plain' in output) {
                const textPlain = (output as Record<string, unknown>)['text/plain'];
                return typeof textPlain === 'string' ? textPlain : String(textPlain || '');
              }
              try {
                return JSON.stringify(output);
              } catch {
                return '[object]';
              }
            }
            // Primitive types (number, boolean, etc.)
            try {
              return String(output);
            } catch {
              return '[unknown]';
            }
          })
          .join('\n');
        const outputAnalysis = this.analyzeOutputForFailure(allOutputs);

        if (outputAnalysis.isNegative) {
          console.log('[Orchestrator] Negative output detected:', outputAnalysis.reason);

          // Fast Fail: 부정적 출력 → 바로 Adaptive Replanning
          return {
            success: false,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: 1,
            error: outputAnalysis.reason || '출력 결과에서 문제 감지',
          };
        }

        return {
          success: true,
          stepNumber: step.stepNumber,
          toolResults,
          attempts: 1,
        };
      }

      // 도구 실행 결과가 없는 경우
      return {
        success: false,
        stepNumber: step.stepNumber,
        toolResults,
        attempts: 1,
        error: '도구 실행 결과 없음',
      };

    } catch (error: any) {
      const isTimeout = error.message?.includes('timeout');

      if (isTimeout) {
        // 타임아웃 시 커널 인터럽트
        await this.toolExecutor.interruptKernel();
      }

      return {
        success: false,
        stepNumber: step.stepNumber,
        toolResults,
        attempts: 1,
        error: error.message || '알 수 없는 오류',
      };
    }
  }

  /**
   * 노트북 컨텍스트 추출
   */
  private extractNotebookContext(notebook: NotebookPanel): NotebookContext {
    const cells = notebook.content.model?.cells;
    const cellCount = cells?.length || 0;

    // 최근 3개 셀 정보 추출
    const recentCells: CellContext[] = [];
    if (cells) {
      const startIndex = Math.max(0, cellCount - 3);
      for (let i = startIndex; i < cellCount; i++) {
        const cell = cells.get(i);
        recentCells.push({
          index: i,
          type: cell.type as 'code' | 'markdown',
          source: cell.sharedModel.getSource().slice(0, 500), // 처음 500자만
          output: this.toolExecutor.getCellOutput(i).slice(0, 300), // 처음 300자만
        });
      }
    }

    return {
      cellCount,
      recentCells,
      importedLibraries: this.detectImportedLibraries(notebook),
      definedVariables: this.detectDefinedVariables(notebook),
      notebookPath: notebook.context?.path,
    };
  }

  /**
   * import된 라이브러리 감지
   */
  private detectImportedLibraries(notebook: NotebookPanel): string[] {
    const libraries = new Set<string>();
    const cells = notebook.content.model?.cells;

    if (!cells) return [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells.get(i);
      if (cell.type === 'code') {
        const source = cell.sharedModel.getSource();
        // import xxx 패턴
        const importMatches = source.matchAll(/^import\s+(\w+)/gm);
        for (const match of importMatches) {
          libraries.add(match[1]);
        }
        // from xxx import 패턴
        const fromMatches = source.matchAll(/^from\s+(\w+)/gm);
        for (const match of fromMatches) {
          libraries.add(match[1]);
        }
      }
    }

    return Array.from(libraries);
  }

  /**
   * 정의된 변수 감지
   *
   * ★ 수정: 인덴트된 코드 (try/except, with, if 블록 내부)에서도 변수 감지
   * 기존 regex: /^(\w+)\s*=/gm - 라인 시작에서만 매칭
   * 수정 regex: /^[ \t]*(\w+)\s*=/gm - 인덴트된 할당문도 매칭
   */
  private detectDefinedVariables(notebook: NotebookPanel): string[] {
    const variables = new Set<string>();
    const cells = notebook.content.model?.cells;

    if (!cells) return [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells.get(i);
      if (cell.type === 'code') {
        const source = cell.sharedModel.getSource();
        // ★ 인덴트 허용하는 할당 패턴: [공백/탭]* variable = ...
        const assignMatches = source.matchAll(/^[ \t]*(\w+)\s*=/gm);
        for (const match of assignMatches) {
          // 예약어 및 비교 연산자 제외
          // == 는 비교연산자이므로 제외 (예: if x == 1)
          const varName = match[1];
          if (!['if', 'for', 'while', 'def', 'class', 'import', 'from', 'elif', 'return', 'yield', 'assert', 'raise', 'del', 'pass', 'break', 'continue', 'global', 'nonlocal', 'lambda', 'with', 'as', 'try', 'except', 'finally'].includes(varName)) {
            // == 비교 연산자 체크 (matchAll 결과에서 원래 문자열 확인)
            const fullMatch = match[0];
            if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('<=') && !fullMatch.includes('>=')) {
              variables.add(varName);
            }
          }
        }

        // ★ 추가: 튜플 언패킹 패턴도 감지 (예: x, y = func())
        const tupleMatches = source.matchAll(/^[ \t]*(\w+(?:\s*,\s*\w+)+)\s*=/gm);
        for (const match of tupleMatches) {
          const tupleVars = match[1].split(',').map(v => v.trim());
          for (const varName of tupleVars) {
            if (varName && /^\w+$/.test(varName)) {
              variables.add(varName);
            }
          }
        }

        // ★ 추가: for 루프 변수 감지 (예: for x in items:, for i, v in enumerate())
        const forMatches = source.matchAll(/^[ \t]*for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+/gm);
        for (const match of forMatches) {
          const loopVars = match[1].split(',').map(v => v.trim());
          for (const varName of loopVars) {
            if (varName && /^\w+$/.test(varName)) {
              variables.add(varName);
            }
          }
        }

        // ★ 추가: with 문 변수 감지 (예: with open() as f:)
        const withMatches = source.matchAll(/^[ \t]*with\s+.*\s+as\s+(\w+)/gm);
        for (const match of withMatches) {
          variables.add(match[1]);
        }

        // ★ 추가: except 문 변수 감지 (예: except Exception as e:)
        const exceptMatches = source.matchAll(/^[ \t]*except\s+.*\s+as\s+(\w+)/gm);
        for (const match of exceptMatches) {
          variables.add(match[1]);
        }
      }
    }

    return Array.from(variables);
  }

  /**
   * ★ 단일 코드 문자열에서 정의된 변수 추출
   * detectDefinedVariables와 동일한 로직을 단일 코드 블록에 적용
   */
  private extractVariablesFromCode(code: string): string[] {
    const variables = new Set<string>();
    const reservedWords = ['if', 'for', 'while', 'def', 'class', 'import', 'from', 'elif', 'return', 'yield', 'assert', 'raise', 'del', 'pass', 'break', 'continue', 'global', 'nonlocal', 'lambda', 'with', 'as', 'try', 'except', 'finally'];

    // 인덴트 허용하는 할당 패턴
    const assignMatches = code.matchAll(/^[ \t]*(\w+)\s*=/gm);
    for (const match of assignMatches) {
      const varName = match[1];
      if (!reservedWords.includes(varName)) {
        const fullMatch = match[0];
        if (!fullMatch.includes('==') && !fullMatch.includes('!=') && !fullMatch.includes('<=') && !fullMatch.includes('>=')) {
          variables.add(varName);
        }
      }
    }

    // 튜플 언패킹
    const tupleMatches = code.matchAll(/^[ \t]*(\w+(?:\s*,\s*\w+)+)\s*=/gm);
    for (const match of tupleMatches) {
      const tupleVars = match[1].split(',').map(v => v.trim());
      for (const varName of tupleVars) {
        if (varName && /^\w+$/.test(varName)) {
          variables.add(varName);
        }
      }
    }

    // for 루프 변수
    const forMatches = code.matchAll(/^[ \t]*for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+/gm);
    for (const match of forMatches) {
      const loopVars = match[1].split(',').map(v => v.trim());
      for (const varName of loopVars) {
        if (varName && /^\w+$/.test(varName)) {
          variables.add(varName);
        }
      }
    }

    // with 문 변수
    const withMatches = code.matchAll(/^[ \t]*with\s+.*\s+as\s+(\w+)/gm);
    for (const match of withMatches) {
      variables.add(match[1]);
    }

    // except 문 변수
    const exceptMatches = code.matchAll(/^[ \t]*except\s+.*\s+as\s+(\w+)/gm);
    for (const match of exceptMatches) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * ★ 코드에서 import된 이름들 추출
   * - import xxx → xxx
   * - import xxx as yyy → yyy
   * - from xxx import yyy → yyy
   * - from xxx import yyy as zzz → zzz
   * - from xxx import * 는 제외 (추적 불가)
   */
  private extractImportsFromCode(code: string): string[] {
    const imports = new Set<string>();

    // import xxx 또는 import xxx as yyy
    const importMatches = code.matchAll(/^[ \t]*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm);
    for (const match of importMatches) {
      const asName = match[2]; // as 별칭
      const name = match[1];   // 원래 이름
      if (asName) {
        imports.add(asName);
      } else {
        // import pandas.DataFrame 같은 경우 pandas만 추출
        imports.add(name.split('.')[0]);
      }
    }

    // from xxx import yyy, zzz 또는 from xxx import yyy as aaa
    const fromImportMatches = code.matchAll(/^[ \t]*from\s+[\w.]+\s+import\s+(.+)$/gm);
    for (const match of fromImportMatches) {
      const importList = match[1];
      if (importList.trim() === '*') continue; // from xxx import * 제외

      // 여러 import 처리 (예: from sklearn import train_test_split, cross_val_score)
      const items = importList.split(',');
      for (const item of items) {
        const trimmed = item.trim();
        // as 별칭이 있는 경우: yyy as zzz
        const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          imports.add(asMatch[2]); // 별칭 사용
        } else if (/^\w+$/.test(trimmed)) {
          imports.add(trimmed);
        }
      }
    }

    return Array.from(imports);
  }

  /**
   * ★ 실행된 Step의 코드에서 변수와 import를 추적
   */
  private trackVariablesFromStep(step: PlanStep): void {
    for (const toolCall of step.toolCalls) {
      if (toolCall.tool === 'jupyter_cell') {
        const params = toolCall.parameters as JupyterCellParams;

        // 변수 추적
        const vars = this.extractVariablesFromCode(params.code);
        vars.forEach(v => this.executedStepVariables.add(v));

        // ★ import 추적
        const imports = this.extractImportsFromCode(params.code);
        imports.forEach(i => this.executedStepImports.add(i));

        console.log('[Orchestrator] Tracked from step', step.stepNumber, '- vars:', vars, 'imports:', imports);
      }
    }
  }

  /**
   * Adaptive Replanning 결과 적용
   *
   * ★ 순차 실행 원칙: 모든 새 셀은 항상 맨 끝에 추가됨
   * - 기존 셀 재사용(cellIndex 주입) 제거 → 항상 새 셀 생성
   * - 이렇게 하면 셀이 항상 위에서 아래로 순서대로 추가됨
   */
  private applyReplanChanges(
    plan: ExecutionPlan,
    currentStepIndex: number,
    replanResponse: AutoAgentReplanResponse,
    failedCellIndex?: number  // 이제 사용하지 않음 (API 호환성 유지)
  ): ExecutionPlan {
    const { decision, changes } = replanResponse;
    const steps = [...plan.steps];
    const currentStep = steps[currentStepIndex];

    console.log('[Orchestrator] Applying replan changes:', decision, '(always append new cells)');

    switch (decision) {
      case 'refine':
        // 현재 단계의 코드만 수정 - 기존 셀 수정 (MODIFY 작업)
        if (changes.refined_code) {
          const newToolCalls = currentStep.toolCalls.map(tc => {
            if (tc.tool === 'jupyter_cell') {
              const params = tc.parameters as JupyterCellParams;
              return {
                ...tc,
                parameters: {
                  ...params,
                  code: changes.refined_code!,
                  // ★ cellIndex 보존: 기존 셀 또는 실패한 셀을 수정
                  cellIndex: params.cellIndex ?? failedCellIndex,
                  operation: 'MODIFY' as CellOperation,
                },
              };
            }
            return tc;
          });
          steps[currentStepIndex] = {
            ...currentStep,
            toolCalls: newToolCalls,
            wasReplanned: true,  // Replan으로 수정됨 표시
            cellOperation: 'MODIFY',
            targetCellIndex: failedCellIndex,
          };
        }
        break;

      case 'insert_steps':
        // 새로운 단계들을 현재 위치에 삽입 (예: pip install)
        // 실행 시 모든 셀은 순차적으로 맨 끝에 추가됨
        if (changes.new_steps && changes.new_steps.length > 0) {
          const newSteps = changes.new_steps.map((newStep, idx) => ({
            ...newStep,
            stepNumber: currentStep.stepNumber + idx * 0.1, // 임시 번호
            isNew: true, // Replan으로 새로 추가된 스텝 표시
            cellOperation: 'CREATE' as CellOperation,  // 새 셀 생성
          }));

          steps.splice(currentStepIndex, 0, ...newSteps);
          // 단계 번호 재정렬
          steps.forEach((step, idx) => {
            step.stepNumber = idx + 1;
          });
        }
        break;

      case 'replace_step':
        // 현재 단계를 완전히 교체 - 새 셀 생성
        if (changes.replacement) {
          const replacementStep: PlanStep = {
            ...changes.replacement,
            stepNumber: currentStep.stepNumber,
            toolCalls: changes.replacement.toolCalls || [],
            isReplaced: true,  // 교체된 스텝 표시
            cellOperation: 'CREATE' as CellOperation,  // 새 셀 생성
          };
          // cellIndex 속성 명시적 제거 (새 셀 생성)
          replacementStep.toolCalls.forEach(tc => {
            if (tc.tool === 'jupyter_cell' && tc.parameters) {
              delete (tc.parameters as any).cellIndex;
              (tc.parameters as JupyterCellParams).operation = 'CREATE';
            }
          });
          steps[currentStepIndex] = replacementStep;
        }
        break;

      case 'replan_remaining':
        // 현재 단계부터 끝까지 새로운 계획으로 교체
        if (changes.new_plan && changes.new_plan.length > 0) {
          const existingSteps = steps.slice(0, currentStepIndex);
          const newPlanSteps = changes.new_plan.map((newStep, idx) => ({
            ...newStep,
            stepNumber: currentStepIndex + idx + 1,
            isNew: true, // Replan으로 새로 추가된 스텝 표시
            cellOperation: 'CREATE' as CellOperation,  // 새 셀 생성
          }));

          // 새 계획에 final_answer가 없으면 경고 로그
          const hasFinalAnswer = newPlanSteps.some(step =>
            step.toolCalls?.some((tc: ToolCall) => tc.tool === 'final_answer')
          );
          if (!hasFinalAnswer) {
            console.warn('[Orchestrator] replan_remaining: new_plan does not include final_answer');
          }

          steps.length = 0;
          steps.push(...existingSteps, ...newPlanSteps);
        }
        break;
    }

    return {
      ...plan,
      steps,
      totalSteps: steps.length,
    };
  }

  /**
   * 총 시도 횟수 계산
   */
  private countTotalAttempts(steps: StepResult[]): number {
    return steps.reduce((sum, step) => sum + step.attempts, 0);
  }

  /**
   * 타임아웃 래퍼
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`실행 타임아웃 (${timeoutMs}ms)`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 지연 유틸리티
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 실행 취소
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * 실행 상태 확인
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<AutoAgentConfig>): void {
    this.config = { ...this.config, ...config };
    this.safetyChecker.updateConfig({
      enableSafetyCheck: this.config.enableSafetyCheck,
      maxExecutionTime: this.config.executionTimeout / 1000,
    });
    // ToolExecutor 자동 스크롤 설정 동기화
    if (config.autoScrollToCell !== undefined) {
      this.toolExecutor.setAutoScroll(this.config.autoScrollToCell);
    }
  }

  /**
   * 현재 실행 중인 셀로 스크롤 및 하이라이트
   */
  private scrollToAndHighlightCell(cellIndex: number): void {
    if (!this.config.autoScrollToCell && !this.config.highlightCurrentCell) {
      return;
    }

    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex];

    if (!cell) return;

    // 셀로 스크롤
    if (this.config.autoScrollToCell) {
      cell.node.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }

    // 셀 하이라이트 (CSS 클래스 추가)
    if (this.config.highlightCurrentCell) {
      // 기존 하이라이트 제거
      notebookContent.widgets.forEach((w) => {
        w.node.classList.remove('aa-cell-executing');
      });
      // 새 하이라이트 추가
      cell.node.classList.add('aa-cell-executing');

      // 실행 완료 후 하이라이트 제거 (지연 후)
      setTimeout(() => {
        cell.node.classList.remove('aa-cell-executing');
      }, this.getEffectiveDelay() + 500);
    }
  }

  /**
   * 현재 설정에 맞는 지연 시간 반환
   */
  private getEffectiveDelay(): number {
    // executionSpeed 프리셋 사용 (stepDelay는 무시하고 프리셋 값을 우선)
    const presetDelay = EXECUTION_SPEED_DELAYS[this.config.executionSpeed];
    if (presetDelay !== undefined) {
      return presetDelay;
    }
    // 프리셋이 없으면 stepDelay 사용
    return this.config.stepDelay || 0;
  }

  /**
   * 스텝 사이 지연 적용 (step-by-step 모드 포함)
   */
  private async applyStepDelay(): Promise<void> {
    const delay = this.getEffectiveDelay();
    console.log(`[Orchestrator] applyStepDelay called: speed=${this.config.executionSpeed}, delay=${delay}ms`);

    // step-by-step 모드: 사용자가 다음 버튼을 누를 때까지 대기
    if (this.config.executionSpeed === 'step-by-step' || delay < 0) {
      this.isPaused = true;
      await new Promise<void>((resolve) => {
        this.stepByStepResolver = resolve;
      });
      this.isPaused = false;
      this.stepByStepResolver = null;
      return;
    }

    // 일반 지연
    if (delay > 0) {
      await this.delay(delay);
    }
  }

  /**
   * Step-by-step 모드에서 다음 스텝 진행
   */
  proceedToNextStep(): void {
    if (this.stepByStepResolver) {
      this.stepByStepResolver();
    }
  }

  /**
   * 일시 정지 상태 확인
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 현재 실행 속도 설정 반환
   */
  getExecutionSpeed(): string {
    return this.config.executionSpeed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Code Validation & Reflection Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 실행 전 코드 검증 (Pyflakes/AST 기반)
   *
   * @param code 검증할 코드
   * @returns 검증 결과
   */
  private async validateCodeBeforeExecution(code: string): Promise<AutoAgentValidateResponse | null> {
    if (!this.enablePreValidation) {
      return null;
    }

    try {
      console.log('[Orchestrator] Pre-validation: Checking code quality');
      const notebookContext = this.extractNotebookContext(this.notebook);

      // ★ 이전 Step에서 추적된 변수들을 notebookContext에 병합
      const allDefinedVariables = new Set([
        ...notebookContext.definedVariables,
        ...this.executedStepVariables,
      ]);
      notebookContext.definedVariables = Array.from(allDefinedVariables);

      // ★ 이전 Step에서 추적된 import들을 notebookContext에 병합
      const allImportedLibraries = new Set([
        ...notebookContext.importedLibraries,
        ...this.executedStepImports,
      ]);
      notebookContext.importedLibraries = Array.from(allImportedLibraries);

      console.log('[Orchestrator] Validation context - tracked vars:', Array.from(this.executedStepVariables));
      console.log('[Orchestrator] Validation context - tracked imports:', Array.from(this.executedStepImports));

      const validationResult = await this.apiService.validateCode({
        code,
        notebookContext,
      });

      console.log('[Orchestrator] Validation result:', {
        valid: validationResult.valid,
        hasErrors: validationResult.hasErrors,
        issueCount: validationResult.issues.length,
      });

      return validationResult;
    } catch (error: any) {
      console.warn('[Orchestrator] Pre-validation failed:', error.message);
      // 검증 실패 시에도 실행은 계속 진행 (graceful degradation)
      return null;
    }
  }

  /**
   * 실행 후 Reflection 수행
   *
   * @param step 실행된 단계
   * @param toolResults 도구 실행 결과
   * @param remainingSteps 남은 단계들
   * @returns Reflection 결과
   */
  private async performReflection(
    step: PlanStep | EnhancedPlanStep,
    toolResults: ToolResult[],
    remainingSteps: PlanStep[]
  ): Promise<ReflectionResult | null> {
    if (!this.enableReflection) {
      return null;
    }

    try {
      // jupyter_cell 실행 결과 추출
      const jupyterResult = toolResults.find(r => r.cellIndex !== undefined);
      if (!jupyterResult) {
        return null;
      }

      // 실행된 코드 추출
      const jupyterToolCall = step.toolCalls.find(tc => tc.tool === 'jupyter_cell');
      const executedCode = jupyterToolCall
        ? (jupyterToolCall.parameters as JupyterCellParams).code
        : '';

      // Checkpoint 정보 추출 (EnhancedPlanStep인 경우)
      const enhancedStep = step as EnhancedPlanStep;
      const checkpoint = enhancedStep.checkpoint;

      // ★ 프론트엔드에서 먼저 출력 분석 수행
      const outputString = (() => {
        const output = jupyterResult.output;
        if (!output) return '';
        if (typeof output === 'string') return output;
        if (typeof output === 'object' && output !== null) {
          if ('text/plain' in output) {
            const textPlain = (output as Record<string, unknown>)['text/plain'];
            return typeof textPlain === 'string' ? textPlain : String(textPlain || '');
          }
          try {
            return JSON.stringify(output);
          } catch {
            return '[object]';
          }
        }
        // Primitive types (number, boolean, etc.)
        try {
          return String(output);
        } catch {
          return '[unknown]';
        }
      })();
      const localOutputAnalysis = this.analyzeOutputForFailure(outputString);

      // 부정적 출력이 감지되면 에러 메시지에 추가
      let effectiveErrorMessage = jupyterResult.error;
      let effectiveStatus = jupyterResult.success ? 'ok' : 'error';

      if (localOutputAnalysis.isNegative) {
        console.log('[Orchestrator] Reflection: Local output analysis detected issue:', localOutputAnalysis.reason);
        effectiveErrorMessage = effectiveErrorMessage
          ? `${effectiveErrorMessage}; 출력 분석: ${localOutputAnalysis.reason}`
          : `출력 분석: ${localOutputAnalysis.reason}`;
        // 실행은 성공했지만 출력이 부정적인 경우도 'error'로 표시
        if (jupyterResult.success && localOutputAnalysis.isNegative) {
          effectiveStatus = 'warning';  // 백엔드에 경고 상태 전달
        }
      }

      console.log('[Orchestrator] Performing reflection for step', step.stepNumber);

      const reflectResponse = await this.apiService.reflectOnExecution({
        stepNumber: step.stepNumber,
        stepDescription: step.description,
        executedCode,
        executionStatus: effectiveStatus,
        executionOutput: outputString,
        errorMessage: effectiveErrorMessage,
        expectedOutcome: checkpoint?.expectedOutcome,
        validationCriteria: checkpoint?.validationCriteria,
        remainingSteps,
      });

      console.log('[Orchestrator] Reflection result:', {
        checkpointPassed: reflectResponse.reflection.evaluation.checkpoint_passed,
        confidenceScore: reflectResponse.reflection.evaluation.confidence_score,
        action: reflectResponse.reflection.recommendations.action,
      });

      return reflectResponse.reflection;
    } catch (error: any) {
      console.warn('[Orchestrator] Reflection failed:', error.message);
      // Reflection 실패 시에도 실행은 계속 진행
      return null;
    }
  }

  /**
   * Reflection 결과에 따른 액션 결정
   *
   * @param reflection Reflection 결과
   * @returns true면 계속 진행, false면 재시도/재계획 필요
   */
  private shouldContinueAfterReflection(reflection: ReflectionResult | null): {
    shouldContinue: boolean;
    action: ReflectionAction;
    reason: string;
  } {
    if (!reflection) {
      return { shouldContinue: true, action: 'continue', reason: 'No reflection data' };
    }

    const { evaluation, recommendations } = reflection;

    // Checkpoint 통과 및 신뢰도 70% 이상이면 계속 진행
    if (evaluation.checkpoint_passed && evaluation.confidence_score >= 0.7) {
      return {
        shouldContinue: true,
        action: 'continue',
        reason: 'Checkpoint passed with high confidence'
      };
    }

    // Recommendation에 따른 결정
    switch (recommendations.action) {
      case 'continue':
        return {
          shouldContinue: true,
          action: 'continue',
          reason: recommendations.reasoning
        };

      case 'adjust':
        // 경미한 조정은 계속 진행 (다음 단계에서 보정)
        return {
          shouldContinue: true,
          action: 'adjust',
          reason: recommendations.reasoning
        };

      case 'retry':
        return {
          shouldContinue: false,
          action: 'retry',
          reason: recommendations.reasoning
        };

      case 'replan':
        return {
          shouldContinue: false,
          action: 'replan',
          reason: recommendations.reasoning
        };

      default:
        return { shouldContinue: true, action: 'continue', reason: 'Default continue' };
    }
  }

  /**
   * 검증 결과에 따른 코드 자동 수정 시도
   *
   * @param code 원본 코드
   * @param validation 검증 결과
   * @returns 수정된 코드 (수정 불가 시 null)
   */
  private async attemptAutoFix(
    code: string,
    validation: AutoAgentValidateResponse
  ): Promise<string | null> {
    // 자동 수정 가능한 경우만 처리
    const autoFixableIssues = validation.issues.filter(
      issue => issue.category === 'unused_import' || issue.category === 'unused_variable'
    );

    // 심각한 오류가 있으면 자동 수정 불가
    if (validation.hasErrors) {
      return null;
    }

    // 경고만 있는 경우 코드 그대로 반환 (실행 가능)
    if (!validation.hasErrors && autoFixableIssues.length > 0) {
      console.log('[Orchestrator] Code has warnings but is executable');
      return code;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE VERIFICATION Methods (Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 스텝 실행 후 상태 검증
   * @param step 실행된 스텝
   * @param stepResult 스텝 실행 결과
   * @param onProgress 진행 상태 콜백
   * @returns 상태 검증 결과 또는 null (검증 불가 시)
   */
  private async verifyStepStateAfterExecution(
    step: PlanStep,
    stepResult: StepResult,
    onProgress: (status: AgentStatus) => void
  ): Promise<StateVerificationResult | null> {
    // jupyter_cell 실행 결과만 검증
    const jupyterResult = stepResult.toolResults.find(r => r.cellIndex !== undefined);
    if (!jupyterResult) {
      return null;
    }

    // Progress 업데이트: 검증 시작
    onProgress({
      phase: 'verifying',
      message: '상태 검증 중...',
      currentStep: step.stepNumber,
    });

    try {
      // 실행된 코드 추출
      const jupyterToolCall = step.toolCalls.find(tc => tc.tool === 'jupyter_cell');
      const executedCode = jupyterToolCall
        ? (jupyterToolCall.parameters as JupyterCellParams).code
        : '';

      // 출력 문자열 생성
      const outputString = this.extractOutputString(jupyterResult.output);

      // 노트북 컨텍스트에서 현재 변수 목록 추출
      const notebookContext = this.extractNotebookContext(this.notebook);

      // 실행 결과 객체 생성 (StateVerifier 인터페이스에 맞춤)
      const executionResult: ExecutionResult = {
        status: jupyterResult.success ? 'ok' : 'error',
        stdout: outputString,
        stderr: '',  // Jupyter에서 stderr는 별도로 제공되지 않음
        result: jupyterResult.output ? String(jupyterResult.output) : '',
        error: jupyterResult.error ? {
          ename: jupyterResult.errorName || 'Error',
          evalue: jupyterResult.error,
          traceback: jupyterResult.traceback || [],
        } : undefined,
        executionTime: 0,  // 실행 시간은 별도 추적 필요
        cellIndex: jupyterResult.cellIndex ?? -1,
      };

      // 상태 기대 정보 추출 (step.checkpoint 또는 expectedOutcome이 있는 경우)
      const enhancedStep = step as EnhancedPlanStep;
      const expectation: StateExpectation | undefined = enhancedStep.checkpoint
        ? {
            stepNumber: step.stepNumber,
            expectedVariables: this.extractVariablesFromCode(executedCode),
            expectedOutputPatterns: enhancedStep.checkpoint.validationCriteria,
          }
        : undefined;

      // 검증 컨텍스트 생성
      const verificationContext: VerificationContext = {
        stepNumber: step.stepNumber,
        executionResult,
        expectation,
        previousVariables: Array.from(this.executedStepVariables),
        currentVariables: notebookContext.definedVariables,
        notebookContext,
      };

      // 상태 검증 수행
      const verificationResult = await this.stateVerifier.verifyStepState(verificationContext);

      // Progress 업데이트: 검증 완료
      const statusMessage = verificationResult.isValid
        ? `검증 통과 (${(verificationResult.confidence * 100).toFixed(0)}%)`
        : `검증 경고: ${verificationResult.mismatches.length}건 감지`;

      onProgress({
        phase: 'verifying',
        message: statusMessage,
        currentStep: step.stepNumber,
      });

      return verificationResult;
    } catch (error: any) {
      console.warn('[Orchestrator] State verification failed:', error.message);
      // 검증 실패 시에도 실행은 계속 진행 (graceful degradation)
      return null;
    }
  }

  /**
   * 출력 객체에서 문자열 추출
   */
  private extractOutputString(output: any): string {
    if (!output) return '';
    if (typeof output === 'string') return output;
    if (typeof output === 'object' && output !== null) {
      if ('text/plain' in output) {
        const textPlain = output['text/plain'];
        return typeof textPlain === 'string' ? textPlain : String(textPlain || '');
      }
      try {
        return JSON.stringify(output);
      } catch {
        return '[object]';
      }
    }
    try {
      return String(output);
    } catch {
      return '[unknown]';
    }
  }

  /**
   * Validation & Reflection 설정 업데이트
   */
  setValidationEnabled(enabled: boolean): void {
    this.enablePreValidation = enabled;
    console.log('[Orchestrator] Pre-validation:', enabled ? 'enabled' : 'disabled');
  }

  setReflectionEnabled(enabled: boolean): void {
    this.enableReflection = enabled;
    console.log('[Orchestrator] Reflection:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * ★ State Verification 설정 업데이트 (Phase 1)
   */
  setStateVerificationEnabled(enabled: boolean): void {
    this.enableStateVerification = enabled;
    console.log('[Orchestrator] State verification:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * 현재 설정 확인
   */
  getValidationEnabled(): boolean {
    return this.enablePreValidation;
  }

  getReflectionEnabled(): boolean {
    return this.enableReflection;
  }

  /**
   * ★ State Verification 설정 확인 (Phase 1)
   */
  getStateVerificationEnabled(): boolean {
    return this.enableStateVerification;
  }

  /**
   * ★ State Verification 이력 조회 (Phase 1)
   */
  getStateVerificationHistory(count: number = 5): StateVerificationResult[] {
    return this.stateVerifier.getRecentHistory(count);
  }

  /**
   * ★ State Verification 트렌드 분석 (Phase 1)
   */
  getStateVerificationTrend(): {
    average: number;
    trend: 'improving' | 'declining' | 'stable';
    criticalCount: number;
  } {
    return this.stateVerifier.analyzeConfidenceTrend();
  }

  /**
   * Replan decision 레이블 반환
   */
  private getReplanDecisionLabel(decision: ReplanDecision): string {
    switch (decision) {
      case 'refine':
        return '코드 수정';
      case 'insert_steps':
        return '단계 추가';
      case 'replace_step':
        return '단계 교체';
      case 'replan_remaining':
        return '남은 계획 재수립';
      default:
        return decision;
    }
  }

  /**
   * ModuleNotFoundError 메시지에서 패키지 이름 추출
   */
  private extractMissingPackage(errorMessage: string): string | undefined {
    // "No module named 'plotly'" 패턴
    const match = errorMessage.match(/No module named ['"]([\w\-_.]+)['"]/);
    if (match) {
      return match[1];
    }
    // "ModuleNotFoundError: plotly" 패턴
    const altMatch = errorMessage.match(/ModuleNotFoundError:\s*([\w\-_.]+)/);
    if (altMatch) {
      return altMatch[1];
    }
    return undefined;
  }
}

export default AgentOrchestrator;
