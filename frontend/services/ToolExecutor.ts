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
  CellOperation,
  ToolExecutionContext,
  ApprovalCallback,
} from '../types/auto-agent';

import { ToolRegistry, BUILTIN_TOOL_DEFINITIONS } from './ToolRegistry';

export class ToolExecutor {
  private notebook: NotebookPanel;
  private sessionContext: ISessionContext;
  private autoScrollEnabled: boolean = true;
  private registry: ToolRegistry;

  constructor(notebook: NotebookPanel, sessionContext: ISessionContext) {
    this.notebook = notebook;
    this.sessionContext = sessionContext;
    this.registry = ToolRegistry.getInstance();

    // 빌트인 도구들 등록
    this.registerBuiltinTools();
  }

  /**
   * 빌트인 도구들을 레지스트리에 등록
   */
  private registerBuiltinTools(): void {
    // jupyter_cell 도구 등록
    const jupyterCellDef = BUILTIN_TOOL_DEFINITIONS.find(t => t.name === 'jupyter_cell');
    if (jupyterCellDef && !this.registry.hasTool('jupyter_cell')) {
      this.registry.register({
        ...jupyterCellDef,
        executor: async (params: JupyterCellParams, context: ToolExecutionContext) => {
          return this.executeJupyterCell(params, context.stepNumber);
        },
      });
    }

    // markdown 도구 등록
    const markdownDef = BUILTIN_TOOL_DEFINITIONS.find(t => t.name === 'markdown');
    if (markdownDef && !this.registry.hasTool('markdown')) {
      this.registry.register({
        ...markdownDef,
        executor: async (params: MarkdownParams, context: ToolExecutionContext) => {
          return this.executeMarkdown(params, context.stepNumber);
        },
      });
    }

    // final_answer 도구 등록
    const finalAnswerDef = BUILTIN_TOOL_DEFINITIONS.find(t => t.name === 'final_answer');
    if (finalAnswerDef && !this.registry.hasTool('final_answer')) {
      this.registry.register({
        ...finalAnswerDef,
        executor: async (params: FinalAnswerParams, _context: ToolExecutionContext) => {
          return this.executeFinalAnswer(params);
        },
      });
    }

    console.log('[ToolExecutor] Built-in tools registered');
    this.registry.printStatus();
  }

  /**
   * 승인 콜백 설정 (ApprovalDialog 연동용)
   */
  setApprovalCallback(callback: ApprovalCallback): void {
    this.registry.setApprovalCallback(callback);
  }

  /**
   * 승인 필요 여부 설정
   */
  setApprovalRequired(required: boolean): void {
    this.registry.setApprovalRequired(required);
  }

  /**
   * 레지스트리 인스턴스 반환 (외부 도구 등록용)
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }

  /**
   * 커널이 idle 상태가 될 때까지 대기
   * @param timeout 최대 대기 시간 (ms)
   * @returns true if kernel became idle, false if timeout
   */
  private async waitForKernelIdle(timeout: number = 10000): Promise<boolean> {
    const kernel = this.sessionContext.session?.kernel;
    if (!kernel) {
      console.warn('[ToolExecutor] No kernel available');
      return false;
    }

    const startTime = Date.now();
    const pollInterval = 100; // 100ms마다 체크

    return new Promise<boolean>((resolve) => {
      const checkStatus = () => {
        const elapsed = Date.now() - startTime;
        const status = kernel.status;

        if (status === 'idle') {
          console.log('[ToolExecutor] Kernel is idle after', elapsed, 'ms');
          resolve(true);
          return;
        }

        if (elapsed >= timeout) {
          console.warn('[ToolExecutor] Kernel idle wait timeout after', timeout, 'ms, status:', status);
          resolve(false);
          return;
        }

        // 아직 idle이 아니면 다시 체크
        setTimeout(checkStatus, pollInterval);
      };

      checkStatus();
    });
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
   * Tool 실행 라우터 (레지스트리 기반)
   * @param call - 도구 호출 정보
   * @param stepNumber - 실행 계획의 단계 번호 (셀에 표시용)
   */
  async executeTool(call: ToolCall, stepNumber?: number): Promise<ToolResult> {
    console.log('[ToolExecutor] executeTool called:', JSON.stringify(call, null, 2), 'stepNumber:', stepNumber);

    // 실행 컨텍스트 생성
    const context: ToolExecutionContext = {
      notebook: this.notebook,
      sessionContext: this.sessionContext,
      stepNumber,
    };

    // 레지스트리를 통해 도구 실행 (승인 게이트 포함)
    const result = await this.registry.executeTool(call.tool, call.parameters, context);

    console.log('[ToolExecutor] Tool result:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * Step 번호 포맷팅 (스태킹 방지)
   * 기존 Step 주석이 있으면 교체, 없으면 추가
   */
  private formatCodeWithStep(code: string, stepNumber?: number): string {
    if (stepNumber === undefined) {
      return code;
    }

    // 기존 Step 주석 제거 (스태킹 방지)
    // # [Step N] 또는 # [Step N.M] 패턴 매칭
    const stepPattern = /^# \[Step \d+(?:\.\d+)?\]\n/;
    const cleanCode = code.replace(stepPattern, '');

    // 새 Step 주석 추가
    return `# [Step ${stepNumber}]\n${cleanCode}`;
  }

  /**
   * jupyter_cell 도구: 셀 생성/수정/실행
   * @param stepNumber - 실행 계획의 단계 번호 (셀에 주석으로 표시)
   */
  async executeJupyterCell(params: JupyterCellParams, stepNumber?: number): Promise<ToolResult> {
    console.log('[ToolExecutor] executeJupyterCell params:', params);
    const notebookContent = this.notebook.content;
    console.log('[ToolExecutor] notebook content available:', !!notebookContent);
    console.log('[ToolExecutor] notebook model available:', !!notebookContent?.model);
    let cellIndex: number;
    let wasModified = false;
    let operation: CellOperation = params.operation || 'CREATE';
    let previousContent: string | undefined;

    // Step 번호 포맷팅 (스태킹 방지)
    const codeWithStep = this.formatCodeWithStep(params.code, stepNumber);

    try {
      // 작업 유형에 따른 셀 처리
      if (params.cellIndex !== undefined && params.operation !== 'CREATE') {
        // MODIFY: 기존 셀 수정
        operation = 'MODIFY';
        cellIndex = params.cellIndex;

        // 수정 전 원본 내용 저장 (UI/실행취소용)
        const existingCell = notebookContent.widgets[cellIndex];
        if (existingCell?.model?.sharedModel) {
          previousContent = existingCell.model.sharedModel.getSource();
        }

        console.log('[ToolExecutor] MODIFY: Updating cell at index:', cellIndex);
        this.updateCellContent(cellIndex, codeWithStep);
        wasModified = true;

      } else if (params.insertAfter !== undefined) {
        // INSERT_AFTER: 특정 셀 뒤에 삽입
        operation = 'INSERT_AFTER';
        console.log('[ToolExecutor] INSERT_AFTER: Inserting after cell:', params.insertAfter);
        cellIndex = await this.insertCellAfter(codeWithStep, params.insertAfter);

      } else if (params.insertBefore !== undefined) {
        // INSERT_BEFORE: 특정 셀 앞에 삽입
        operation = 'INSERT_BEFORE';
        console.log('[ToolExecutor] INSERT_BEFORE: Inserting before cell:', params.insertBefore);
        cellIndex = await this.insertCellBefore(codeWithStep, params.insertBefore);

      } else {
        // CREATE: 기본 동작 - 노트북 끝에 생성
        operation = 'CREATE';
        console.log('[ToolExecutor] CREATE: Creating new cell at end');
        cellIndex = await this.createCodeCell(codeWithStep);
      }

      console.log('[ToolExecutor] Cell operation completed:', operation, 'at index:', cellIndex);

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
        errorName: result.error?.ename,  // 에러 타입명 추가 (e.g., "ModuleNotFoundError")
        traceback: result.error?.traceback,
        cellIndex,
        wasModified,
        operation,
        previousContent,
      };
    } catch (error: any) {
      console.error('[ToolExecutor] executeJupyterCell error:', error);
      return {
        success: false,
        error: error.message || 'Failed to execute jupyter_cell',
        cellIndex: cellIndex!,
        wasModified,
        operation,
        previousContent,
      };
    }
  }

  /**
   * markdown 도구: 마크다운 셀 생성/수정
   */
  async executeMarkdown(params: MarkdownParams, stepNumber?: number): Promise<ToolResult> {
    try {
      let cellIndex: number;
      let wasModified = false;

      // stepNumber가 있으면 마크다운 맨 앞에 표시 추가
      let contentWithStep = params.content;
      if (stepNumber !== undefined) {
        contentWithStep = `**[Step ${stepNumber}]**\n\n${params.content}`;
      }

      if (params.cellIndex !== undefined) {
        cellIndex = params.cellIndex;
        this.updateCellContent(cellIndex, contentWithStep);
        wasModified = true;
      } else {
        cellIndex = await this.createMarkdownCell(contentWithStep);
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

    console.log('[ToolExecutor] createCodeCell debug:', {
      hasNotebook: !!this.notebook,
      hasContent: !!notebookContent,
      hasModel: !!notebookContent?.model,
      contentType: typeof notebookContent,
      modelType: typeof notebookContent?.model,
      contentKeys: notebookContent ? Object.keys(notebookContent).slice(0, 10) : []
    });

    const model = notebookContent.model;

    if (!model) {
      console.error('[ToolExecutor] Notebook model is null/undefined!');
      console.error('[ToolExecutor] notebookContent:', notebookContent);
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
   * 특정 셀 뒤에 새 코드 셀 삽입 (INSERT_AFTER)
   * @param code - 삽입할 코드
   * @param afterIndex - 이 셀 뒤에 삽입
   */
  private async insertCellAfter(code: string, afterIndex: number): Promise<number> {
    const model = this.notebook.content.model;
    if (!model) throw new Error('Notebook model not available');

    // 삽입 위치: afterIndex + 1 (afterIndex 바로 뒤)
    const insertIndex = Math.min(afterIndex + 1, model.cells.length);

    model.sharedModel.insertCell(insertIndex, {
      cell_type: 'code',
      source: code,
      metadata: { hdsp_inserted: true },  // Agent에 의해 삽입됨 표시
    });

    this.lastCreatedCellIndex = insertIndex;
    this.notebook.content.activeCellIndex = insertIndex;

    console.log('[ToolExecutor] INSERT_AFTER: Inserted cell after index:', afterIndex, 'at:', insertIndex);
    return insertIndex;
  }

  /**
   * 특정 셀 앞에 새 코드 셀 삽입 (INSERT_BEFORE)
   * @param code - 삽입할 코드
   * @param beforeIndex - 이 셀 앞에 삽입
   */
  private async insertCellBefore(code: string, beforeIndex: number): Promise<number> {
    const model = this.notebook.content.model;
    if (!model) throw new Error('Notebook model not available');

    // 삽입 위치: beforeIndex (beforeIndex 바로 앞)
    const insertIndex = Math.max(0, beforeIndex);

    model.sharedModel.insertCell(insertIndex, {
      cell_type: 'code',
      source: code,
      metadata: { hdsp_inserted: true },  // Agent에 의해 삽입됨 표시
    });

    this.lastCreatedCellIndex = insertIndex;
    this.notebook.content.activeCellIndex = insertIndex;

    console.log('[ToolExecutor] INSERT_BEFORE: Inserted cell before index:', beforeIndex, 'at:', insertIndex);
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
    const runSuccess = await NotebookActions.run(notebookContent, this.sessionContext);
    console.log('[ToolExecutor] NotebookActions.run() success:', runSuccess);

    // 커널이 idle 상태가 될 때까지 대기 (출력이 완전히 업데이트되도록)
    // NotebookActions.run()이 false를 반환해도 커널은 아직 busy 상태일 수 있음
    const kernelIdled = await this.waitForKernelIdle(10000);
    console.log('[ToolExecutor] Kernel idle wait result:', kernelIdled);

    // 추가 안정화 대기 (출력 모델 동기화)
    await new Promise(resolve => setTimeout(resolve, 200));

    // 실행 완료 후 결과 캡처
    const executionTime = Date.now() - startTime;

    // 셀 출력 분석
    let stdout = '';
    let stderr = '';
    let result: any = null;
    let error: ExecutionResult['error'] = undefined;

    // cell.model과 outputs가 존재하는지 안전하게 체크
    const outputs = cell.model?.outputs;
    console.log('[ToolExecutor] After kernel idle - outputs count:', outputs?.length ?? 0, '| runSuccess:', runSuccess);
    if (outputs && outputs.length > 0) {
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs.get(i);
        // 더 상세한 디버깅: 전체 output 구조 확인
        console.log(`[ToolExecutor] Output ${i} type:`, output.type);
        try {
          // toJSON이 있으면 전체 구조 확인
          const outputJson = (output as any).toJSON?.() || output;
          console.log(`[ToolExecutor] Output ${i} full structure:`, JSON.stringify(outputJson, null, 2));
        } catch (e) {
          console.log(`[ToolExecutor] Output ${i} raw:`, output);
        }

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
          // CRITICAL: output 모델 객체는 toJSON()으로 실제 데이터를 추출해야 함
          // 직접 프로퍼티 접근(output.ename)은 undefined를 반환할 수 있음
          const errorData = (output as any).toJSON?.() || output;
          console.log('[ToolExecutor] Error output detected:', JSON.stringify(errorData));
          // 실제로 에러 내용이 있는 경우에만 에러로 처리
          if (errorData.ename || errorData.evalue) {
            error = {
              ename: errorData.ename,
              evalue: errorData.evalue,
              traceback: errorData.traceback || [],
            };
            console.log('[ToolExecutor] Error captured:', error.ename, '-', error.evalue);
          }
        }
      }
    }

    // NotebookActions.run()이 false를 반환했거나 error output이 있으면 실패
    // runSuccess가 false면 에러 output이 없어도 실패로 처리
    const status = (error || !runSuccess) ? 'error' : 'ok';

    // 디버깅: 실패 감지 상세 로그
    console.log('[ToolExecutor] Final status:', status);
    console.log('[ToolExecutor] - runSuccess:', runSuccess);
    console.log('[ToolExecutor] - error detected:', !!error);
    if (error) {
      console.log('[ToolExecutor] - error.ename:', error.ename);
      console.log('[ToolExecutor] - error.evalue:', error.evalue);
    }

    // runSuccess가 false인데 error가 없으면 stdout/stderr에서 에러 패턴 추출 시도
    if (!runSuccess && !error) {
      console.warn('[ToolExecutor] NotebookActions.run() failed but no error output captured!');
      console.log('[ToolExecutor] Attempting to extract error from stdout/stderr...');

      // stdout에서 에러 패턴 검색 (Python traceback 형식)
      const combinedOutput = stdout + '\n' + stderr;
      const extractedError = this.extractErrorFromOutput(combinedOutput);

      if (extractedError) {
        console.log('[ToolExecutor] Extracted error from output:', extractedError);
        error = extractedError;
      } else {
        error = {
          ename: 'ExecutionError',
          evalue: 'Cell execution failed (NotebookActions.run returned false)',
          traceback: [],
        };
      }
    }

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
   * 출력 텍스트에서 Python 에러 패턴을 추출
   * error 타입 출력이 캡처되지 않았을 때 stdout/stderr에서 에러 추출 시도
   */
  private extractErrorFromOutput(output: string): ExecutionResult['error'] | undefined {
    if (!output) return undefined;

    // 에러 타입 패턴들 (Python 표준 에러들)
    const errorPatterns = [
      /^(ModuleNotFoundError):\s*(.+)$/m,
      /^(ImportError):\s*(.+)$/m,
      /^(SyntaxError):\s*(.+)$/m,
      /^(TypeError):\s*(.+)$/m,
      /^(ValueError):\s*(.+)$/m,
      /^(KeyError):\s*(.+)$/m,
      /^(IndexError):\s*(.+)$/m,
      /^(AttributeError):\s*(.+)$/m,
      /^(NameError):\s*(.+)$/m,
      /^(FileNotFoundError):\s*(.+)$/m,
      /^(ZeroDivisionError):\s*(.+)$/m,
      /^(RuntimeError):\s*(.+)$/m,
      /^(PermissionError):\s*(.+)$/m,
      /^(OSError):\s*(.+)$/m,
      /^(IOError):\s*(.+)$/m,
      /^(ConnectionError):\s*(.+)$/m,
      /^(TimeoutError):\s*(.+)$/m,
    ];

    for (const pattern of errorPatterns) {
      const match = output.match(pattern);
      if (match) {
        return {
          ename: match[1],
          evalue: match[2].trim(),
          traceback: [],  // traceback 추출은 복잡하므로 생략
        };
      }
    }

    // Traceback이 있으면 마지막 에러 라인 추출 시도
    if (output.includes('Traceback (most recent call last):')) {
      // 마지막 줄에서 에러 타입: 메시지 패턴 찾기
      const lines = output.split('\n').filter(l => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        const errorMatch = line.match(/^(\w+Error):\s*(.+)$/);
        if (errorMatch) {
          return {
            ename: errorMatch[1],
            evalue: errorMatch[2].trim(),
            traceback: [],
          };
        }
      }
    }

    return undefined;
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
