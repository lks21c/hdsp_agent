# HDSP Agent Auto-Agent Mode Implementation Plan

## Overview

커서 AI와 유사한 Auto-Agent 모드를 HDSP Agent JupyterLab 확장에 구현하기 위한 상세 계획입니다.

**핵심 기능:**
- 자동 코드 생성 및 Jupyter 셀에 삽입
- 셀 실행 후 결과 자동 캡처
- 실행 결과 분석 및 가설 검증
- 오류 발생 시 자동 수정 및 재시도 (최대 3회)
- ReAct 패턴 기반 사고 → 행동 → 관찰 루프

---

## 참고 오픈소스 프로젝트

### 1. HuggingFace Jupyter Agent - **Primary Reference** ⭐
- GitHub: https://github.com/huggingface/jupyter-agent (원본), https://github.com/lks21c/hf-jupyter-agent (포크)
- **핵심 기능:** Cursor의 데이터 분석 버전, 노트북 컨텍스트 이해 및 Python 코드 실행
- **Tool Calling 메커니즘:** 3가지 도구 활용
  - `jupyter_cell`: 코드 실행 및 노트북 셀 추가
  - `markdown`: 설명 텍스트 셀 작성
  - `final_answer`: 질문에 대한 최종 답변 제시
- **이중 실행 모드:**
  - LLM 시뮬레이션: 데이터셋이 로컬에 없을 때 LLM이 코드 실행 결과 시뮬레이션
  - E2B 실행: 데이터가 존재할 때 실제 코드를 격리된 환경에서 실행
- **적용할 패턴:** Tool Calling 구조, 단계별 추론 추적(reasoning traces), 이중 실행 모드
- **성능:** DABStep 벤치마크 75% (기본 38.7% → 파인튜닝 후 75%)
- **활용도:** 10/10

### 2. Jupyter AI Agents (Datalayer) - **Architecture Reference**
- GitHub: https://github.com/datalayer/jupyter-ai-agents
- **핵심 기능:** 노트북 전체 조작, 셀 생성/실행/결과 분석, 에러 분석 및 수정 제안
- **적용할 패턴:** Real-Time Collaboration, Jupyter NbModel Client, Kernel Client
- **활용도:** 9/10

### 3. Notebook Intelligence (NBI) - **Safety Reference**
- GitHub: https://github.com/notebook-intelligence/notebook-intelligence
- **핵심 기능:** Agent Mode로 자율적 노트북 조작, 이슈 탐지 및 자동 수정
- **적용할 패턴:** 안전 제어 (notebook_execute_tool 비활성화 옵션)
- **활용도:** 8/10

### 4. E2B Code Interpreter - **Sandbox Reference**
- GitHub: https://github.com/e2b-dev/code-interpreter
- **핵심 기능:** 안전한 샌드박스 실행 환경, Stateful Jupyter 커널
- **적용할 패턴:** (Optional) 프로덕션 배포 시 샌드박스 실행, HF Jupyter Agent에서도 사용
- **활용도:** 7/10

### 5. LangChain PythonREPLTool - **Error Handling Reference**
- Docs: https://python.langchain.com/api_reference/experimental/tools/
- **적용할 패턴:** `with_retry`, `handle_tool_error`, exponential backoff
- **활용도:** 7/10

### 6. Open Interpreter - **Self-Correction Reference**
- GitHub: https://github.com/openinterpreter/open-interpreter
- **핵심 기능:** Stack trace 기반 자동 수정
- **적용할 패턴:** 프롬프트 기반 재시도 ("If you get an error, debug your code and try again")
- **활용도:** 6/10

---

## Architecture Design

### Core Pattern: Tool Calling + ReAct + Self-Healing Loop

HuggingFace Jupyter Agent의 Tool Calling 메커니즘을 채택하여 3가지 도구 기반 아키텍처 구현:

```
사용자 요청 (예: "데이터 로드 → 전처리 → 시각화")
    ↓
┌───────────────────────────────────────────────────────┐
│              PLAN-AND-EXECUTE ORCHESTRATOR            │
│  ┌─────────────────────────────────────────────────┐ │
│  │  PLANNING PHASE                                  │ │
│  │  - 요청 분석 및 작업 분해                         │ │
│  │  - 단계별 실행 계획 생성                          │ │
│  │  - 예: [Step1: 로드, Step2: 전처리, Step3: 시각화] │ │
│  └───────────────────────┬─────────────────────────┘ │
│                          ↓                           │
│  ┌─────────────────────────────────────────────────┐ │
│  │  EXECUTION LOOP (for each step)                 │ │
│  │  ┌───────────────────────────────────────────┐  │ │
│  │  │  TOOL CALLING (HF Jupyter Agent 패턴)      │  │ │
│  │  │  ┌─────────────────────────────────────┐  │  │ │
│  │  │  │ 📝 jupyter_cell                      │  │  │ │
│  │  │  │ - 코드 셀 생성/수정/실행              │  │  │ │
│  │  │  │ - 실행 결과 캡처                      │  │  │ │
│  │  │  └─────────────────────────────────────┘  │  │ │
│  │  │  ┌─────────────────────────────────────┐  │  │ │
│  │  │  │ 📖 markdown                          │  │  │ │
│  │  │  │ - 설명 텍스트 셀 작성                 │  │  │ │
│  │  │  │ - 분석 과정 문서화                    │  │  │ │
│  │  │  └─────────────────────────────────────┘  │  │ │
│  │  │  ┌─────────────────────────────────────┐  │  │ │
│  │  │  │ ✅ final_answer                      │  │  │ │
│  │  │  │ - 최종 답변/결과 제시                 │  │  │ │
│  │  │  │ - 작업 완료 신호                      │  │  │ │
│  │  │  └─────────────────────────────────────┘  │  │ │
│  │  └───────────────────────────────────────────┘  │ │
│  │                        ↓                        │ │
│  │  ┌───────────────────────────────────────────┐  │ │
│  │  │  OBSERVATION & VALIDATION                  │  │ │
│  │  │  - 실행 결과 분석                          │  │ │
│  │  │  - 성공 → 다음 단계로 진행                  │  │ │
│  │  │  - 실패 → Self-Healing (최대 3회 재시도)    │  │ │
│  │  └───────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
    ↓
결과 반환 (성공/실패 + 생성된 셀들)
```

### Tool Calling Schema (HF Jupyter Agent 참조)

```typescript
// Tool 정의
interface AgentTool {
  name: 'jupyter_cell' | 'markdown' | 'final_answer';
  description: string;
  parameters: Record<string, any>;
}

// jupyter_cell 도구
interface JupyterCellTool {
  name: 'jupyter_cell';
  parameters: {
    code: string;           // 실행할 Python 코드
    cell_index?: number;    // 수정할 셀 인덱스 (없으면 새 셀 생성)
  };
  returns: {
    output: string;         // 실행 결과
    error?: string;         // 에러 메시지
    cell_index: number;     // 생성/수정된 셀 인덱스
  };
}

// markdown 도구
interface MarkdownTool {
  name: 'markdown';
  parameters: {
    content: string;        // 마크다운 텍스트
    cell_index?: number;    // 수정할 셀 인덱스
  };
  returns: {
    cell_index: number;
  };
}

// final_answer 도구
interface FinalAnswerTool {
  name: 'final_answer';
  parameters: {
    answer: string;         // 최종 답변
    summary?: string;       // 작업 요약
  };
  returns: void;
}
```

### Integration with Existing HDSP Agent

```
기존 HDSP Agent 아키텍처
├── AgentPanel (채팅 UI)
├── CellButtons (E/F/? 버튼)
└── ApiService (백엔드 통신)

추가될 Auto-Agent 모듈
├── AutoAgentService (프론트엔드)
│   ├── executeAutoTask()
│   ├── createAndExecuteCell()
│   └── captureExecutionResult()
├── AutoAgentPanel (UI 컴포넌트)
│   └── 진행 상태, 재시도 횟수 표시
├── AgentLoopHandler (백엔드)
│   ├── POST /hdsp-agent/auto-agent/execute
│   └── SSE /hdsp-agent/auto-agent/stream
└── CodeValidator (안전 검증)
    └── 위험 코드 패턴 검출
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Frontend - Tool Executor 구현 (HF Jupyter Agent 패턴)
**파일:** `frontend/services/ToolExecutor.ts`

```typescript
// HF Jupyter Agent 스타일의 Tool 정의
type ToolName = 'jupyter_cell' | 'markdown' | 'final_answer';

interface ToolCall {
  tool: ToolName;
  parameters: Record<string, any>;
}

interface ToolResult {
  success: boolean;
  output?: any;
  error?: string;
  cellIndex?: number;
}

// jupyter_cell 도구 실행
interface JupyterCellParams {
  code: string;
  cellIndex?: number;    // 기존 셀 수정 시 인덱스 지정
  insertAfter?: number;  // 특정 셀 뒤에 삽입
}

// 실행 결과
interface ExecutionResult {
  status: 'ok' | 'error';
  stdout: string;
  stderr: string;
  result: any;
  error?: { ename: string; evalue: string; traceback: string[] };
  executionTime: number;
  cellIndex: number;
}

// Plan-and-Execute를 위한 작업 계획
interface ExecutionPlan {
  steps: PlanStep[];
  totalSteps: number;
}

interface PlanStep {
  stepNumber: number;
  description: string;
  toolCalls: ToolCall[];
  dependencies: number[];  // 의존하는 이전 단계 번호들
}

// 최종 결과 (다중 셀 지원)
interface AutoAgentResult {
  success: boolean;
  plan: ExecutionPlan;
  executedSteps: StepResult[];
  createdCells: number[];    // 생성된 셀 인덱스들
  modifiedCells: number[];   // 수정된 셀 인덱스들
  finalAnswer?: string;
  error?: string;
  totalAttempts: number;
}
```

**핵심 메서드:**

```typescript
export class ToolExecutor {
  constructor(
    private notebook: NotebookPanel,
    private sessionContext: ISessionContext
  ) {}

  // Tool 실행 라우터
  async executeTool(call: ToolCall): Promise<ToolResult> {
    switch (call.tool) {
      case 'jupyter_cell':
        return this.executeJupyterCell(call.parameters as JupyterCellParams);
      case 'markdown':
        return this.executeMarkdown(call.parameters);
      case 'final_answer':
        return this.executeFinalAnswer(call.parameters);
    }
  }

  // 1. jupyter_cell 도구: 셀 생성/수정/실행
  async executeJupyterCell(params: JupyterCellParams): Promise<ToolResult> {
    let cellIndex: number;

    if (params.cellIndex !== undefined) {
      // 기존 셀 수정
      cellIndex = params.cellIndex;
      this.updateCellContent(cellIndex, params.code);
    } else {
      // 새 셀 생성
      cellIndex = await this.createCell(params.code, params.insertAfter);
    }

    // 셀 실행 및 결과 캡처
    const result = await this.executeCellAndCapture(cellIndex);

    return {
      success: result.status === 'ok',
      output: result.result,
      error: result.error?.evalue,
      cellIndex
    };
  }

  // 2. markdown 도구: 마크다운 셀 생성/수정
  async executeMarkdown(params: { content: string; cellIndex?: number }): Promise<ToolResult> {
    let cellIndex: number;

    if (params.cellIndex !== undefined) {
      cellIndex = params.cellIndex;
      this.updateCellContent(cellIndex, params.content);
    } else {
      cellIndex = await this.createMarkdownCell(params.content);
    }

    return { success: true, cellIndex };
  }

  // 3. final_answer 도구: 작업 완료 신호
  async executeFinalAnswer(params: { answer: string }): Promise<ToolResult> {
    // UI에 최종 답변 표시
    return { success: true, output: params.answer };
  }

  // 커널 결과 캡처 (기존 HDSP Agent 패턴 활용)
  private async executeCellAndCapture(cellIndex: number): Promise<ExecutionResult> {
    const cell = this.notebook.content.widgets[cellIndex];
    const code = cell.model.sharedModel.getSource();

    return new Promise((resolve) => {
      const future = this.sessionContext.session!.kernel!.requestExecute({ code });

      let stdout = '', stderr = '', result = null, error = null;

      future.onIOPub = (msg) => {
        const msgType = msg.header.msg_type;
        if (msgType === 'stream') {
          const content = (msg as any).content;
          if (content.name === 'stdout') stdout += content.text;
          else if (content.name === 'stderr') stderr += content.text;
        } else if (msgType === 'execute_result') {
          result = (msg as any).content.data;
        } else if (msgType === 'error') {
          error = (msg as any).content;
        }
      };

      future.done.then((reply) => {
        resolve({
          status: reply.content.status as 'ok' | 'error',
          stdout, stderr, result, error,
          executionTime: Date.now(),
          cellIndex
        });
      });
    });
  }
}
```

#### 1.2 Backend - AgentLoopHandler 구현
**파일:** `backend/handlers/auto_agent.py`

```python
class AutoAgentHandler(BaseAgentHandler):
    """Auto-agent task execution handler"""

    async def post(self):
        """Execute auto-agent task with retry loop"""
        body = self.get_json_body()
        request = body.get('request')
        max_retries = body.get('max_retries', 3)

        # Stream 방식으로 진행 상황 전달
        self.set_header('Content-Type', 'text/event-stream')

        for attempt in range(max_retries):
            # 1. LLM으로 코드 생성
            hypothesis = await self.generate_code_hypothesis(request, last_error)
            self.write_sse('thought', hypothesis)

            # 2. 프론트엔드가 셀 실행 및 결과 반환
            # (실제 실행은 프론트엔드에서 수행 - 커널 접근 필요)
            self.write_sse('action', {'code': hypothesis.code})

            # 3. 결과 검증은 후속 요청으로 처리
            ...
```

### Phase 2: LLM Integration (Week 2)

#### 2.1 프롬프트 템플릿 설계
**파일:** `backend/prompts/auto_agent_prompts.py`

```python
CODE_GENERATION_PROMPT = """
당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.

사용자 요청: {request}

요구사항:
- 실행 가능한 Python 코드만 생성
- 필요한 import 문 포함
- 마지막 줄에 결과 반환
- 주석은 간결하게

컨텍스트:
- 사용 가능한 라이브러리: {available_libraries}
- 이전 셀 결과: {previous_output}

코드만 출력하세요. 설명 없이.
"""

ERROR_REFINEMENT_PROMPT = """
다음 코드가 오류로 실패했습니다:

코드:
```python
{code}
```

오류:
{error_type}: {error_message}
트레이스백:
{traceback}

시도 횟수: {attempt}/{max_attempts}

오류를 분석하고 수정된 코드를 제공하세요. 수정된 코드만 출력하세요.
"""
```

#### 2.2 기존 LLMService 확장
**파일:** `backend/llm_service.py` (수정)

```python
class LLMService:
    # ... 기존 코드 ...

    async def generate_code_hypothesis(
        self,
        request: str,
        context: dict,
        last_error: Optional[dict] = None,
        attempt: int = 0
    ) -> CodeHypothesis:
        """Generate code hypothesis for auto-agent"""
        if attempt == 0 or last_error is None:
            prompt = CODE_GENERATION_PROMPT.format(...)
        else:
            prompt = ERROR_REFINEMENT_PROMPT.format(...)

        response = await self._call_llm(prompt)
        return self._parse_code_hypothesis(response)
```

### Phase 3: Agent Loop - Plan-and-Execute (Week 2-3)

#### 3.1 Frontend AgentOrchestrator 구현 (다중 셀 지원)
**파일:** `frontend/services/AgentOrchestrator.ts`

```typescript
export class AgentOrchestrator {
  private readonly MAX_RETRIES_PER_STEP = 3;
  private readonly EXECUTION_TIMEOUT = 30000; // 30초

  constructor(
    private apiService: ApiService,
    private toolExecutor: ToolExecutor
  ) {}

  async executeTask(
    userRequest: string,
    notebook: NotebookPanel,
    onProgress: (status: AgentStatus) => void
  ): Promise<AutoAgentResult> {

    const createdCells: number[] = [];
    const modifiedCells: number[] = [];
    const executedSteps: StepResult[] = [];

    try {
      // ═══════════════════════════════════════════════════════════
      // PHASE 1: PLANNING - 작업 분해 (HF Jupyter Agent 패턴)
      // ═══════════════════════════════════════════════════════════
      onProgress({ phase: 'planning', message: '작업 계획 수립 중...' });

      const plan = await this.apiService.generateExecutionPlan(userRequest, {
        notebookContext: this.extractNotebookContext(notebook),
        availableTools: ['jupyter_cell', 'markdown', 'final_answer']
      });

      onProgress({
        phase: 'planned',
        plan,
        message: `${plan.totalSteps}단계 실행 계획 생성됨`
      });

      // ═══════════════════════════════════════════════════════════
      // PHASE 2: EXECUTION - 단계별 실행 (Self-Healing 포함)
      // ═══════════════════════════════════════════════════════════
      for (const step of plan.steps) {
        onProgress({
          phase: 'executing',
          currentStep: step.stepNumber,
          totalSteps: plan.totalSteps,
          description: step.description
        });

        const stepResult = await this.executeStepWithRetry(
          step,
          notebook,
          onProgress
        );

        executedSteps.push(stepResult);

        // 생성/수정된 셀 추적
        stepResult.toolResults.forEach(tr => {
          if (tr.cellIndex !== undefined) {
            if (tr.wasModified) modifiedCells.push(tr.cellIndex);
            else createdCells.push(tr.cellIndex);
          }
        });

        // 단계 실패 시 중단
        if (!stepResult.success) {
          return {
            success: false,
            plan,
            executedSteps,
            createdCells,
            modifiedCells,
            error: `Step ${step.stepNumber} 실패: ${stepResult.error}`,
            totalAttempts: this.countTotalAttempts(executedSteps)
          };
        }

        // final_answer 도구 호출 시 완료
        if (stepResult.isFinalAnswer) {
          return {
            success: true,
            plan,
            executedSteps,
            createdCells,
            modifiedCells,
            finalAnswer: stepResult.finalAnswer,
            totalAttempts: this.countTotalAttempts(executedSteps)
          };
        }
      }

      // 모든 단계 성공
      return {
        success: true,
        plan,
        executedSteps,
        createdCells,
        modifiedCells,
        totalAttempts: this.countTotalAttempts(executedSteps)
      };

    } catch (error) {
      return {
        success: false,
        plan: null,
        executedSteps,
        createdCells,
        modifiedCells,
        error: error.message,
        totalAttempts: this.countTotalAttempts(executedSteps)
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Self-Healing: 단계별 재시도 로직
  // ═══════════════════════════════════════════════════════════
  private async executeStepWithRetry(
    step: PlanStep,
    notebook: NotebookPanel,
    onProgress: (status: AgentStatus) => void
  ): Promise<StepResult> {

    let lastError: ExecutionError | null = null;

    for (let attempt = 0; attempt < this.MAX_RETRIES_PER_STEP; attempt++) {
      const toolResults: ToolResult[] = [];

      try {
        // Tool Calling 실행
        for (const toolCall of step.toolCalls) {
          onProgress({
            phase: 'tool_calling',
            tool: toolCall.tool,
            attempt: attempt + 1
          });

          const result = await this.executeWithTimeout(
            () => this.toolExecutor.executeTool(toolCall),
            this.EXECUTION_TIMEOUT
          );

          toolResults.push(result);

          // jupyter_cell 실행 실패 시 재시도 준비
          if (!result.success && toolCall.tool === 'jupyter_cell') {
            lastError = {
              type: 'runtime',
              message: result.error || 'Unknown error',
              traceback: result.traceback || [],
              recoverable: true
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
              finalAnswer: result.output
            };
          }
        }

        // 모든 도구 실행 성공
        if (toolResults.every(r => r.success)) {
          return {
            success: true,
            stepNumber: step.stepNumber,
            toolResults,
            attempts: attempt + 1
          };
        }

        // 에러 발생 시 LLM에게 수정 요청
        if (lastError && attempt < this.MAX_RETRIES_PER_STEP - 1) {
          onProgress({
            phase: 'self_healing',
            attempt: attempt + 1,
            error: lastError
          });

          // LLM에게 수정된 코드 요청
          const fixedToolCalls = await this.apiService.refineStepCode(
            step,
            lastError,
            attempt + 1
          );
          step.toolCalls = fixedToolCalls;
        }

      } catch (error) {
        lastError = {
          type: error.message.includes('timeout') ? 'timeout' : 'runtime',
          message: error.message,
          recoverable: !error.message.includes('timeout')
        };
      }

      // Exponential backoff
      await this.delay(1000 * Math.pow(2, attempt));
    }

    return {
      success: false,
      stepNumber: step.stepNumber,
      toolResults: [],
      attempts: this.MAX_RETRIES_PER_STEP,
      error: lastError?.message || 'Unknown error'
    };
  }

  private extractNotebookContext(notebook: NotebookPanel): NotebookContext {
    const cells = notebook.content.model.cells;
    return {
      cellCount: cells.length,
      recentCells: this.getRecentCells(notebook, 3),
      importedLibraries: this.detectImportedLibraries(notebook),
      definedVariables: this.detectDefinedVariables(notebook)
    };
  }
}
```

### Phase 4: Safety & Validation (Week 3)

#### 4.1 코드 안전 검사기
**파일:** `frontend/utils/SafetyChecker.ts`

```typescript
export class SafetyChecker {
  private readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf/,               // 재귀 삭제
    /os\.system\s*\(/,        // 시스템 명령
    /subprocess\./,           // 서브프로세스
    /eval\s*\(/,              // eval
    /exec\s*\(/,              // exec
    /__import__/,             // 동적 임포트
    /open\s*\([^)]*,\s*['"]w/ // 파일 쓰기
  ];

  checkCodeSafety(code: string): SafetyResult {
    const warnings: string[] = [];

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        warnings.push(`위험한 패턴 감지: ${pattern.source}`);
      }
    }

    return { safe: warnings.length === 0, warnings };
  }
}
```

#### 4.2 실행 시간 제한
```typescript
// TimeoutGuard는 AgentLoop에 통합
// 30초 기본값, 사용자 설정 가능 (10-300초)
```

### Phase 5: UI Integration (Week 3-4)

#### 5.1 AutoAgentPanel 컴포넌트
**파일:** `frontend/components/AutoAgentPanel.tsx`

```tsx
export const AutoAgentPanel: React.FC<Props> = ({ notebook, onComplete }) => {
  const [status, setStatus] = useState<AgentStatus>({ phase: 'idle' });
  const [request, setRequest] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const handleExecute = async () => {
    setIsRunning(true);
    const agentLoop = new AgentLoop(apiService, autoAgentService);

    try {
      const result = await agentLoop.executeTask(
        request,
        notebook,
        (status) => setStatus(status)
      );
      onComplete(result);
    } catch (error) {
      // 에러 처리
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="auto-agent-panel">
      <div className="input-section">
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="원하는 작업을 설명하세요..."
          disabled={isRunning}
        />
        <button onClick={handleExecute} disabled={isRunning || !request}>
          {isRunning ? '실행 중...' : '자동 실행'}
        </button>
      </div>

      <StatusIndicator status={status} />

      {status.phase === 'retrying' && (
        <RetryProgress
          attempt={status.attempt}
          maxRetries={3}
          error={status.error}
        />
      )}
    </div>
  );
};
```

#### 5.2 기존 AgentPanel에 통합
**파일:** `frontend/components/AgentPanel.tsx` (수정)

```tsx
// 채팅 패널에 Auto-Agent 모드 토글 추가
<div className="mode-selector">
  <button
    className={mode === 'chat' ? 'active' : ''}
    onClick={() => setMode('chat')}
  >
    채팅
  </button>
  <button
    className={mode === 'auto' ? 'active' : ''}
    onClick={() => setMode('auto')}
  >
    자동 에이전트
  </button>
</div>

{mode === 'auto' && (
  <AutoAgentPanel notebook={currentNotebook} onComplete={handleAutoComplete} />
)}
```

---

## File Structure (New Files)

```
frontend/
├── services/
│   ├── ToolExecutor.ts           # 📝 Tool 실행기 (jupyter_cell, markdown, final_answer)
│   ├── AgentOrchestrator.ts      # 🎯 Plan-and-Execute 오케스트레이터
│   └── NotebookContextExtractor.ts # 📊 노트북 컨텍스트 추출
├── components/
│   ├── AutoAgentPanel.tsx        # 🖥️ Auto-Agent UI 메인 패널
│   ├── ExecutionPlanView.tsx     # 📋 실행 계획 시각화
│   ├── StepProgressIndicator.tsx # ⏳ 단계별 진행 상태 표시
│   └── ToolCallLog.tsx           # 📜 Tool 호출 로그 뷰어
├── utils/
│   └── SafetyChecker.ts          # 🔒 코드 안전 검사
└── types/
    └── auto-agent.ts             # 📝 Auto-Agent 관련 타입 정의

backend/
├── handlers/
│   ├── auto_agent.py             # 🔌 Auto-Agent API 핸들러
│   └── plan_generator.py         # 📋 실행 계획 생성 핸들러
├── prompts/
│   ├── auto_agent_prompts.py     # 💬 Tool Calling 프롬프트
│   ├── planning_prompts.py       # 📋 Plan 생성 프롬프트
│   └── self_healing_prompts.py   # 🔧 에러 수정 프롬프트
└── services/
    ├── plan_executor.py          # 🎯 계획 실행 서비스
    └── code_validator.py         # ✅ 코드 검증 서비스
```

### Key Components Overview

| 컴포넌트 | 역할 | HF Jupyter Agent 참조 |
|---------|------|---------------------|
| **ToolExecutor** | 3가지 도구 실행 및 결과 캡처 | `jupyter_cell`, `markdown`, `final_answer` 패턴 |
| **AgentOrchestrator** | 다중 셀 Plan-and-Execute | 순환적 메시지 흐름 |
| **SafetyChecker** | 위험 코드 패턴 사전 검출 | E2B 격리 실행 대안 |
| **NotebookContextExtractor** | 노트북 상태 분석 | 컨텍스트 읽기 기능 |

---

## API Endpoints (New)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/hdsp-agent/auto-agent/plan` | 📋 실행 계획 생성 (Plan-and-Execute) |
| POST | `/hdsp-agent/auto-agent/refine` | 🔧 에러 기반 코드 수정 (Self-Healing) |
| POST | `/hdsp-agent/auto-agent/tool-call` | 📝 단일 도구 호출 요청 |
| GET | `/hdsp-agent/auto-agent/status/{taskId}` | ⏳ 작업 상태 조회 |
| GET | `/hdsp-agent/auto-agent/stream/{taskId}` | 📡 실시간 진행 상황 스트리밍 (SSE) |

### Tool Calling Request/Response 예시

```typescript
// POST /hdsp-agent/auto-agent/plan
// Request
{
  "request": "데이터 로드하고 전처리 후 시각화해줘",
  "notebookContext": {
    "cellCount": 5,
    "importedLibraries": ["pandas", "numpy"],
    "definedVariables": ["df", "data"]
  }
}

// Response
{
  "plan": {
    "totalSteps": 3,
    "steps": [
      {
        "stepNumber": 1,
        "description": "데이터 로드",
        "toolCalls": [
          { "tool": "jupyter_cell", "parameters": { "code": "df = pd.read_csv('data.csv')\ndf.head()" }}
        ]
      },
      {
        "stepNumber": 2,
        "description": "데이터 전처리",
        "toolCalls": [
          { "tool": "markdown", "parameters": { "content": "## 데이터 전처리" }},
          { "tool": "jupyter_cell", "parameters": { "code": "df = df.dropna()\ndf.describe()" }}
        ]
      },
      {
        "stepNumber": 3,
        "description": "시각화",
        "toolCalls": [
          { "tool": "jupyter_cell", "parameters": { "code": "df.plot(kind='bar')\nplt.show()" }},
          { "tool": "final_answer", "parameters": { "answer": "데이터 로드, 전처리, 시각화를 완료했습니다." }}
        ]
      }
    ]
  }
}
```

---

## Risk Mitigation

### 1. 무한 루프 방지
- **30초 실행 타임아웃** (기본값)
- **커널 인터럽트 버튼** 제공
- **while True** 패턴 사전 감지

### 2. 컨텍스트 오버플로우 방지
- **대화 요약** (5개 메시지마다)
- **선택적 컨텍스트** (최근 3개 셀만)
- **토큰 예산 추적**

### 3. LLM 환각 방지
- **가설 검증** (예상 출력 vs 실제 출력)
- **동일 에러 반복 감지** (2회 연속 시 중단)
- **사용자 확인** (위험 작업 전)

### 4. 보안
- **위험 코드 패턴 스캔**
- **파일 시스템 접근 경고**
- **감사 로깅** (모든 자동 생성 코드 기록)

---

## Success Criteria

### 1. 기능 완성도 (Core Features)

| 기능 | 설명 | HF Jupyter Agent 참조 |
|-----|------|---------------------|
| ✅ 다중 셀 지원 | 하나의 요청으로 여러 셀 순차 생성/실행 | Plan-and-Execute 패턴 |
| ✅ 기존 셀 수정 | 새 셀 생성 뿐 아니라 기존 셀 수정 가능 | `cellIndex` 파라미터 |
| ✅ Tool Calling | 3가지 도구 (jupyter_cell, markdown, final_answer) | HF Agent 패턴 |
| ✅ 계획 수립 | 복잡한 작업을 단계별로 분해 | Planning Phase |
| ✅ Self-Healing | 에러 발생 시 자동 수정 및 재시도 (최대 3회/단계) | 단계별 추론 추적 |
| ✅ 실시간 진행 상황 | SSE 스트리밍으로 각 단계 상태 표시 | 기존 HDSP 패턴 활용 |

### 2. 안정성 (Safety & Reliability)

| 항목 | 설명 |
|-----|------|
| ⏱️ 실행 타임아웃 | 30초 기본값 (설정 가능) |
| 🔄 무한 루프 방지 | `while True` 패턴 사전 감지 + 커널 인터럽트 |
| 🔒 위험 코드 검사 | rm -rf, eval, exec 등 사전 경고 |
| 📊 토큰 예산 관리 | 컨텍스트 오버플로우 방지 |
| 🔙 작업 취소 | 실행 중인 작업 중단 기능 |

### 3. 사용성 (User Experience)

| 항목 | 설명 |
|-----|------|
| 🎨 UI 일관성 | 기존 HDSP Agent 디자인 시스템 준수 |
| 📋 계획 시각화 | 실행 계획을 단계별로 시각적 표시 |
| ⏳ 진행 표시기 | 현재 단계, 총 단계, 재시도 횟수 표시 |
| 📝 Tool 로그 | 각 Tool 호출 결과 상세 로그 |
| ❌ 에러 메시지 | 사용자가 이해할 수 있는 한국어 에러 메시지 |

---

## Estimated Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Core Infrastructure | 1 week | AutoAgentService, 셀 실행/캡처 |
| Phase 2: LLM Integration | 1 week | 프롬프트, 코드 생성 API |
| Phase 3: Agent Loop | 1 week | ReAct 루프, 재시도 로직 |
| Phase 4: Safety | 0.5 week | 안전 검사, 타임아웃 |
| Phase 5: UI | 0.5 week | AutoAgentPanel, 통합 |
| Testing & Polish | 1 week | E2E 테스트, 버그 수정 |

**Total: 5 weeks**

---

## User Requirements (Confirmed)

1. **LLM Provider**: 기존 사용자 설정 사용 (별도 기본값 없음)

2. **셀 수정 범위**: **기존 셀 수정 가능** - Fix 기능처럼 기존 셀을 직접 수정할 수 있음

3. **다중 셀 지원**: **다중 셀 지원** - 복잡한 작업을 여러 셀로 분할하여 순차 실행 (Plan-and-Execute 패턴 적용)
