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

## 현재 환경 정보

- **설치된 패키지**: {available_libraries}

## 사용자 요청

{request}

## 지침

1. 요청을 논리적인 단계로 분해하세요 (최대 10단계)
2. 각 단계는 명확한 목표와 도구 호출을 가져야 합니다
3. 코드는 즉시 실행 가능해야 합니다
4. 필요한 import 문을 포함하세요
5. 마지막 단계는 반드시 final_answer를 포함하세요
6. 한국어로 설명을 작성하세요

## ⚠️ 초기 설정 (첫 번째 코드 셀에 포함)

첫 번째 코드 셀에 항상 다음 코드를 포함하세요:
```python
import warnings
warnings.filterwarnings('ignore', category=RuntimeWarning)
warnings.filterwarnings('ignore', category=FutureWarning)

# matplotlib 한글 폰트 설정 (시스템 폰트 자동 탐지)
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

def find_korean_font():
    """시스템에서 사용 가능한 한글 폰트를 탐색하여 반환"""
    # 한글 폰트 우선순위 목록 (일반적인 한글 폰트들)
    korean_fonts = [
        # macOS
        'Apple SD Gothic Neo', 'AppleGothic', 'Apple Color Emoji',
        'Noto Sans CJK KR', 'Noto Sans KR',
        # Windows
        'Malgun Gothic', '맑은 고딕', 'NanumGothic', '나눔고딕',
        'NanumBarunGothic', 'Gulim', '굴림', 'Dotum', '돋움',
        # Linux / Cross-platform
        'NanumGothic', 'NanumBarunGothic', 'UnDotum', 'UnBatang',
        'Noto Sans CJK KR', 'Noto Sans KR', 'Source Han Sans KR',
        'D2Coding', 'D2 Coding',
        # 추가 한글 폰트
        'KoPubDotum', 'KoPub돋움', 'Spoqa Han Sans', 'IBM Plex Sans KR',
    ]

    # 시스템에 설치된 폰트 목록 가져오기
    system_fonts = set([f.name for f in fm.fontManager.ttflist])

    # 우선순위에 따라 사용 가능한 폰트 찾기
    for font in korean_fonts:
        if font in system_fonts:
            return font

    # 한글이 포함된 폰트 이름으로 추가 탐색
    for font_name in system_fonts:
        lower_name = font_name.lower()
        if any(keyword in lower_name for keyword in ['gothic', 'nanum', 'malgun', 'gulim', 'dotum', 'batang', 'korean', 'cjk']):
            return font_name

    return None  # 한글 폰트를 찾지 못함

# 한글 폰트 설정
korean_font = find_korean_font()
if korean_font:
    plt.rcParams['font.family'] = korean_font
    print(f"한글 폰트 설정: {{korean_font}}")
else:
    print("경고: 한글 폰트를 찾을 수 없습니다. 한글이 깨질 수 있습니다.")
plt.rcParams['axes.unicode_minus'] = False
```

## 🔴 라이브러리 일관성 규칙 (CRITICAL!)

**사용자가 특정 라이브러리를 명시한 경우, 모든 단계에서 일관되게 해당 라이브러리를 사용하세요!**
- 예: "dask로 EDA 해줘" → 모든 단계에서 dask 사용, pandas 혼용 금지!
- 예: "polars로 분석해줘" → 모든 단계에서 polars 사용

**참고**: 특정 라이브러리가 감지되면 해당 API 가이드가 아래에 자동으로 추가됩니다.

## 🔍 파일 탐색 규칙 (중요!)

사용자 요청에 **파일명이 언급된 경우**, 반드시 다음 순서로 처리하세요:

1. **로컬 파일 탐색 우선**: 먼저 `os.listdir()`, `glob.glob()` 등으로 현재 디렉토리 및 하위 디렉토리에서 해당 파일을 탐색합니다
2. **파일 존재 확인**: `os.path.exists()` 또는 유사한 방법으로 파일 존재 여부를 확인합니다
3. **경로 출력**: 발견된 파일의 전체 경로를 출력하여 사용자에게 알립니다
4. **파일이 없는 경우**: 파일을 찾을 수 없으면 명확한 에러 메시지를 제공합니다

예시:
- "train.csv 파일을 로드해줘" → 먼저 `glob.glob('**/train.csv', recursive=True)`로 파일 탐색
- "data.xlsx를 읽어줘" → 먼저 로컬에서 해당 파일 검색 후 로드

## 📊 시각화 전 데이터 검증 (중요!)

**시각화하기 전에 항상 데이터가 비어있는지 확인하세요!**

빈 데이터로 `.plot()` 호출 시 `IndexError`가 발생합니다. 다음 패턴을 사용하세요:

```python
# ❌ 잘못된 예시 - 빈 데이터일 때 에러 발생
missing_pct[missing_pct > 0].head(20).plot(kind='bar')

# ✅ 올바른 예시 - 데이터 존재 여부 확인
data_to_plot = missing_pct[missing_pct > 0].head(20)
if len(data_to_plot) > 0:
    data_to_plot.plot(kind='bar')
    plt.title('결측치 비율')
    plt.show()
else:
    print("시각화할 데이터가 없습니다 (결측치 없음)")
```

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

## ⚠️ 중요 규칙 (절대 위반 금지)

**ModuleNotFoundError/ImportError 처리**:
- 모듈이 없는 에러의 경우, **절대로 다른 라이브러리로 대체하지 마세요**
- 예: `import dask` 실패 시 → `import pandas`로 대체 ❌ 금지!
- 이런 에러는 시스템이 자동으로 패키지 설치로 해결합니다
- Self-Healing에서는 **코드 문법/로직 수정만** 수행하세요

**수정 가능한 에러 유형**:
- SyntaxError (문법 오류)
- TypeError (타입 불일치)
- ValueError (값 오류)
- KeyError (잘못된 키)
- IndexError (인덱스 범위)
- AttributeError (잘못된 속성)
- NameError (변수명 오타)

**수정 불가 - 원래 코드 그대로 반환해야 하는 에러 유형**:
- ModuleNotFoundError
- ImportError
- FileNotFoundError (경로 문제는 시스템이 처리)

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

## 현재 환경 정보

- **설치된 패키지**: {available_libraries}

## ⚠️ 필수 규칙 (MANDATORY RULES - 반드시 따를 것!)

### 🚨🚨🚨 ModuleNotFoundError / ImportError → 무조건 `insert_steps` 사용! 🚨🚨🚨

**⛔ 절대적 금지 사항 (이 규칙은 어떤 경우에도 위반 불가)**:
- `ModuleNotFoundError`나 `ImportError` 발생 시:
  - ❌ `refine` 사용 금지!
  - ❌ `replace_step` 사용 금지!
  - ❌ `replan_remaining` 사용 금지!
  - ✅ 오직 `insert_steps`만 허용!

**🔍 간접 의존성 오류 (CRITICAL - 매우 중요!)**:
- 실행한 코드와 오류 메시지의 패키지가 **달라도** `insert_steps` 사용!
- 예시 1: `import dask.dataframe as dd` 실행 → `No module named 'pyarrow'` 오류
  → pyarrow는 dask의 **내부 의존성**
  → `insert_steps`로 `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 pyarrow` 추가!
  → ❌ "dask 대신 pandas 사용" 같은 접근법 변경 금지!
- 예시 2: `import tensorflow` 실행 → `No module named 'keras'` 오류
  → `insert_steps`로 `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 keras` 추가!
- 예시 3: `from transformers import AutoModel` 실행 → `No module named 'accelerate'` 오류
  → `insert_steps`로 `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 accelerate` 추가!

**📋 판단 기준**: 에러 메시지에 `No module named` 또는 `ImportError`가 있으면:
1. **⚠️ 에러 메시지에서 패키지명 추출 (코드가 아님!)** ⚠️
2. 무조건 `insert_steps` 선택
3. `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 에러메시지의_패키지명` 단계 추가
4. **사용자가 요청한 원래 라이브러리(dask 등)는 그대로 유지!**

**🚨 URL 축약 절대 금지!**:
- pip install 명령어의 `--index-url` 은 **반드시 전체 URL을 그대로 사용**해야 합니다
- ❌ 금지: `https://nexus-base.hyundai.../simple` (... 로 축약)
- ✅ 필수: `https://nexus-base.hyundaicard.com/repository/pypi/simple` (전체 URL)
- 긴 URL이라도 절대 축약하지 마세요! 실행되지 않습니다!

**🚨 패키지 설치 전 필수 확인!**:
- **설치된 패키지** 목록을 반드시 확인하세요
- 에러 메시지의 패키지가 **이미 설치되어 있다면** 설치 단계를 추가하지 마세요!
- 예: 에러가 `No module named 'pyarrow'`인데 설치된 패키지에 `pyarrow`가 있으면 → 설치 불필요
- 예: 에러가 `No module named 'dask'`인데 설치된 패키지에 `dask`가 있으면 → 설치 불필요
- ⚠️ **주의**: 패키지가 이미 있는데도 설치를 반복하면 무한 루프에 빠집니다!
- ✅ 패키지가 없을 때만 `insert_steps`로 설치 추가하세요

### 🚨🚨🚨 패키지명 추출 - 매우 중요!!! 🚨🚨🚨

**반드시 에러 메시지에서 추출하세요! 사용자 코드에서 추출하면 안 됩니다!**

**예시 상황**:
- 사용자 코드: `import dask.dataframe as dd`
- 에러 메시지: `ModuleNotFoundError: No module named 'pyarrow'`

| 추출 방법 | 결과 | 판정 |
|----------|------|------|
| 사용자 코드에서 추출 | `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 dask` | ❌ **완전히 틀림!** |
| 에러 메시지에서 추출 | `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 pyarrow` | ✅ **정답!** |

**왜 중요한가?**:
- dask는 이미 설치되어 있음 (그래서 import dask가 시작됨)
- 하지만 dask 내부에서 pyarrow를 로드하려다 실패
- 따라서 설치해야 할 패키지는 pyarrow!

### 패키지명 추출 규칙
- "No module named 'xxx'" → `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 xxx` (에러 메시지의 xxx!)
- "No module named 'xxx.yyy'" → `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 xxx` (최상위 패키지만)
- 예외: `sklearn` → `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 scikit-learn`
- 예외: `cv2` → `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 opencv-python`
- 예외: `PIL` → `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 pillow`

## 분석 지침

1. **근본 원인 분석**: 단순 코드 버그인가, 접근법 자체의 문제인가?
2. **필요한 선행 작업**: 누락된 import, 데이터 변환, 환경 설정이 있는가?
3. **대안적 접근법**: 다른 라이브러리나 방법을 사용해야 하는가?

## 에러 유형별 해결 전략

### 🚨 ModuleNotFoundError / ImportError → ⚡ `insert_steps` 필수! (예외 없음)
- **decision**: 반드시 `"insert_steps"` 선택 (다른 옵션 절대 불가!)
- **changes.new_steps**: `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 에러메시지의_패키지명` 단계 추가
  - ⚠️ **패키지명은 반드시 에러 메시지에서 추출!**
  - ⚠️ **사용자 코드의 패키지가 아님!** (예: dask가 아니라 pyarrow)
- ❌ `refine` 금지 - 코드 수정으로 해결 불가!
- ❌ `replace_step` 금지 - 다른 라이브러리로 대체 금지!
- ❌ `replan_remaining` 금지 - 접근법 변경 금지!
- ⚠️ **간접 의존성**: 실행 코드와 에러의 패키지가 달라도 에러 메시지의 패키지 설치!

### FileNotFoundError
- 파일 경로 확인 또는 파일 존재 여부 체크 단계 추가
- 가능하면 `os.path.exists()` 검증 후 적절한 에러 메시지

### NameError (변수 미정의)
- 이전 단계에서 정의해야 할 변수가 누락된 경우 → 해당 정의 단계 추가
- 단순 오타면 `refine`으로 수정

### TypeError / ValueError
- 대부분 `refine`으로 코드 수정
- 데이터 타입 변환이 필요하면 변환 로직 추가

## 결정 옵션

1. **refine**: 같은 접근법으로 코드만 수정
   - ✅ 사용 가능: SyntaxError, TypeError, ValueError, KeyError, IndexError, AttributeError
   - ❌ 사용 금지: ModuleNotFoundError, ImportError

2. **insert_steps**: 현재 단계 전에 필요한 단계 추가 (선행 작업 필요)
   - ✅ **ModuleNotFoundError, ImportError 발생 시 유일하게 허용되는 옵션!**
   - 패키지 설치: `!pip install --index-url https://nexus-base.hyundaicard.com/repository/pypi/simple --timeout 180 패키지명` 단계 추가
   - 에러 메시지의 패키지명을 정확히 추출하여 설치

3. **replace_step**: 현재 단계를 완전히 다른 접근법으로 교체
   - ❌ ModuleNotFoundError, ImportError 시 사용 금지! (라이브러리 대체 금지)

4. **replan_remaining**: 남은 모든 단계를 새로 계획 (final_answer도 새로 작성!)
   - ❌ ModuleNotFoundError, ImportError 시 사용 금지! (접근법 변경 금지)

## 중요 규칙

- **replan_remaining 또는 replace_step 선택 시**: 접근법이 변경되면 final_answer 메시지도 반드시 실제 사용된 방법을 반영해야 합니다.
  - 예: dask → pandas로 변경 시, final_answer는 "pandas를 사용하여..."로 작성
- **final_answer는 실제 실행된 코드를 정확히 반영**해야 합니다.

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

    // decision이 "insert_steps"인 경우 (예: 패키지 설치):
    // ⚠️ 중요: 에러메시지의 패키지명 사용! (예: pyarrow, 사용자코드의 dask 아님!)
    "new_steps": [
      {{
        "description": "에러메시지에서 확인된 패키지(예: pyarrow) 설치",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "!pip install 에러메시지의_패키지명"}}}}]
      }}
    ],

    // decision이 "replace_step"인 경우:
    "replacement": {{
      "description": "새 단계 설명",
      "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
    }},

    // decision이 "replan_remaining"인 경우 (final_answer 필수 포함!):
    "new_plan": [
      {{
        "description": "단계 설명",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
      }},
      {{
        "description": "최종 결과 제시",
        "toolCalls": [{{"tool": "final_answer", "parameters": {{"answer": "실제 사용된 방법을 반영한 완료 메시지"}}}}]
      }}
    ]
  }}
}}
```

JSON만 출력하세요.'''


# ═══════════════════════════════════════════════════════════════════════════
# 구조화된 계획 생성 프롬프트 (Enhanced Planning with Checkpoints)
# ═══════════════════════════════════════════════════════════════════════════

STRUCTURED_PLAN_PROMPT = '''당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.
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

## ⚠️ 초기 설정 (첫 번째 코드 셀에 포함)

첫 번째 코드 셀에 항상 다음 코드를 포함하세요:
```python
import warnings
warnings.filterwarnings('ignore', category=RuntimeWarning)
warnings.filterwarnings('ignore', category=FutureWarning)

# matplotlib 한글 폰트 설정 (시스템 폰트 자동 탐색)
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt

def find_korean_font():
    korean_fonts = [
        'Apple SD Gothic Neo', 'AppleGothic', 'Malgun Gothic', '맑은 고딕',
        'NanumGothic', '나눔고딕', 'NanumBarunGothic', 'Noto Sans CJK KR',
        'Noto Sans KR', 'Gulim', '굴림', 'Dotum', '돋움', 'UnDotum', 'UnBatang',
        'Source Han Sans KR', 'D2Coding', 'KoPubDotum', 'Spoqa Han Sans',
    ]
    system_fonts = set([f.name for f in fm.fontManager.ttflist])
    for font in korean_fonts:
        if font in system_fonts:
            return font
    for font_name in system_fonts:
        lower = font_name.lower()
        if any(k in lower for k in ['gothic', 'nanum', 'malgun', 'gulim', 'dotum', 'korean', 'cjk']):
            return font_name
    return None

korean_font = find_korean_font()
if korean_font:
    plt.rcParams['font.family'] = korean_font
plt.rcParams['axes.unicode_minus'] = False
```

## 🔍 파일 탐색 규칙 (중요!)

사용자 요청에 **파일명이 언급된 경우**, 반드시 다음 순서로 처리하세요:

1. **로컬 파일 탐색 우선**: 먼저 `os.listdir()`, `glob.glob()` 등으로 현재 디렉토리 및 하위 디렉토리에서 해당 파일을 탐색합니다
2. **파일 존재 확인**: `os.path.exists()` 또는 유사한 방법으로 파일 존재 여부를 확인합니다
3. **경로 출력**: 발견된 파일의 전체 경로를 출력하여 사용자에게 알립니다
4. **파일이 없는 경우**: 파일을 찾을 수 없으면 명확한 에러 메시지를 제공합니다

예시:
- "train.csv 파일을 로드해줘" → 먼저 `glob.glob('**/train.csv', recursive=True)`로 파일 탐색
- "data.xlsx를 읽어줘" → 먼저 로컬에서 해당 파일 검색 후 로드

## 📊 시각화 전 데이터 검증 (중요!)

**시각화하기 전에 항상 데이터가 비어있는지 확인하세요!**

빈 데이터로 `.plot()` 호출 시 `IndexError`가 발생합니다. 다음 패턴을 사용하세요:

```python
# ❌ 잘못된 예시 - 빈 데이터일 때 에러 발생
missing_pct[missing_pct > 0].head(20).plot(kind='bar')

# ✅ 올바른 예시 - 데이터 존재 여부 확인
data_to_plot = missing_pct[missing_pct > 0].head(20)
if len(data_to_plot) > 0:
    data_to_plot.plot(kind='bar')
    plt.title('결측치 비율')
    plt.show()
else:
    print("시각화할 데이터가 없습니다 (결측치 없음)")
```

## 출력 형식 (JSON)

```json
{{
  "analysis": {{
    "problem_decomposition": {{
      "core_goal": "핵심 목표",
      "essential_steps": ["필수 단계 목록"],
      "optional_steps": ["선택적 단계 목록"]
    }},
    "dependency_analysis": {{
      "required_libraries": ["필요한 라이브러리"],
      "data_flow": "데이터 흐름 설명",
      "shared_variables": ["공유 변수"]
    }},
    "risk_assessment": {{
      "high_risk_steps": [1, 2],
      "external_dependencies": ["외부 의존성"],
      "estimated_complexity": "low | medium | high"
    }}
  }},
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
        "dependencies": [],
        "checkpoint": {{
          "expectedOutcome": "예상 결과",
          "validationCriteria": ["검증 기준 1", "검증 기준 2"],
          "successIndicators": ["성공 지표"]
        }},
        "riskLevel": "low | medium | high"
      }}
    ]
  }}
}}
```

JSON만 출력하세요. 다른 텍스트 없이.'''


# ═══════════════════════════════════════════════════════════════════════════
# Reflection 프롬프트 (실행 결과 분석 및 적응적 조정)
# ═══════════════════════════════════════════════════════════════════════════

REFLECTION_PROMPT = '''실행 결과를 분석하고 다음 단계에 대한 조정을 제안하세요.

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

## 분석 요청

1. **결과 평가**: 실행 결과가 예상과 일치하는가?
2. **성공/실패 요인**: 무엇이 잘 되었고 무엇이 문제인가?
3. **다음 단계 영향**: 이 결과가 남은 단계에 어떤 영향을 미치는가?
4. **조정 제안**: 계획을 수정해야 하는가?

## 출력 형식 (JSON)

```json
{{
  "evaluation": {{
    "checkpoint_passed": true/false,
    "output_matches_expected": true/false,
    "confidence_score": 0.0-1.0
  }},
  "analysis": {{
    "success_factors": ["성공 요인들"],
    "failure_factors": ["실패 요인들"],
    "unexpected_outcomes": ["예상치 못한 결과들"]
  }},
  "impact_on_remaining": {{
    "affected_steps": [단계_번호들],
    "severity": "none | minor | major | critical",
    "description": "영향 설명"
  }},
  "recommendations": {{
    "action": "continue | adjust | retry | replan",
    "adjustments": [
      {{
        "step_number": 단계_번호,
        "change_type": "modify_code | add_step | remove_step | change_approach",
        "description": "변경 설명",
        "new_content": "새 코드 또는 내용 (필요한 경우)"
      }}
    ],
    "reasoning": "조정 이유"
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
    recent_cells: list,
    available_libraries: list = None
) -> str:
    """실행 계획 생성 프롬프트 포맷팅 (Mini RAG 지식 자동 로드)"""
    from ..knowledge.loader import get_knowledge_loader

    recent_cells_text = ""
    for i, cell in enumerate(recent_cells):
        cell_type = cell.get('type', 'code')
        source = cell.get('source', '')[:300]  # 최대 300자
        recent_cells_text += f"\n[셀 {cell.get('index', i)}] ({cell_type}):\n```\n{source}\n```\n"

    # Mini RAG: 사용자 요청에서 라이브러리 감지 및 지식 로드
    knowledge_loader = get_knowledge_loader()
    context = ", ".join(imported_libraries) if imported_libraries else ""
    library_knowledge = knowledge_loader.format_knowledge_section(request, context)

    # 기본 프롬프트 생성
    base_prompt = PLAN_GENERATION_PROMPT.format(
        request=request,
        cell_count=cell_count,
        imported_libraries=", ".join(imported_libraries) if imported_libraries else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음",
        available_libraries=", ".join(available_libraries) if available_libraries else "정보 없음"
    )

    # 라이브러리 지식이 있으면 프롬프트에 추가
    if library_knowledge:
        # JSON 출력 형식 앞에 지식 삽입
        base_prompt = base_prompt.replace(
            "## 출력 형식 (JSON)",
            f"{library_knowledge}\n## 출력 형식 (JSON)"
        )

    return base_prompt


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
    execution_output: str = "",
    available_libraries: list = None
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
        execution_output=execution_output if execution_output else "없음",
        available_libraries=", ".join(available_libraries) if available_libraries else "정보 없음"
    )


def format_structured_plan_prompt(
    request: str,
    cell_count: int,
    imported_libraries: list,
    defined_variables: list,
    recent_cells: list
) -> str:
    """구조화된 계획 생성 프롬프트 포맷팅 (Enhanced Planning)"""
    recent_cells_text = ""
    for i, cell in enumerate(recent_cells):
        cell_type = cell.get('type', 'code')
        source = cell.get('source', '')[:300]
        recent_cells_text += f"\n[셀 {cell.get('index', i)}] ({cell_type}):\n```\n{source}\n```\n"

    return STRUCTURED_PLAN_PROMPT.format(
        request=request,
        cell_count=cell_count,
        imported_libraries=", ".join(imported_libraries) if imported_libraries else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음"
    )


def format_reflection_prompt(
    step_number: int,
    step_description: str,
    executed_code: str,
    execution_status: str,
    execution_output: str,
    error_message: str,
    expected_outcome: str,
    validation_criteria: list,
    remaining_steps: list
) -> str:
    """Reflection 프롬프트 포맷팅 (실행 결과 분석)"""
    # 검증 기준 텍스트
    criteria_text = "\n".join([f"- {c}" for c in validation_criteria]) if validation_criteria else "없음"

    # 남은 단계 텍스트
    remaining_text = "\n".join([
        f"- Step {s.get('stepNumber', i+1)}: {s.get('description', '')}"
        for i, s in enumerate(remaining_steps)
    ]) if remaining_steps else "없음"

    return REFLECTION_PROMPT.format(
        step_number=step_number,
        step_description=step_description,
        executed_code=executed_code,
        execution_status=execution_status,
        execution_output=execution_output if execution_output else "없음",
        error_message=error_message if error_message else "없음",
        expected_outcome=expected_outcome if expected_outcome else "성공적 실행",
        validation_criteria=criteria_text,
        remaining_steps=remaining_text
    )
