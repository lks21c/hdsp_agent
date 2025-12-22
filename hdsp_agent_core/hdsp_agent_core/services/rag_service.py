"""
RAG Service Implementations

Embedded and Proxy implementations of IRAGService.
"""

import logging
from typing import Any, Dict, List, Optional

import httpx

from hdsp_agent_core.interfaces import IRAGService
from hdsp_agent_core.models.rag import SearchRequest, SearchResponse

logger = logging.getLogger(__name__)


class EmbeddedRAGService(IRAGService):
    """
    Embedded implementation of RAG Service.

    Uses RAGManager directly in-process without HTTP calls.
    Used in development mode (HDSP_AGENT_MODE=embedded).
    """

    def __init__(self):
        """Initialize embedded RAG service"""
        self._rag_manager = None
        self._initialized = False
        logger.info("EmbeddedRAGService created (not yet initialized)")

    async def initialize(self) -> None:
        """Initialize RAG manager"""
        if self._initialized:
            return

        try:
            from hdsp_agent_core.managers.rag_manager import get_rag_manager
            self._rag_manager = get_rag_manager()
            self._initialized = True
            logger.info("EmbeddedRAGService initialized with RAGManager")
        except ImportError as e:
            logger.warning(f"RAGManager not available: {e}")
            self._initialized = False
        except Exception as e:
            logger.error(f"Failed to initialize RAGManager: {e}")
            self._initialized = False

    async def shutdown(self) -> None:
        """Shutdown RAG service"""
        self._rag_manager = None
        self._initialized = False
        logger.info("EmbeddedRAGService shutdown")

    def is_ready(self) -> bool:
        """Check if RAG service is ready"""
        if not self._initialized or not self._rag_manager:
            return False
        return self._rag_manager.is_ready

    async def search(self, request: SearchRequest) -> SearchResponse:
        """Search the knowledge base"""
        logger.info(f"[Embedded] RAG search: {request.query[:100]}...")

        if not self.is_ready():
            return SearchResponse(
                results=[],
                total=0,
                query=request.query,
            )

        results = await self._rag_manager.search(
            query=request.query,
            collection=request.collection,
            limit=request.limit,
            score_threshold=request.scoreThreshold,
        )

        return SearchResponse(
            results=results.get("results", []),
            total=results.get("total", 0),
            query=request.query,
        )

    async def get_context_for_query(
        self,
        query: str,
        detected_libraries: Optional[List[str]] = None,
        max_results: int = 5
    ) -> Optional[str]:
        """Get formatted context for a query"""
        logger.info(f"[Embedded] Get context for query: {query[:100]}...")

        if not self.is_ready():
            return None

        try:
            return await self._rag_manager.get_context_for_query(
                query=query,
                detected_libraries=detected_libraries,
                max_results=max_results,
            )
        except Exception as e:
            logger.error(f"Failed to get RAG context: {e}")
            return None

    async def get_index_status(self) -> Dict[str, Any]:
        """Get current index status"""
        logger.info("[Embedded] Get index status")

        if not self.is_ready():
            return {
                "ready": False,
                "documentCount": 0,
                "collections": [],
                "message": "RAG service not initialized",
            }

        try:
            return await self._rag_manager.get_index_status()
        except Exception as e:
            logger.error(f"Failed to get index status: {e}")
            return {
                "ready": False,
                "documentCount": 0,
                "collections": [],
                "message": str(e),
            }

    async def trigger_reindex(self, force: bool = False) -> Dict[str, Any]:
        """Trigger a reindex operation"""
        logger.info(f"[Embedded] Trigger reindex (force={force})")

        if not self.is_ready():
            return {
                "success": False,
                "message": "RAG service not initialized",
            }

        try:
            return await self._rag_manager.trigger_reindex(force=force)
        except Exception as e:
            logger.error(f"Failed to trigger reindex: {e}")
            return {
                "success": False,
                "message": str(e),
            }


class ProxyRAGService(IRAGService):
    """
    Proxy implementation of RAG Service.

    Forwards requests to external agent server via HTTP.
    Used in production mode (HDSP_AGENT_MODE=proxy).
    """

    def __init__(self, base_url: str, timeout: float = 120.0):
        """Initialize proxy RAG service"""
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._ready = False
        logger.info(f"ProxyRAGService initialized (server: {self._base_url})")

    async def initialize(self) -> None:
        """Check server connectivity and RAG availability"""
        try:
            status = await self.get_index_status()
            self._ready = status.get("ready", False)
            logger.info(f"ProxyRAGService ready: {self._ready}")
        except Exception as e:
            logger.warning(f"Failed to check RAG server: {e}")
            self._ready = False

    async def shutdown(self) -> None:
        """Shutdown proxy service"""
        self._ready = False

    def is_ready(self) -> bool:
        """Check if RAG service is ready"""
        return self._ready

    async def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to RAG server"""
        url = f"{self._base_url}{path}"

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            if method == "POST":
                response = await client.post(url, json=data)
            elif method == "GET":
                response = await client.get(url)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response.raise_for_status()
            return response.json()

    async def search(self, request: SearchRequest) -> SearchResponse:
        """Search via proxy"""
        logger.info(f"[Proxy] RAG search: {request.query[:100]}...")

        data = request.model_dump(mode="json")
        result = await self._request("POST", "/rag/search", data)

        return SearchResponse(**result)

    async def get_context_for_query(
        self,
        query: str,
        detected_libraries: Optional[List[str]] = None,
        max_results: int = 5
    ) -> Optional[str]:
        """Get context via proxy"""
        logger.info(f"[Proxy] Get context for query: {query[:100]}...")

        data = {
            "query": query,
            "detected_libraries": detected_libraries,
            "max_results": max_results,
        }

        try:
            result = await self._request("POST", "/rag/context", data)
            return result.get("context")
        except Exception as e:
            logger.error(f"Failed to get RAG context via proxy: {e}")
            return None

    async def get_index_status(self) -> Dict[str, Any]:
        """Get index status via proxy"""
        logger.info("[Proxy] Get index status")

        try:
            return await self._request("GET", "/rag/status")
        except Exception as e:
            logger.error(f"Failed to get index status via proxy: {e}")
            return {
                "ready": False,
                "documentCount": 0,
                "collections": [],
                "message": str(e),
            }

    async def trigger_reindex(self, force: bool = False) -> Dict[str, Any]:
        """Trigger reindex via proxy"""
        logger.info(f"[Proxy] Trigger reindex (force={force})")

        data = {"force": force}

        try:
            return await self._request("POST", "/rag/reindex", data)
        except Exception as e:
            logger.error(f"Failed to trigger reindex via proxy: {e}")
            return {
                "success": False,
                "message": str(e),
            }
