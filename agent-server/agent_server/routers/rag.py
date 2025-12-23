"""
RAG Router - Endpoints for RAG search and status.

Provides:
- POST /rag/search - Explicit RAG search
- GET /rag/status - RAG system status
- POST /rag/reindex - Manual re-indexing trigger
"""

import logging

from fastapi import APIRouter, HTTPException
from hdsp_agent_core.models.agent import StepRAGRequest, StepRAGResponse
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


@router.post("/step-context", response_model=StepRAGResponse)
async def get_step_context(request: StepRAGRequest) -> StepRAGResponse:
    """
    Step-Level RAG 컨텍스트 조회.

    Step-Level RAG Architecture:
    - Planning 시 LLM이 각 step에 requiredCollections를 지정
    - Step 실행 전 이 endpoint로 해당 collections만 검색
    - 결과를 /agent/step-code로 전달하여 최종 코드 생성

    Args:
        query: Step description (검색 쿼리로 사용)
        collections: requiredCollections 목록 (e.g., ["dask", "matplotlib"])
        topK: 각 collection당 반환할 청크 수 (기본: 3)

    Returns:
        context: 포맷팅된 RAG 컨텍스트 문자열
        sources: 사용된 collection 목록
        chunkCount: 조회된 청크 수
    """
    rag_manager = get_rag_manager()

    if not rag_manager.is_ready:
        # RAG가 준비되지 않으면 빈 컨텍스트 반환 (fallback)
        logger.warning("RAG system not ready, returning empty context")
        return StepRAGResponse(context="", sources=[], chunkCount=0)

    try:
        # requiredCollections가 비어있으면 빈 컨텍스트 반환
        if not request.collections:
            logger.info("No collections specified, returning empty context")
            return StepRAGResponse(context="", sources=[], chunkCount=0)

        # Collection 기반 필터링 검색
        # metadata의 source 필드가 "{collection}.md" 형태로 저장되어 있음
        source_filters = [f"{c}.md" for c in request.collections]

        results = await rag_manager.search(
            query=request.query,
            top_k=request.topK * len(request.collections),  # collection당 topK개
            filters={"source": {"$in": source_filters}},
        )

        if not results:
            logger.info(f"No results found for collections: {request.collections}")
            return StepRAGResponse(
                context="", sources=request.collections, chunkCount=0
            )

        # 결과를 컨텍스트 문자열로 포맷팅
        context_parts = []
        sources_used = set()

        for r in results:
            source = r.get("metadata", {}).get("source", "unknown")
            content = r.get("content", "")
            score = r.get("score", 0)

            # Collection 이름 추출 (e.g., "dask.md" -> "dask")
            collection_name = source.replace(".md", "") if source.endswith(".md") else source
            sources_used.add(collection_name)

            # 컨텍스트에 추가
            context_parts.append(
                f"### {collection_name.upper()} API Guide (score: {score:.3f})\n{content}"
            )

        formatted_context = "\n\n---\n\n".join(context_parts)

        logger.info(
            f"Step context retrieved: {len(results)} chunks from {list(sources_used)}"
        )

        return StepRAGResponse(
            context=formatted_context,
            sources=list(sources_used),
            chunkCount=len(results),
        )

    except Exception as e:
        logger.error(f"Step context retrieval failed: {e}", exc_info=True)
        # 에러 시에도 빈 컨텍스트 반환 (코드 생성은 계속 진행)
        return StepRAGResponse(context="", sources=[], chunkCount=0)
