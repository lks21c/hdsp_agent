/**
 * ToolExecutor - HF Jupyter Agent 스타일의 Tool 실행기
 *
 * 3가지 도구 실행 및 결과 캡처:
 * - jupyter_cell: 코드 셀 생성/수정/실행
 * - markdown: 마크다운 셀 생성/수정
 * - final_answer: 작업 완료 신호
 */

import type { NotebookPanel, Notebook } from '@jupyterlab/notebook';
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

  constructor(notebook: NotebookPanel, sessionContext: ISessionContext) {
    this.notebook = notebook;
    this.sessionContext = sessionContext;
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
   * 코드 셀 생성
   */
  private async createCodeCell(code: string, insertAfter?: number): Promise<number> {
    const notebookContent = this.notebook.content;
    const model = notebookContent.model;

    if (!model) {
      throw new Error('Notebook model not available');
    }

    // 삽입 위치 결정
    let insertIndex: number;
    if (insertAfter !== undefined) {
      insertIndex = insertAfter + 1;
    } else {
      // 기본: 현재 활성 셀 다음 또는 맨 끝
      const activeIndex = notebookContent.activeCellIndex;
      insertIndex = activeIndex >= 0 ? activeIndex + 1 : model.cells.length;
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

    // 삽입 위치 결정
    let insertIndex: number;
    if (insertAfter !== undefined) {
      insertIndex = insertAfter + 1;
    } else {
      const activeIndex = notebookContent.activeCellIndex;
      insertIndex = activeIndex >= 0 ? activeIndex + 1 : model.cells.length;
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

    return insertIndex;
  }

  /**
   * 셀 내용 업데이트
   */
  private updateCellContent(cellIndex: number, content: string): void {
    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex];

    if (!cell) {
      throw new Error(`Cell at index ${cellIndex} not found`);
    }

    cell.model.sharedModel.setSource(content);
  }

  /**
   * 셀 실행 및 결과 캡처
   */
  private async executeCellAndCapture(cellIndex: number): Promise<ExecutionResult> {
    const notebookContent = this.notebook.content;
    const cell = notebookContent.widgets[cellIndex] as CodeCell;

    if (!cell) {
      throw new Error(`Cell at index ${cellIndex} not found`);
    }

    const code = cell.model.sharedModel.getSource();
    const kernel = this.sessionContext.session?.kernel;

    if (!kernel) {
      throw new Error('Kernel not available');
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const future = kernel.requestExecute({ code });

      let stdout = '';
      let stderr = '';
      let result: any = null;
      let error: ExecutionResult['error'] = undefined;

      future.onIOPub = (msg) => {
        const msgType = msg.header.msg_type;
        const content = msg.content as any;

        switch (msgType) {
          case 'stream':
            if (content.name === 'stdout') {
              stdout += content.text;
            } else if (content.name === 'stderr') {
              stderr += content.text;
            }
            break;

          case 'execute_result':
            result = content.data;
            break;

          case 'display_data':
            // 이미지나 다른 출력 형식 처리
            if (!result) {
              result = content.data;
            }
            break;

          case 'error':
            error = {
              ename: content.ename,
              evalue: content.evalue,
              traceback: content.traceback,
            };
            break;
        }
      };

      future.done.then((reply) => {
        const status = (reply.content as any).status as 'ok' | 'error';
        resolve({
          status,
          stdout,
          stderr,
          result,
          error,
          executionTime: Date.now() - startTime,
          cellIndex,
        });
      }).catch((err) => {
        reject(err);
      });
    });
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
    return cell?.model.sharedModel.getSource() || '';
  }

  /**
   * 특정 셀의 출력 반환
   */
  getCellOutput(cellIndex: number): string {
    const cell = this.notebook.content.widgets[cellIndex] as CodeCell;
    if (!cell || !cell.model.outputs) {
      return '';
    }

    const outputs: string[] = [];
    for (let i = 0; i < cell.model.outputs.length; i++) {
      const output = cell.model.outputs.get(i);
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
