"""
Retriever - Hybrid search implementation with dense vectors and BM25.

Provides intelligent retrieval combining:
- Dense vector search via Qdrant (semantic similarity)
- BM25 keyword matching (exact term matching)
- Reciprocal Rank Fusion for result combination
- Metadata filtering for precise retrieval
"""

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, NamedTuple, Optional

if TYPE_CHECKING:
    from agent_server.core.embedding_service import EmbeddingService
    from agent_server.schemas.rag import RAGConfig

logger = logging.getLogger(__name__)


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
    """
    Hybrid retrieval combining dense vectors with BM25 keyword matching.

    Features:
    - Dense vector search via Qdrant
    - BM25 keyword matching for precision (optional)
    - Configurable fusion weights (alpha parameter)
    - Metadata filtering
    - Score normalization

    Usage:
        retriever = Retriever(client, embedding_service, config)
        results = await retriever.search("query", top_k=5)
    """

    def __init__(
        self,
        client,  # Qdrant client
        embedding_service: "EmbeddingService",
        config: "RAGConfig",
    ):
        self._client = client
        self._embedding_service = embedding_service
        self._config = config
        self._bm25_available = False

        # Initialize BM25 if hybrid search is enabled
        if config.use_hybrid_search:
            self._init_bm25()

    def _init_bm25(self) -> None:
        """Initialize BM25 capability check"""
        try:
            from rank_bm25 import BM25Okapi

            self._bm25_class = BM25Okapi
            self._bm25_available = True
            logger.info("BM25 hybrid search enabled")
        except ImportError:
            logger.warning(
                "rank_bm25 not installed, hybrid search disabled. "
                "Install with: pip install rank-bm25"
            )
            self._bm25_available = False

    async def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        score_threshold: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Perform hybrid search (dense + BM25).

        Args:
            query: Search query
            top_k: Number of results (default from config)
            filters: Metadata filters
            score_threshold: Minimum score (default from config)

        Returns:
            List of results with content, score, metadata
        """
        effective_top_k = top_k or self._config.top_k
        effective_threshold = score_threshold or self._config.score_threshold

        # Generate query embedding
        query_embedding = self._embedding_service.embed_query(query)

        # Build filter condition
        qdrant_filter = self._build_filter(filters) if filters else None

        # Dense vector search
        try:
            dense_results = self._client.search(
                collection_name=self._config.qdrant.collection_name,
                query_vector=query_embedding,
                query_filter=qdrant_filter,
                limit=effective_top_k * 2
                if self._should_use_hybrid()
                else effective_top_k,
                score_threshold=effective_threshold
                * 0.5,  # Lower threshold for initial retrieval
            )
        except Exception as e:
            logger.error(f"Dense search failed: {e}")
            return []

        if not dense_results:
            logger.debug(f"No results for query: {query[:50]}...")
            return []

        # Hybrid search if enabled and available
        if self._should_use_hybrid():
            return self._hybrid_search(
                query=query,
                dense_results=dense_results,
                top_k=effective_top_k,
                score_threshold=effective_threshold,
            )

        # Dense-only results
        return self._format_results(
            dense_results[:effective_top_k], effective_threshold
        )

    def _should_use_hybrid(self) -> bool:
        """Check if hybrid search should be used"""
        return self._config.use_hybrid_search and self._bm25_available

    def _hybrid_search(
        self, query: str, dense_results: List, top_k: int, score_threshold: float
    ) -> List[Dict[str, Any]]:
        """
        Combine dense and BM25 results using Reciprocal Rank Fusion.

        RRF formula: score = sum(1 / (k + rank)) for each ranking
        """
        if not dense_results:
            return []

        # Extract documents for BM25
        documents = []
        doc_ids = []
        for r in dense_results:
            content = r.payload.get("content", "")
            if content:
                documents.append(content)
                doc_ids.append(r.id)

        if not documents:
            return self._format_results(dense_results[:top_k], score_threshold)

        # Tokenize for BM25
        tokenized_docs = [self._tokenize(doc) for doc in documents]
        tokenized_query = self._tokenize(query)

        # BM25 scoring
        bm25 = self._bm25_class(tokenized_docs)
        bm25_scores = bm25.get_scores(tokenized_query)

        # Normalize BM25 scores
        max_bm25 = (
            max(bm25_scores) if bm25_scores.any() and max(bm25_scores) > 0 else 1.0
        )
        normalized_bm25 = bm25_scores / max_bm25

        # Combine scores with alpha weighting
        alpha = self._config.hybrid_alpha
        fused_scores = {}

        for i, result in enumerate(dense_results):
            doc_id = result.id
            dense_score = result.score  # Already 0-1 for cosine
            keyword_score = normalized_bm25[i] if i < len(normalized_bm25) else 0

            # Weighted combination
            fused_scores[doc_id] = alpha * dense_score + (1 - alpha) * keyword_score

        # Sort by fused score
        sorted_ids = sorted(
            fused_scores.keys(), key=lambda x: fused_scores[x], reverse=True
        )

        # Build results
        id_to_result = {r.id: r for r in dense_results}
        results = []

        for doc_id in sorted_ids[:top_k]:
            score = fused_scores[doc_id]
            if score < score_threshold:
                continue

            result = id_to_result[doc_id]
            results.append(
                {
                    "content": result.payload.get("content", ""),
                    "score": round(score, 4),
                    "metadata": {
                        k: v for k, v in result.payload.items() if k != "content"
                    },
                }
            )

        return results

    def _tokenize(self, text: str) -> List[str]:
        """
        Simple tokenization for BM25.

        Handles both English and Korean text.
        """
        import re

        # Convert to lowercase
        text = text.lower()

        # Split on whitespace and punctuation
        # Keep Korean characters together
        tokens = re.findall(r"[\w가-힣]+", text)

        # Filter very short tokens
        tokens = [t for t in tokens if len(t) > 1]

        return tokens

    def _build_filter(self, filters: Dict[str, Any]) -> Dict[str, Any]:
        """Convert filter dict to Qdrant filter format"""
        if not filters:
            return None

        conditions = []
        for key, value in filters.items():
            if isinstance(value, list):
                # Multiple values - any match
                conditions.append(
                    {"should": [{"key": key, "match": {"value": v}} for v in value]}
                )
            else:
                conditions.append({"key": key, "match": {"value": value}})

        return {"must": conditions} if conditions else None

    def _format_results(
        self, results: List, score_threshold: float
    ) -> List[Dict[str, Any]]:
        """Format Qdrant results to standard format"""
        formatted = []
        for r in results:
            if r.score < score_threshold:
                continue

            formatted.append(
                {
                    "content": r.payload.get("content", ""),
                    "score": round(r.score, 4),
                    "metadata": {k: v for k, v in r.payload.items() if k != "content"},
                }
            )
        return formatted

    def search_sync(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Synchronous search wrapper for non-async contexts.

        Note: Qdrant client operations are synchronous,
        so this is just a convenience method.
        """
        import asyncio

        # If we're in an async context, run in executor
        try:
            loop = asyncio.get_running_loop()
            # We're in async context - shouldn't use this method
            logger.warning(
                "search_sync called from async context, use search() instead"
            )
        except RuntimeError:
            # Not in async context - safe to run
            pass

        # Run the coroutine
        return asyncio.run(self.search(query, top_k, filters))

    async def search_with_debug(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        score_threshold: Optional[float] = None,
    ) -> DebugSearchResult:
        """
        전체 점수 정보를 포함한 디버그 검색 수행.

        1. Dense search (with timing)
        2. BM25 scoring (if hybrid enabled)
        3. Score fusion (alpha * dense + (1-alpha) * bm25)
        4. Rankings for all scoring methods
        5. Return detailed ChunkScoreDetails

        Args:
            query: Search query
            top_k: Number of results (default from config)
            filters: Metadata filters
            score_threshold: Minimum score (default from config)

        Returns:
            DebugSearchResult with detailed scoring information
        """
        start_time = time.perf_counter()

        effective_top_k = top_k or self._config.top_k
        effective_threshold = score_threshold or self._config.score_threshold

        # Generate query embedding
        query_embedding = self._embedding_service.embed_query(query)

        # Build filter condition
        qdrant_filter = self._build_filter(filters) if filters else None

        # Dense search with timing
        dense_start = time.perf_counter()
        try:
            # 디버그용으로 더 많은 결과 (3배)를 낮은 threshold로 가져옴
            dense_results = self._client.search(
                collection_name=self._config.qdrant.collection_name,
                query_vector=query_embedding,
                query_filter=qdrant_filter,
                limit=effective_top_k * 3,
                score_threshold=effective_threshold * 0.3,
            )
        except Exception as e:
            logger.error(f"Dense search failed: {e}")
            return DebugSearchResult(
                chunks=[],
                dense_search_ms=0.0,
                bm25_search_ms=None,
                total_search_ms=0.0,
                total_candidates=0,
            )
        dense_ms = (time.perf_counter() - dense_start) * 1000

        if not dense_results:
            return DebugSearchResult(
                chunks=[],
                dense_search_ms=round(dense_ms, 2),
                bm25_search_ms=None,
                total_search_ms=round((time.perf_counter() - start_time) * 1000, 2),
                total_candidates=0,
            )

        # Dense rankings 생성
        dense_rankings = {r.id: (i + 1, r.score) for i, r in enumerate(dense_results)}
        id_to_result = {r.id: r for r in dense_results}

        # BM25 scoring (if hybrid enabled)
        bm25_ms = None
        normalized_bm25: Dict[Any, float] = {}
        raw_bm25: Dict[Any, float] = {}
        bm25_rankings: Dict[Any, int] = {}

        if self._should_use_hybrid():
            bm25_start = time.perf_counter()

            # Extract documents for BM25
            documents = []
            doc_ids = []
            for r in dense_results:
                content = r.payload.get("content", "")
                if content:
                    documents.append(content)
                    doc_ids.append(r.id)

            if documents:
                # Tokenize for BM25
                tokenized_docs = [self._tokenize(doc) for doc in documents]
                tokenized_query = self._tokenize(query)

                # BM25 scoring
                bm25 = self._bm25_class(tokenized_docs)
                bm25_scores = bm25.get_scores(tokenized_query)

                # Store raw BM25 scores
                for i, doc_id in enumerate(doc_ids):
                    raw_bm25[doc_id] = float(bm25_scores[i])

                # Normalize BM25 scores
                max_bm25 = (
                    max(bm25_scores)
                    if bm25_scores.any() and max(bm25_scores) > 0
                    else 1.0
                )
                for i, doc_id in enumerate(doc_ids):
                    normalized_bm25[doc_id] = float(bm25_scores[i] / max_bm25)

                # BM25 rankings
                sorted_by_bm25 = sorted(
                    doc_ids, key=lambda x: raw_bm25.get(x, 0), reverse=True
                )
                bm25_rankings = {
                    doc_id: (rank + 1) for rank, doc_id in enumerate(sorted_by_bm25)
                }

            bm25_ms = (time.perf_counter() - bm25_start) * 1000

        # Fused scores 계산
        alpha = self._config.hybrid_alpha
        fused_scores: Dict[Any, float] = {}

        for r in dense_results:
            dense_score = r.score
            bm25_norm = normalized_bm25.get(r.id, 0.0)
            if self._should_use_hybrid():
                fused_scores[r.id] = alpha * dense_score + (1 - alpha) * bm25_norm
            else:
                fused_scores[r.id] = dense_score

        # Final rankings (by fused score)
        sorted_ids = sorted(
            fused_scores.keys(), key=lambda x: fused_scores[x], reverse=True
        )
        final_rankings = {doc_id: (rank + 1) for rank, doc_id in enumerate(sorted_ids)}

        # Build detailed results
        chunks = []
        for doc_id in sorted_ids:
            result = id_to_result[doc_id]
            chunks.append(
                ChunkScoreDetails(
                    chunk_id=str(doc_id),
                    content=result.payload.get("content", ""),
                    dense_score=round(dense_rankings[doc_id][1], 4),
                    bm25_score=round(normalized_bm25.get(doc_id, 0.0), 4)
                    if self._should_use_hybrid()
                    else None,
                    bm25_raw_score=round(raw_bm25.get(doc_id, 0.0), 4)
                    if self._should_use_hybrid()
                    else None,
                    fused_score=round(fused_scores[doc_id], 4),
                    rank_dense=dense_rankings[doc_id][0],
                    rank_bm25=bm25_rankings.get(doc_id)
                    if self._should_use_hybrid()
                    else None,
                    rank_final=final_rankings[doc_id],
                    metadata={
                        k: v for k, v in result.payload.items() if k != "content"
                    },
                    passed_threshold=fused_scores[doc_id] >= effective_threshold,
                )
            )

        total_ms = (time.perf_counter() - start_time) * 1000

        return DebugSearchResult(
            chunks=chunks,
            dense_search_ms=round(dense_ms, 2),
            bm25_search_ms=round(bm25_ms, 2) if bm25_ms is not None else None,
            total_search_ms=round(total_ms, 2),
            total_candidates=len(dense_results),
        )


class SimpleRetriever:
    """
    Simplified retriever for basic dense-only search.

    Use this when BM25 hybrid search is not needed.
    """

    def __init__(
        self,
        client,
        embedding_service: "EmbeddingService",
        collection_name: str,
        top_k: int = 5,
        score_threshold: float = 0.3,
    ):
        self._client = client
        self._embedding_service = embedding_service
        self._collection_name = collection_name
        self._top_k = top_k
        self._score_threshold = score_threshold

    def search(self, query: str, top_k: Optional[int] = None) -> List[Dict[str, Any]]:
        """Simple dense vector search"""
        query_embedding = self._embedding_service.embed_query(query)

        results = self._client.search(
            collection_name=self._collection_name,
            query_vector=query_embedding,
            limit=top_k or self._top_k,
            score_threshold=self._score_threshold,
        )

        return [
            {
                "content": r.payload.get("content", ""),
                "score": round(r.score, 4),
                "metadata": {k: v for k, v in r.payload.items() if k != "content"},
            }
            for r in results
        ]
