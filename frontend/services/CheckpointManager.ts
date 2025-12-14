/**
 * CheckpointManager - 체크포인트 생성 및 롤백 관리
 *
 * 각 성공 스텝 후 체크포인트 저장, 실패 시 롤백 가능
 * - 순환 버퍼 (기본 최대 10개)
 * - 생성된 셀 삭제, 수정된 셀 복원
 */

import type { NotebookPanel } from '@jupyterlab/notebook';

import {
  ExecutionCheckpoint,
  CellSnapshot,
  RollbackResult,
  CheckpointConfig,
  CheckpointManagerState,
  DEFAULT_CHECKPOINT_CONFIG,
  ExecutionPlan,
  StepResult,
  ToolResult,
} from '../types/auto-agent';

/**
 * CheckpointManager 클래스
 * 체크포인트 생성/조회/롤백 관리
 */
export class CheckpointManager {
  private config: CheckpointConfig;
  private checkpoints: Map<number, ExecutionCheckpoint>;  // stepNumber -> checkpoint
  private notebook: NotebookPanel;

  // 현재 실행 세션의 추적 정보
  private createdCellIndices: Set<number> = new Set();
  private modifiedCellIndices: Set<number> = new Set();
  private variableNames: Set<string> = new Set();

  constructor(notebook: NotebookPanel, config?: Partial<CheckpointConfig>) {
    this.notebook = notebook;
    this.config = {
      ...DEFAULT_CHECKPOINT_CONFIG,
      ...config,
    };
    this.checkpoints = new Map();
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<CheckpointConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
    console.log('[CheckpointManager] Config updated:', this.config);
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): CheckpointConfig {
    return { ...this.config };
  }

  /**
   * 새 실행 세션 시작 시 초기화
   */
  startNewSession(): void {
    this.checkpoints.clear();
    this.createdCellIndices.clear();
    this.modifiedCellIndices.clear();
    this.variableNames.clear();
    console.log('[CheckpointManager] New session started');
  }

  /**
   * 체크포인트 생성
   * 스텝 성공 후 호출
   */
  createCheckpoint(
    stepNumber: number,
    stepDescription: string,
    plan: ExecutionPlan,
    stepResult: StepResult,
    newVariables: string[] = []
  ): ExecutionCheckpoint {
    // 스텝 결과에서 생성/수정된 셀 추적
    stepResult.toolResults.forEach((tr: ToolResult) => {
      if (tr.cellIndex !== undefined) {
        if (tr.wasModified) {
          this.modifiedCellIndices.add(tr.cellIndex);
        } else {
          this.createdCellIndices.add(tr.cellIndex);
        }
      }
    });

    // 새 변수들 추적
    newVariables.forEach(v => this.variableNames.add(v));

    // 셀 스냅샷 생성
    const cellSnapshots = this.captureCellSnapshots(stepResult);

    const checkpoint: ExecutionCheckpoint = {
      id: `cp-${stepNumber}-${Date.now()}`,
      stepNumber,
      timestamp: Date.now(),
      description: stepDescription,
      planSnapshot: { ...plan },
      cellSnapshots,
      variableNames: Array.from(this.variableNames),
      createdCellIndices: Array.from(this.createdCellIndices),
      modifiedCellIndices: Array.from(this.modifiedCellIndices),
    };

    // 순환 버퍼: 최대 개수 초과 시 가장 오래된 체크포인트 삭제
    if (this.checkpoints.size >= this.config.maxCheckpoints) {
      const oldestStep = Math.min(...this.checkpoints.keys());
      this.checkpoints.delete(oldestStep);
      console.log(`[CheckpointManager] Removed oldest checkpoint: step ${oldestStep}`);
    }

    this.checkpoints.set(stepNumber, checkpoint);
    console.log(`[CheckpointManager] Created checkpoint for step ${stepNumber}`);

    return checkpoint;
  }

  /**
   * 셀 스냅샷 캡처
   */
  private captureCellSnapshots(stepResult: StepResult): CellSnapshot[] {
    const snapshots: CellSnapshot[] = [];
    const cells = this.notebook.content.model?.cells;

    if (!cells) return snapshots;

    stepResult.toolResults.forEach((tr: ToolResult) => {
      if (tr.cellIndex !== undefined && tr.cellIndex < cells.length) {
        const cell = cells.get(tr.cellIndex);
        const snapshot: CellSnapshot = {
          index: tr.cellIndex,
          type: cell.type as 'code' | 'markdown',
          source: cell.sharedModel.getSource(),
          outputs: this.getCellOutputs(tr.cellIndex),
          wasCreated: !tr.wasModified,
          wasModified: tr.wasModified || false,
          previousSource: tr.previousContent,
        };
        snapshots.push(snapshot);
      }
    });

    return snapshots;
  }

  /**
   * 셀 출력 가져오기
   */
  private getCellOutputs(cellIndex: number): any[] {
    const cells = this.notebook.content.model?.cells;
    if (!cells || cellIndex >= cells.length) return [];

    const cell = cells.get(cellIndex);
    if (cell.type !== 'code') return [];

    const outputs: any[] = [];
    const codeCell = cell as any;  // ICellModel doesn't expose outputs directly

    if (codeCell.outputs) {
      for (let i = 0; i < codeCell.outputs.length; i++) {
        outputs.push(codeCell.outputs.get(i)?.toJSON?.() || {});
      }
    }

    return outputs;
  }

  /**
   * 특정 체크포인트 조회
   */
  getCheckpoint(stepNumber: number): ExecutionCheckpoint | undefined {
    return this.checkpoints.get(stepNumber);
  }

  /**
   * 모든 체크포인트 조회
   */
  getAllCheckpoints(): ExecutionCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * 가장 최근 체크포인트 조회
   */
  getLatestCheckpoint(): ExecutionCheckpoint | undefined {
    if (this.checkpoints.size === 0) return undefined;
    const maxStep = Math.max(...this.checkpoints.keys());
    return this.checkpoints.get(maxStep);
  }

  /**
   * 특정 체크포인트로 롤백
   * - 해당 체크포인트 이후에 생성된 셀 삭제
   * - 해당 체크포인트 이후에 수정된 셀 복원
   */
  async rollbackTo(stepNumber: number): Promise<RollbackResult> {
    const checkpoint = this.checkpoints.get(stepNumber);

    if (!checkpoint) {
      return {
        success: false,
        rolledBackTo: -1,
        deletedCells: [],
        restoredCells: [],
        error: `Checkpoint for step ${stepNumber} not found`,
      };
    }

    console.log(`[CheckpointManager] Rolling back to step ${stepNumber}`);

    const cells = this.notebook.content.model?.cells;
    if (!cells) {
      return {
        success: false,
        rolledBackTo: stepNumber,
        deletedCells: [],
        restoredCells: [],
        error: 'Notebook cells not accessible',
      };
    }

    const deletedCells: number[] = [];
    const restoredCells: number[] = [];

    try {
      // 1. 체크포인트 이후에 생성된 셀들 식별 및 삭제
      const checkpointCreatedSet = new Set(checkpoint.createdCellIndices);
      const cellsToDelete = Array.from(this.createdCellIndices)
        .filter(idx => !checkpointCreatedSet.has(idx))
        .sort((a, b) => b - a);  // 뒤에서부터 삭제 (인덱스 변경 방지)

      for (const cellIndex of cellsToDelete) {
        if (cellIndex < cells.length) {
          this.notebook.content.model?.sharedModel.deleteCell(cellIndex);
          deletedCells.push(cellIndex);
          console.log(`[CheckpointManager] Deleted cell at index ${cellIndex}`);
        }
      }

      // 2. 체크포인트 이후에 수정된 셀들 복원
      const laterCheckpoints = Array.from(this.checkpoints.values())
        .filter(cp => cp.stepNumber > stepNumber);

      for (const laterCp of laterCheckpoints) {
        for (const snapshot of laterCp.cellSnapshots) {
          if (snapshot.wasModified && snapshot.previousSource !== undefined) {
            // 삭제로 인한 인덱스 조정 계산
            const deletedBefore = deletedCells.filter(d => d < snapshot.index).length;
            const adjustedIndex = snapshot.index - deletedBefore;

            if (adjustedIndex >= 0 && adjustedIndex < cells.length) {
              const cell = cells.get(adjustedIndex);
              cell.sharedModel.setSource(snapshot.previousSource);
              restoredCells.push(adjustedIndex);
              console.log(`[CheckpointManager] Restored cell at index ${adjustedIndex}`);
            }
          }
        }
      }

      // 3. 추적 상태 업데이트
      this.createdCellIndices = new Set(checkpoint.createdCellIndices);
      this.modifiedCellIndices = new Set(checkpoint.modifiedCellIndices);
      this.variableNames = new Set(checkpoint.variableNames);

      // 4. 롤백된 체크포인트 이후의 체크포인트들 삭제
      for (const [step, _] of this.checkpoints) {
        if (step > stepNumber) {
          this.checkpoints.delete(step);
        }
      }

      console.log(
        `[CheckpointManager] Rollback complete: deleted ${deletedCells.length} cells, ` +
        `restored ${restoredCells.length} cells`
      );

      return {
        success: true,
        rolledBackTo: stepNumber,
        deletedCells,
        restoredCells,
      };
    } catch (error: any) {
      console.error('[CheckpointManager] Rollback failed:', error);
      return {
        success: false,
        rolledBackTo: stepNumber,
        deletedCells,
        restoredCells,
        error: error.message || 'Unknown rollback error',
      };
    }
  }

  /**
   * 가장 최근 체크포인트로 롤백
   */
  async rollbackToLatest(): Promise<RollbackResult> {
    const latest = this.getLatestCheckpoint();
    if (!latest) {
      return {
        success: false,
        rolledBackTo: -1,
        deletedCells: [],
        restoredCells: [],
        error: 'No checkpoints available',
      };
    }
    return this.rollbackTo(latest.stepNumber);
  }

  /**
   * 특정 스텝 이전 체크포인트로 롤백
   */
  async rollbackBefore(stepNumber: number): Promise<RollbackResult> {
    const checkpointSteps = Array.from(this.checkpoints.keys())
      .filter(step => step < stepNumber)
      .sort((a, b) => b - a);

    if (checkpointSteps.length === 0) {
      return {
        success: false,
        rolledBackTo: -1,
        deletedCells: [],
        restoredCells: [],
        error: `No checkpoint found before step ${stepNumber}`,
      };
    }

    return this.rollbackTo(checkpointSteps[0]);
  }

  /**
   * 모든 체크포인트 삭제
   */
  clearAllCheckpoints(): void {
    this.checkpoints.clear();
    console.log('[CheckpointManager] All checkpoints cleared');
  }

  /**
   * 관리자 상태 반환
   */
  getState(): CheckpointManagerState {
    const steps = Array.from(this.checkpoints.keys()).sort((a, b) => a - b);
    return {
      config: { ...this.config },
      checkpointCount: this.checkpoints.size,
      oldestCheckpoint: steps.length > 0 ? steps[0] : undefined,
      latestCheckpoint: steps.length > 0 ? steps[steps.length - 1] : undefined,
    };
  }

  /**
   * 상태 출력 (디버깅용)
   */
  printStatus(): void {
    const state = this.getState();
    console.log('[CheckpointManager] Status:');
    console.log(`  - Max checkpoints: ${state.config.maxCheckpoints}`);
    console.log(`  - Checkpoint count: ${state.checkpointCount}`);
    console.log(`  - Oldest: step ${state.oldestCheckpoint ?? 'N/A'}`);
    console.log(`  - Latest: step ${state.latestCheckpoint ?? 'N/A'}`);
    console.log(`  - Created cells: ${Array.from(this.createdCellIndices).join(', ') || 'none'}`);
    console.log(`  - Modified cells: ${Array.from(this.modifiedCellIndices).join(', ') || 'none'}`);
  }

  /**
   * 현재 추적 중인 생성된 셀 인덱스들 반환
   */
  getCreatedCellIndices(): number[] {
    return Array.from(this.createdCellIndices);
  }

  /**
   * 현재 추적 중인 수정된 셀 인덱스들 반환
   */
  getModifiedCellIndices(): number[] {
    return Array.from(this.modifiedCellIndices);
  }

  /**
   * 현재 추적 중인 변수 이름들 반환
   */
  getVariableNames(): string[] {
    return Array.from(this.variableNames);
  }
}

export default CheckpointManager;
