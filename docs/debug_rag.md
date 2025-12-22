# RAG 디버깅/리니지 추적 가이드

## 개요

RAG 디버깅 기능은 벡터 검색 파이프라인의 전체 리니지를 추적하여, 어떤 문서의 어떤 부분이 검색되어 기여했는지 상세히 확인할 수 있습니다.

## 사용 방법

### 1. CLI 스크립트

터미널에서 직접 RAG 검색을 디버깅할 수 있습니다.

```bash
# 기본 사용
python -m scripts.debug_rag "pandas로 데이터프레임 만들어줘"

# 라이브러리 지정
python -m scripts.debug_rag "시각화 코드" --libs matplotlib seaborn

# 상세 출력
python -m scripts.debug_rag "test query" --top-k 10 --verbose

# JSON 출력
python -m scripts.debug_rag "test query" --json

# 전체 컨텐츠 포함
python -m scripts.debug_rag "test query" --full-content
```

#### CLI 옵션

| 옵션 | 설명 |
|------|------|
| `--libs`, `-l` | 시뮬레이션할 import된 라이브러리 목록 |
| `--top-k`, `-k` | 검색할 청크 수 (기본값: config에서 설정) |
| `--verbose`, `-v` | 상세 청크 정보 출력 |
| `--json`, `-j` | JSON 형식 출력 |
| `--full-content` | 청크 미리보기 대신 전체 컨텐츠 출력 |

#### CLI 출력 예시

```
================================================================================
 RAG DEBUG RESULTS
================================================================================

Query: pandas로 데이터프레임 만들어줘
Imported Libraries: (none)
Detected Libraries: ['pandas']

================================================================================
 SEARCH CONFIGURATION
================================================================================
  top_k: 5
  score_threshold: 0.3
  max_context_tokens: 1500

================================================================================
 TIMING
================================================================================
  Vector search: 12.34 ms

================================================================================
 RETRIEVED CHUNKS
================================================================================
Total candidates: 15
Passed threshold: 5

 Rank   Score    Pass   Source
----------------------------------------------------------------------
   1   0.9234    YES   pandas.md > DataFrame Creation
   2   0.8567    YES   pandas.md > Data Loading
   3   0.7234    YES   numpy.md > Array Operations
   ...

================================================================================
 FORMATTED CONTEXT
================================================================================
Character count: 2456
Estimated tokens: 614

## 라이브러리 API 참조 (RAG Retrieved)
...
```

---

### 2. HTTP API 엔드포인트

`POST /rag/debug` 엔드포인트를 통해 프로그래밍 방식으로 디버깅할 수 있습니다.

#### 요청 형식

```bash
curl -X POST http://localhost:8765/rag/debug \
  -H "Content-Type: application/json" \
  -d '{
    "query": "pandas dataframe 만들기",
    "imported_libraries": ["pandas"],
    "top_k": 10,
    "include_full_content": false,
    "simulate_plan_context": true
  }'
```

#### 요청 파라미터

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `query` | string | O | 검색 쿼리 |
| `imported_libraries` | string[] | X | import된 라이브러리 목록 |
| `top_k` | int | X | 검색할 청크 수 |
| `include_full_content` | bool | X | 전체 컨텐츠 포함 여부 (기본: false) |
| `simulate_plan_context` | bool | X | 플랜 컨텍스트 생성 여부 (기본: true) |

#### 응답 형식

```json
{
  "library_detection": {
    "input_query": "pandas dataframe 만들기",
    "imported_libraries": ["pandas"],
    "available_libraries": ["pandas", "numpy", "matplotlib"],
    "detected_libraries": ["pandas"],
    "detection_method": "deterministic"
  },
  "config": {
    "top_k": 5,
    "score_threshold": 0.3,
    "max_context_tokens": 1500
  },
  "chunks": [
    {
      "chunk_id": "abc123",
      "content_preview": "DataFrame 생성하기...",
      "score": 0.9234,
      "rank": 1,
      "metadata": {
        "source": "pandas.md",
        "section": "DataFrame Creation"
      },
      "passed_threshold": true
    }
  ],
  "total_candidates": 15,
  "total_passed_threshold": 5,
  "search_ms": 12.34,
  "formatted_context": "## 라이브러리 API 참조...",
  "context_char_count": 2456,
  "estimated_context_tokens": 614
}
```

---

## 응답 필드 설명

### library_detection

라이브러리 감지 단계의 디버그 정보입니다.

| 필드 | 설명 |
|------|------|
| `input_query` | 입력된 검색 쿼리 |
| `imported_libraries` | 요청에서 지정된 import 라이브러리 |
| `available_libraries` | Knowledge Base에서 사용 가능한 라이브러리 |
| `detected_libraries` | 쿼리에서 감지된 라이브러리 |
| `detection_method` | 감지 방법 (deterministic, llm_fallback 등) |

### chunks

각 청크별 상세 점수 정보입니다.

| 필드 | 설명 |
|------|------|
| `chunk_id` | 청크 고유 ID |
| `content_preview` | 컨텐츠 미리보기 (처음 200자) |
| `score` | 벡터 유사도 점수 (0-1) |
| `rank` | 순위 |
| `metadata` | 청크 메타데이터 (source, section 등) |
| `passed_threshold` | score_threshold 통과 여부 |

### 타이밍 정보

| 필드 | 설명 |
|------|------|
| `search_ms` | 벡터 검색 소요 시간 (밀리초) |

---

## 사용 사례

### 1. 특정 청크가 왜 검색되었는지 확인

```bash
python -m scripts.debug_rag "dask 병렬 처리" --verbose
```

각 청크의 벡터 유사도 점수를 확인하여 어떤 청크가 왜 상위에 랭크되었는지 분석할 수 있습니다.

### 2. Threshold 조정 필요성 판단

응답의 `passed_threshold` 필드를 확인하여:
- 너무 많은 청크가 통과하면 threshold를 높여야 함
- 관련 청크가 통과하지 못하면 threshold를 낮춰야 함

### 3. 컨텍스트 길이 최적화

`estimated_context_tokens`를 확인하여 LLM에 주입되는 컨텍스트 크기를 모니터링합니다.

---

## 설정 파일

RAG 설정은 `agent_server/schemas/rag.py`의 `RAGConfig`에서 관리됩니다.

```python
class RAGConfig(BaseModel):
    top_k: int = 5                    # 검색할 청크 수
    score_threshold: float = 0.3     # 최소 점수 임계값
    max_context_tokens: int = 1500   # 최대 컨텍스트 토큰
```

환경 변수로 오버라이드할 수 있습니다:
- `HDSP_RAG_ENABLED`: RAG 시스템 활성화 여부
- `HDSP_KNOWLEDGE_PATH`: Knowledge Base 경로

---

## 문제 해결

### RAG system not ready 오류

```bash
# RAG 상태 확인
curl http://localhost:8765/rag/status
```

RAG 시스템이 초기화되지 않은 경우 발생합니다. 서버 로그를 확인하세요.

### 검색 결과가 없는 경우

1. `score_threshold`가 너무 높은지 확인
2. Knowledge Base에 관련 문서가 있는지 확인
3. 임베딩 모델이 올바르게 로드되었는지 확인
