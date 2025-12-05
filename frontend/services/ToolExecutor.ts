/**
 * ToolExecutor - HF Jupyter Agent 스타일의 Tool 실행기
 *
 * 3가지 도구 실행 및 결과 캡처:
 * - jupyter_cell: 코드 셀 생성/수정/실행
 * - markdown: 마크다운 셀 생성/수정
 * - final_answer: 작업 완료 신호
 */

import type { NotebookPanel, Notebook } from '@jupyterlab/notebook';
import { NotebookActions } from '@jupyterlab/notebook';
import type { ISessionContext } from '@jupyterlab/apputils';
import type { Cell, CodeCell, MarkdownCell } from '@jupyterlab/cells';
import { CodeCellModel, MarkdownCellModel } from '@jupyterlab/cells';

import {
  ToolName,
  ToolCall,
  ToolResult,
  JupyterCellParams,
  MarkdownParams,
  FinalAnswerParams,
  ExecutionResult,
} from '../types/auto-agent';

export class ToolExecutor {
  private notebook: NotebookPanel;
  private sessionContext: ISessionContext;
  private autoScrollEnabled: boolean = true;

  constructor(notebook: NotebookPanel, sessionContext: ISessionContext) {
    this.notebook = notebook;
    this.sessionContext = sessionContext;
  }

  /**
   * 자동 스크롤 설정
   */
  setAutoScroll(enabled: boolean): void {
    this.autoScrollEnabled = enabled;
  }

  /**
   * 특정 셀로 스크롤 및 포커스
   */
  scrollToCell(cellIndex: number): void {
    if (!this.autoScrollEnabled) return;

    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex];

    if (cell) {
      // 셀로 부드럽게 스크롤
      cell.node.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }

  /**
   * Tool 실행 라우터
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    console.log('[ToolExecutor] executeTool called:', JSON.stringify(call, null, 2));

    let result: ToolResult;
    switch (call.tool) {
      case 'jupyter_cell':
        console.log('[ToolExecutor] Executing jupyter_cell tool');
        result = await this.executeJupyterCell(call.parameters as JupyterCellParams);
        break;
      case 'markdown':
        console.log('[ToolExecutor] Executing markdown tool');
        result = await this.executeMarkdown(call.parameters as MarkdownParams);
        break;
      case 'final_answer':
        console.log('[ToolExecutor] Executing final_answer tool');
        result = await this.executeFinalAnswer(call.parameters as FinalAnswerParams);
        break;
      default:
        result = {
          success: false,
          error: `Unknown tool: ${(call as any).tool}`,
        };
    }

    console.log('[ToolExecutor] Tool result:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * jupyter_cell 도구: 셀 생성/수정/실행
   */
  async executeJupyterCell(params: JupyterCellParams): Promise<ToolResult> {
    console.log('[ToolExecutor] executeJupyterCell params:', params);
    const notebookContent = this.notebook.content;
    console.log('[ToolExecutor] notebook content available:', !!notebookContent);
    console.log('[ToolExecutor] notebook model available:', !!notebookContent?.model);
    let cellIndex: number;
    let wasModified = false;

    try {
      if (params.cellIndex !== undefined) {
        // 기존 셀 수정
        console.log('[ToolExecutor] Modifying existing cell at index:', params.cellIndex);
        cellIndex = params.cellIndex;
        this.updateCellContent(cellIndex, params.code);
        wasModified = true;
      } else {
        // 새 셀 생성
        console.log('[ToolExecutor] Creating new code cell');
        cellIndex = await this.createCodeCell(params.code, params.insertAfter);
        console.log('[ToolExecutor] Created cell at index:', cellIndex);
      }

      // 셀 생성/수정 후 해당 셀로 스크롤 (실행 전)
      this.scrollToCell(cellIndex);

      // 셀 실행 및 결과 캡처
      console.log('[ToolExecutor] Executing cell at index:', cellIndex);
      const result = await this.executeCellAndCapture(cellIndex);
      console.log('[ToolExecutor] Cell execution result:', result.status);

      return {
        success: result.status === 'ok',
        output: result.result || result.stdout,
        error: result.error?.evalue,
        traceback: result.error?.traceback,
        cellIndex,
        wasModified,
      };
    } catch (error: any) {
      console.error('[ToolExecutor] executeJupyterCell error:', error);
      return {
        success: false,
        error: error.message || 'Failed to execute jupyter_cell',
        cellIndex: cellIndex!,
        wasModified,
      };
    }
  }

  /**
   * markdown 도구: 마크다운 셀 생성/수정
   */
  async executeMarkdown(params: MarkdownParams): Promise<ToolResult> {
    try {
      let cellIndex: number;
      let wasModified = false;

      if (params.cellIndex !== undefined) {
        cellIndex = params.cellIndex;
        this.updateCellContent(cellIndex, params.content);
        wasModified = true;
      } else {
        cellIndex = await this.createMarkdownCell(params.content);
      }

      // 마크다운 셀도 생성 후 스크롤
      this.scrollToCell(cellIndex);

      return {
        success: true,
        cellIndex,
        wasModified,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to execute markdown',
      };
    }
  }

  /**
   * final_answer 도구: 작업 완료 신호
   */
  async executeFinalAnswer(params: FinalAnswerParams): Promise<ToolResult> {
    return {
      success: true,
      output: params.answer,
    };
  }

  /**
   * 코드 셀 생성 (빈 셀이 있으면 재사용)
   */
  private async createCodeCell(code: string, insertAfter?: number): Promise<number> {
    const notebookContent = this.notebook.content;
    const model = notebookContent.model;

    if (!model) {
      throw new Error('Notebook model not available');
    }

    // 노트북 맨 끝의 활성 셀이 빈 코드 셀이면 재사용 (첫 셀 생성 시에만)
    const activeIndex = notebookContent.activeCellIndex;
    const isAtEnd = activeIndex === model.cells.length - 1;
    if (activeIndex >= 0 && insertAfter === undefined && isAtEnd) {
      const activeCell = model.cells.get(activeIndex);
      if (activeCell && activeCell.type === 'code') {
        const source = activeCell.sharedModel.getSource().trim();
        if (source === '') {
          // 빈 셀 재사용
          activeCell.sharedModel.setSource(code);
          return activeIndex;
        }
      }
    }

    // 삽입 위치 결정: 항상 노트북 맨 끝에 추가 (순서 보장)
    // insertAfter가 지정되면 그 다음 위치, 아니면 맨 끝
    let insertIndex: number;
    if (insertAfter !== undefined) {
      insertIndex = insertAfter + 1;
    } else {
      // 맨 끝에 추가하여 순서 보장
      insertIndex = model.cells.length;
    }

    // 새 코드 셀 생성
    const cellModel = model.sharedModel.insertCell(insertIndex, {
      cell_type: 'code',
      source: code,
      metadata: {},
    });

    // 새 셀로 포커스 이동
    notebookContent.activeCellIndex = insertIndex;

    return insertIndex;
  }

  /**
   * 마크다운 셀 생성
   */
  private async createMarkdownCell(content: string, insertAfter?: number): Promise<number> {
    const notebookContent = this.notebook.content;
    const model = notebookContent.model;

    if (!model) {
      throw new Error('Notebook model not available');
    }

    // 삽입 위치 결정: 항상 노트북 맨 끝에 추가 (순서 보장)
    // insertAfter가 지정되면 그 다음 위치, 아니면 맨 끝
    let insertIndex: number;
    if (insertAfter !== undefined) {
      insertIndex = insertAfter + 1;
    } else {
      // 맨 끝에 추가하여 순서 보장
      insertIndex = model.cells.length;
    }

    // 새 마크다운 셀 생성
    model.sharedModel.insertCell(insertIndex, {
      cell_type: 'markdown',
      source: content,
      metadata: {},
    });

    // 마크다운 셀 렌더링
    const cell = notebookContent.widgets[insertIndex] as MarkdownCell;
    if (cell && cell.rendered !== undefined) {
      cell.rendered = true;
    }

    // 새 셀로 활성 셀 업데이트 (다음 셀이 이 셀 다음에 삽입되도록)
    notebookContent.activeCellIndex = insertIndex;

    return insertIndex;
  }

  /**
   * 셀 내용 업데이트
   */
  private updateCellContent(cellIndex: number, content: string): void {
    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex];

    if (!cell || !cell.model?.sharedModel) {
      throw new Error(`Cell at index ${cellIndex} not found or model not available`);
    }

    cell.model.sharedModel.setSource(content);
  }

  /**
   * 셀 실행 및 결과 캡처
   * NotebookActions.run()을 사용하여 정식으로 셀 실행 (execution_count 업데이트 포함)
   */
  private async executeCellAndCapture(cellIndex: number): Promise<ExecutionResult> {
    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex] as CodeCell;

    if (!cell) {
      throw new Error(`Cell at index ${cellIndex} not found`);
    }

    const startTime = Date.now();

    // 해당 셀 선택
    notebookContent.activeCellIndex = cellIndex;

    // NotebookActions.run()을 사용하여 정식 실행 (execution_count 업데이트됨)
    const success = await NotebookActions.run(notebookContent, this.sessionContext);

    // 실행 완료 후 결과 캡처
    const executionTime = Date.now() - startTime;

    // 셀 출력 분석
    let stdout = '';
    let stderr = '';
    let result: any = null;
    let error: ExecutionResult['error'] = undefined;

    // cell.model과 outputs가 존재하는지 안전하게 체크
    const outputs = cell.model?.outputs;
    if (outputs && outputs.length > 0) {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);

        if (output.type === 'stream') {
          const streamOutput = output as any;
          if (streamOutput.name === 'stdout') {
            stdout += streamOutput.text || '';
          } else if (streamOutput.name === 'stderr') {
            stderr += streamOutput.text || '';
          }
        } else if (output.type === 'execute_result' || output.type === 'display_data') {
          const data = (output as any).data;
          if (!result) {
            result = data;
          }
        } else if (output.type === 'error') {
          const errorOutput = output as any;
          error = {
            ename: errorOutput.ename,
            evalue: errorOutput.evalue,
            traceback: errorOutput.traceback,
          };
        }
      }
    }

    const status = error ? 'error' : 'ok';

    return {
      status,
      stdout,
      stderr,
      result,
      error,
      executionTime,
      cellIndex,
    };
  }

  /**
   * 현재 노트북의 셀 개수 반환
   */
  getCellCount(): number {
    return this.notebook.content.model?.cells.length || 0;
  }

  /**
   * 특정 셀의 내용 반환
   */
  getCellContent(cellIndex: number): string {
    const cell = this.notebook.content.widgets[cellIndex];
    return cell?.model?.sharedModel?.getSource() || '';
  }

  /**
   * 특정 셀의 출력 반환
   */
  getCellOutput(cellIndex: number): string {
    const cell = this.notebook.content.widgets[cellIndex] as CodeCell;
    // cell, cell.model, cell.model.outputs 모두 안전하게 체크
    const cellOutputs = cell?.model?.outputs;
    if (!cell || !cellOutputs) {
      return '';
    }

    const outputs: string[] = [];
    for (let i = 0; i < cellOutputs.length; i++) {
      const output = cellOutputs.get(i);
      if (output.type === 'stream') {
        outputs.push((output as any).text || '');
      } else if (output.type === 'execute_result' || output.type === 'display_data') {
        const data = (output as any).data;
        if (data?.['text/plain']) {
          outputs.push(data['text/plain']);
        }
      } else if (output.type === 'error') {
        const errorOutput = output as any;
        outputs.push(`${errorOutput.ename}: ${errorOutput.evalue}`);
      }
    }

    return outputs.join('\n');
  }

  /**
   * 커널 인터럽트
   */
  async interruptKernel(): Promise<void> {
    const kernel = this.sessionContext.session?.kernel;
    if (kernel) {
      await kernel.interrupt();
    }
  }

  /**
   * 셀 삭제
   */
  deleteCell(cellIndex: number): void {
    const model = this.notebook.content.model;
    if (model && cellIndex >= 0 && cellIndex < model.cells.length) {
      model.sharedModel.deleteCell(cellIndex);
    }
  }

  /**
   * 여러 셀 실행 (순차)
   */
  async executeMultipleCells(cellIndices: number[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const index of cellIndices) {
      const result = await this.executeCellAndCapture(index);
      results.push(result);
      if (result.status === 'error') {
        break; // 에러 발생 시 중단
      }
    }
    return results;
  }
}

export default ToolExecutor;
