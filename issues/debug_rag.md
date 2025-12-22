# RAG 디버깅/리니지 추적 기능 구현 계획

## 배경
Qdrant 기반 Knowledge Base RAG가 탑재되었으나, 플래닝 과정에서 어떤 문서의 어떤 부분이 발췌되어 기여했는지 추적하기 어려움.

## 목표
RAG 검색 파이프라인의 전체 리니지 추적이 가능한 디버깅 도구 구현

## 구현 범위
1. **CLI 스크립트**: 터미널에서 프롬프트 입력 → 상세 검색 결과 출력
2. **API 엔드포인트**: `POST /rag/debug` HTTP 엔드포인트
3. **전체 파이프라인 가시성**: 라이브러리 감지 → 검색 → 점수 계산 → 컨텍스트 포맷팅
4. **유닛테스트**: Mock 기반 테스트 (토큰 소비 0)

---

## Phase 1: 데이터 구조 추가

### 파일: `agent-server/agent_server/schemas/rag.py`

새로운 Pydantic 모델 추가:

```python
class ChunkDebugInfo(BaseModel):
    """청크별 상세 점수 정보"""
    chunk_id: str
    content_preview: str  # 처음 200자
    dense_score: float    # Dense vector 유사도 (0-1)
    bm25_score: Optional[float]      # BM25 정규화 점수
    bm25_raw_score: Optional[float]  # BM25 원본 점수
    fused_score: float    # 최종 융합 점수
    rank_dense: int       # Dense 순위
    rank_bm25: Optional[int]  # BM25 순위
    rank_final: int       # 최종 순위
    metadata: Dict[str, Any]  # source, section 등
    passed_threshold: bool    # threshold 통과 여부

class LibraryDetectionDebug(BaseModel):
    """라이브러리 감지 단계 디버그 정보"""
    input_query: str
    imported_libraries: List[str]
    available_libraries: List[str]
    detected_libraries: List[str]
    detection_method: str

class SearchConfigDebug(BaseModel):
    """검색 설정 정보"""
    top_k: int
    score_threshold: float
    use_hybrid_search: bool
    hybrid_alpha: float
    max_context_tokens: int

class DebugSearchRequest(BaseModel):
    """디버그 검색 요청"""
    query: str
    imported_libraries: List[str] = []
    top_k: Optional[int] = None
    include_full_content: bool = False
    simulate_plan_context: bool = True

class DebugSearchResponse(BaseModel):
    """디버그 검색 응답"""
    library_detection: LibraryDetectionDebug
    config: SearchConfigDebug
    chunks: List[ChunkDebugInfo]
    total_candidates: int
    total_passed_threshold: int
    dense_search_ms: float
    bm25_search_ms: Optional[float]
    total_search_ms: float
    formatted_context: str
    context_char_count: int
    estimated_context_tokens: int
```

---

## Phase 2: Retriever 확장

### 파일: `agent-server/agent_server/core/retriever.py`

`search_with_debug()` 메서드 추가:

```python
from dataclasses import dataclass
from typing import NamedTuple
import time

@dataclass
class ChunkScoreDetails:
    """내부 데이터 구조: 청크별 점수 상세"""
    chunk_id: str
    content: str
    dense_score: float
    bm25_score: Optional[float]
    bm25_raw_score: Optional[float]
    fused_score: float
    rank_dense: int
    rank_bm25: Optional[int]
    rank_final: int
    metadata: Dict[str, Any]
    passed_threshold: bool

class DebugSearchResult(NamedTuple):
    """디버그 검색 결과"""
    chunks: List[ChunkScoreDetails]
    dense_search_ms: float
    bm25_search_ms: Optional[float]
    total_search_ms: float
    total_candidates: int

class Retriever:
    # ... 기존 메서드 ...

    async def search_with_debug(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        score_threshold: Optional[float] = None
    ) -> DebugSearchResult:
        """
        전체 점수 정보를 포함한 디버그 검색 수행

        1. Dense search (with timing)
        2. BM25 scoring (if hybrid enabled)
        3. Score fusion (alpha * dense + (1-alpha) * bm25)
        4. Rankings for all scoring methods
        5. Return detailed ChunkScoreDetails
        """
        start_time = time.perf_counter()

        # Query embedding
        query_embedding = self._embedding_service.embed_query(query)

        # Dense search with timing
        dense_start = time.perf_counter()
        dense_results = self._client.search(
            collection_name=self._config.qdrant.collection_name,
            query_vector=query_embedding,
            limit=top_k * 3,  # 디버그용으로 더 많이 가져옴
            score_threshold=threshold * 0.3  # 낮은 threshold로 더 많은 결과
        )
        dense_ms = (time.perf_counter() - dense_start) * 1000

        # Dense rankings 생성
        dense_rankings = {r.id: (i + 1, r.score) for i, r in enumerate(dense_results)}

        # BM25 scoring (if hybrid)
        bm25_ms = None
        normalized_bm25 = {}
        raw_bm25 = {}
        bm25_rankings = {}

        if self._should_use_hybrid():
            bm25_start = time.perf_counter()
            # ... BM25 계산 로직 ...
            bm25_ms = (time.perf_counter() - bm25_start) * 1000

        # Fused scores 계산
        alpha = self._config.hybrid_alpha
        fused_scores = {}
        for r in dense_results:
            dense_score = r.score
            bm25_norm = normalized_bm25.get(r.id, 0.0)
            fused_scores[r.id] = alpha * dense_score + (1 - alpha) * bm25_norm

        # Final rankings
        sorted_ids = sorted(fused_scores.keys(), key=lambda x: fused_scores[x], reverse=True)
        final_rankings = {doc_id: (rank + 1) for rank, doc_id in enumerate(sorted_ids)}

        # Build detailed results
        chunks = []
        for doc_id in sorted_ids:
            result = id_to_result[doc_id]
            chunks.append(ChunkScoreDetails(
                chunk_id=str(doc_id),
                content=result.payload.get("content", ""),
                dense_score=round(dense_rankings[doc_id][1], 4),
                bm25_score=round(normalized_bm25.get(doc_id, 0.0), 4),
                bm25_raw_score=round(raw_bm25.get(doc_id, 0.0), 4),
                fused_score=round(fused_scores[doc_id], 4),
                rank_dense=dense_rankings[doc_id][0],
                rank_bm25=bm25_rankings.get(doc_id),
                rank_final=final_rankings[doc_id],
                metadata={k: v for k, v in result.payload.items() if k != "content"},
                passed_threshold=fused_scores[doc_id] >= threshold
            ))

        return DebugSearchResult(
            chunks=chunks,
            dense_search_ms=round(dense_ms, 2),
            bm25_search_ms=round(bm25_ms, 2) if bm25_ms else None,
            total_search_ms=round((time.perf_counter() - start_time) * 1000, 2),
            total_candidates=len(dense_results)
        )
```

---

## Phase 3: RAGManager 확장

### 파일: `agent-server/agent_server/core/rag_manager.py`

`debug_search()` 메서드 추가:

```python
async def debug_search(
    self,
    query: str,
    imported_libraries: List[str] = None,
    top_k: Optional[int] = None,
    include_full_content: bool = False,
    simulate_plan_context: bool = True
) -> Dict[str, Any]:
    """
    전체 파이프라인 리니지를 포함한 디버그 검색

    반환 정보:
    - 라이브러리 감지 결과
    - 청크별 점수 (dense, BM25, fused)
    - 최종 포맷된 컨텍스트
    """
    if not self._ready:
        return {"error": "RAG system not ready"}

    # 1. 라이브러리 감지 (agent.py와 동일 로직)
    from agent_server.knowledge.loader import get_knowledge_base, get_library_detector

    knowledge_base = get_knowledge_base()
    library_detector = get_library_detector()
    available = knowledge_base.list_available_libraries()
    detected_libraries = library_detector.detect(
        request=query,
        available_libraries=available,
        imported_libraries=imported_libraries or []
    )

    library_detection_info = {
        "input_query": query,
        "imported_libraries": imported_libraries or [],
        "available_libraries": available or [],
        "detected_libraries": detected_libraries,
        "detection_method": "deterministic"
    }

    # 2. 디버그 검색 수행
    debug_result = await self._retriever.search_with_debug(
        query=query,
        top_k=top_k or self._config.top_k
    )

    # 3. 청크 디버그 정보 구성
    chunks_info = []
    for chunk in debug_result.chunks:
        chunks_info.append({
            "chunk_id": chunk.chunk_id,
            "content_preview": chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content,
            "dense_score": chunk.dense_score,
            "bm25_score": chunk.bm25_score,
            "bm25_raw_score": chunk.bm25_raw_score,
            "fused_score": chunk.fused_score,
            "rank_dense": chunk.rank_dense,
            "rank_bm25": chunk.rank_bm25,
            "rank_final": chunk.rank_final,
            "metadata": chunk.metadata,
            "passed_threshold": chunk.passed_threshold
        })

    # 4. 포맷된 컨텍스트 생성 (get_context_for_query와 동일)
    formatted_context = ""
    if simulate_plan_context:
        passed_chunks = [c for c in debug_result.chunks if c.passed_threshold]
        # ... 컨텍스트 포맷팅 ...

    return {
        "library_detection": library_detection_info,
        "config": {...},
        "chunks": chunks_info,
        "total_candidates": debug_result.total_candidates,
        "total_passed_threshold": sum(1 for c in debug_result.chunks if c.passed_threshold),
        "dense_search_ms": debug_result.dense_search_ms,
        "bm25_search_ms": debug_result.bm25_search_ms,
        "total_search_ms": debug_result.total_search_ms,
        "formatted_context": formatted_context,
        "context_char_count": len(formatted_context),
        "estimated_context_tokens": len(formatted_context) // 4
    }
```

---

## Phase 4: API 엔드포인트

### 파일: `agent-server/agent_server/routers/rag.py`

```python
@router.post("/debug", response_model=DebugSearchResponse)
async def debug_search(request: DebugSearchRequest) -> DebugSearchResponse:
    """
    RAG 검색 디버깅 - 전체 파이프라인 리니지 추적

    사용 사례:
    - 특정 청크가 왜 검색되었는지 확인
    - 점수 계산이 최종 RAG 컨텍스트에 어떻게 영향을 미치는지 분석

    반환 정보:
    - 라이브러리 감지 결과
    - 청크별 Dense/BM25/Fused 점수
    - 최종 포맷된 컨텍스트
    """
    rag_manager = get_rag_manager()

    if not rag_manager.is_ready:
        raise HTTPException(status_code=503, detail="RAG system not ready")

    result = await rag_manager.debug_search(
        query=request.query,
        imported_libraries=request.imported_libraries,
        top_k=request.top_k,
        include_full_content=request.include_full_content,
        simulate_plan_context=request.simulate_plan_context
    )

    return DebugSearchResponse(**result)
```

---

## Phase 5: CLI 스크립트

### 파일: `agent-server/scripts/debug_rag.py` (신규 생성)

```bash
# 사용 예시
python -m scripts.debug_rag "pandas로 데이터프레임 만들어줘"
python -m scripts.debug_rag "시각화 코드" --libs matplotlib seaborn
python -m scripts.debug_rag "test query" --top-k 10 --verbose
python -m scripts.debug_rag "test query" --json  # JSON 출력
```

출력 포맷:
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
  use_hybrid_search: True
  hybrid_alpha: 0.5

================================================================================
 TIMING
================================================================================
  Dense search: 12.34 ms
  BM25 search: 3.21 ms
  Total: 18.76 ms

================================================================================
 RETRIEVED CHUNKS
================================================================================
Total candidates: 15
Passed threshold: 5

 Rank   Dense    BM25    Fused   Pass   Source
--------------------------------------------------------------------------------
  1    0.9234  0.8123  0.8679   YES   pandas.md > DataFrame Creation
  2    0.8567  0.7890  0.8229   YES   pandas.md > Data Loading
  3    0.7234  0.6543  0.6889   YES   numpy.md > Array Operations
  ...

================================================================================
 FORMATTED CONTEXT
================================================================================
Character count: 2456
Estimated tokens: 614

## 📚 라이브러리 API 참조 (RAG Retrieved)

아래 가이드의 API 사용법을 **반드시** 따르세요.

[Source: pandas.md > DataFrame Creation (relevance: 0.87)]
...
```

---

## Phase 6: 유닛테스트

### 파일: `agent-server/tests/test_rag_components.py`

추가할 테스트 클래스:

```python
class TestRAGDebug:
    """Retriever.search_with_debug() 테스트"""

    def test_search_with_debug_returns_all_scores(self):
        """search_with_debug는 dense, bm25, fused 점수를 모두 반환해야 함"""

    def test_search_with_debug_dense_scores_descending(self):
        """fused 점수는 내림차순으로 정렬되어야 함"""

    def test_search_with_debug_threshold_filtering(self):
        """passed_threshold가 올바르게 설정되어야 함"""

    def test_debug_search_timing_present(self):
        """타이밍 정보가 포함되어야 함"""


class TestRAGManagerDebug:
    """RAGManager.debug_search() 테스트"""

    def test_debug_search_returns_library_detection(self):
        """debug_search는 라이브러리 감지 정보를 반환해야 함"""

    def test_debug_search_not_ready_returns_error(self):
        """RAG가 준비되지 않았을 때 에러 반환"""


class TestDebugSchemas:
    """디버그 스키마 검증 테스트"""

    def test_debug_search_request_validation(self):
        """DebugSearchRequest 검증"""

    def test_debug_search_request_defaults(self):
        """기본값 확인"""

    def test_chunk_debug_info_validation(self):
        """ChunkDebugInfo 검증"""
```

---

## 수정 파일 목록

| 파일 | 작업 |
|------|------|
| `agent-server/agent_server/schemas/rag.py` | 디버그 스키마 추가 |
| `agent-server/agent_server/core/retriever.py` | `search_with_debug()` 메서드 추가 |
| `agent-server/agent_server/core/rag_manager.py` | `debug_search()` 메서드 추가 |
| `agent-server/agent_server/routers/rag.py` | `POST /rag/debug` 엔드포인트 추가 |
| `agent-server/scripts/debug_rag.py` | CLI 스크립트 신규 생성 |
| `agent-server/tests/test_rag_components.py` | 디버그 테스트 추가 |

---

## 구현 순서

1. **schemas/rag.py** - 데이터 구조 먼저 정의
2. **core/retriever.py** - 핵심 디버그 검색 로직
3. **core/rag_manager.py** - 오케스트레이션 레이어
4. **routers/rag.py** - API 노출
5. **scripts/debug_rag.py** - CLI 도구
6. **tests/test_rag_components.py** - 테스트 추가
7. 전체 테스트 실행 및 검증

---

## 예상 결과

### CLI 사용 예시
```bash
$ python -m scripts.debug_rag "dask로 대용량 데이터 처리하는 코드 작성해줘" --verbose

Query: dask로 대용량 데이터 처리하는 코드 작성해줘
Detected Libraries: ['dask']

 Rank   Dense    BM25    Fused   Pass   Source
--------------------------------------------------------------------------------
  1    0.9456  0.8912  0.9184   YES   dask.md > DataFrame Operations
  2    0.8823  0.7654  0.8239   YES   dask.md > Parallel Computing
  3    0.7234  0.6123  0.6679   YES   pandas.md > Large Data Handling
```

### API 사용 예시
```bash
$ curl -X POST http://localhost:8765/rag/debug \
  -H "Content-Type: application/json" \
  -d '{"query": "pandas dataframe", "imported_libraries": ["pandas"]}'
```
