"""
Retriever - Dense vector search implementation.

Provides semantic similarity search via Qdrant vector database.
"""

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, NamedTuple, Optional

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import RAGConfig

    from agent_server.core.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


@dataclass
class ChunkScoreDetails:
    """청크별 점수 상세 정보"""

    chunk_id: str
    content: str
    score: float  # Vector similarity score (0-1)
    rank: int
    metadata: Dict[str, Any]
    passed_threshold: bool


class DebugSearchResult(NamedTuple):
    """디버그 검색 결과"""

    chunks: List[ChunkScoreDetails]
    search_ms: float
    total_candidates: int


class Retriever:
    """
    Dense vector retrieval using Qdrant.

    Features:
    - Dense vector search via Qdrant
    - Metadata filtering
    - Score thresholding

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

    async def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        score_threshold: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Perform dense vector search.

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
            results = self._client.search(
                collection_name=self._config.qdrant.collection_name,
                query_vector=query_embedding,
                query_filter=qdrant_filter,
                limit=effective_top_k,
                score_threshold=effective_threshold
                * 0.5,  # Lower for initial retrieval
            )
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

        if not results:
            logger.debug(f"No results for query: {query[:50]}...")
            return []

        return self._format_results(results, effective_threshold)

    def _build_filter(self, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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

        try:
            asyncio.get_running_loop()
            logger.warning(
                "search_sync called from async context, use search() instead"
            )
        except RuntimeError:
            pass

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

        # Vector search with timing
        try:
            # 디버그용으로 더 많은 결과 (3배)를 낮은 threshold로 가져옴
            results = self._client.search(
                collection_name=self._config.qdrant.collection_name,
                query_vector=query_embedding,
                query_filter=qdrant_filter,
                limit=effective_top_k * 3,
                score_threshold=effective_threshold * 0.3,
            )
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return DebugSearchResult(
                chunks=[],
                search_ms=0.0,
                total_candidates=0,
            )

        search_ms = (time.perf_counter() - start_time) * 1000

        if not results:
            return DebugSearchResult(
                chunks=[],
                search_ms=round(search_ms, 2),
                total_candidates=0,
            )

        # Build detailed results
        chunks = []
        for rank, result in enumerate(results, start=1):
            chunks.append(
                ChunkScoreDetails(
                    chunk_id=str(result.id),
                    content=result.payload.get("content", ""),
                    score=round(result.score, 4),
                    rank=rank,
                    metadata={
                        k: v for k, v in result.payload.items() if k != "content"
                    },
                    passed_threshold=result.score >= effective_threshold,
                )
            )

        return DebugSearchResult(
            chunks=chunks,
            search_ms=round(search_ms, 2),
            total_candidates=len(results),
        )
