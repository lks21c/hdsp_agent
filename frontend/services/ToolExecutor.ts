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
   * Jupyter kernel에서 변수 값들을 추출
   * @param varNames 추출할 변수명 배열
   * @returns 변수명 -> 값 매핑 객체
   */
  async getVariableValues(varNames: string[]): Promise<Record<string, string>> {
    if (varNames.length === 0) {
      return {};
    }

    try {
      // JSON으로 변수 값들을 추출하는 Python 코드 생성
      // DataFrame 등 복잡한 타입을 HTML table로 변환하는 헬퍼 함수 포함
      const code = `
import json

def _format_value(v):
    """변수 값을 적절한 형태로 포맷팅"""
    try:
        # 1. DataFrame → HTML table (pandas, modin 등)
        if hasattr(v, 'to_html'):
            try:
                html = v.to_html(index=False, max_rows=100)
                return f"<!--DFHTML-->{html}<!--/DFHTML-->"
            except:
                pass

        # 2. Lazy DataFrame (dask) - 샘플만 변환
        if hasattr(v, 'compute'):
            try:
                sample = v.head(100).compute()
                if hasattr(sample, 'to_html'):
                    html = sample.to_html(index=False)
                    return f"<!--DFHTML-->{html}<!--/DFHTML-->"
            except:
                pass

        # 3. Spark DataFrame
        if hasattr(v, 'toPandas'):
            try:
                sample = v.limit(100).toPandas()
                if hasattr(sample, 'to_html'):
                    html = sample.to_html(index=False)
                    return f"<!--DFHTML-->{html}<!--/DFHTML-->"
            except:
                pass

        # 4. DataFrame with to_pandas conversion (polars, cudf, vaex 등)
        for method in ['to_pandas', 'to_pandas_df']:
            if hasattr(v, method):
                try:
                    converted = getattr(v, method)()
                    if hasattr(converted, 'to_html'):
                        html = converted.to_html(index=False, max_rows=100)
                        return f"<!--DFHTML-->{html}<!--/DFHTML-->"
                except:
                    continue

        # 5. Series - to_string()
        if hasattr(v, 'to_string'):
            try:
                return v.to_string(max_rows=100)
            except:
                pass

        # 6. 기본 str()
        return str(v)
    except:
        return str(v)

# 변수 값 추출
result = {}
${varNames.map(v => `
if '${v}' in locals() or '${v}' in globals():
    val = locals().get('${v}', globals().get('${v}'))
    result['${v}'] = _format_value(val)
else:
    result['${v}'] = None`).join('')}

print(json.dumps(result))
`.trim();

      // 임시 셀 생성하여 실행
      const model = this.notebook.content.model;
      if (!model) {
        throw new Error('Notebook model is not available');
      }

      const tempCellIndex = model.cells.length;

      // 코드 셀 삽입
      model.sharedModel.insertCell(tempCellIndex, {
        cell_type: 'code',
        source: code,
      });

      // 실행 및 결과 캡처
      const result = await this.executeCellAndCapture(tempCellIndex);

      // 임시 셀 삭제
      model.sharedModel.deleteCell(tempCellIndex);

      // stdout에서 JSON 파싱
      if (result.stdout) {
        const variables = JSON.parse(result.stdout.trim());
        // null 값 제거
        const filtered: Record<string, string> = {};
        for (const [key, value] of Object.entries(variables)) {
          if (value !== null) {
            filtered[key] = value as string;
          }
        }
        return filtered;
      }

      return {};
    } catch (error) {
      console.error('[ToolExecutor] Failed to extract variable values:', error);
      return {};
    }
  }

  /**
   * 마지막으로 생성된 셀 인덱스 추적 (순차 삽입용)
   */
  private lastCreatedCellIndex: number = -1;

  /**
   * 순차 실행 시작 시 호출 (마지막 셀 인덱스 초기화)
   */
  resetSequentialExecution(): void {
    const model = this.notebook.content.model;
    // 현재 노트북 맨 끝 셀 인덱스로 초기화
    this.lastCreatedCellIndex = model ? model.cells.length - 1 : -1;
    console.log('[ToolExecutor] Reset sequential execution, lastCreatedCellIndex:', this.lastCreatedCellIndex);
  }

  /**
   * 코드 셀 생성 (항상 순차적으로 맨 끝에 추가)
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
          this.lastCreatedCellIndex = activeIndex;
          return activeIndex;
        }
      }
    }

    // ★ 순차 삽입: 항상 노트북 맨 끝에 추가 (중간 삽입 금지)
    // 이렇게 하면 셀이 항상 아래로만 추가됨
    const insertIndex = model.cells.length;

    // 새 코드 셀 생성
    model.sharedModel.insertCell(insertIndex, {
      cell_type: 'code',
      source: code,
      metadata: {},
    });

    // 마지막 생성 셀 인덱스 업데이트
    this.lastCreatedCellIndex = insertIndex;

    // 새 셀로 포커스 이동
    notebookContent.activeCellIndex = insertIndex;

    console.log('[ToolExecutor] Created cell at index:', insertIndex, '(always at end)');
    return insertIndex;
  }

  /**
   * 마크다운 셀 생성 (항상 순차적으로 맨 끝에 추가)
   */
  private async createMarkdownCell(content: string, insertAfter?: number): Promise<number> {
    const notebookContent = this.notebook.content;
    const model = notebookContent.model;

    if (!model) {
      throw new Error('Notebook model not available');
    }

    // ★ 순차 삽입: 항상 노트북 맨 끝에 추가 (중간 삽입 금지)
    const insertIndex = model.cells.length;

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

    // 마지막 생성 셀 인덱스 업데이트
    this.lastCreatedCellIndex = insertIndex;

    // 새 셀로 활성 셀 업데이트
    notebookContent.activeCellIndex = insertIndex;

    console.log('[ToolExecutor] Created markdown cell at index:', insertIndex, '(always at end)');
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

    // 실행 완료 후 outputs 업데이트 대기 (최대 100ms)
    // NotebookActions.run()이 완료되어도 outputs가 바로 업데이트되지 않을 수 있음
    await new Promise(resolve => setTimeout(resolve, 100));

    // 실행 완료 후 결과 캡처
    const executionTime = Date.now() - startTime;

    // 셀 출력 분석
    let stdout = '';
    let stderr = '';
    let result: any = null;
    let error: ExecutionResult['error'] = undefined;

    // cell.model과 outputs가 존재하는지 안전하게 체크
    const outputs = cell.model?.outputs;
    console.log('[ToolExecutor] Cell outputs count:', outputs?.length ?? 0);
    if (outputs && outputs.length > 0) {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);
        console.log(`[ToolExecutor] Output ${i} type:`, output.type);

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
          console.log('[ToolExecutor] Error output detected:', JSON.stringify(errorOutput));
          // 실제로 에러 내용이 있는 경우에만 에러로 처리
          if (errorOutput.ename || errorOutput.evalue) {
            error = {
              ename: errorOutput.ename,
              evalue: errorOutput.evalue,
              traceback: errorOutput.traceback,
            };
          }
        }
      }
    }

    const status = error ? 'error' : 'ok';
    console.log('[ToolExecutor] Final status:', status, 'error:', error);

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
