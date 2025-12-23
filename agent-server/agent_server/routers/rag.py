"""
RAG Router - Endpoints for RAG search and status.

Provides:
- POST /rag/search - Explicit RAG search
- GET /rag/status - RAG system status
- POST /rag/reindex - Manual re-indexing trigger
"""

import logging

from fastapi import APIRouter, HTTPException
from hdsp_agent_core.models.rag import (
    ChunkDebugInfo,
    DebugSearchRequest,
    DebugSearchResponse,
    IndexStatusResponse,
    LibraryDetectionDebug,
    ReindexRequest,
    ReindexResponse,
    SearchConfigDebug,
    SearchRequest,
    SearchResponse,
    SearchResult,
)

from agent_server.core.rag_manager import get_rag_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    """
    Perform explicit RAG search.

    Use this endpoint for direct knowledge base queries.
    For automatic RAG context in plan generation, use /agent/plan instead.
    """
    rag_manager = get_rag_manager()

    if not rag_manager.is_ready:
        raise HTTPException(
            status_code=503,
            detail="RAG system not ready. Check /rag/status for details.",
        )

    try:
        results = await rag_manager.search(
            query=request.query, top_k=request.top_k, filters=request.filters
        )

        search_results = [
            SearchResult(
                content=r["content"],
                score=r["score"] if request.include_score else 0.0,
                metadata=r["metadata"],
            )
            for r in results
        ]

        return SearchResponse(
            results=search_results,
            query=request.query,
            total_results=len(search_results),
        )

    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/status", response_model=IndexStatusResponse)
async def get_status() -> IndexStatusResponse:
    """
    Get RAG system status.

    Returns information about:
    - System readiness
    - Document/chunk counts
    - Last update time
    - Knowledge base path
    """
    rag_manager = get_rag_manager()
    return rag_manager.get_status()


@router.post("/reindex", response_model=ReindexResponse)
async def reindex(request: ReindexRequest) -> ReindexResponse:
    """
    Manually trigger re-indexing.

    Use this to:
    - Force full reindex after knowledge base changes
    - Index a specific file or directory
    """
    rag_manager = get_rag_manager()

    if not rag_manager.is_ready:
        raise HTTPException(
            status_code=503,
            detail="RAG system not ready. Check /rag/status for details.",
        )

    try:
        # For now, return a simple success response
        # Full reindex implementation would go here
        return ReindexResponse(success=True, indexed=0, skipped=0, errors=[])

    except Exception as e:
        logger.error(f"Reindex failed: {e}")
        raise HTTPException(status_code=500, detail=f"Reindex failed: {str(e)}")


@router.post("/debug", response_model=DebugSearchResponse)
async def debug_search(request: DebugSearchRequest) -> DebugSearchResponse:
    """
    RAG 검색 디버깅 - 전체 파이프라인 리니지 추적.

    사용 사례:
    - 특정 청크가 왜 검색되었는지 확인
    - 점수 계산이 최종 RAG 컨텍스트에 어떻게 영향을 미치는지 분석

    반환 정보:
    - 라이브러리 감지 결과
    - 청크별 벡터 유사도 점수
    - 최종 포맷된 컨텍스트
    """
    rag_manager = get_rag_manager()

    if not rag_manager.is_ready:
        raise HTTPException(
            status_code=503,
            detail="RAG system not ready. Check /rag/status for details.",
        )

    try:
        result = await rag_manager.debug_search(
            query=request.query,
            imported_libraries=request.imported_libraries,
            top_k=request.top_k,
            include_full_content=request.include_full_content,
            simulate_plan_context=request.simulate_plan_context,
        )

        # Convert dict to response model
        return DebugSearchResponse(
            library_detection=LibraryDetectionDebug(**result["library_detection"]),
            config=SearchConfigDebug(**result["config"]),
            chunks=[ChunkDebugInfo(**c) for c in result["chunks"]],
            total_candidates=result["total_candidates"],
            total_passed_threshold=result["total_passed_threshold"],
            search_ms=result["search_ms"],
            formatted_context=result["formatted_context"],
            context_char_count=result["context_char_count"],
            estimated_context_tokens=result["estimated_context_tokens"],
        )

    except Exception as e:
        logger.error(f"Debug search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Debug search failed: {str(e)}")
