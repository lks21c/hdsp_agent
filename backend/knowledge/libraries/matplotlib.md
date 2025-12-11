# Matplotlib API 가이드

## ⛔ 절대 금지 (CRITICAL - 반드시 지킬 것!)

**tick_params()에서 절대 사용하면 안 되는 파라미터:**
- ❌ `ha` - 사용 금지! ValueError 발생!
- ❌ `horizontalalignment` - 사용 금지! ValueError 발생!
- ❌ `va` - 사용 금지!
- ❌ `verticalalignment` - 사용 금지!

**레이블 정렬이 필요하면 반드시 이 방법을 사용:**
```python
# ✅ 올바른 방법: plt.setp() 사용
plt.setp(ax.get_xticklabels(), rotation=45, ha='right')
```

---

## 핵심 개념
Matplotlib은 Python의 대표적인 시각화 라이브러리입니다. `pyplot` 인터페이스와 객체지향(OO) 인터페이스 두 가지 방식을 지원합니다.

## tick_params() 사용법

### 지원되는 파라미터 (이것만 사용 가능!)
`tick_params()`는 틱의 **외관**만 제어합니다. **레이블 정렬(ha, va)은 지원하지 않습니다!**
```python
ax.tick_params(axis='x',           # 'x', 'y', 'both'
               which='major',       # 'major', 'minor', 'both'
               direction='out',     # 'in', 'out', 'inout'
               length=6,            # 틱 길이
               width=1,             # 틱 두께
               color='black',       # 틱 색상
               labelsize=10,        # 레이블 폰트 크기
               labelcolor='black',  # 레이블 색상
               rotation=0,          # 레이블 회전 각도
               pad=3)               # 레이블과 틱 사이 간격
# ⚠️ ha, va, horizontalalignment, verticalalignment는 사용 불가!
```

### x축 레이블 회전 + 정렬 (올바른 방법)
```python
# ✅ 방법 1: plt.setp() 사용 (권장!)
plt.setp(ax.get_xticklabels(), rotation=45, ha='right')

# ✅ 방법 2: plt.xticks() 사용
plt.xticks(rotation=45, ha='right')

# ✅ 방법 3: 개별 설정
for label in ax.get_xticklabels():
    label.set_rotation(45)
    label.set_horizontalalignment('right')

# ✅ 방법 4: fig.autofmt_xdate() - 날짜 데이터에 최적
fig.autofmt_xdate(rotation=45, ha='right')
```

## Figure와 Axes 생성

### 기본 생성
```python
# 단일 플롯
fig, ax = plt.subplots()

# 여러 플롯 (2행 3열)
fig, axes = plt.subplots(2, 3, figsize=(12, 8))

# axes 접근
axes[0, 0]  # 첫 번째 행, 첫 번째 열
axes[1, 2]  # 두 번째 행, 세 번째 열

# 1차원 배열로 펼치기
axes = axes.flatten()  # axes[0], axes[1], ... 으로 접근
```

### 흔한 실수 - axes 차원
```python
# 1행만 있을 때
fig, axes = plt.subplots(1, 3)  # axes는 1차원 배열
axes[0]  # OK
axes[0, 0]  # Error!

# 해결책: squeeze=False
fig, axes = plt.subplots(1, 3, squeeze=False)
axes[0, 0]  # OK (항상 2차원)
```

## 레이아웃 조정

### 겹침 방지
```python
# 자동 레이아웃 조정 (권장)
plt.tight_layout()

# 또는 Figure 생성 시
fig, ax = plt.subplots(constrained_layout=True)

# 서브플롯 간격 수동 조정
plt.subplots_adjust(hspace=0.3, wspace=0.3)
```

## 한글 폰트 설정

### macOS
```python
plt.rcParams['font.family'] = 'Apple SD Gothic Neo'
plt.rcParams['axes.unicode_minus'] = False
```

### Windows
```python
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False
```

### 자동 감지 (권장)
```python
import matplotlib.font_manager as fm

korean_fonts = ['Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic']
available = set(f.name for f in fm.fontManager.ttflist)
for font in korean_fonts:
    if font in available:
        plt.rcParams['font.family'] = font
        break
plt.rcParams['axes.unicode_minus'] = False
```

## 색상과 스타일

### colormap 사용
```python
# 연속형 데이터
plt.scatter(x, y, c=values, cmap='viridis')

# 범주형 데이터
colors = plt.cm.Set1(range(n_categories))
```

### 스타일 설정
```python
plt.style.use('seaborn-v0_8-whitegrid')  # 최신 버전
# 또는
plt.style.use('ggplot')
```

## 저장

### 파일 저장
```python
# 기본 저장
plt.savefig('plot.png')

# 고해상도 저장
plt.savefig('plot.png', dpi=300, bbox_inches='tight')

# 투명 배경
plt.savefig('plot.png', transparent=True)
```

## 주의사항
- `tick_params()`는 `ha`, `va`, `horizontalalignment`, `verticalalignment` 미지원
- 레이블 정렬은 `plt.xticks()`, `plt.setp()`, 또는 개별 Text 객체로 설정
- `plt.show()`는 Figure를 닫으므로 저장은 show() 전에 수행
- 여러 Figure 작업 시 `plt.close('all')`로 메모리 정리
