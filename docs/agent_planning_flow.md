# HDSP Agent - Plan-and-Execute 아키텍처 흐름

## 개요

HDSP Agent는 HuggingFace Jupyter Agent에서 영감을 받은 **Plan-and-Execute 패턴**을 구현합니다.
사용자 요청을 받아 계획을 수립하고, 단계별로 실행하며, 오류 발생 시 적응적으로 재계획합니다.

### 아키텍처 개요

HDSP Agent는 **Agent Server 분리 아키텍처**를 채택합니다:

```
┌─────────────────────────────┐          HTTP/REST          ┌─────────────────────────────┐
│     JupyterLab Extension    │  ◀────────────────────────▶ │       Agent Server          │
│         (Frontend)          │                             │        (FastAPI)            │
│                             │                             │                             │
│  ┌───────────────────────┐  │                             │  ┌───────────────────────┐  │
│  │     ApiService.ts     │──┼─────── /agent/plan ────────▶│  │   routers/agent.py    │  │
│  │  (Rate Limit 처리)    │  │                             │  │   routers/chat.py     │  │
│  └───────────────────────┘  │                             │  └───────────────────────┘  │
│             │               │                             │             │               │
│             ▼               │                             │             ▼               │
│  ┌───────────────────────┐  │                             │  ┌───────────────────────┐  │
│  │  AgentOrchestrator.ts │  │                             │  │     LLMService.py     │  │
│  │   (상태 머신 관리)      │  │                             │  │   (Gemini/OpenAI)     │  │
│  └───────────────────────┘  │                             │  └───────────────────────┘  │
└─────────────────────────────┘                             └─────────────────────────────┘
```

**설계 원칙:**
- **클라이언트-서버 분리**: Frontend는 도구 실행만, Agent Server는 LLM 호출 담당
- **API 키 보안**: 서버는 API 키를 저장하지 않음 (요청마다 클라이언트가 전송)
- **결정론적 서브시스템**: 에러 분류/상태 검증은 LLM 없이 패턴 매칭으로 처리

---

## 전체 흐름도

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         사용자 요청 (User Request)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Knowledge Base 동적 로딩 (Mini RAG)                                  │
│     - 요청에서 라이브러리 키워드 감지 (dask, polars, pyspark 등)            │
│     - 해당 라이브러리의 API 가이드 자동 로드                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Planning (계획 수립) - POST /agent/plan                              │
│     - System Prompt + 사용자 요청 + 노트북 컨텍스트 + 라이브러리 지식        │
│     - LLM이 실행 계획(steps) 생성                                         │
│     - 각 step은 tool 호출 정의 포함                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Pre-Validation (사전 검증)                                           │
│     - Ruff 기반 고속 정적 분석 (700+ 규칙, 보안/스타일/버그 패턴)            │
│     - AST 파싱으로 구문 분석 및 의존성 추출                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. Step-by-Step Execution (단계별 실행)                                  │
│     - jupyter_cell: 셀 생성/수정/삽입 및 실행                              │
│     - markdown: 마크다운 셀 생성                                          │
│     - final_answer: 최종 답변 제공                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            ┌──────────────┐                ┌──────────────┐
            │   성공 (✓)    │                │   오류 (✗)    │
            └──────────────┘                └──────────────┘
                    │                               │
                    ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. State Verification (상태 검증) - POST /agent/verify-state            │
│     - 결정론적 검증 (LLM 호출 없음)                                        │
│     - 신뢰도 점수 계산 (0.0 ~ 1.0)                                        │
│     - 불일치 항목 식별                                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            ┌──────────────┐                ┌──────────────┐
            │  계속 진행    │                │   재계획 필요  │
            └──────────────┘                └──────────────┘
                    │                               │
                    ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. Adaptive Replanning (적응적 재계획) - POST /agent/replan             │
│     - refine: 현재 step 수정 (POST /agent/refine)                        │
│     - insert_steps: 새로운 step 삽입                                     │
│     - replace_step: step 교체                                            │
│     - replan_remaining: 나머지 전체 재계획                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                            ┌──────────────┐
                            │   완료/실패   │
                            └──────────────┘
```

---

## API 엔드포인트

### Agent API (`/agent/*`)

| 엔드포인트 | 메서드 | 설명 | LLM 호출 |
|------------|--------|------|----------|
| `/agent/plan` | POST | 실행 계획 생성 | ✓ |
| `/agent/refine` | POST | 코드 수정 (Self-Healing) | ✓ |
| `/agent/replan` | POST | 적응적 재계획 결정 | ✗ (결정론적) |
| `/agent/verify-state` | POST | 상태 검증 | ✗ (결정론적) |
| `/agent/report-execution` | POST | 실행 결과 보고 | ✗ |

### Chat API (`/chat/*`)

| 엔드포인트 | 메서드 | 설명 | LLM 호출 |
|------------|--------|------|----------|
| `/chat/message` | POST | 채팅 메시지 | ✓ |
| `/chat/stream` | POST | 스트리밍 응답 (SSE) | ✓ |

### 요청 예시

```json
// POST /agent/plan
{
  "request": "pandas로 CSV 파일을 읽어서 데이터 분석해줘",
  "notebookContext": {
    "cellCount": 5,
    "importedLibraries": ["pandas", "numpy"],
    "definedVariables": ["df", "data"],
    "recentCells": [...]
  },
  "llmConfig": {
    "provider": "gemini",
    "gemini": {
      "apiKey": "AIza...",
      "model": "gemini-2.5-flash"
    }
  }
}
```

---

## 내장 도구 (Built-in Tools)

### jupyter_cell

Python 코드 셀을 생성, 수정, 삽입합니다.

| 액션 | 파라미터 | 설명 |
|------|----------|------|
| `CREATE` | `code` | 새 코드 셀 생성 및 실행 |
| `MODIFY` | `code`, `cellId` | 기존 셀 내용 수정 |
| `INSERT_AFTER` | `code`, `cellId` | 지정된 셀 뒤에 새 셀 삽입 |
| `INSERT_BEFORE` | `code`, `cellId` | 지정된 셀 앞에 새 셀 삽입 |

```json
{
  "tool": "jupyter_cell",
  "parameters": {
    "action": "CREATE",
    "code": "import pandas as pd\ndf = pd.read_csv('data.csv')"
  }
}
```

### markdown

마크다운 형식의 설명 셀을 생성합니다.

| 파라미터 | 설명 |
|----------|------|
| `content` | 마크다운 텍스트 |

```json
{
  "tool": "markdown",
  "parameters": {
    "content": "## 데이터 분석 결과\n분석이 완료되었습니다."
  }
}
```

### final_answer

최종 답변을 제공합니다. 변수 치환을 지원합니다.

| 파라미터 | 설명 |
|----------|------|
| `answer` | 최종 답변 텍스트 (`{{변수명}}` 형식으로 치환 가능) |

```json
{
  "tool": "final_answer",
  "parameters": {
    "answer": "데이터 로드가 완료되었습니다. 총 {{row_count}}개의 행이 있습니다."
  }
}
```

### read_file

파일 내용을 읽습니다. 작업 디렉토리 내 파일만 접근 가능합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 파일 경로 (상대 경로) | 필수 |
| `encoding` | 파일 인코딩 | `utf-8` |
| `maxLines` | 최대 읽을 라인 수 | 없음 (전체) |

```json
{
  "tool": "read_file",
  "parameters": {
    "path": "data/config.json",
    "maxLines": 100
  }
}
```

### write_file

파일에 내용을 씁니다. **항상 사용자 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 파일 경로 (상대 경로) | 필수 |
| `content` | 작성할 내용 | 필수 |
| `overwrite` | 기존 파일 덮어쓰기 | `false` |

```json
{
  "tool": "write_file",
  "parameters": {
    "path": "output/result.csv",
    "content": "col1,col2\n1,2",
    "overwrite": true
  }
}
```

### list_files

디렉토리의 파일 목록을 조회합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 디렉토리 경로 | `.` (현재) |
| `recursive` | 재귀적 탐색 | `false` |
| `pattern` | 파일 패턴 (glob) | `*` |

```json
{
  "tool": "list_files",
  "parameters": {
    "path": "data",
    "recursive": true,
    "pattern": "*.csv"
  }
}
```

### execute_command

셸 명령을 실행합니다. **위험한 명령은 사용자 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `command` | 실행할 명령 | 필수 |
| `timeout` | 타임아웃 (초) | `30` |

```json
{
  "tool": "execute_command",
  "parameters": {
    "command": "pip install pandas",
    "timeout": 60
  }
}
```

**위험 명령 패턴 (승인 필요):**
- `rm`, `rm -rf`, `rmdir`
- `sudo`, `su`
- `chmod 777`, `chown`
- `> /dev`, `mkfs`, `dd`
- `curl | sh`, `wget | sh`

### search_files

파일 내용을 검색합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `pattern` | 검색 패턴 (정규식) | 필수 |
| `path` | 검색 시작 경로 | `.` |
| `maxResults` | 최대 결과 수 | `50` |

```json
{
  "tool": "search_files",
  "parameters": {
    "pattern": "import pandas",
    "path": "src",
    "maxResults": 20
  }
}
```

---

## 결정론적 서브시스템

LLM 호출 없이 패턴 매칭으로 처리되는 서브시스템입니다.

### ErrorClassifier

에러 유형을 패턴 기반으로 분류하여 재계획 결정을 내립니다.

```python
# agent-server/agent_server/core/error_classifier.py

class ReplanDecision(Enum):
    REFINE = "refine"           # 현재 step 코드만 수정
    INSERT_STEPS = "insert_steps"  # 새 step 삽입
    REPLACE_STEP = "replace_step"  # step 교체
    REPLAN_REMAINING = "replan_remaining"  # 나머지 전체 재계획
    ABORT = "abort"             # 중단
```

**분류 규칙 예시:**
| 에러 패턴 | 결정 |
|-----------|------|
| `SyntaxError`, `IndentationError` | REFINE |
| `ModuleNotFoundError`, `ImportError` | INSERT_STEPS (import 추가) |
| `NameError` (미정의 변수) | REPLAN_REMAINING |
| `PermissionError`, `OSError` | ABORT |

#### LLM Fallback 메커니즘

패턴 매칭만으로 해결이 어려운 복잡한 에러의 경우, LLM 기반 분석으로 폴백합니다.

**LLM Fallback 트리거 조건:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         에러 발생                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  조건 #1: 동일 에러로 2회 이상 실패?                                       │
│  (previousAttempts >= 2)                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Yes                           │ No
                    ▼                               ▼
            ┌──────────────┐            ┌─────────────────────────────────┐
            │  LLM Fallback │            │  조건 #2: 미지의 에러 타입?        │
            └──────────────┘            │  (패턴 매핑에 없음)                │
                                        └─────────────────────────────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │ Yes                           │ No
                                    ▼                               ▼
                            ┌──────────────┐        ┌─────────────────────────────────┐
                            │  LLM Fallback │        │  조건 #3: 복잡한 트레이스백?       │
                            └──────────────┘        │  (2개 이상 Exception 포함)        │
                                                    └─────────────────────────────────┘
                                                                │
                                                ┌───────────────┴───────────────┐
                                                │ Yes                           │ No
                                                ▼                               ▼
                                        ┌──────────────┐            ┌──────────────┐
                                        │  LLM Fallback │            │  패턴 매칭    │
                                        └──────────────┘            └──────────────┘
```

**API 응답 확장:**
```python
class ReplanResponse:
    decision: str       # refine/insert_steps/replace_step/replan_remaining
    analysis: Dict      # 분석 상세 정보
    reasoning: str      # 결정 이유
    changes: Dict       # 제안된 변경사항
    usedLlm: bool       # LLM 폴백 사용 여부 (NEW)
    confidence: float   # 분석 신뢰도 0.0~1.0 (NEW)
```

**신뢰도 점수:**
- `1.0`: 패턴 매칭 (결정론적)
- `0.8~0.95`: LLM 분석 (높은 신뢰도)
- `0.3~0.7`: LLM 분석 (낮은 신뢰도, 파싱 실패 등)

### StateVerifier

실행 결과의 상태를 검증하고 신뢰도 점수를 계산합니다.

```python
# agent-server/agent_server/core/state_verifier.py

class VerificationResult:
    verified: bool           # 검증 통과 여부
    confidence: float        # 신뢰도 (0.0 ~ 1.0)
    discrepancies: List[str] # 불일치 항목
```

**신뢰도 계산 기준:**
- 출력 존재 여부
- 예상 변수 정의 여부
- 에러 발생 여부
- 실행 시간 정상 범위 여부

### LibraryDetector

요청 텍스트에서 라이브러리 키워드를 감지합니다.

```python
# agent-server/agent_server/knowledge/loader.py

# 키워드 스코어링으로 라이브러리 감지
detected = detector.detect(
    request="dask로 대용량 CSV 병렬 처리",
    available_libraries=["dask", "polars", "pandas"],
    imported_libraries=["pandas"]
)
# 결과: ["dask"]
```

---

## Knowledge Base 동적 로딩 (Mini RAG)

사용자 요청에서 특정 라이브러리 키워드를 감지하면, 해당 라이브러리의 API 가이드를 자동으로 로드합니다.

**지원 라이브러리:**
| 트리거 키워드 | 로드되는 가이드 |
|--------------|----------------|
| `dask`, `dask.dataframe`, `dd.read` | `dask.md` |
| `polars`, `pl.read` | `polars.md` |
| `pyspark`, `spark` | `pyspark.md` |
| `vaex` | `vaex.md` |
| `modin` | `modin.md` |
| `ray` | `ray.md` |

**예시: Dask 요청 처리**
```
사용자: "dask로 대용량 CSV 파일을 병렬 처리해줘"
         ↓
1. "dask" 키워드 감지
2. agent-server/agent_server/knowledge/libraries/dask.md 로드
3. 플래닝 프롬프트에 Dask API 가이드 포함
4. LLM이 올바른 Dask 문법으로 계획 생성
```

**코드 위치:** `agent-server/agent_server/knowledge/loader.py`

---

## Pre-Validation (사전 검증)

실행 전 코드 품질 검사를 수행합니다.

### 검증 도구 비교

| 도구 | 특징 | 검사 범위 |
|------|------|----------|
| **Ruff** | Rust 기반 초고속 린터 (700+ 규칙) | F (Pyflakes), E/W (스타일), S (보안), B (버그 패턴) |
| **AST** | Python 내장 파서 | 구문 분석, 의존성 추출 |

### Ruff 규칙 카테고리

| 규칙 코드 | 카테고리 | 설명 | 심각도 |
|----------|---------|------|--------|
| F821 | undefined_name | 미정의 변수/함수 | ERROR |
| F401 | unused_import | 미사용 import | WARNING |
| S102 | security | `exec()` 사용 감지 | WARNING |
| E9xx | syntax | 런타임 에러 | ERROR |

### Ruff 자동 수정 (--fix)

코드 검증 시 Ruff의 자동 수정 기능을 활용하여 LLM 토큰을 절약합니다.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         코드 검증 요청                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Pass 1: ruff check --fix                                               │
│  - 자동 수정 가능한 이슈 자동 처리                                         │
│  - F401 (미사용 import), W (스타일) 등 자동 수정                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Pass 2: ruff check (검증 전용)                                          │
│  - 자동 수정 불가능한 이슈만 반환                                           │
│  - F821 (미정의 변수), S (보안) 등                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            ┌──────────────┐                ┌──────────────┐
            │  이슈 없음    │                │  이슈 있음    │
            │  (수정된 코드) │                │  (LLM에 전달) │
            └──────────────┘                └──────────────┘
```

**API 응답 확장:**
```python
class ValidateResponse:
    valid: bool                     # 검증 통과 여부
    issues: List[ValidationIssue]   # 자동 수정 불가 이슈
    fixedCode: Optional[str]        # 자동 수정된 코드 (NEW)
    fixedCount: int                 # 자동 수정된 이슈 수 (NEW)
```

**효과:**
- 스타일/포맷팅 이슈는 LLM 호출 없이 즉시 수정
- LLM에 전달되는 이슈 수 감소 → 토큰 절약
- 응답 속도 향상

**코드 위치:** `agent-server/agent_server/core/code_validator.py`

---

## Frontend 상태 머신

```
                                    ┌─────────────┐
                                    │    idle     │
                                    └──────┬──────┘
                                           │ 사용자 요청
                                           ▼
                                    ┌─────────────┐
                                    │  planning   │ ──── POST /agent/plan
                                    └──────┬──────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │   planned   │
                                    └──────┬──────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                              ┌──── │  executing  │ ────┐
                              │     └─────────────┘     │
                              │ 성공                   오류 │
                              ▼                         ▼
                       ┌─────────────┐          ┌─────────────┐
                       │ validating  │          │  reflecting │
                       └──────┬──────┘          └──────┬──────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────┐          ┌─────────────┐
                       │  verifying  │          │ replanning  │
                       └──────┬──────┘          └──────┬──────┘
                              │                        │
          ┌───────────────────┴────────────────────────┘
          │
          ▼
    ┌───────────┐                               ┌──────────┐
    │ completed │                               │  failed  │
    └───────────┘                               └──────────┘
```

### 상태 설명

| 상태 | 설명 |
|------|------|
| `idle` | 대기 상태 |
| `planning` | LLM에 계획 요청 중 |
| `planned` | 계획 수립 완료, 실행 대기 |
| `executing` | 현재 step 실행 중 |
| `validating` | 코드 사전 검증 중 |
| `verifying` | 실행 결과 상태 검증 중 |
| `reflecting` | 오류 분석 중 |
| `replanning` | 재계획 중 |
| `completed` | 모든 step 완료 |
| `failed` | 복구 불가 오류 |

**코드 위치:** `extensions/jupyter/frontend/services/AgentOrchestrator.ts`

---

## Rate Limit 처리

### 개요

API Rate Limit (429) 발생 시 자동으로 다음 API 키로 교체합니다.

```
┌───────────────┐     429 발생      ┌───────────────┐
│   API 호출     │ ──────────────▶  │  키 교체       │
│   (Key #1)    │                  │  (Key #2)     │
└───────────────┘                  └───────────────┘
       │                                  │
       │ 성공                             │ 재시도
       ▼                                  ▼
  ┌───────────┐                    ┌───────────────┐
  │   완료     │                    │  API 재호출    │
  └───────────┘                    └───────────────┘
```

### fetchWithKeyRotation 래퍼

모든 LLM API 호출에 전역으로 적용되는 래퍼입니다.

```typescript
// extensions/jupyter/frontend/services/ApiService.ts

private async fetchWithKeyRotation<T>(
  url: string,
  request: { llmConfig?: any; [key: string]: any },
  options?: {
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void;
    defaultErrorMessage?: string;
  }
): Promise<T>
```

**특징:**
- 최대 10회 재시도
- 성공 시 키 로테이션 상태 리셋
- 모든 키 소진 시 명확한 에러 메시지
- 프론트엔드 전용 (서버는 키를 저장하지 않음)

### 적용 API

- `generateExecutionPlan()`
- `refineStepCode()`
- `replanExecution()`
- `sendMessage()`
- `cellAction()`
- `fileAction()`
- `validateCode()`
- `reflectOnExecution()`
- `verifyState()`

**코드 위치:**
- `extensions/jupyter/frontend/services/ApiService.ts`
- `extensions/jupyter/frontend/services/ApiKeyManager.ts`

---

## 핵심 파일 위치

### Agent Server

| 컴포넌트 | 파일 경로 |
|----------|----------|
| API 라우터 | `agent-server/agent_server/routers/agent.py` |
| Chat 라우터 | `agent-server/agent_server/routers/chat.py` |
| 프롬프트 템플릿 | `agent-server/agent_server/prompts/auto_agent_prompts.py` |
| Knowledge Base | `agent-server/agent_server/knowledge/loader.py` |
| 라이브러리 가이드 | `agent-server/agent_server/knowledge/libraries/*.md` |
| 코드 검증기 | `agent-server/agent_server/core/code_validator.py` |
| 에러 분류기 | `agent-server/agent_server/core/error_classifier.py` |
| 상태 검증기 | `agent-server/agent_server/core/state_verifier.py` |
| LLM 서비스 | `agent-server/agent_server/core/llm_service.py` |

### Frontend (JupyterLab Extension)

| 컴포넌트 | 파일 경로 |
|----------|----------|
| API 서비스 | `extensions/jupyter/frontend/services/ApiService.ts` |
| API 키 관리 | `extensions/jupyter/frontend/services/ApiKeyManager.ts` |
| 오케스트레이터 | `extensions/jupyter/frontend/services/AgentOrchestrator.ts` |
| 도구 실행기 | `extensions/jupyter/frontend/services/ToolExecutor.ts` |
| 체크포인트 관리 | `extensions/jupyter/frontend/services/CheckpointManager.ts` |
| 컨텍스트 관리 | `extensions/jupyter/frontend/services/ContextManager.ts` |
| 타입 정의 | `extensions/jupyter/frontend/types/agent.ts` |

---

## 아키텍처 특징

1. **Self-Healing**: 오류 발생 시 자동으로 코드 수정 시도
2. **Context-Aware**: 노트북 상태를 지속적으로 추적
3. **Knowledge-Enhanced**: 라이브러리별 전문 지식 동적 로딩
4. **Fail-Fast Validation**: 실행 전 코드 품질 사전 검증 + Ruff 자동 수정
5. **Adaptive Planning**: 상황에 따른 유연한 계획 수정
6. **Deterministic Subsystems**: 에러 분류/상태 검증은 LLM 없이 처리
7. **LLM Fallback**: 패턴 매칭 실패 시 LLM 기반 에러 분석
8. **Extended Toolset**: 파일/셸 작업 지원 (read_file, write_file, execute_command 등)
9. **Rate Limit Resilience**: 자동 API 키 교체로 서비스 연속성 보장

---

## 참고 프로젝트

개발 과정에서 다음 오픈소스 프로젝트를 참고했습니다:
- [Roo Code](https://github.com/RooVetGit/Roo-Code)
- [Cline](https://github.com/cline/cline)
- [Continue](https://github.com/continuedev/continue)
- [Void](https://github.com/voideditor/void)
