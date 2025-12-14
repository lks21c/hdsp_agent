/**
 * ContextManager - 컨텍스트 윈도우 관리
 *
 * 토큰 예산 관리 및 적응형 컨텍스트 축소로 LLM 호출 신뢰성 향상
 * - 토큰 추정 (chars / 4)
 * - 우선순위 기반 셀 관리
 * - 예산 초과 시 자동 축소
 */

import {
  NotebookContext,
  CellContext,
  CellPriority,
  PrioritizedCell,
  TokenUsageStats,
  ContextBudget,
  ContextManagerState,
  ContextPruneResult,
  DEFAULT_CONTEXT_BUDGET,
} from '../types/auto-agent';

/**
 * ContextManager 클래스
 * 컨텍스트 윈도우 관리 및 토큰 예산 관리
 */
export class ContextManager {
  private budget: ContextBudget;
  private lastUsage: TokenUsageStats | null = null;

  constructor(budget?: Partial<ContextBudget>) {
    this.budget = {
      ...DEFAULT_CONTEXT_BUDGET,
      ...budget,
    };
  }

  /**
   * 예산 설정 업데이트
   */
  updateBudget(budget: Partial<ContextBudget>): void {
    this.budget = {
      ...this.budget,
      ...budget,
    };
    console.log('[ContextManager] Budget updated:', this.budget);
  }

  /**
   * 현재 예산 설정 반환
   */
  getBudget(): ContextBudget {
    return { ...this.budget };
  }

  /**
   * 텍스트의 토큰 수 추정
   * 근사값: 문자 수 / 4
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * 셀 컨텍스트의 토큰 수 추정
   */
  estimateCellTokens(cell: CellContext): number {
    let tokens = this.estimateTokens(cell.source);
    if (cell.output) {
      tokens += this.estimateTokens(cell.output);
    }
    return tokens;
  }

  /**
   * 노트북 컨텍스트의 전체 토큰 사용량 계산
   */
  calculateUsage(context: NotebookContext): TokenUsageStats {
    const cellTokens = context.recentCells.reduce(
      (sum, cell) => sum + this.estimateCellTokens(cell),
      0
    );

    const variableTokens = this.estimateTokens(
      context.definedVariables.join(', ')
    );

    const libraryTokens = this.estimateTokens(
      context.importedLibraries.join(', ')
    );

    const totalTokens = cellTokens + variableTokens + libraryTokens;
    const availableTokens = this.budget.maxTokens - this.budget.reservedForResponse;
    const usagePercent = totalTokens / availableTokens;

    const usage: TokenUsageStats = {
      totalTokens,
      cellTokens,
      variableTokens,
      libraryTokens,
      reservedTokens: this.budget.reservedForResponse,
      usagePercent,
    };

    this.lastUsage = usage;
    return usage;
  }

  /**
   * 마지막 토큰 사용량 반환
   */
  getLastUsage(): TokenUsageStats | null {
    return this.lastUsage;
  }

  /**
   * 셀들에 우선순위 부여
   * - critical: currentCellIndex에 해당하는 셀
   * - high: 최근 3개 셀
   * - medium: 최근 5개 셀 (high 제외)
   * - low: 나머지 셀
   */
  prioritizeCells(
    cells: CellContext[],
    currentCellIndex?: number
  ): PrioritizedCell[] {
    if (cells.length === 0) return [];

    // 인덱스 기준 내림차순 정렬 (최근 셀이 앞으로)
    const sortedCells = [...cells].sort((a, b) => b.index - a.index);

    return sortedCells.map((cell, sortedIndex) => {
      let priority: CellPriority;

      // currentCellIndex가 지정된 경우 해당 셀은 critical
      if (currentCellIndex !== undefined && cell.index === currentCellIndex) {
        priority = 'critical';
      }
      // 최근 3개 셀은 high
      else if (sortedIndex < 3) {
        priority = 'high';
      }
      // 다음 5개 셀 (3-7)은 medium
      else if (sortedIndex < 8) {
        priority = 'medium';
      }
      // 나머지는 low
      else {
        priority = 'low';
      }

      return {
        ...cell,
        priority,
        tokenEstimate: this.estimateCellTokens(cell),
      };
    });
  }

  /**
   * 우선순위 레벨 숫자값 반환 (비교용)
   */
  private getPriorityValue(priority: CellPriority): number {
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 0;
    }
  }

  /**
   * 컨텍스트 축소 필요 여부 확인
   */
  isPruningRequired(context: NotebookContext): boolean {
    const usage = this.calculateUsage(context);
    const availableTokens = this.budget.maxTokens - this.budget.reservedForResponse;
    return usage.totalTokens > availableTokens;
  }

  /**
   * 경고 임계값 초과 여부 확인
   */
  isWarningThresholdExceeded(context: NotebookContext): boolean {
    const usage = this.calculateUsage(context);
    return usage.usagePercent >= this.budget.warningThreshold;
  }

  /**
   * 컨텍스트 축소
   * 우선순위가 낮은 셀부터 제거하거나 축소
   */
  pruneContext(
    context: NotebookContext,
    targetTokens?: number,
    currentCellIndex?: number
  ): { context: NotebookContext; result: ContextPruneResult } {
    const target = targetTokens ?? (this.budget.maxTokens - this.budget.reservedForResponse);
    const prioritizedCells = this.prioritizeCells(context.recentCells, currentCellIndex);

    // 현재 사용량 계산
    const originalUsage = this.calculateUsage(context);
    const originalTokens = originalUsage.totalTokens;

    // 이미 예산 내에 있으면 그대로 반환
    if (originalTokens <= target) {
      return {
        context,
        result: {
          originalTokens,
          prunedTokens: originalTokens,
          removedCellCount: 0,
          truncatedCellCount: 0,
          preservedCells: context.recentCells.map(c => c.index),
        },
      };
    }

    console.log(`[ContextManager] Pruning required: ${originalTokens} → ${target} tokens`);

    // 우선순위 순으로 정렬 (낮은 우선순위가 먼저 제거됨)
    const sortedByPriority = [...prioritizedCells].sort(
      (a, b) => this.getPriorityValue(a.priority) - this.getPriorityValue(b.priority)
    );

    const preservedCells: PrioritizedCell[] = [];
    let currentTokens = originalUsage.variableTokens + originalUsage.libraryTokens;
    let removedCount = 0;
    let truncatedCount = 0;

    // 우선순위 높은 것부터 유지 (역순으로 처리)
    for (let i = sortedByPriority.length - 1; i >= 0; i--) {
      const cell = sortedByPriority[i];
      const cellTokens = cell.tokenEstimate;

      // 예산 내에 들어가면 유지
      if (currentTokens + cellTokens <= target) {
        preservedCells.push(cell);
        currentTokens += cellTokens;
      }
      // critical 또는 high 우선순위는 축소해서라도 유지
      else if (cell.priority === 'critical' || cell.priority === 'high') {
        const remainingBudget = target - currentTokens;

        if (remainingBudget > 100) {  // 최소 100 토큰 이상 남아있어야 축소
          const truncatedSource = this.truncateText(
            cell.source,
            remainingBudget * 4  // 토큰 → 문자 변환
          );

          const truncatedCell: PrioritizedCell = {
            ...cell,
            source: truncatedSource,
            output: undefined,  // 출력은 제거
            tokenEstimate: this.estimateTokens(truncatedSource),
          };

          preservedCells.push(truncatedCell);
          currentTokens += truncatedCell.tokenEstimate;
          truncatedCount++;

          console.log(
            `[ContextManager] Truncated ${cell.priority} cell ${cell.index}: ` +
            `${cellTokens} → ${truncatedCell.tokenEstimate} tokens`
          );
        } else {
          removedCount++;
          console.log(
            `[ContextManager] Removed ${cell.priority} cell ${cell.index} ` +
            `(insufficient budget: ${remainingBudget} tokens)`
          );
        }
      }
      // 그 외 우선순위는 제거
      else {
        removedCount++;
        console.log(
          `[ContextManager] Removed ${cell.priority} cell ${cell.index}`
        );
      }
    }

    // 원래 인덱스 순서로 복원
    const prunedCells = preservedCells
      .sort((a, b) => a.index - b.index)
      .map(({ priority, tokenEstimate, ...cellContext }) => cellContext as CellContext);

    const prunedContext: NotebookContext = {
      ...context,
      recentCells: prunedCells,
    };

    const result: ContextPruneResult = {
      originalTokens,
      prunedTokens: currentTokens,
      removedCellCount: removedCount,
      truncatedCellCount: truncatedCount,
      preservedCells: prunedCells.map(c => c.index),
    };

    console.log(
      `[ContextManager] Pruning complete: ` +
      `${originalTokens} → ${currentTokens} tokens, ` +
      `removed ${removedCount}, truncated ${truncatedCount}`
    );

    return { context: prunedContext, result };
  }

  /**
   * 텍스트 축소 (마지막 부분 유지)
   */
  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    // 마지막 부분 유지 (최근 코드가 더 중요)
    const truncated = text.slice(-maxChars);

    // 줄 경계에서 자르기
    const firstNewline = truncated.indexOf('\n');
    if (firstNewline > 0 && firstNewline < maxChars * 0.2) {
      return '...\n' + truncated.slice(firstNewline + 1);
    }

    return '...' + truncated;
  }

  /**
   * 노트북 컨텍스트 추출 및 최적화
   * 예산을 초과하면 자동으로 축소
   */
  extractOptimizedContext(
    context: NotebookContext,
    currentCellIndex?: number
  ): { context: NotebookContext; usage: TokenUsageStats; pruneResult?: ContextPruneResult } {
    // 경고 임계값 체크
    if (this.isWarningThresholdExceeded(context)) {
      const usage = this.getLastUsage()!;
      console.log(
        `[ContextManager] Warning: Token usage at ${(usage.usagePercent * 100).toFixed(1)}% ` +
        `(threshold: ${this.budget.warningThreshold * 100}%)`
      );
    }

    // 축소 필요 여부 확인
    if (this.isPruningRequired(context)) {
      const { context: prunedContext, result } = this.pruneContext(
        context,
        undefined,
        currentCellIndex
      );
      const usage = this.calculateUsage(prunedContext);

      return {
        context: prunedContext,
        usage,
        pruneResult: result,
      };
    }

    return {
      context,
      usage: this.calculateUsage(context),
    };
  }

  /**
   * 관리자 상태 반환
   */
  getState(): ContextManagerState {
    return {
      budget: { ...this.budget },
      currentUsage: this.lastUsage ?? {
        totalTokens: 0,
        cellTokens: 0,
        variableTokens: 0,
        libraryTokens: 0,
        reservedTokens: this.budget.reservedForResponse,
        usagePercent: 0,
      },
      isPruningRequired: false,
      lastPruneTimestamp: undefined,
    };
  }

  /**
   * 상태 출력 (디버깅용)
   */
  printStatus(): void {
    console.log('[ContextManager] Status:');
    console.log(`  - Max tokens: ${this.budget.maxTokens}`);
    console.log(`  - Reserved for response: ${this.budget.reservedForResponse}`);
    console.log(`  - Warning threshold: ${this.budget.warningThreshold * 100}%`);

    if (this.lastUsage) {
      console.log(`  - Current usage: ${this.lastUsage.totalTokens} tokens`);
      console.log(`    - Cells: ${this.lastUsage.cellTokens}`);
      console.log(`    - Variables: ${this.lastUsage.variableTokens}`);
      console.log(`    - Libraries: ${this.lastUsage.libraryTokens}`);
      console.log(`  - Usage percent: ${(this.lastUsage.usagePercent * 100).toFixed(1)}%`);
    }
  }
}

export default ContextManager;
