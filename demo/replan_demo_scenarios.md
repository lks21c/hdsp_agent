# HDSP Agent 리플랜 데모 시나리오

> **목적**: Agent 모드의 핵심 기능인 "Adaptive Replanning"을 상무님께 시연
> **핵심 메시지**: "에러가 나도 스스로 해결하고 원래 목표를 달성합니다"

---

## 데모 전 체크리스트

- [ ] Jupyter Lab 실행 확인 (http://localhost:8889)
- [ ] HDSP Agent 확장 설치 확인
- [ ] titanic.csv 파일 준비 (demo 폴더에)
- [ ] 각 시나리오 전 환경 준비 명령어 실행

---

## 시나리오 1: 모듈 설치 자동 리플랜 ⭐ 추천

### 1-1. 환경 준비 (터미널에서 실행)

```bash
# plotly 제거 (리플랜 트리거용)
pip uninstall plotly -y

# 확인
pip show plotly  # "WARNING: Package(s) not found" 나와야 함
```

### 1-2. Agent에 입력할 프롬프트

```
plotly로 titanic.csv의 Pclass별 생존율을 interactive bar chart로 보여줘
```

### 1-3. 예상 시연 흐름

1. **계획 수립** → 5개 정도의 Step 생성
2. **Step 1 실행** → `import plotly.express as px`
3. **에러 발생** → `ModuleNotFoundError: No module named 'plotly'`
4. **🔄 리플랜 발동** → "insert_steps" 결정
5. **패키지 설치** → `!pip install plotly` 자동 실행
6. **원래 계획 재개** → plotly로 인터랙티브 차트 완성

### 1-4. 어필 포인트

> "사용자가 요청한 라이브러리가 없어도, Agent가 알아서 설치하고 원래 목표를 달성합니다.
> 일반 사용자는 pip install 명령어를 몰라도 됩니다."

---

## 시나리오 2: 간접 의존성 리플랜 (고급)

### 2-1. 환경 준비 (터미널에서 실행)

```bash
# pyarrow 제거 (dask의 숨은 의존성)
pip uninstall pyarrow -y

# dask는 설치되어 있어야 함
pip show dask  # 설치 확인
```

### 2-2. Agent에 입력할 프롬프트

```
dask로 titanic.csv 읽어서 describe() 결과 보여줘
```

### 2-3. 예상 시연 흐름

1. **계획 수립** → dask로 EDA 계획 생성
2. **Step 1 실행** → `import dask.dataframe as dd`
3. **에러 발생** → `ModuleNotFoundError: No module named 'pyarrow'`
   - 주목: 코드는 dask인데 에러는 pyarrow!
4. **🔄 리플랜 발동** → Agent가 에러 메시지 분석
5. **정확한 패키지 설치** → `!pip install pyarrow` (dask 아님!)
6. **원래 계획 재개** → dask로 분석 완료

### 2-4. 어필 포인트

> "Agent가 단순히 코드의 패키지가 아니라, 에러 메시지를 분석해서
> 숨겨진 의존성(pyarrow)을 찾아 설치합니다. 사용자가 요청한 dask는 그대로 유지!"

---

## 시나리오 3: API 에러 자동 수정 (Self-Healing)

### 3-1. 환경 준비

```bash
# 특별한 준비 불필요 (matplotlib은 기본 설치)
# seaborn 설치 확인
pip show seaborn
```

### 3-2. Agent에 입력할 프롬프트

```
seaborn으로 titanic.csv의 Pclass별 생존율 barplot 그리고, x축 레이블을 45도 기울여서 보기 좋게 만들어줘
```

### 3-3. 예상 시연 흐름

1. **계획 수립** → seaborn barplot + 레이블 회전 계획
2. **시각화 코드 실행** → LLM이 `ax.tick_params(ha='right')` 사용 가능
3. **에러 발생** → `ValueError: 'ha' is not a valid argument`
4. **🔄 리플랜 발동** → "refine" 결정 (같은 목표, 다른 방법)
5. **코드 수정** → `plt.setp(ax.get_xticklabels(), rotation=45, ha='right')`
6. **성공** → 예쁜 차트 완성

### 3-4. 어필 포인트

> "LLM도 잘못된 API를 사용할 수 있습니다. 하지만 Agent는 에러를 학습하고
> 올바른 방법으로 자동 수정합니다. 사용자는 에러 메시지를 볼 필요가 없습니다."

---

## 시나리오 4: 파일 경로 자동 탐색

### 4-1. 환경 준비

```bash
# titanic.csv를 숨겨진 위치에 배치
mkdir -p ~/repo/hdsp_agent/demo/data/raw
mv titanic.csv ~/repo/hdsp_agent/demo/data/raw/

# 또는 다른 이름으로
cp titanic.csv ~/repo/hdsp_agent/demo/data/raw/train_titanic.csv
```

### 4-2. Agent에 입력할 프롬프트

```
titanic 데이터 찾아서 로드하고 head() 보여줘
```

### 4-3. 예상 시연 흐름

1. **파일 탐색 단계** → `glob.glob('**/*titanic*.csv', recursive=True)`
2. **경로 발견** → `./data/raw/train_titanic.csv` 출력
3. **파일 로드** → 찾은 경로로 pandas 로드
4. **결과 표시** → head() 출력

### 4-4. 어필 포인트

> "정확한 파일 경로를 몰라도 됩니다.
> Agent가 알아서 파일을 찾아서 로드합니다."

---

## 시나리오 5: Dask API 에러 수정

### 5-1. 환경 준비

```bash
# dask, pyarrow 모두 설치 확인
pip show dask pyarrow
```

### 5-2. Agent에 입력할 프롬프트

```
dask로 titanic.csv 읽어서 상관관계 분석하고 히트맵 그려줘
```

### 5-3. 예상 시연 흐름

1. **계획 수립** → dask로 데이터 로드 + corr() + 히트맵
2. **상관관계 계산** → LLM이 `df.corr().compute()` 사용 가능
3. **에러 발생** → 문자열 컬럼 포함으로 ValueError
4. **🔄 리플랜 발동** → "refine" 결정
5. **코드 수정** → `df.select_dtypes(include=['number']).corr().compute()`
6. **성공** → 상관관계 히트맵 완성

### 5-4. 어필 포인트

> "라이브러리별 특수한 API 규칙도 Agent가 알아서 처리합니다.
> Dask는 pandas와 다른 점이 많은데, 에러가 나면 자동 수정합니다."

---

## 베스트 데모 조합 (시간별)

### 5분 데모
- **시나리오 1만** (모듈 설치 리플랜) - 가장 직관적

### 10분 데모
- **시나리오 1** → **시나리오 3** (설치 + API 수정)

### 15분 데모
- **시나리오 1** → **시나리오 2** → **시나리오 3**
- "없는 패키지 → 숨은 의존성 → API 에러" 3단계 어필

---

## 데모 후 복원

```bash
# 패키지 재설치
pip install plotly pyarrow

# 파일 위치 복원
mv ~/repo/hdsp_agent/demo/data/raw/titanic.csv ~/repo/hdsp_agent/demo/
```

---

## 멘트 예시

### 오프닝
> "기존 Jupyter 노트북은 에러가 나면 사용자가 직접 해결해야 합니다.
> HDSP Agent는 에러가 발생해도 스스로 분석하고, 해결책을 찾아 실행합니다."

### 리플랜 발동 시
> "지금 보시는 것처럼, 패키지가 없다는 에러가 발생했습니다.
> Agent가 이를 감지하고 자동으로 설치 단계를 추가합니다.
> 사용자는 pip 명령어를 몰라도 됩니다."

### 클로징
> "이처럼 HDSP Agent는 단순한 코드 생성이 아니라,
> 실행-검증-수정의 지능적인 사이클을 수행합니다.
> 데이터 분석가가 코딩 에러에 시간을 쓰지 않고, 분석 자체에 집중할 수 있습니다."
