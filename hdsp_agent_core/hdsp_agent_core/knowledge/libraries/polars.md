# Polars DataFrame API 가이드

## 핵심 개념
Polars는 Rust 기반 고성능 DataFrame 라이브러리입니다. pandas와 API가 다릅니다.

## 데이터 읽기
```python
import polars as pl

df = pl.read_csv('file.csv')
df = pl.read_parquet('file.parquet')
df = pl.scan_csv('file.csv')  # lazy
```

## pandas와 차이점

### 컬럼 선택
```python
# pandas
df['col']
df[['col1', 'col2']]

# polars
df['col']  # Series
df.select(['col1', 'col2'])  # DataFrame
df.select(pl.col('col1'), pl.col('col2'))
```

### 필터링
```python
# pandas
df[df['col'] > 10]

# polars
df.filter(pl.col('col') > 10)
```

### 그룹 연산
```python
# pandas
df.groupby('col').sum()

# polars
df.group_by('col').agg(pl.sum('value'))
```

### 새 컬럼 추가
```python
# pandas
df['new'] = df['a'] + df['b']

# polars
df = df.with_columns((pl.col('a') + pl.col('b')).alias('new'))
```

## Lazy 모드
```python
lf = pl.scan_csv('file.csv')  # LazyFrame
result = lf.filter(...).select(...).collect()  # 실행
```

## 통계
```python
df.describe()
df['col'].mean()
df['col'].value_counts()
df.null_count()
```
