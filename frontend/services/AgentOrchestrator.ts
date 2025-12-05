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
  // Validation & Reflection Types
  AutoAgentValidateResponse,
  ReflectionResult,
  ReflectionAction,
  EnhancedPlanStep,
  Checkpoint,
} from '../types/auto-agent';

export class AgentOrchestrator {
  private apiService: ApiService;
  private toolExecutor: ToolExecutor;
  private safetyChecker: SafetyChecker;
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
    this.config = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config };

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

          onProgress({
            phase: 'replanning',
            message: '계획 수정 중...',
            currentStep: step.stepNumber,
          });

          // 실패 정보 구성
          const executionError: ExecutionError = {
            type: 'runtime',
            message: stepResult.error || '알 수 없는 오류',
            traceback: stepResult.toolResults.find(r => r.traceback)?.traceback || [],
            recoverable: true,
          };

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

            // Replan 결과에 따른 계획 수정
            currentPlan = this.applyReplanChanges(
              currentPlan,
              stepIndex,
              replanResponse
            );

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
            const confidencePercent = Math.round(reflection.evaluation.confidence_score * 100);

            if (reflection.evaluation.checkpoint_passed) {
              onProgress({
                phase: 'reflecting',
                reflectionStatus: 'passed',
                currentStep: step.stepNumber,
                confidenceScore: confidencePercent,
                message: `검증 통과 (신뢰도: ${confidencePercent}%)`,
              });
            } else {
              onProgress({
                phase: 'reflecting',
                reflectionStatus: 'adjusting',
                currentStep: step.stepNumber,
                confidenceScore: confidencePercent,
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
   * 환경/의존성 관련 에러인지 판단 (Adaptive Replanning으로 바로 보내야 하는 에러)
   */
  private isEnvironmentError(errorMessage: string, traceback?: string[]): boolean {
    const envErrorPatterns = [
      /ModuleNotFoundError/i,
      /ImportError/i,
      /No module named/i,
      /cannot import name/i,
      /FileNotFoundError/i,
      /PermissionError/i,
      /OSError/i,
      /ConnectionError/i,
      /pip install/i,
      /conda install/i,
    ];

    const fullText = [errorMessage, ...(traceback || [])].join('\n');
    return envErrorPatterns.some(pattern => pattern.test(fullText));
  }

  /**
   * Self-Healing: 단계별 재시도 로직
   * 환경/의존성 에러는 재시도하지 않고 바로 Adaptive Replanning으로 보냄
   * + Pre-Validation: 실행 전 Pyflakes/AST 검증
   */
  private async executeStepWithRetry(
    step: PlanStep,
    notebook: NotebookPanel,
    onProgress: (status: AgentStatus) => void
  ): Promise<StepResult> {
    console.log('[Orchestrator] executeStepWithRetry called for step:', step.stepNumber);
    console.log('[Orchestrator] Step toolCalls:', JSON.stringify(step.toolCalls, null, 2));
    let lastError: ExecutionError | null = null;
    let currentStep = { ...step };

    for (let attempt = 0; attempt < this.config.maxRetriesPerStep; attempt++) {
      console.log('[Orchestrator] Attempt', attempt + 1, 'of', this.config.maxRetriesPerStep);
      const toolResults: ToolResult[] = [];

      try {
        // Tool Calling 실행
        console.log('[Orchestrator] Processing', currentStep.toolCalls.length, 'tool calls');
        for (const toolCall of currentStep.toolCalls) {
          console.log('[Orchestrator] Processing toolCall:', toolCall.tool);
          // 중단 요청 확인
          if (this.abortController?.signal.aborted) {
            return {
              success: false,
              stepNumber: step.stepNumber,
              toolResults,
              attempts: attempt + 1,
              error: '사용자에 의해 취소됨',
            };
          }

          onProgress({
            phase: 'tool_calling',
            tool: toolCall.tool,
            attempt: attempt + 1,
            currentStep: step.stepNumber,
          });

          // jupyter_cell인 경우: 안전성 검사 + Pre-Validation
          if (toolCall.tool === 'jupyter_cell') {
            const params = toolCall.parameters as JupyterCellParams;

            // 1. 기존 안전성 검사
            const safetyResult = this.safetyChecker.checkCodeSafety(params.code);
            if (!safetyResult.safe) {
              return {
                success: false,
                stepNumber: step.stepNumber,
                toolResults,
                attempts: attempt + 1,
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
                console.log('[Orchestrator] Pre-validation detected errors:', validation.summary);

                onProgress({
                  phase: 'validating',
                  validationStatus: 'failed',
                  currentStep: step.stepNumber,
                  message: `검증 실패: ${validation.summary}`,
                });

                // 검증 오류가 있으면 Self-Healing으로 수정 시도
                lastError = {
                  type: 'validation',
                  message: `사전 검증 오류: ${validation.summary}`,
                  traceback: validation.issues.map(i => `Line ${i.line || '?'}: [${i.category}] ${i.message}`),
                  recoverable: true,
                };

                // 다음 재시도에서 LLM에게 수정 요청
                break;
              } else if (validation.hasWarnings) {
                onProgress({
                  phase: 'validating',
                  validationStatus: 'warning',
                  currentStep: step.stepNumber,
                  message: `경고 감지: ${validation.issues.length}건 (실행 계속)`,
                });
              } else {
                onProgress({
                  phase: 'validating',
                  validationStatus: 'passed',
                  currentStep: step.stepNumber,
                  message: '코드 검증 통과',
                });
              }
            }
          }

          // 타임아웃과 함께 실행
          console.log('[Orchestrator] Calling toolExecutor.executeTool for:', toolCall.tool);
          console.log('[Orchestrator] toolCall parameters:', JSON.stringify(toolCall.parameters));
          const result = await this.executeWithTimeout(
            () => this.toolExecutor.executeTool(toolCall),
            this.config.executionTimeout
          );
          console.log('[Orchestrator] Tool execution result:', JSON.stringify(result));

          toolResults.push(result);

          // jupyter_cell 실행 실패 시
          if (!result.success && toolCall.tool === 'jupyter_cell') {
            const errorMsg = result.error || '알 수 없는 오류';
            const isEnvError = this.isEnvironmentError(errorMsg, result.traceback);

            lastError = {
              type: isEnvError ? 'validation' : 'runtime', // 환경 에러는 validation 타입으로 표시
              message: errorMsg,
              traceback: result.traceback || [],
              recoverable: !isEnvError, // 환경 에러는 Self-Healing으로 복구 불가
            };

            // 환경/의존성 에러는 Self-Healing 재시도 없이 바로 실패 반환
            // → 메인 루프에서 Adaptive Replanning 호출
            if (isEnvError) {
              console.log('[Orchestrator] Environment error detected, skipping to Adaptive Replanning');
              return {
                success: false,
                stepNumber: step.stepNumber,
                toolResults,
                attempts: attempt + 1,
                error: errorMsg,
              };
            }

            break;
          }

          // final_answer 도구 감지
          if (toolCall.tool === 'final_answer') {
            return {
              success: true,
              stepNumber: step.stepNumber,
              toolResults,
              attempts: attempt + 1,
              isFinalAnswer: true,
              finalAnswer: result.output as string,
            };
          }
        }

        // 모든 도구 실행 성공
        if (toolResults.every((r) => r.success)) {
          return {
            success: true,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: attempt + 1,
          };
        }

        // 일반 런타임 에러 발생 시 LLM에게 수정 요청 (Self-Healing)
        if (lastError && lastError.recoverable && attempt < this.config.maxRetriesPerStep - 1) {
          onProgress({
            phase: 'self_healing',
            attempt: attempt + 1,
            error: lastError,
            currentStep: step.stepNumber,
          });

          // 마지막으로 실행된 코드 추출
          const lastJupyterCell = currentStep.toolCalls.find(
            (tc) => tc.tool === 'jupyter_cell'
          );
          const previousCode = lastJupyterCell
            ? (lastJupyterCell.parameters as JupyterCellParams).code
            : undefined;

          // LLM에게 수정된 코드 요청
          const refineResponse = await this.apiService.refineStepCode({
            step: currentStep,
            error: lastError,
            attempt: attempt + 1,
            previousCode,
          });

          currentStep.toolCalls = refineResponse.toolCalls;
        }
      } catch (error: any) {
        const isTimeout = error.message?.includes('timeout');
        lastError = {
          type: isTimeout ? 'timeout' : 'runtime',
          message: error.message,
          recoverable: !isTimeout,
        };

        if (isTimeout) {
          // 타임아웃 시 커널 인터럽트
          await this.toolExecutor.interruptKernel();
        }
      }

      // Exponential backoff
      if (attempt < this.config.maxRetriesPerStep - 1) {
        await this.delay(1000 * Math.pow(2, attempt));
      }
    }

    return {
      success: false,
      stepNumber: step.stepNumber,
      toolResults: [],
      attempts: this.config.maxRetriesPerStep,
      error: lastError?.message || '알 수 없는 오류',
    };
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
   */
  private detectDefinedVariables(notebook: NotebookPanel): string[] {
    const variables = new Set<string>();
    const cells = notebook.content.model?.cells;

    if (!cells) return [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells.get(i);
      if (cell.type === 'code') {
        const source = cell.sharedModel.getSource();
        // 간단한 할당 패턴: variable = ...
        const assignMatches = source.matchAll(/^(\w+)\s*=/gm);
        for (const match of assignMatches) {
          // 예약어 제외
          if (!['if', 'for', 'while', 'def', 'class', 'import', 'from'].includes(match[1])) {
            variables.add(match[1]);
          }
        }
      }
    }

    return Array.from(variables);
  }

  /**
   * Adaptive Replanning 결과 적용
   */
  private applyReplanChanges(
    plan: ExecutionPlan,
    currentStepIndex: number,
    replanResponse: AutoAgentReplanResponse
  ): ExecutionPlan {
    const { decision, changes } = replanResponse;
    const steps = [...plan.steps];
    const currentStep = steps[currentStepIndex];

    console.log('[Orchestrator] Applying replan changes:', decision);

    switch (decision) {
      case 'refine':
        // 현재 단계의 코드만 수정
        if (changes.refined_code) {
          const newToolCalls = currentStep.toolCalls.map(tc => {
            if (tc.tool === 'jupyter_cell') {
              return {
                ...tc,
                parameters: {
                  ...(tc.parameters as JupyterCellParams),
                  code: changes.refined_code!,
                },
              };
            }
            return tc;
          });
          steps[currentStepIndex] = {
            ...currentStep,
            toolCalls: newToolCalls,
          };
        }
        break;

      case 'insert_steps':
        // 현재 단계 전에 새로운 단계들 삽입
        if (changes.new_steps && changes.new_steps.length > 0) {
          const newSteps = changes.new_steps.map((newStep, idx) => ({
            ...newStep,
            stepNumber: currentStep.stepNumber + idx * 0.1, // 임시 번호
          }));
          steps.splice(currentStepIndex, 0, ...newSteps);
          // 단계 번호 재정렬
          steps.forEach((step, idx) => {
            step.stepNumber = idx + 1;
          });
        }
        break;

      case 'replace_step':
        // 현재 단계를 완전히 교체
        if (changes.replacement) {
          steps[currentStepIndex] = {
            ...changes.replacement,
            stepNumber: currentStep.stepNumber,
          };
        }
        break;

      case 'replan_remaining':
        // 현재 단계부터 끝까지 새로운 계획으로 교체
        if (changes.new_plan && changes.new_plan.length > 0) {
          const existingSteps = steps.slice(0, currentStepIndex);
          const newPlanSteps = changes.new_plan.map((newStep, idx) => ({
            ...newStep,
            stepNumber: currentStepIndex + idx + 1,
          }));
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

      console.log('[Orchestrator] Performing reflection for step', step.stepNumber);

      const reflectResponse = await this.apiService.reflectOnExecution({
        stepNumber: step.stepNumber,
        stepDescription: step.description,
        executedCode,
        executionStatus: jupyterResult.success ? 'ok' : 'error',
        executionOutput: String(jupyterResult.output || ''),
        errorMessage: jupyterResult.error,
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
   * 현재 설정 확인
   */
  getValidationEnabled(): boolean {
    return this.enablePreValidation;
  }

  getReflectionEnabled(): boolean {
    return this.enableReflection;
  }
}

export default AgentOrchestrator;
