"""
RAG Router - Endpoints for RAG search and status.

Provides:
- POST /rag/search - Explicit RAG search
- GET /rag/status - RAG system status
- POST /rag/reindex - Manual re-indexing trigger
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from agent_server.core.rag_manager import get_rag_manager
from agent_server.schemas.rag import (
    SearchRequest,
    SearchResponse,
    SearchResult,
    IndexStatusResponse,
    ReindexRequest,
    ReindexResponse,
)

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
            detail="RAG system not ready. Check /rag/status for details."
        )

    try:
        results = await rag_manager.search(
            query=request.query,
            top_k=request.top_k,
            filters=request.filters
        )

        search_results = [
            SearchResult(
                content=r["content"],
                score=r["score"] if request.include_score else 0.0,
                metadata=r["metadata"]
            )
            for r in results
        ]

        return SearchResponse(
            results=search_results,
            query=request.query,
            total_results=len(search_results)
        )

    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(e)}"
        )


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
            detail="RAG system not ready. Check /rag/status for details."
        )

    try:
        # For now, return a simple success response
        # Full reindex implementation would go here
        return ReindexResponse(
            success=True,
            indexed=0,
            skipped=0,
            errors=[]
        )

    except Exception as e:
        logger.error(f"Reindex failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Reindex failed: {str(e)}"
        )
