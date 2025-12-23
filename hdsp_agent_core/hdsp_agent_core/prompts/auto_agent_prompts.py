"""
Auto-Agent Prompts
HuggingFace Jupyter Agent 패턴 기반 프롬프트 템플릿

Tool Calling 구조:
- jupyter_cell: 코드 셀 생성/수정/실행
- markdown: 마크다운 셀 생성/수정
- final_answer: 작업 완료 신호
- read_file: 파일 읽기 (상대 경로만)
- write_file: 파일 쓰기 (승인 필요)
- list_files: 디렉토리 조회
- execute_command: 셸 명령 실행 (위험 명령만 승인)
- search_files: 파일 내용 검색
"""

import os

# ═══════════════════════════════════════════════════════════════════════════
# Nexus URL 설정 (보안을 위해 외부 파일에서 읽기)
# ═══════════════════════════════════════════════════════════════════════════


def _get_pip_index_option() -> str:
    """
    pip install 시 사용할 index-url 옵션 반환
    - Sagemaker 환경: nexus-url.txt에서 읽어서 --index-url <url> 반환
    - 로컬 환경: 빈 문자열 반환 (일반 pip install)
    """
    nexus_url_path = "/home/sagemaker-user/nexus-url.txt"

    try:
        if os.path.exists(nexus_url_path):
            with open(nexus_url_path, "r") as f:
                url = f.read().strip()
                if url:
                    return f"--index-url {url}"
    except Exception as e:
        print(
            f"[AutoAgent] Warning: Failed to load nexus URL from {nexus_url_path}: {e}"
        )

    # 파일이 없거나 읽기 실패 시: 일반 pip install (로컬 환경)
    return ""


PIP_INDEX_OPTION = _get_pip_index_option()

# ═══════════════════════════════════════════════════════════════════════════
# 실행 계획 생성 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

PLAN_GENERATION_PROMPT = """Jupyter 노트북 Python 전문가. 단계별 실행 계획을 JSON으로 생성.

{collection_index}

## 도구
### 기본 도구 (셀 작업)
1. **jupyter_cell**: {{"code": "Python코드"}} - 노트북 끝에 새 셀 추가
2. **markdown**: {{"content": "마크다운"}} - 설명 셀 추가
3. **final_answer**: {{"answer": "완료메시지"}} - 작업 완료

### 확장 도구 (파일/터미널)
4. **read_file**: {{"path": "상대경로"}} - 파일 읽기 (절대경로/.. 금지)
5. **write_file**: {{"path": "상대경로", "content": "내용"}} - 파일 쓰기 (승인 필요)
6. **list_files**: {{"path": ".", "recursive": false, "pattern": "*.py"}} - 디렉토리 조회
7. **execute_command**: {{"command": "pip list"}} - 셸 명령 (위험 명령만 승인)
8. **search_files**: {{"pattern": "def func", "path": "src"}} - 파일 내용 검색

## 🚨 핵심 원칙 (CRITICAL!)
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
7. **시각화 코드에는 반드시 한글 폰트 설정 포함**:
```python
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'AppleGothic'
plt.rcParams['axes.unicode_minus'] = False
```

## requiredCollections 규칙
- 각 step에서 필요한 라이브러리 가이드를 위 컬렉션 목록에서 선택
- 해당 step 실행 시 선택된 컬렉션에서 관련 API 가이드를 조회
- 필요 없으면 빈 배열 [] 또는 생략
- **toolCalls의 code는 placeholder**: 실제 코드는 step 실행 시 RAG context와 함께 생성됨

## JSON 출력
```json
{{"reasoning":"이유","plan":{{"totalSteps":N,"steps":[{{"stepNumber":1,"description":"설명","toolCalls":[{{"tool":"jupyter_cell","parameters":{{"code":"# placeholder - step 실행 시 생성됨"}}}}],"dependencies":[],"requiredCollections":["dask"]}}]}}}}
```
JSON만 출력."""


# ═══════════════════════════════════════════════════════════════════════════
# 코드 생성 프롬프트 (단일 셀)
# ═══════════════════════════════════════════════════════════════════════════

CODE_GENERATION_PROMPT = """당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.

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
7. **변수 값 출력**:
    - f-string을 사용하여 변수 값을 출력하세요
    - Markdown cell에 변수를 쓰면 변수명이 그대로 텍스트로 출력됩니다
    - 변수 값을 출력하려면 code cell에서 print 또는 display 사용하세요
    - 마크다운 포맷으로 예쁘게 출력하려면 display(Markdown(...)) 사용 권장
8. 에러 처리를 적절히 포함하세요
9. **시각화 시 한글 폰트 설정 필수**:
```python
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'AppleGothic'
plt.rcParams['axes.unicode_minus'] = False
```

## 출력

Python 코드만 출력하세요. 마크다운이나 설명 없이."""


# ═══════════════════════════════════════════════════════════════════════════
# 에러 수정 프롬프트 (Self-Healing)
# ═══════════════════════════════════════════════════════════════════════════

ERROR_REFINEMENT_PROMPT = """다음 코드가 오류로 실패했습니다. 수정된 코드를 제공하세요.

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
4. **코드 내 주석과 문자열은 한글 또는 영어로만 작성하세요 (한자 사용 절대 금지)**
5. **함수 docstring은 작은따옴표(') 3개만 사용하세요. 절대 백틱(`)을 사용하지 마세요.**
6. **변수 값 출력**:
    - f-string을 사용하여 변수 값을 출력하세요
    - Markdown cell에 변수를 쓰면 변수명이 그대로 텍스트로 출력됩니다
    - 변수 값을 출력하려면 code cell에서 print 또는 display 사용하세요
    - 마크다운 포맷으로 예쁘게 출력하려면 display(Markdown(...)) 사용 권장

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

JSON만 출력하세요."""


# ═══════════════════════════════════════════════════════════════════════════
# Adaptive Replanning 프롬프트 (계획 수정)
# ═══════════════════════════════════════════════════════════════════════════

ADAPTIVE_REPLAN_PROMPT = """에러가 발생했습니다. 출력과 에러를 분석하여 계획을 수정하거나 새로운 접근법을 제시하세요.

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
  → `insert_steps`로 `!pip install {PIP_INDEX_OPTION} --timeout 180 pyarrow` 추가!
  → ❌ "dask 대신 pandas 사용" 같은 접근법 변경 금지!
- 예시 2: `import tensorflow` 실행 → `No module named 'keras'` 오류
  → `insert_steps`로 `!pip install {PIP_INDEX_OPTION} --timeout 180 keras` 추가!
- 예시 3: `from transformers import AutoModel` 실행 → `No module named 'accelerate'` 오류
  → `insert_steps`로 `!pip install {PIP_INDEX_OPTION} --timeout 180 accelerate` 추가!

**📋 판단 기준**: 에러 메시지에 `No module named` 또는 `ImportError`가 있으면:
1. **⚠️ 에러 메시지에서 패키지명 추출 (코드가 아님!)** ⚠️
2. 무조건 `insert_steps` 선택
3. `!pip install {PIP_INDEX_OPTION} --timeout 180 에러메시지의_패키지명` 단계 추가
4. **사용자가 요청한 원래 라이브러리(dask 등)는 그대로 유지!**

**🚨 URL 축약 절대 금지!**:
- pip install 명령어에서 URL이 포함된 경우, **반드시 전체 URL을 그대로 사용**해야 합니다
- ❌ 금지: `https://repository.example.../simple` (... 로 축약)
- ✅ 필수: `https://repository.example.com/pypi/simple` (전체 URL)
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
| 사용자 코드에서 추출 | `!pip install {PIP_INDEX_OPTION} --timeout 180 dask` | ❌ **완전히 틀림!** |
| 에러 메시지에서 추출 | `!pip install {PIP_INDEX_OPTION} --timeout 180 pyarrow` | ✅ **정답!** |

**왜 중요한가?**:
- dask는 이미 설치되어 있음 (그래서 import dask가 시작됨)
- 하지만 dask 내부에서 pyarrow를 로드하려다 실패
- 따라서 설치해야 할 패키지는 pyarrow!

### 패키지명 추출 규칙
- "No module named 'xxx'" → `!pip install {PIP_INDEX_OPTION} --timeout 180 xxx` (에러 메시지의 xxx!)
- "No module named 'xxx.yyy'" → `!pip install {PIP_INDEX_OPTION} --timeout 180 xxx` (최상위 패키지만)
- 예외: `sklearn` → `!pip install {PIP_INDEX_OPTION} --timeout 180 scikit-learn`
- 예외: `cv2` → `!pip install {PIP_INDEX_OPTION} --timeout 180 opencv-python`
- 예외: `PIL` → `!pip install {PIP_INDEX_OPTION} --timeout 180 pillow`

## 분석 지침

1. **근본 원인 분석**: 단순 코드 버그인가, 접근법 자체의 문제인가?
2. **필요한 선행 작업**: 누락된 import, 데이터 변환, 환경 설정이 있는가?
3. **대안적 접근법**: 다른 라이브러리나 방법을 사용해야 하는가?
4. **⚠️ 이전 실행된 코드 참고**: 위의 "현재까지 실행된 단계"에 표시된 코드를 반드시 확인하세요!
   - 예: 이전 단계에서 데이터프레임 컬럼명을 소문자로 변환했다면, 현재 단계에서도 소문자로 접근해야 합니다
   - 예: 이전 단계에서 특정 변수를 정의했다면, 그 변수명을 그대로 사용해야 합니다
   - 데이터 전처리, 변수 변환 등 이전 컨텍스트를 유지하세요
5. **코드 내 주석과 문자열은 한글 또는 영어로만 작성하세요 (한자 사용 절대 금지)**
6. **함수 docstring은 작은따옴표(') 3개만 사용하세요. 절대 백틱(`)을 사용하지 마세요.**
7. **변수 값 출력**:
    - f-string을 사용하여 변수 값을 출력하세요
    - Markdown cell에 변수를 쓰면 변수명이 그대로 텍스트로 출력됩니다
    - 변수 값을 출력하려면 code cell에서 print 또는 display 사용하세요
    - 마크다운 포맷으로 예쁘게 출력하려면 display(Markdown(...)) 사용 권장

## 에러 유형별 해결 전략

### FileNotFoundError
- 파일 경로 확인 또는 파일 존재 여부 체크 단계 추가
- 가능하면 `os.path.exists()` 검증 후 적절한 에러 메시지

### NameError (변수 미정의)
**원인을 먼저 파악하세요:**
1. **이전 MODIFY 단계에서 원본 코드가 손실된 경우**
   - 이전 단계에서 셀을 MODIFY할 때 관련 없는 코드를 삭제했을 가능성
   - **해결책**: `refine`으로 해당 코드에 누락된 변수 정의를 복원

2. **단순 오타인 경우**
   - `refine`으로 수정

3. **원래 계획에서 변수 정의가 누락된 경우**
   - 필요한 변수 정의를 추가하는 것이 적절

### TypeError / ValueError
- 대부분 `refine`으로 코드 수정
- 데이터 타입 변환이 필요하면 변환 로직 추가

## 결정 옵션

1. **refine**: 같은 접근법으로 코드만 수정
   - ✅ 사용 가능: SyntaxError, TypeError, ValueError, KeyError, IndexError, AttributeError, NameError
   - ❌ 사용 금지: ModuleNotFoundError, ImportError

2. **insert_steps**: 현재 단계 전에 필요한 단계 추가 (선행 작업 필요)
   - ✅ **ModuleNotFoundError, ImportError 발생 시 유일하게 허용되는 옵션!**
   - 패키지 설치: `!pip install {PIP_INDEX_OPTION} --timeout 180 패키지명` 단계 추가
   - 에러 메시지의 패키지명을 정확히 추출하여 설치

3. **replace_step**: 현재 단계를 완전히 다른 접근법으로 교체
   - ❌ ModuleNotFoundError, ImportError 시 사용 금지! (라이브러리 대체 금지)

4. **replan_remaining**: 남은 모든 단계를 새로 계획 (final_answer도 새로 작성!)
   - ❌ ModuleNotFoundError, ImportError 시 사용 금지! (접근법 변경 금지)

## 중요 규칙

- **replan_remaining 또는 replace_step 선택 시**: 접근법이 변경되면 final_answer 메시지도 반드시 실제 사용된 방법을 반영해야 합니다.
  - 예: dask → pandas로 변경 시, final_answer는 "pandas를 사용하여..."로 작성
- **final_answer는 실제 실행된 코드를 정확히 반영**해야 합니다.

## 🚨 import 문 보존 규칙 (CRITICAL!)

**코드를 수정할 때 import 문은 절대로 주석 처리하지 마세요!**

```python
# ❌ 잘못된 예시 - import까지 주석 처리 → 후속 Step에서 NameError 발생
# import matplotlib.pyplot as plt  ← 이렇게 하면 안 됨!
# import matplotlib.font_manager as fm

# ✅ 올바른 예시 - import는 유지하고 문제 코드만 수정
import matplotlib.pyplot as plt  # 반드시 유지!
import matplotlib.font_manager as fm  # 반드시 유지!

# 문제가 있는 부분만 try-except로 감싸거나 제거
try:
    # 한글 폰트 설정 등 문제 코드
    pass
except Exception:
    pass
```

**규칙**: matplotlib, pandas, numpy, seaborn 등의 import 문은 항상 유지하세요. 문제가 생기면 import 이후의 코드만 수정하세요.

## 🚨 Matplotlib API 금지 규칙 (CRITICAL!)

**⛔ tick_params()에서 절대 사용 금지:**
- ❌ `ax.tick_params(ha='right')` - ValueError 발생!
- ❌ `ax.tick_params(horizontalalignment='right')` - ValueError 발생!
- ❌ `ax.tick_params(va='center')` - ValueError 발생!

**✅ 레이블 정렬이 필요하면 반드시 이 방법 사용:**
```python
# 올바른 방법: plt.setp() 사용
plt.setp(ax.get_xticklabels(), rotation=45, ha='right')

# 또는 plt.xticks() 사용
plt.xticks(rotation=45, ha='right')
```

## 🚨 Dask DataFrame 금지 규칙 (CRITICAL!)

**⛔ .head() 결과에 .compute() 절대 사용 금지:**
- ❌ `df.head().compute()` - AttributeError 발생! head()는 이미 pandas!
- ❌ `df.head(1000).compute()` - AttributeError 발생!
- ❌ `df[['col1', 'col2']].head(5000).compute()` - 컬럼 선택 후에도 금지!
- ❌ `sample_df = df.head(100); sample_df.compute()` - head() 결과는 이미 pandas!

**✅ head()는 직접 사용 (compute 불필요):**
```python
# 올바른 방법: head()는 이미 pandas DataFrame 반환
sample_df = df.head(1000)                    # 이미 pandas!
sample_df = df[['col1', 'col2']].head(5000)  # 이미 pandas!
# 바로 시각화나 분석에 사용하면 됨
```

**⛔ corr() 사용 시 문자열 컬럼 포함 금지:**
- ❌ `df.corr().compute()` - 문자열 컬럼이 있으면 ValueError 발생!

**✅ 반드시 숫자형 컬럼만 선택 후 사용:**
```python
# 올바른 방법: 숫자형 컬럼만 선택
numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
correlation_matrix = df[numeric_cols].corr().compute()
```

**⛔ value_counts().unstack() 사용 금지:**
- ❌ `df.groupby('Sex')['Survived'].value_counts().unstack().compute()` - Dask Series에는 unstack() 메서드 없음! AttributeError 발생!

**✅ 대체 방법: compute 후 unstack 또는 crosstab 사용:**
```python
# 방법 1: groupby + size + compute 후 unstack
cross_tab = df.groupby(['Sex', 'Survived']).size().compute().unstack(fill_value=0)

# 방법 2: pandas crosstab (compute 후 적용)
sample = df[['Sex', 'Survived']].compute()
cross_tab = pd.crosstab(sample['Sex'], sample['Survived'])
```

## 출력 형식 (JSON)

**⚠️ 중요: 응답은 간결하게!**
- `root_cause`: 1-2문장으로 간결하게 작성
- `reasoning`: 1-2문장으로 간결하게 작성
- 장황한 설명 금지!

```json
{{
  "analysis": {{
    "root_cause": "근본 원인을 1-2문장으로 간결하게 (한국어)",
    "is_approach_problem": true/false,
    "missing_prerequisites": ["누락된 선행 작업들"]
  }},
  "decision": "refine | insert_steps | replace_step | replan_remaining",
  "reasoning": "결정 이유를 1-2문장으로 간결하게 (한국어)",
  "changes": {{
    // decision이 "refine"인 경우:
    "refined_code": "수정된 코드",

    // decision이 "insert_steps"인 경우 (예: 패키지 설치):
    // ⚠️ 중요: 에러메시지의 패키지명 사용! (예: pyarrow, 사용자코드의 dask 아님!)
    "new_steps": [
      {{
        "description": "에러메시지에서 확인된 패키지(예: pyarrow) 설치",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "!pip install {PIP_INDEX_OPTION} --timeout 180 에러메시지의_패키지명"}}}}]
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

## 🚨 출력 형식 필수 규칙 (CRITICAL!)

**⛔ 절대 금지:**
- ❌ 마크다운 형식 (## 분석, **굵은 글씨** 등) 출력 금지!
- ❌ 설명, 해설, 주석 출력 금지!
- ❌ "다음은...", "분석 결과..." 같은 서두 금지!

**✅ 필수:**
- JSON 코드 블록만 출력하세요!
- ```json 으로 시작하고 ``` 으로 끝나야 합니다!

**올바른 응답 예시:**
```json
{{
  "analysis": {{...}},
  "decision": "refine",
  "reasoning": "...",
  "changes": {{...}}
}}
```

위 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요!"""


# ═══════════════════════════════════════════════════════════════════════════
# 구조화된 계획 생성 프롬프트 (Enhanced Planning with Checkpoints)
# ═══════════════════════════════════════════════════════════════════════════

STRUCTURED_PLAN_PROMPT = """당신은 Jupyter 노트북을 위한 Python 코드 전문가입니다.
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

### 기본 도구 (셀 작업)
1. **jupyter_cell**: Python 코드 셀 생성 (노트북 끝에 추가)
   - parameters: {{"code": "Python 코드"}}
   - **항상 새 셀을 노트북 끝에 추가합니다**

2. **markdown**: 마크다운 설명 셀 생성 (노트북 끝에 추가)
   - parameters: {{"content": "마크다운 텍스트"}}

3. **final_answer**: 작업 완료 및 최종 답변
   - parameters: {{"answer": "최종 답변 텍스트", "summary": "작업 요약(선택)"}}

### 확장 도구 (파일/터미널)
4. **read_file**: 파일 읽기 (절대경로/.. 금지)
   - parameters: {{"path": "상대경로"}}

5. **write_file**: 파일 쓰기 (승인 필요)
   - parameters: {{"path": "상대경로", "content": "내용"}}

6. **list_files**: 디렉토리 조회
   - parameters: {{"path": ".", "recursive": false, "pattern": "*.py"}}

7. **execute_command**: 셸 명령 (위험 명령만 승인)
   - parameters: {{"command": "pip list"}}

8. **search_files**: 파일 내용 검색
   - parameters: {{"pattern": "def func", "path": "src"}}

## 🔴 핵심 원칙: 항상 새 셀을 아래에 추가!

**⛔ 기존 셀을 수정하지 마세요! 항상 새 셀을 노트북 끝에 추가합니다.**

이 방식의 장점:
- 기존 코드 히스토리가 보존됨
- 사용자가 이전/이후 코드를 비교할 수 있음
- 실행 순서가 명확해짐
- 롤백이 쉬움 (불필요한 셀만 삭제하면 됨)

## 노트북 컨텍스트 (참고용 - 기존 코드를 수정하지 마세요!)

- 셀 개수: {cell_count}
- 임포트된 라이브러리: {imported_libraries}
- 정의된 변수: {defined_variables}
- 최근 셀 내용 (참고용):
{recent_cells}

**참고**: 위 기존 셀들은 수정하지 않습니다. 필요한 코드는 새 셀로 추가하세요.

## 사용자 요청

{request}

## ⚠️ 초기 설정 (첫 번째 코드 셀에 포함)

**먼저 "설치된 패키지" 목록을 확인하세요!**
- 필요한 라이브러리가 없으면 `!pip install {PIP_INDEX_OPTION} --timeout 180 패키지명` 형식으로 설치 단계를 먼저 추가하세요.

첫 번째 코드 셀 예시 (설치된 패키지에 따라 조정):
```python
# === 경고 필터링 ===
import warnings
warnings.filterwarnings('ignore', category=RuntimeWarning)
warnings.filterwarnings('ignore', category=FutureWarning)

# === 기본 라이브러리 import (pandas, numpy는 대부분 설치되어 있음) ===
import pandas as pd
import numpy as np

# === 시각화 라이브러리 (설치 확인 후 import) ===
# matplotlib, seaborn이 설치된 패키지 목록에 있는 경우에만 import
import matplotlib.pyplot as plt
import seaborn as sns

# === 한글 폰트 설정 (선택적 - matplotlib 설치된 경우) ===
try:
    import matplotlib.font_manager as fm
    korean_fonts = ['Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic', 'Noto Sans CJK KR']
    available = set(f.name for f in fm.fontManager.ttflist)
    for font in korean_fonts:
        if font in available:
            plt.rcParams['font.family'] = font
            break
    plt.rcParams['axes.unicode_minus'] = False
except Exception:
    pass  # 폰트 설정 실패해도 계속 진행
```

**🔴 중요**:
- **설치되지 않은 라이브러리는 import하지 마세요!** 먼저 `!pip install {PIP_INDEX_OPTION} --timeout 180 패키지명` 단계를 추가하세요.
- import 문은 **절대로** 주석 처리하지 마세요! 문제가 생기면 한글 폰트 설정 블록(try 블록)만 수정하세요.

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

JSON만 출력하세요. 다른 텍스트 없이."""


# ═══════════════════════════════════════════════════════════════════════════
# Reflection 프롬프트 (실행 결과 분석 및 적응적 조정)
# ═══════════════════════════════════════════════════════════════════════════

REFLECTION_PROMPT = """실행 결과를 분석하고 다음 단계에 대한 조정을 제안하세요.

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

JSON만 출력하세요."""


# ═══════════════════════════════════════════════════════════════════════════
# 최종 답변 생성 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

FINAL_ANSWER_PROMPT = """작업이 완료되었습니다. 결과를 요약해주세요.

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
5. **변수명이 아닌 실제 계산된 값을 사용하세요** (예: "n_rows 행" 대신 "891 행")

## 출력

간결한 요약 텍스트 (200자 이내)"""


# ═══════════════════════════════════════════════════════════════════════════
# 유틸리티 함수
# ═══════════════════════════════════════════════════════════════════════════


def format_plan_prompt(
    request: str,
    cell_count: int,
    imported_libraries: list,
    defined_variables: list,
    recent_cells: list,
    available_libraries: list = None,
) -> str:
    """
    실행 계획 생성 프롬프트 포맷팅

    Step-Level RAG 아키텍처:
    - Planning 단계에서는 Collection TOC만 제공 (실제 문서 조회 없음)
    - LLM이 각 step별로 필요한 requiredCollections를 선택
    - 실제 RAG 조회는 step 실행 시점에 수행됨
    """
    # Collection Index TOC 로드
    from hdsp_agent_core.knowledge.collection_index import get_collection_index

    collection_index = get_collection_index()
    collection_index_text = collection_index.format_for_prompt()

    # 최근 셀 내용 포맷팅 (참고용으로만 표시) - 최대 5개 셀, 각 150자
    recent_cells_text = ""
    max_cells = min(5, len(recent_cells))  # 최대 5개 셀만
    for i, cell in enumerate(recent_cells[-max_cells:]):  # 마지막 5개만
        source = cell.get("source", "")[:150]  # 최대 150자
        cell_index = cell.get("index", i)
        recent_cells_text += (
            f"\n[셀 {cell_index}]: {source[:100]}...\n"
            if len(source) > 100
            else f"\n[셀 {cell_index}]: {source}\n"
        )

    # 프롬프트 생성 (Collection TOC 주입)
    prompt = PLAN_GENERATION_PROMPT.format(
        collection_index=collection_index_text,
        request=request,
        cell_count=cell_count,
        imported_libraries=", ".join(imported_libraries)
        if imported_libraries
        else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음",
        available_libraries=", ".join(available_libraries)
        if available_libraries
        else "정보 없음",
    )

    print(f"[Planning] Collection TOC 주입됨: {len(collection_index_text)} chars")

    return prompt


def format_refine_prompt(
    original_code: str,
    error_type: str,
    error_message: str,
    traceback: str,
    attempt: int,
    max_attempts: int,
    available_libraries: list,
    defined_variables: list,
) -> str:
    """에러 수정 프롬프트 포맷팅"""
    return ERROR_REFINEMENT_PROMPT.format(
        original_code=original_code,
        error_type=error_type,
        error_message=error_message,
        traceback=traceback,
        attempt=attempt,
        max_attempts=max_attempts,
        available_libraries=", ".join(available_libraries)
        if available_libraries
        else "pandas, numpy, matplotlib",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
    )


def format_final_answer_prompt(
    original_request: str, executed_steps: list, outputs: list
) -> str:
    """최종 답변 프롬프트 포맷팅"""
    steps_text = "\n".join(
        [
            f"- Step {s.get('stepNumber', i + 1)}: {s.get('description', '완료')}"
            for i, s in enumerate(executed_steps)
        ]
    )

    outputs_text = "\n".join(
        [f"[출력 {i + 1}]: {str(o)[:200]}" for i, o in enumerate(outputs)]
    )

    return FINAL_ANSWER_PROMPT.format(
        original_request=original_request,
        executed_steps=steps_text if steps_text else "없음",
        outputs=outputs_text if outputs_text else "없음",
    )


def format_replan_prompt(
    original_request: str,
    executed_steps: list,
    failed_step: dict,
    error_info: dict,
    execution_output: str = "",
    available_libraries: list = None,
) -> str:
    """Adaptive Replanning 프롬프트 포맷팅"""
    # 실행된 단계 텍스트 (코드 포함)
    executed_text_parts = []
    if executed_steps:
        for i, s in enumerate(executed_steps):
            step_num = s.get("stepNumber", i + 1)
            step_desc = s.get("description", "완료")
            executed_text_parts.append(f"- Step {step_num}: {step_desc} ✅")

            # 이 스텝에서 실행한 코드 추가
            tool_calls = s.get("toolCalls", [])
            for tc in tool_calls:
                if tc.get("tool") == "jupyter_cell":
                    code = tc.get("parameters", {}).get("code", "")
                    if code:
                        # 코드를 간략하게 표시 (처음 3줄 또는 전체)
                        code_lines = code.split("\n")
                        if len(code_lines) > 5:
                            code_preview = "\n".join(code_lines[:5]) + "\n  ...(생략)"
                        else:
                            code_preview = code
                        executed_text_parts.append(
                            f"  코드:\n    {code_preview.replace(chr(10), chr(10) + '    ')}"
                        )

    executed_text = "\n".join(executed_text_parts) if executed_text_parts else "없음"

    # 실패한 코드 추출
    failed_code = ""
    if failed_step.get("toolCalls"):
        for tc in failed_step["toolCalls"]:
            if tc.get("tool") == "jupyter_cell":
                failed_code = tc.get("parameters", {}).get("code", "")
                break

    # traceback 처리
    traceback_data = error_info.get("traceback", [])
    if isinstance(traceback_data, list):
        traceback_str = "\n".join(traceback_data)
    else:
        traceback_str = str(traceback_data) if traceback_data else ""

    # errorName (Python 예외 이름)이 있으면 우선 사용, 없으면 type 필드 사용
    # 예: "ModuleNotFoundError", "ImportError", "TypeError" 등
    error_type = error_info.get("errorName") or error_info.get("type", "runtime")

    return ADAPTIVE_REPLAN_PROMPT.format(
        original_request=original_request,
        executed_steps=executed_text,
        failed_step_number=failed_step.get("stepNumber", "?"),
        failed_step_description=failed_step.get("description", ""),
        failed_code=failed_code,
        error_type=error_type,  # Python 예외 이름 (ModuleNotFoundError 등)
        error_message=error_info.get("message", "Unknown error"),
        traceback=traceback_str,
        execution_output=execution_output if execution_output else "없음",
        available_libraries=", ".join(available_libraries)
        if available_libraries
        else "정보 없음",
    )


def format_structured_plan_prompt(
    request: str,
    cell_count: int,
    imported_libraries: list,
    defined_variables: list,
    recent_cells: list,
) -> str:
    """구조화된 계획 생성 프롬프트 포맷팅 (Enhanced Planning)"""
    recent_cells_text = ""
    for i, cell in enumerate(recent_cells):
        cell_type = cell.get("type", "code")
        source = cell.get("source", "")[:300]
        recent_cells_text += (
            f"\n[셀 {cell.get('index', i)}] ({cell_type}):\n```\n{source}\n```\n"
        )

    return STRUCTURED_PLAN_PROMPT.format(
        request=request,
        cell_count=cell_count,
        imported_libraries=", ".join(imported_libraries)
        if imported_libraries
        else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음",
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
    remaining_steps: list,
) -> str:
    """Reflection 프롬프트 포맷팅 (실행 결과 분석)"""
    # 검증 기준 텍스트
    criteria_text = (
        "\n".join([f"- {c}" for c in validation_criteria])
        if validation_criteria
        else "없음"
    )

    # 남은 단계 텍스트
    remaining_text = (
        "\n".join(
            [
                f"- Step {s.get('stepNumber', i + 1)}: {s.get('description', '')}"
                for i, s in enumerate(remaining_steps)
            ]
        )
        if remaining_steps
        else "없음"
    )

    return REFLECTION_PROMPT.format(
        step_number=step_number,
        step_description=step_description,
        executed_code=executed_code,
        execution_status=execution_status,
        execution_output=execution_output if execution_output else "없음",
        error_message=error_message if error_message else "없음",
        expected_outcome=expected_outcome if expected_outcome else "성공적 실행",
        validation_criteria=criteria_text,
        remaining_steps=remaining_text,
    )


# ═══════════════════════════════════════════════════════════════════════════
# LLM Fallback 에러 분석 프롬프트 (패턴 매칭 실패 시 사용)
# ═══════════════════════════════════════════════════════════════════════════

ERROR_ANALYSIS_PROMPT = """에러를 분석하고 복구 전략을 결정하세요.

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
   - SyntaxError, TypeError, ValueError, KeyError 등 단순 코드 버그

2. **insert_steps**: 선행 작업이 필요한 경우
   - 패키지 설치가 필요한 경우 (ModuleNotFoundError)
   - 데이터 전처리가 필요한 경우

3. **replace_step**: 완전히 다른 접근법이 필요한 경우
   - 현재 방법이 근본적으로 작동하지 않는 경우
   - 대안적 라이브러리/알고리즘이 필요한 경우

4. **replan_remaining**: 남은 모든 단계를 재계획해야 하는 경우
   - 시스템 레벨 문제 (dlopen 에러 등)
   - 전체 접근법 변경이 필요한 경우

## 분석 지침

1. 에러의 근본 원인을 파악하세요
2. 이전 시도 횟수를 고려하세요 (2회 이상 실패 시 다른 전략 고려)
3. 에러 메시지와 트레이스백을 면밀히 분석하세요
4. 가장 효율적인 복구 전략을 선택하세요

## 출력 형식 (JSON)

```json
{{
  "analysis": {{
    "root_cause": "에러의 근본 원인 (1-2문장)",
    "is_approach_problem": true/false,
    "missing_prerequisites": ["누락된 선행 작업들"],
    "complexity": "simple | moderate | complex"
  }},
  "decision": "refine | insert_steps | replace_step | replan_remaining",
  "reasoning": "결정 이유 (1-2문장)",
  "confidence": 0.0-1.0,
  "changes": {{
    // decision이 "refine"인 경우:
    "refined_code": null,

    // decision이 "insert_steps"인 경우:
    "new_steps": [
      {{
        "description": "단계 설명",
        "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
      }}
    ],

    // decision이 "replace_step"인 경우:
    "replacement": {{
      "description": "새 단계 설명",
      "toolCalls": [{{"tool": "jupyter_cell", "parameters": {{"code": "코드"}}}}]
    }},

    // decision이 "replan_remaining"인 경우:
    "new_plan": []
  }}
}}
```

JSON만 출력하세요."""


def format_error_analysis_prompt(
    error_type: str,
    error_message: str,
    traceback: str,
    previous_attempts: int = 0,
    previous_codes: list = None,
) -> str:
    """LLM Fallback 에러 분석 프롬프트 포맷팅"""
    previous_codes = previous_codes or []
    codes_text = ""
    if previous_codes:
        for i, code in enumerate(previous_codes[-3:], 1):  # 최근 3개만
            codes_text += f"\n### 시도 {i}:\n```python\n{code[:500]}\n```\n"
    else:
        codes_text = "없음"

    return ERROR_ANALYSIS_PROMPT.format(
        error_type=error_type,
        error_message=error_message[:500] if error_message else "없음",
        traceback=traceback[:1000] if traceback else "없음",
        previous_attempts=previous_attempts,
        previous_codes=codes_text,
    )


# ═══════════════════════════════════════════════════════════════════════════
# 프롬프트 치환: {PIP_INDEX_OPTION} placeholder를 실제 값으로 교체
# ═══════════════════════════════════════════════════════════════════════════

# 모든 프롬프트에서 {PIP_INDEX_OPTION}을 실제 값으로 치환
# - 로컬 환경: 빈 문자열 → `!pip install --timeout 180 패키지명`
# - 내부망: "--index-url <url>" → `!pip install --index-url <url> --timeout 180 패키지명`
PLAN_GENERATION_PROMPT = PLAN_GENERATION_PROMPT.replace(
    "{PIP_INDEX_OPTION}", PIP_INDEX_OPTION
)
ADAPTIVE_REPLAN_PROMPT = ADAPTIVE_REPLAN_PROMPT.replace(
    "{PIP_INDEX_OPTION}", PIP_INDEX_OPTION
)


# ═══════════════════════════════════════════════════════════════════════════
# Step-Level 코드 생성 프롬프트 (Step 실행 시 RAG context와 함께 사용)
# ═══════════════════════════════════════════════════════════════════════════

STEP_CODE_GENERATION_PROMPT = """주어진 Step을 실행할 Python 코드를 생성하세요.

## Step 정보

**Step {step_number}**: {step_description}

## API 가이드 (반드시 참고)

{rag_context}

## 노트북 컨텍스트

- 기존 import: {imported_libraries}
- 정의된 변수: {defined_variables}
- 최근 셀:
{recent_cells}

## 핵심 규칙

1. **새 셀 독립 실행**: 기존 변수에 의존하지 않고 독립적으로 실행 가능해야 함
2. **API 가이드 준수**: 위 API 가이드의 코드 패턴과 주의사항을 반드시 따르세요
3. **한글 주석**: 코드 내 주석과 문자열은 한글 또는 영어로만 (한자 금지)
4. **에러 방지**: API 가이드에 언급된 일반적인 실수를 피하세요
5. **시각화 시 한글 폰트**:
```python
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'AppleGothic'
plt.rcParams['axes.unicode_minus'] = False
```

## 출력 형식

```json
{{
  "toolCalls": [
    {{
      "tool": "jupyter_cell",
      "parameters": {{
        "code": "실제 Python 코드"
      }}
    }}
  ],
  "reasoning": "코드 생성 이유 (1-2문장)"
}}
```

JSON만 출력하세요."""


def format_step_code_prompt(
    step_number: int,
    step_description: str,
    rag_context: str,
    imported_libraries: list,
    defined_variables: list,
    recent_cells: list,
) -> str:
    """
    Step-Level 코드 생성 프롬프트 포맷팅

    Args:
        step_number: 현재 step 번호
        step_description: step 설명
        rag_context: /rag/step-context 에서 조회한 RAG 컨텍스트
        imported_libraries: 노트북에서 import된 라이브러리 목록
        defined_variables: 노트북에서 정의된 변수 목록
        recent_cells: 최근 실행된 셀 목록

    Returns:
        포맷팅된 프롬프트 문자열
    """
    # 최근 셀 내용 포맷팅 (참고용으로만 표시) - 최대 3개 셀, 각 100자
    recent_cells_text = ""
    max_cells = min(3, len(recent_cells))
    for i, cell in enumerate(recent_cells[-max_cells:]):
        source = cell.get("source", "")[:100]
        cell_index = cell.get("index", i)
        recent_cells_text += (
            f"\n[셀 {cell_index}]: {source[:80]}...\n"
            if len(source) > 80
            else f"\n[셀 {cell_index}]: {source}\n"
        )

    # RAG context가 없는 경우 기본 메시지
    if not rag_context or not rag_context.strip():
        rag_context = "(API 가이드 없음 - 일반적인 Python 베스트 프랙티스를 따르세요)"

    return STEP_CODE_GENERATION_PROMPT.format(
        step_number=step_number,
        step_description=step_description,
        rag_context=rag_context,
        imported_libraries=", ".join(imported_libraries)
        if imported_libraries
        else "없음",
        defined_variables=", ".join(defined_variables) if defined_variables else "없음",
        recent_cells=recent_cells_text if recent_cells_text else "없음",
    )
