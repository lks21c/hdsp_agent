# HDSP Agent - 프롬프트 레퍼런스

본 문서는 HDSP Agent에서 사용하는 모든 LLM 프롬프트를 정리합니다.

← [메인 문서로 돌아가기](./agent_planning_flow.md)

---

## 📑 목차

| # | 프롬프트 | 호출 시점 | LLM 호출 |
|---|----------|----------|----------|
| 1 | [PLAN_GENERATION_PROMPT](#1-plan_generation_prompt) | 계획 수립 (POST /agent/plan) | ✓ |
| 2 | [STRUCTURED_PLAN_PROMPT](#2-structured_plan_prompt) | 향상된 계획 수립 (Enhanced Planning) | ✓ |
| 3 | [CODE_GENERATION_PROMPT](#3-code_generation_prompt) | 단일 셀 코드 생성 | ✓ |
| 4 | [ERROR_REFINEMENT_PROMPT](#4-error_refinement_prompt) | Self-Healing (POST /agent/refine) | ✓ |
| 5 | [ADAPTIVE_REPLAN_PROMPT](#5-adaptive_replan_prompt) | 적응적 재계획 (POST /agent/replan) | ✓ |
| 6 | [REFLECTION_PROMPT](#6-reflection_prompt) | 실행 결과 분석 | ✓ |
| 7 | [ERROR_ANALYSIS_PROMPT](#7-error_analysis_prompt) | LLM Fallback 에러 분석 | ✓ |
| 8 | [FINAL_ANSWER_PROMPT](#8-final_answer_prompt) | 최종 답변 생성 | ✓ |
| 9 | [Cell Action Prompts](#9-cell-action-prompts) | 셀 설명/수정/커스텀 | ✓ |
| 10 | [File Action Prompts](#10-file-action-prompts) | 파일 분석/수정 | ✓ |

---

## 전체 흐름에서 프롬프트 호출 위치

```
사용자 요청
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Knowledge Base 동적 로딩 (RAG)                                   │
│     - 프롬프트 호출 없음 (벡터 검색만)                                 │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. Planning                                                         │
│     ✦ PLAN_GENERATION_PROMPT 또는 STRUCTURED_PLAN_PROMPT             │
│     - RAG 컨텍스트 + 노트북 상태 + 사용자 요청 → LLM → 실행 계획        │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Pre-Validation (Ruff)                                            │
│     - 프롬프트 호출 없음 (결정론적 코드 검증)                           │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Step-by-Step Execution                                           │
│     - 🔧 도구 실행 (ToolExecutor) ← 여기서 18개 도구 호출!             │
│     - 프롬프트 호출 없음 (계획된 코드 실행만)                           │
└─────────────────────────────────────────────────────────────────────┘
     │
     ├─── 성공 ───┐
     │            ▼
     │    ┌───────────────────────────────────────────────────────────┐
     │    │  5a. State Verification                                    │
     │    │      - 프롬프트 호출 없음 (결정론적 검증)                    │
     │    │                                                            │
     │    │  (선택) REFLECTION_PROMPT                                  │
     │    │      - 실행 결과 분석 및 조정 제안                           │
     │    └───────────────────────────────────────────────────────────┘
     │
     └─── 실패 ───┐
                  ▼
          ┌───────────────────────────────────────────────────────────┐
          │  5b. Error Classification                                  │
          │      - 패턴 매칭 우선 (프롬프트 없음)                        │
          │      - 필요시 ERROR_ANALYSIS_PROMPT (LLM Fallback)          │
          └───────────────────────────────────────────────────────────┘
                  │
                  ▼
          ┌───────────────────────────────────────────────────────────┐
          │  6. Adaptive Replanning                                    │
          │     ✦ ADAPTIVE_REPLAN_PROMPT                               │
          │     - 에러 정보 + 실행 이력 → LLM → 복구 전략               │
          │                                                            │
          │     또는 (단순 수정 시)                                     │
          │     ✦ ERROR_REFINEMENT_PROMPT                              │
          │     - 원래 코드 + 에러 → LLM → 수정된 코드                   │
          └───────────────────────────────────────────────────────────┘
                  │
                  ▼
          ┌───────────────────────────────────────────────────────────┐
          │  7. 재실행 → 4. Step-by-Step Execution으로 돌아감           │
          └───────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  완료                                                                │
│  ✦ FINAL_ANSWER_PROMPT (선택)                                        │
│  - 실행 결과 요약 생성                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. PLAN_GENERATION_PROMPT

**용도**: 사용자 요청을 단계별 실행 계획으로 변환

**호출 시점**: `POST /agent/plan`

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
Jupyter 노트북 Python 전문가. 단계별 실행 계획을 JSON으로 생성.

## 도구
### 기본 도구 (셀 작업)
1. **jupyter_cell**: {"code": "Python코드"} - 노트북 끝에 새 셀 추가
2. **markdown**: {"content": "마크다운"} - 설명 셀 추가
3. **final_answer**: {"answer": "완료메시지"} - 작업 완료

### 확장 도구 (파일/터미널)
4. **read_file**: {"path": "상대경로"} - 파일 읽기 (절대경로/.. 금지)
5. **write_file**: {"path": "상대경로", "content": "내용"} - 파일 쓰기 (승인 필요)
6. **list_files**: {"path": ".", "recursive": false, "pattern": "*.py"} - 디렉토리 조회
7. **execute_command**: {"command": "pip list"} - 셸 명령 (위험 명령만 승인)
8. **search_files**: {"pattern": "def func", "path": "src"} - 파일 내용 검색

## 핵심 원칙 (CRITICAL!)
1. ⛔ **기존 셀 수정 금지! 항상 새 셀을 노트북 끝에 추가**
2. ⛔ **기존 변수(df 등)에 의존 금지! 새 셀은 독립적으로 실행 가능해야 함**
3. ✅ **데이터 로딩/정의를 포함한 완전한 코드 작성** (기존 코드는 참고용)

## 노트북 현황 (참고용 - 기존 변수 사용 금지!)
- 셀: {cell_count}개 | 라이브러리: {imported_libraries} | 변수: {defined_variables}
- 최근 셀 (참고용):
{recent_cells}

## 환경: {available_libraries}

## 요청: {request}

## 규칙
1. 최대 10단계, 마지막은 final_answer
2. 한글 설명, 한자 금지
3. 미설치 패키지: `!pip install {PIP_INDEX_OPTION} --timeout 180 패키지`
4. 시각화 전 데이터 검증 필수
5. 첫 셀에 warnings 필터링 + 필요한 import + 데이터 로딩 포함
6. 기존 노트북 코드를 분석/개선할 때도 새 셀에서 처음부터 구현
7. **시각화 코드에는 반드시 한글 폰트 설정 포함**

## JSON 출력
{"reasoning":"이유","plan":{"totalSteps":N,"steps":[{"stepNumber":1,"description":"설명","toolCalls":[{"tool":"jupyter_cell","parameters":{"code":"코드"}}],"dependencies":[]}]}}
JSON만 출력.
```

</details>

**템플릿 변수**:
- `{cell_count}`: 현재 노트북 셀 개수
- `{imported_libraries}`: import된 라이브러리 목록
- `{defined_variables}`: 정의된 변수 목록
- `{recent_cells}`: 최근 셀 내용 (최대 5개)
- `{available_libraries}`: 설치된 패키지 목록
- `{request}`: 사용자 요청

---

## 2. STRUCTURED_PLAN_PROMPT

**용도**: 체계적 분석 기반 향상된 계획 수립 (Enhanced Planning with Checkpoints)

**호출 시점**: 복잡한 요청에 대한 계획 수립

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.
사용자의 요청을 체계적으로 분석하고, 검증 가능한 단계별 실행 계획을 생성하세요.

## 분석 프레임워크

### 1. 문제 분해 (Problem Decomposition)
- 핵심 목표는 무엇인가?
- 필수 단계와 선택적 단계는 무엇인가?
- 각 단계의 입력과 출력은 무엇인가?

### 2. 의존성 분석 (Dependency Analysis)
- 어떤 라이브러리가 필요한가?
- 단계 간 데이터 흐름은 어떠한가?
- 어떤 변수/객체가 단계 간에 공유되는가?

### 3. 위험도 평가 (Risk Assessment)
- 실패 가능성이 높은 단계는?
- 외부 의존성(API, 파일, 네트워크)이 있는 단계는?
- 실행 시간이 오래 걸릴 수 있는 단계는?

### 4. 검증 전략 (Validation Strategy)
- 각 단계의 성공을 어떻게 확인할 수 있는가?
- 예상 출력 형태는 무엇인가?
- 체크포인트 기준은 무엇인가?

## JSON 출력
{
  "analysis": {
    "problem_decomposition": {...},
    "dependency_analysis": {...},
    "risk_assessment": {...}
  },
  "reasoning": "계획 수립 이유",
  "plan": {
    "totalSteps": N,
    "steps": [
      {
        "stepNumber": 1,
        "description": "단계 설명",
        "toolCalls": [...],
        "dependencies": [],
        "checkpoint": {
          "expectedOutcome": "예상 결과",
          "validationCriteria": ["검증 기준"],
          "successIndicators": ["성공 지표"]
        },
        "riskLevel": "low | medium | high"
      }
    ]
  }
}
```

</details>

---

## 3. CODE_GENERATION_PROMPT

**용도**: 단일 셀 코드 생성

**호출 시점**: 개별 코드 생성 요청

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.

## 요청
{request}

## 컨텍스트
- 사용 가능한 라이브러리: {available_libraries}
- 정의된 변수: {defined_variables}
- 이전 셀 출력: {previous_output}

## 지침
1. 실행 가능한 Python 코드만 생성하세요
2. 필요한 import 문을 포함하세요
3. 마지막 줄에 결과를 반환/출력하세요
4. 주석은 간결하게 작성하세요
5. **코드 내 주석과 문자열은 한글 또는 영어로만 작성하세요 (한자 사용 절대 금지)**
6. **함수 docstring은 작은따옴표(') 3개만 사용하세요. 절대 백틱(`)을 사용하지 마세요.**
7. **시각화 시 한글 폰트 설정 필수**

## 출력
Python 코드만 출력하세요. 마크다운이나 설명 없이.
```

</details>

---

## 4. ERROR_REFINEMENT_PROMPT

**용도**: Self-Healing - 에러 발생 시 코드 자동 수정

**호출 시점**: `POST /agent/refine`

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
다음 코드가 오류로 실패했습니다. 수정된 코드를 제공하세요.

## 원래 코드
```python
{original_code}
```

## 오류 정보
- 오류 유형: {error_type}
- 오류 메시지: {error_message}
- 트레이스백:
```
{traceback}
```

## 시도 횟수
{attempt}/{max_attempts}

## 컨텍스트
- 사용 가능한 라이브러리: {available_libraries}
- 정의된 변수: {defined_variables}

## 중요 규칙 (절대 위반 금지)

**ModuleNotFoundError/ImportError 처리**:
- 모듈이 없는 에러의 경우, **절대로 다른 라이브러리로 대체하지 마세요**
- 예: `import dask` 실패 시 → `import pandas`로 대체 ❌ 금지!
- 이런 에러는 시스템이 자동으로 패키지 설치로 해결합니다

**수정 가능한 에러 유형**:
- SyntaxError, TypeError, ValueError, KeyError, IndexError, AttributeError, NameError

**수정 불가 - 원래 코드 그대로 반환해야 하는 에러 유형**:
- ModuleNotFoundError, ImportError, FileNotFoundError

## 출력 형식 (JSON)
{
  "reasoning": "오류 분석 및 수정 방법 설명",
  "toolCalls": [
    {
      "tool": "jupyter_cell",
      "parameters": {
        "code": "수정된 Python 코드"
      }
    }
  ]
}
```

</details>

---

## 5. ADAPTIVE_REPLAN_PROMPT

**용도**: 에러 발생 시 복구 전략 결정 (refine / insert_steps / replace_step / replan_remaining)

**호출 시점**: `POST /agent/replan`

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
에러가 발생했습니다. 출력과 에러를 분석하여 계획을 수정하거나 새로운 접근법을 제시하세요.

## 원래 요청
{original_request}

## 현재까지 실행된 단계
{executed_steps}

## 실패한 단계
- 단계 번호: {failed_step_number}
- 설명: {failed_step_description}
- 실행된 코드:
```python
{failed_code}
```

## 에러 정보
- 오류 유형: {error_type}
- 오류 메시지: {error_message}
- 트레이스백:
```
{traceback}
```

## 필수 규칙 (MANDATORY RULES)

### ModuleNotFoundError / ImportError → 무조건 `insert_steps` 사용!

**⛔ 절대적 금지 사항**:
- `ModuleNotFoundError`나 `ImportError` 발생 시:
  - ❌ `refine` 사용 금지!
  - ❌ `replace_step` 사용 금지!
  - ❌ `replan_remaining` 사용 금지!
  - ✅ 오직 `insert_steps`만 허용!

**간접 의존성 오류도 동일 처리**:
- 예: `import dask.dataframe` → `No module named 'pyarrow'` 오류
- → pyarrow는 dask의 내부 의존성
- → `insert_steps`로 `!pip install pyarrow` 추가!

## 결정 옵션

1. **refine**: 코드 수정으로 해결 (SyntaxError, TypeError 등)
2. **insert_steps**: 선행 작업 필요 (패키지 설치 등) - **ModuleNotFoundError 시 유일한 옵션**
3. **replace_step**: 완전히 다른 접근법 필요
4. **replan_remaining**: 남은 모든 단계 재계획

## 출력 형식 (JSON)
{
  "analysis": {
    "root_cause": "근본 원인 (1-2문장)",
    "is_approach_problem": true/false,
    "missing_prerequisites": ["누락된 선행 작업들"]
  },
  "decision": "refine | insert_steps | replace_step | replan_remaining",
  "reasoning": "결정 이유 (1-2문장)",
  "changes": {...}
}
```

</details>

---

## 6. REFLECTION_PROMPT

**용도**: 실행 결과 분석 및 다음 단계 조정 제안

**호출 시점**: 각 단계 실행 후 (선택적)

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
실행 결과를 분석하고 다음 단계에 대한 조정을 제안하세요.

## 실행된 단계
- 단계 번호: {step_number}
- 설명: {step_description}
- 실행된 코드:
```python
{executed_code}
```

## 실행 결과
- 상태: {execution_status}
- 출력:
```
{execution_output}
```
- 오류 (있는 경우):
```
{error_message}
```

## 체크포인트 기준
- 예상 결과: {expected_outcome}
- 검증 기준: {validation_criteria}

## 남은 단계
{remaining_steps}

## 출력 형식 (JSON)
{
  "evaluation": {
    "checkpoint_passed": true/false,
    "output_matches_expected": true/false,
    "confidence_score": 0.0-1.0
  },
  "analysis": {
    "success_factors": ["성공 요인들"],
    "failure_factors": ["실패 요인들"],
    "unexpected_outcomes": ["예상치 못한 결과들"]
  },
  "impact_on_remaining": {
    "affected_steps": [단계 번호들],
    "severity": "none | minor | major | critical",
    "description": "영향 설명"
  },
  "recommendations": {
    "action": "continue | adjust | retry | replan",
    "adjustments": [...],
    "reasoning": "조정 이유"
  }
}
```

</details>

---

## 7. ERROR_ANALYSIS_PROMPT

**용도**: LLM Fallback 에러 분석 (패턴 매칭 실패 시)

**호출 시점**: ErrorClassifier에서 패턴 매칭 실패 시

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
에러를 분석하고 복구 전략을 결정하세요.

## 에러 정보
- 오류 유형: {error_type}
- 오류 메시지: {error_message}
- 트레이스백:
```
{traceback}
```

## 이전 시도 횟수: {previous_attempts}

## 이전 코드 (있는 경우)
{previous_codes}

## 복구 전략 선택지

1. **refine**: 코드 수정으로 해결 가능한 에러
2. **insert_steps**: 선행 작업이 필요한 경우 (패키지 설치 등)
3. **replace_step**: 완전히 다른 접근법이 필요한 경우
4. **replan_remaining**: 시스템 레벨 문제 또는 전체 접근법 변경 필요

## 출력 형식 (JSON)
{
  "analysis": {
    "root_cause": "에러의 근본 원인 (1-2문장)",
    "is_approach_problem": true/false,
    "missing_prerequisites": ["누락된 선행 작업들"],
    "complexity": "simple | moderate | complex"
  },
  "decision": "refine | insert_steps | replace_step | replan_remaining",
  "reasoning": "결정 이유 (1-2문장)",
  "confidence": 0.0-1.0,
  "changes": {...}
}
```

</details>

---

## 8. FINAL_ANSWER_PROMPT

**용도**: 작업 완료 후 결과 요약 생성

**호출 시점**: 모든 단계 완료 후

**파일 위치**: `agent-server/agent_server/prompts/auto_agent_prompts.py`

<details>
<summary><strong>프롬프트 전문 (클릭하여 펼치기)</strong></summary>

```
작업이 완료되었습니다. 결과를 요약해주세요.

## 원래 요청
{original_request}

## 실행된 단계
{executed_steps}

## 생성된 출력
{outputs}

## 지침
1. 작업 결과를 간결하게 요약하세요
2. 주요 발견사항이나 결과를 강조하세요
3. 다음 단계에 대한 제안이 있으면 포함하세요
4. 한국어로 작성하세요
5. **변수명이 아닌 실제 계산된 값을 사용하세요**

## 출력
간결한 요약 텍스트 (200자 이내)
```

</details>

---

## 9. Cell Action Prompts

셀 버튼 클릭 시 사용되는 프롬프트들입니다.

**파일 위치**: `agent-server/agent_server/prompts/cell_action_prompts.py`

### EXPLAIN_CODE_PROMPT

코드 설명 요청 시 사용

```
이 코드가 무엇을 하는지 명확하고 간결하게 설명해주세요.

```python
{cell_content}
```

다음 사항에 초점을 맞춰주세요:
1. 전체적인 목적과 해결하는 문제
2. 주요 단계와 로직 흐름
3. 중요한 구현 세부사항
4. 사용된 주목할 만한 패턴이나 기법
```

### FIX_CODE_PROMPT

코드 수정 요청 시 사용

```
이 코드에서 오류, 버그 또는 잠재적인 문제를 분석하고 수정사항을 제공해주세요.

```python
{cell_content}
```

다음 형식으로 제공해주세요:
1. **발견된 문제점**: 오류, 버그 또는 잠재적 문제 목록
2. **수정된 코드**: 수정된 버전의 코드
3. **설명**: 무엇이 잘못되었고 어떻게 수정했는지
4. **추가 제안**: 추가로 개선할 수 있는 사항
```

---

## 10. File Action Prompts

Python 파일 분석 및 수정 시 사용되는 프롬프트들입니다.

**파일 위치**: `agent-server/agent_server/prompts/file_action_prompts.py`

### format_file_fix_prompt

파일 에러 수정 요청 시 사용

```
Python 파일에서 에러가 발생했습니다. 에러를 분석하고 수정된 코드를 제공하세요.

## 에러 메시지
```
{error_output}
```

## 메인 파일: {main_file_path}
```python
{main_file_content}
```

## 관련 파일들 (있는 경우)
{related_files}

## 지침
1. 에러의 근본 원인을 분석하세요
2. 수정이 필요한 파일의 **전체 코드**를 제공하세요
3. 여러 파일 수정이 필요하면 각각 제공하세요
4. 수정 사항을 간단히 설명하세요
5. **한자 사용 절대 금지**
```

---

## 프롬프트 설계 원칙

### 1. 한자 금지
모든 프롬프트에서 한자 사용을 명시적으로 금지합니다. LLM이 한자를 생성하면 파싱 오류가 발생할 수 있습니다.

### 2. JSON 출력 강제
대부분의 프롬프트는 JSON만 출력하도록 강제합니다. 이는 응답 파싱의 안정성을 높입니다.

### 3. 패키지 대체 금지
`ModuleNotFoundError` 발생 시 다른 라이브러리로 대체하는 것을 명시적으로 금지합니다. 대신 `insert_steps`로 패키지 설치 단계를 추가합니다.

### 4. 컨텍스트 최소화
토큰 절약을 위해 필수 컨텍스트만 포함합니다:
- 최근 셀: 최대 5개, 각 150자
- 에러 메시지: 최대 500자
- 트레이스백: 최대 1000자

---

← [메인 문서로 돌아가기](./agent_planning_flow.md)
