# Dask DataFrame API 가이드

## ⛔ 절대 금지 (CRITICAL - 코드 작성 전 반드시 확인!)

**`.head()` 결과에 `.compute()` 절대 사용 금지!**
```python
# ❌ 모든 형태의 .head().compute() 금지 - AttributeError 발생!
df.head().compute()                           # 금지!
df.head(1000).compute()                       # 금지!
df[['col1', 'col2']].head(5000).compute()     # 금지! ← 컬럼 선택 후에도 마찬가지!
sample_df = df.head(100); sample_df.compute() # 금지!

# ✅ head()는 이미 pandas DataFrame을 반환하므로 직접 사용
sample_df = df.head(1000)                     # 이미 pandas!
sample_df = df[['col1', 'col2']].head(5000)   # 이미 pandas!
# 그냥 바로 사용하면 됨 (compute 불필요)
```

**`.columns`, `.dtypes`에 `.compute()` 절대 사용 금지!**
```python
# ❌ 금지 - AttributeError 발생!
df.columns.compute()
df.dtypes.compute()

# ✅ 직접 사용 (이미 pandas 객체)
df.columns.tolist()
df.dtypes
```

**`.value_counts().unstack()` 사용 금지!**
```python
# ❌ 금지 - Dask Series에는 unstack() 메서드 없음! AttributeError 발생!
df.groupby('Sex')['Survived'].value_counts().unstack().compute()

# ✅ 대체 방법: crosstab 또는 pivot_table 패턴 사용
# 방법 1: groupby + size + unstack (compute 후 unstack)
cross_tab = df.groupby(['Sex', 'Survived']).size().compute().unstack(fill_value=0)

# 방법 2: pandas crosstab (compute 후 crosstab 적용)
sample = df[['Sex', 'Survived']].compute()
cross_tab = pd.crosstab(sample['Sex'], sample['Survived'])
```

---

## 핵심 개념
Dask DataFrame은 **lazy evaluation**을 사용합니다. 연산을 정의하면 즉시 실행되지 않고, `.compute()` 호출 시 실행됩니다.

## 🚨 pandas와 다른 API (반드시 확인!)

### 미지원 메서드/파라미터
```python
# ❌ Dask에서 미지원 - 에러 발생!
df.empty                          # AttributeNotImplementedError
df['col'].value_counts(normalize=True)  # normalize 미지원
df.groupby('col').value_counts(normalize=True)  # normalize 미지원
df.info()                         # 미지원
df.memory_usage()                 # 미지원

# ✅ 대체 방법
len(df.columns) == 0              # df.empty 대신 (컬럼 체크)
len(df) == 0                      # df.empty 대신 (행 체크, 느림)

# value_counts normalize 대체
counts = df['col'].value_counts().compute()
proportions = counts / counts.sum()  # 수동으로 비율 계산

# groupby value_counts normalize 대체
counts = df.groupby('col').size().compute()
proportions = counts / counts.sum()
```

### .compute() 호출 규칙

#### 필요한 경우 (Dask 연산 결과)
```python
df.sum().compute()               # 집계 연산
df.mean().compute()              # 평균
df.describe().compute()          # 통계 요약
df['col'].value_counts().compute()  # 값 빈도 (normalize 없이!)
df.isnull().sum().compute()      # 결측치 개수
df.groupby('col').sum().compute()  # 그룹 연산
df.groupby('col').size().compute()  # 그룹별 개수
len(df)                          # 행 개수 (내부적으로 compute 호출)
```

#### 필요 없는 경우 (이미 pandas 객체)
```python
df.columns              # pandas Index 반환
df.columns.tolist()     # 컬럼 리스트
df.dtypes               # pandas Series 반환
df.head()               # pandas DataFrame 반환 (기본 5행)
df.head(100)            # pandas DataFrame 반환
df.select_dtypes(include=['number']).columns.tolist()  # 컬럼 리스트
```

### 흔한 실수와 해결
```python
# ❌ 잘못된 코드
df.columns.compute()      # AttributeError! columns는 이미 Index
df.head().compute()       # AttributeError! head()는 이미 pandas
df.dtypes.compute()       # AttributeError! dtypes는 이미 Series
sample_df.compute()       # AttributeError! head()로 만든건 이미 pandas

# ✅ 올바른 코드
df.columns.tolist()       # 직접 사용
df.head()                 # 직접 사용 (이미 pandas)
df.dtypes                 # 직접 사용 (이미 pandas)
```

## 시각화 패턴

### 올바른 시각화 코드
```python
import matplotlib.pyplot as plt
import seaborn as sns

# 방법 1: head()로 샘플링 (이미 pandas, compute 불필요!)
sample_df = df.head(1000)
sns.histplot(data=sample_df, x='column')

# 방법 2: 특정 컬럼만 compute
plot_data = df[['col1', 'col2']].compute()
sns.scatterplot(data=plot_data, x='col1', y='col2')

# 방법 3: 집계 후 시각화
counts = df['category'].value_counts().compute()  # 결과는 pandas Series
counts.plot(kind='bar')
```

### value_counts 시각화
```python
# ❌ 잘못된 코드 (normalize 미지원)
df['col'].value_counts(normalize=True).compute().plot()

# ✅ 올바른 코드
counts = df['col'].value_counts().compute()
proportions = counts / counts.sum()  # 비율 계산
proportions.plot(kind='bar')
```

## 데이터 읽기
```python
import dask.dataframe as dd

df = dd.read_csv('file.csv')
df = dd.read_csv('*.csv')        # 여러 파일
df = dd.read_parquet('file.parquet')
```

## 필터링/선택
```python
filtered = df[df['col'] > 10]    # lazy (Dask DataFrame)
result = filtered.compute()       # pandas로 변환

subset = df[['col1', 'col2']]    # lazy (Dask DataFrame)
```

## 그룹 연산
```python
# 기본 집계
df.groupby('col').mean().compute()
df.groupby('col').sum().compute()
df.groupby('col').size().compute()  # 그룹별 개수

# 여러 집계 함수
df.groupby('col').agg({'num_col': ['mean', 'sum', 'count']}).compute()
```

## DataFrame 검사
```python
# ❌ pandas 방식 (Dask에서 미지원)
df.info()
df.empty

# ✅ Dask 방식
print(f"컬럼: {df.columns.tolist()}")
print(f"데이터 타입:\n{df.dtypes}")
print(f"행 수: {len(df)}")  # 느릴 수 있음
print(f"샘플:\n{df.head()}")
```

## 주의사항 요약
1. `head()`, `columns`, `dtypes`는 이미 pandas → `.compute()` 금지!
2. `value_counts(normalize=True)` → 수동 비율 계산으로 대체
3. `df.empty` → `len(df.columns) == 0` 또는 `len(df) == 0`으로 대체
4. `df.info()` → `df.dtypes`, `df.columns`, `len(df)` 조합으로 대체
5. 시각화 전 반드시 pandas로 변환 (compute 또는 head)
