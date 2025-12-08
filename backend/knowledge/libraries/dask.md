# Dask DataFrame API 가이드

## 핵심 개념
Dask DataFrame은 **lazy evaluation**을 사용합니다. 연산을 정의하면 즉시 실행되지 않고, `.compute()` 호출 시 실행됩니다.

## .compute() 호출 규칙

### 필요한 경우 (연산 결과)
```python
df.sum().compute()           # 집계 연산
df.mean().compute()          # 평균
df.describe().compute()      # 통계 요약
df.value_counts().compute()  # 값 빈도
df.isnull().sum().compute()  # 결측치 개수
df.groupby('col').sum().compute()  # 그룹 연산
df.shape[0].compute()        # 행 개수 (Delayed 객체)
```

### 필요 없는 경우 (이미 즉시 평가됨)
```python
df.columns              # pandas Index 반환
df.columns.tolist()     # 컬럼 리스트
df.dtypes               # pandas Series 반환
df.head()               # pandas DataFrame 반환 (기본 5행)
df.head(10)             # pandas DataFrame 반환
df.select_dtypes(include=['number']).columns.tolist()  # 컬럼 리스트
```

### 흔한 실수
```python
# 잘못된 코드
df.columns.compute()  # AttributeError! columns는 이미 Index
len(df)               # 전체 데이터 로드됨, 비효율적

# 올바른 코드
df.columns.tolist()   # 직접 사용
df.shape[0].compute() # 행 개수
```

## 시각화
시각화 전 반드시 `.compute()`로 pandas 변환:
```python
# matplotlib/seaborn 사용 시
sample_df = df.head(1000)  # 이미 pandas
# 또는
plot_df = df[['col1', 'col2']].compute()  # pandas로 변환 후 시각화
```

## 데이터 읽기
```python
import dask.dataframe as dd

df = dd.read_csv('file.csv')
df = dd.read_csv('*.csv')  # 여러 파일
df = dd.read_parquet('file.parquet')
```

## 필터링/선택
```python
filtered = df[df['col'] > 10]  # lazy
result = filtered.compute()     # 실행

subset = df[['col1', 'col2']]   # lazy
```

## 주의사항
- pandas와 API가 유사하지만 동일하지 않음
- 모든 pandas 메서드가 지원되지는 않음
- 대용량 데이터에서 `.compute()` 호출 시 메모리 주의
