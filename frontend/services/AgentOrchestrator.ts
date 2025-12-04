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
} from '../types/auto-agent';

export class AgentOrchestrator {
  private apiService: ApiService;
  private toolExecutor: ToolExecutor;
  private safetyChecker: SafetyChecker;
  private config: AutoAgentConfig;
  private abortController: AbortController | null = null;
  private isRunning: boolean = false;

  constructor(
    notebook: NotebookPanel,
    sessionContext: ISessionContext,
    apiService?: ApiService,
    config?: Partial<AutoAgentConfig>
  ) {
    this.apiService = apiService || new ApiService();
    this.toolExecutor = new ToolExecutor(notebook, sessionContext);
    this.safetyChecker = new SafetyChecker({
      enableSafetyCheck: config?.enableSafetyCheck ?? true,
      maxExecutionTime: (config?.executionTimeout ?? 30000) / 1000,
    });
    this.config = { ...DEFAULT_AUTO_AGENT_CONFIG, ...config };
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
      // PHASE 2: EXECUTION - 단계별 실행 (Self-Healing 포함)
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[Orchestrator] Starting execution phase with', plan.steps.length, 'steps');
      for (const step of plan.steps) {
        console.log('[Orchestrator] Executing step', step.stepNumber, ':', step.description);
        // 중단 요청 확인
        if (this.abortController.signal.aborted) {
          return {
            success: false,
            plan,
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
          totalSteps: plan.totalSteps,
          description: step.description,
        });

        const stepResult = await this.executeStepWithRetry(
          step,
          notebook,
          onProgress
        );

        executedSteps.push(stepResult);

        // 생성/수정된 셀 추적
        stepResult.toolResults.forEach((tr) => {
          if (tr.cellIndex !== undefined) {
            if (tr.wasModified) {
              modifiedCells.push(tr.cellIndex);
            } else {
              createdCells.push(tr.cellIndex);
            }
          }
        });

        // 단계 실패 시 중단
        if (!stepResult.success) {
          onProgress({
            phase: 'failed',
            message: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
          });

          return {
            success: false,
            plan,
            executedSteps,
            createdCells,
            modifiedCells,
            error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
            totalAttempts: this.countTotalAttempts(executedSteps),
            executionTime: Date.now() - startTime,
          };
        }

        // final_answer 도구 호출 시 완료
        if (stepResult.isFinalAnswer) {
          onProgress({
            phase: 'completed',
            message: stepResult.finalAnswer || '작업 완료',
          });

          return {
            success: true,
            plan,
            executedSteps,
            createdCells,
            modifiedCells,
            finalAnswer: stepResult.finalAnswer,
            totalAttempts: this.countTotalAttempts(executedSteps),
            executionTime: Date.now() - startTime,
          };
        }
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
   * Self-Healing: 단계별 재시도 로직
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

          // 안전성 검사 (jupyter_cell인 경우)
          if (toolCall.tool === 'jupyter_cell') {
            const params = toolCall.parameters as JupyterCellParams;
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

          // jupyter_cell 실행 실패 시 재시도 준비
          if (!result.success && toolCall.tool === 'jupyter_cell') {
            lastError = {
              type: 'runtime',
              message: result.error || '알 수 없는 오류',
              traceback: result.traceback || [],
              recoverable: true,
            };
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

        // 에러 발생 시 LLM에게 수정 요청
        if (lastError && attempt < this.config.maxRetriesPerStep - 1) {
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
  }
}

export default AgentOrchestrator;
