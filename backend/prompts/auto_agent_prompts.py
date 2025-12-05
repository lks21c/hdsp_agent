"""
Auto-Agent Prompts
HuggingFace Jupyter Agent 패턴 기반 프롬프트 템플릿

Tool Calling 구조:
- jupyter_cell: 코드 셀 생성/수정/실행
- markdown: 마크다운 셀 생성/수정
- final_answer: 작업 완료 신호
"""

# ═══════════════════════════════════════════════════════════════════════════
# 실행 계획 생성 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

PLAN_GENERATION_PROMPT = '''당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.
사용자의 요청을 분석하고, 단계별 실행 계획을 JSON 형식으로 생성하세요.

## 사용 가능한 도구

1. **jupyter_cell**: Python 코드 셀 생성/수정/실행
   - parameters: {{"code": "Python 코드", "cellIndex": 수정할_셀_인덱스(선택)}}

2. **markdown**: 마크다운 설명 셀 생성/수정
   - parameters: {{"content": "마크다운 텍스트", "cellIndex": 수정할_셀_인덱스(선택)}}

3. **final_answer**: 작업 완료 및 최종 답변
   - parameters: {{"answer": "최종 답변 텍스트", "summary": "작업 요약(선택)"}}

## 노트북 컨텍스트

- 셀 개수: {cell_count}
- 임포트된 라이브러리: {imported_libraries}
- 정의된 변수: {defined_variables}
- 최근 셀 내용:
{recent_cells}

## 사용자 요청

{request}

## 지침

1. 요청을 논리적인 단계로 분해하세요 (최대 10단계)
2. 각 단계는 명확한 목표와 도구 호출을 가져야 합니다
3. 코드는 즉시 실행 가능해야 합니다
4. 필요한 import 문을 포함하세요
5. 마지막 단계는 반드시 final_answer를 포함하세요
6. 한국어로 설명을 작성하세요

## 출력 형식 (JSON)

```json
{{
  "reasoning": "계획 수립 이유에 대한 설명",
  "plan": {{
    "totalSteps": 단계_수,
    "steps": [
      {{
        "stepNumber": 1,
        "description": "단계 설명 (한국어)",
        "toolCalls": [
          {{
            "tool": "jupyter_cell",
            "parameters": {{
              "code": "Python 코드"
            }}
          }}
        ],
        "dependencies": []
      }},
      ...
      {{
        "stepNumber": N,
        "description": "최종 결과 제시",
        "toolCalls": [
          {{
            "tool": "final_answer",
            "parameters": {{
              "answer": "작업 완료 메시지"
            }}
          }}
        ],
        "dependencies": [N-1]
      }}
    ]
  }}
}}
```

JSON만 출력하세요. 다른 텍스트 없이.'''


# ═══════════════════════════════════════════════════════════════════════════
# 코드 생성 프롬프트 (단일 셀)
# ═══════════════════════════════════════════════════════════════════════════

CODE_GENERATION_PROMPT = '''당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.

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
5. 에러 처리를 적절히 포함하세요

## 출력

Python 코드만 출력하세요. 마크다운이나 설명 없이.'''


# ═══════════════════════════════════════════════════════════════════════════
# 에러 수정 프롬프트 (Self-Healing)
# ═══════════════════════════════════════════════════════════════════════════

ERROR_REFINEMENT_PROMPT = '''다음 코드가 오류로 실패했습니다. 수정된 코드를 제공하세요.

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

## 지침

1. 오류의 근본 원인을 분석하세요
2. 수정된 코드를 제공하세요
3. 같은 오류가 반복되지 않도록 하세요
4. 필요하면 대안적인 접근법을 사용하세요

## 출력 형식 (JSON)

```json
{{
  "reasoning": "오류 분석 및 수정 방법 설명",
  "toolCalls": [
    {{
      "tool": "jupyter_cell",
      "parameters": {{
        "code": "수정된 Python 코드"
      }}
    }}
  ]
}}
```

JSON만 출력하세요.'''


# ═══════════════════════════════════════════════════════════════════════════
# Adaptive Replanning 프롬프트 (계획 수정)
# ═══════════════════════════════════════════════════════════════════════════

ADAPTIVE_REPLAN_PROMPT = '''에러가 발생했습니다. 출력과 에러를 분석하여 계획을 수정하거나 새로운 접근법을 제시하세요.

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

## 실행 출력 (stdout/stderr)

```
{execution_output}
```

## 분석 지침

1. **근본 원인 분석**: 단순 코드 버그인가, 접근법 자체의 문제인가?
2. **필요한 선행 작업**: 누락된 import, 데이터 변환, 환경 설정이 있는가?
3. **대안적 접근법**: 다른 라이브러리나 방법을 사용해야 하는가?

## 결정 옵션

1. **refine**: 같은 접근법으로 코드만 수정 (단순 버그)
2. **insert_steps**: 현재 단계 전에 필요한 단계 추가 (선행 작업 필요)
3. **replace_step**: 현재 단계를 완전히 다른 접근법으로 교체
4. **replan_remaining**: 남은 모든 단계를 새로 계획

## 출력 형식 (JSON)

```json
{{
  "analysis": {{
    "root_cause": "근본 원인 분석 (한국어)",
    "is_approach_problem": true/false,
    "missing_prerequisites": ["누락된 선행 작업들"]
  }},
  "decision": "refine | insert_steps | replace_step | replan_remaining",
  "reasoning": "결정 이유 설명 (한국어)",
  "changes": {{
    // decision이 "refine"인 경우:
    "refined_code": "수정된 코드",

    // decision이 "insert_steps"인 경우:
    "new_steps": [
      {{
        "description": "새 단계 설명",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
      }}
    ],

    // decision이 "replace_step"인 경우:
    "replacement": {{
      "description": "새 단계 설명",
      "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
    }},

    // decision이 "replan_remaining"인 경우:
    "new_plan": [
      {{
        "description": "단계 설명",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
      }}
    ]
  }}
}}
```

JSON만 출력하세요.'''


# ═══════════════════════════════════════════════════════════════════════════
# 최종 답변 생성 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

FINAL_ANSWER_PROMPT = '''작업이 완료되었습니다. 결과를 요약해주세요.

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

## 출력

간결한 요약 텍스트 (200자 이내)'''


# ═══════════════════════════════════════════════════════════════════════════
# 유틸리티 함수
# ═══════════════════════════════════════════════════════════════════════════

def format_plan_prompt(
    request: str,
    cell_count: int,
    imported_libraries: list,
    defined_variables: list,
    recent_cells: list
) -> str:
    """실행 계획 생성 프롬프트 포맷팅"""
    recent_cells_text = ""
    for i, cell in enumerate(recent_cells):
        cell_type = cell.get('type', 'code')
        source = cell.get('source', '')[:300]  # 최대 300자
        recent_cells_text += f"\n[셀 {cell.get('index', i)}] ({cell_type}):\n```\n{source}\n```\n"

    return PLAN_GENERATION_PROMPT.format(
        request=request,
        cell_count=cell_count,
        imported_libraries=", ".join(imported_libraries) if imported_libraries else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음"
    )


def format_refine_prompt(
    original_code: str,
    error_type: str,
    error_message: str,
    traceback: str,
    attempt: int,
    max_attempts: int,
    available_libraries: list,
    defined_variables: list
) -> str:
    """에러 수정 프롬프트 포맷팅"""
    return ERROR_REFINEMENT_PROMPT.format(
        original_code=original_code,
        error_type=error_type,
        error_message=error_message,
        traceback=traceback,
        attempt=attempt,
        max_attempts=max_attempts,
        available_libraries=", ".join(available_libraries) if available_libraries else "pandas, numpy, matplotlib",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음"
    )


def format_final_answer_prompt(
    original_request: str,
    executed_steps: list,
    outputs: list
) -> str:
    """최종 답변 프롬프트 포맷팅"""
    steps_text = "\n".join([
        f"- Step {s.get('stepNumber', i+1)}: {s.get('description', '완료')}"
        for i, s in enumerate(executed_steps)
    ])

    outputs_text = "\n".join([
        f"[출력 {i+1}]: {str(o)[:200]}"
        for i, o in enumerate(outputs)
    ])

    return FINAL_ANSWER_PROMPT.format(
        original_request=original_request,
        executed_steps=steps_text if steps_text else "없음",
        outputs=outputs_text if outputs_text else "없음"
    )


def format_replan_prompt(
    original_request: str,
    executed_steps: list,
    failed_step: dict,
    error_info: dict,
    execution_output: str = ""
) -> str:
    """Adaptive Replanning 프롬프트 포맷팅"""
    # 실행된 단계 텍스트
    executed_text = "\n".join([
        f"- Step {s.get('stepNumber', i+1)}: {s.get('description', '완료')} ✅"
        for i, s in enumerate(executed_steps)
    ]) if executed_steps else "없음"

    # 실패한 코드 추출
    failed_code = ""
    if failed_step.get('toolCalls'):
        for tc in failed_step['toolCalls']:
            if tc.get('tool') == 'jupyter_cell':
                failed_code = tc.get('parameters', {}).get('code', '')
                break

    # traceback 처리
    traceback_data = error_info.get('traceback', [])
    if isinstance(traceback_data, list):
        traceback_str = '\n'.join(traceback_data)
    else:
        traceback_str = str(traceback_data) if traceback_data else ''

    return ADAPTIVE_REPLAN_PROMPT.format(
        original_request=original_request,
        executed_steps=executed_text,
        failed_step_number=failed_step.get('stepNumber', '?'),
        failed_step_description=failed_step.get('description', ''),
        failed_code=failed_code,
        error_type=error_info.get('type', 'runtime'),
        error_message=error_info.get('message', 'Unknown error'),
        traceback=traceback_str,
        execution_output=execution_output if execution_output else "없음"
    )
