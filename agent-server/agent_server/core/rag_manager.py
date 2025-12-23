"""
RAG Manager - Main orchestrator for the Local RAG system.

Responsibilities:
- Qdrant client lifecycle management
- Collection creation and schema management
- Document indexing orchestration
- Search coordination
- Watchdog service coordination

Design Patterns:
- Singleton (consistent state across handlers)
- Lazy initialization (defer heavy operations)
- Graceful degradation (fallback to keyword search if RAG fails)
"""

import hashlib
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import RAGConfig

logger = logging.getLogger(__name__)


class RAGManager:
    """
    Central manager for RAG operations.

    Coordinates all RAG components:
    - Qdrant vector database
    - Embedding service
    - Retriever (hybrid search)
    - Watchdog (file monitoring)

    Usage:
        manager = get_rag_manager()
        await manager.initialize()
        results = await manager.search("query")
        context = manager.get_context_for_query("query")
    """

    _instance: Optional["RAGManager"] = None
    _initialized: bool = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config: Optional["RAGConfig"] = None):
        if self._initialized:
            return
        self._initialized = True

        from hdsp_agent_core.models.rag import get_default_rag_config

        self._config = config or get_default_rag_config()
        self._client = None
        self._embedding_service = None
        self._retriever = None
        self._watchdog = None
        self._ready = False
        self._index_stats = {
            "total_documents": 0,
            "total_chunks": 0,
            "last_updated": None,
        }

    async def initialize(self) -> bool:
        """
        Initialize RAG system components.
        Called during FastAPI lifespan startup.

        Returns:
            True if initialization successful
        """
        if not self._config.is_enabled():
            logger.info("RAG system disabled in configuration")
            return False

        try:
            # 1. Initialize Qdrant client
            self._client = self._create_qdrant_client()
            logger.info("Qdrant client initialized")

            # 2. Initialize embedding service
            from agent_server.core.embedding_service import get_embedding_service

            self._embedding_service = get_embedding_service(self._config.embedding)
            logger.info(
                f"Embedding service initialized (dim={self._embedding_service.dimension})"
            )

            # 3. Ensure collection exists
            await self._ensure_collection()

            # 4. Initialize retriever
            from agent_server.core.retriever import Retriever

            self._retriever = Retriever(
                client=self._client,
                embedding_service=self._embedding_service,
                config=self._config,
            )
            logger.info("Retriever initialized")

            # 5. Start watchdog (file monitoring)
            if self._config.watchdog.enabled:
                await self._start_watchdog()

            # 6. Initial indexing
            await self._index_knowledge_base()

            self._ready = True
            logger.info("RAG system initialized successfully")
            return True

        except Exception as e:
            logger.error(f"RAG initialization failed: {e}", exc_info=True)
            self._ready = False
            return False

    async def shutdown(self) -> None:
        """
        Graceful shutdown of RAG components.
        Called during FastAPI lifespan shutdown.
        """
        logger.info("Shutting down RAG system...")

        if self._watchdog:
            self._watchdog.stop()
            logger.info("Watchdog stopped")

        # Qdrant client doesn't need explicit cleanup for local mode
        self._ready = False
        logger.info("RAG system shutdown complete")

    def _create_qdrant_client(self):
        """Create Qdrant client based on configuration mode."""
        try:
            from qdrant_client import QdrantClient
        except ImportError:
            raise ImportError(
                "qdrant-client is required for RAG. "
                "Install with: pip install qdrant-client"
            )

        cfg = self._config.qdrant

        if cfg.mode == "local":
            # Local file-based storage
            local_path = cfg.get_local_path()
            Path(local_path).mkdir(parents=True, exist_ok=True)
            logger.info(f"Initializing Qdrant in local mode: {local_path}")
            return QdrantClient(path=local_path)

        elif cfg.mode == "server":
            # Docker or external server
            logger.info(f"Connecting to Qdrant server: {cfg.url}")
            return QdrantClient(url=cfg.url)

        elif cfg.mode == "cloud":
            # Qdrant Cloud
            logger.info("Connecting to Qdrant Cloud")
            return QdrantClient(url=cfg.url, api_key=cfg.api_key)

        else:
            raise ValueError(f"Unknown Qdrant mode: {cfg.mode}")

    async def _ensure_collection(self) -> None:
        """Create collection if it doesn't exist."""
        from qdrant_client.models import Distance, VectorParams

        collection_name = self._config.qdrant.collection_name

        try:
            collections = self._client.get_collections().collections
            exists = any(c.name == collection_name for c in collections)

            if not exists:
                logger.info(f"Creating collection: {collection_name}")
                self._client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(
                        size=self._embedding_service.dimension, distance=Distance.COSINE
                    ),
                )
                logger.info(
                    f"Collection created with dimension {self._embedding_service.dimension}"
                )
            else:
                logger.info(f"Collection exists: {collection_name}")
        except Exception as e:
            logger.error(f"Failed to ensure collection: {e}")
            raise

    async def _start_watchdog(self) -> None:
        """Start file system monitoring."""
        try:
            from agent_server.knowledge.watchdog_service import WatchdogService

            knowledge_path = self._get_knowledge_path()
            if not knowledge_path.exists():
                logger.warning(f"Knowledge base path does not exist: {knowledge_path}")
                return

            self._watchdog = WatchdogService(
                watch_path=knowledge_path,
                config=self._config.watchdog,
                on_change_callback=self._on_file_change,
            )
            self._watchdog.start()
            logger.info(f"Watchdog started monitoring: {knowledge_path}")
        except ImportError:
            logger.warning("Watchdog service not available")
        except Exception as e:
            logger.warning(f"Failed to start watchdog: {e}")

    def _get_knowledge_path(self) -> Path:
        """Get knowledge base directory path."""
        custom_path = self._config.get_knowledge_base_path()
        if custom_path:
            return Path(custom_path)
        # Default to built-in libraries directory
        return Path(__file__).parent.parent / "knowledge" / "libraries"

    async def _index_knowledge_base(self) -> Dict[str, Any]:
        """Index all documents in the knowledge base."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker

        knowledge_path = self._get_knowledge_path()
        if not knowledge_path.exists():
            logger.warning(f"Knowledge base path not found: {knowledge_path}")
            return {"indexed": 0, "skipped": 0, "errors": []}

        chunker = DocumentChunker(self._config.chunking)

        indexed = 0
        skipped = 0
        errors = []

        # Get all files matching patterns
        files = []
        for pattern in self._config.watchdog.patterns:
            files.extend(knowledge_path.glob(f"**/{pattern}"))

        # Filter out ignored patterns
        files = [f for f in files if not self._should_ignore(f)]

        logger.info(f"Found {len(files)} files to index in {knowledge_path}")

        for file_path in files:
            try:
                # Check if file needs re-indexing
                if self._is_file_indexed(file_path):
                    skipped += 1
                    continue

                # Read and chunk document
                content = file_path.read_text(encoding="utf-8")
                chunks = chunker.chunk_document(
                    content=content,
                    metadata={
                        "source": str(file_path.relative_to(knowledge_path)),
                        "source_type": self._infer_source_type(file_path),
                        "file_path": str(file_path),
                        "indexed_at": datetime.now().isoformat(),
                    },
                )

                if chunks:
                    self._index_chunks(chunks, file_path)
                    indexed += 1
                    self._index_stats["total_documents"] += 1
                    self._index_stats["total_chunks"] += len(chunks)

            except Exception as e:
                errors.append({"file": str(file_path), "error": str(e)})
                logger.error(f"Failed to index {file_path}: {e}")

        self._index_stats["last_updated"] = datetime.now().isoformat()
        result = {"indexed": indexed, "skipped": skipped, "errors": errors}
        logger.info(
            f"Indexing complete: {indexed} indexed, {skipped} skipped, {len(errors)} errors"
        )
        return result

    def _should_ignore(self, file_path: Path) -> bool:
        """Check if file should be ignored."""
        path_str = str(file_path)
        for pattern in self._config.watchdog.ignore_patterns:
            if pattern.startswith("."):
                # Hidden files/dirs
                if any(part.startswith(".") for part in file_path.parts):
                    return True
            elif pattern in path_str:
                return True
        return False

    def _is_file_indexed(self, file_path: Path) -> bool:
        """Check if file is already indexed with current content hash."""
        file_hash = self._compute_file_hash(file_path)

        try:
            results = self._client.scroll(
                collection_name=self._config.qdrant.collection_name,
                scroll_filter={
                    "must": [{"key": "file_path", "match": {"value": str(file_path)}}]
                },
                limit=1,
                with_payload=True,
            )

            if results[0]:  # Has existing points
                existing_hash = results[0][0].payload.get("content_hash")
                return existing_hash == file_hash

        except Exception as e:
            logger.debug(f"Error checking indexed status: {e}")

        return False

    def _compute_file_hash(self, file_path: Path) -> str:
        """Compute content hash for change detection."""
        content = file_path.read_bytes()
        return hashlib.sha256(content).hexdigest()[:16]

    def _infer_source_type(self, file_path: Path) -> str:
        """Infer document source type from path."""
        path_str = str(file_path).lower()

        if "libraries" in path_str:
            return "library_guide"
        elif "incidents" in path_str:
            return "incident"
        elif "tutorials" in path_str:
            return "tutorial"
        elif "infrastructure" in path_str:
            return "infrastructure"
        else:
            return "general"

    def _index_chunks(self, chunks: List[Dict], file_path: Path) -> None:
        """Index document chunks to Qdrant."""
        from qdrant_client.models import PointStruct

        # Generate embeddings
        texts = [c["content"] for c in chunks]
        embeddings = self._embedding_service.embed_texts(texts)

        # Add content hash to all chunks
        file_hash = self._compute_file_hash(file_path)

        # Create points
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            point_id = str(uuid.uuid4())
            payload = {
                **chunk["metadata"],
                "content": chunk["content"],
                "content_hash": file_hash,
                "chunk_index": i,
            }
            points.append(PointStruct(id=point_id, vector=embedding, payload=payload))

        # Upsert to Qdrant
        self._client.upsert(
            collection_name=self._config.qdrant.collection_name, points=points
        )

        logger.debug(f"Indexed {len(points)} chunks from {file_path.name}")

    async def _on_file_change(self, event_type: str, file_path: Path) -> None:
        """Handle file change events from watchdog."""
        logger.info(f"File change detected: {event_type} - {file_path}")

        if event_type == "deleted":
            self._remove_file_from_index(file_path)
        else:
            # Modified or created - re-index
            await self._reindex_file(file_path)

    def _remove_file_from_index(self, file_path: Path) -> None:
        """Remove file's chunks from index."""
        try:
            self._client.delete(
                collection_name=self._config.qdrant.collection_name,
                points_selector={
                    "filter": {
                        "must": [
                            {"key": "file_path", "match": {"value": str(file_path)}}
                        ]
                    }
                },
            )
            logger.info(f"Removed from index: {file_path}")
        except Exception as e:
            logger.error(f"Failed to remove from index: {e}")

    async def _reindex_file(self, file_path: Path) -> None:
        """Re-index a single file."""
        # Remove old chunks
        self._remove_file_from_index(file_path)

        if not file_path.exists():
            return

        # Index new content
        from hdsp_agent_core.knowledge.chunking import DocumentChunker

        chunker = DocumentChunker(self._config.chunking)

        try:
            content = file_path.read_text(encoding="utf-8")
            knowledge_path = self._get_knowledge_path()

            chunks = chunker.chunk_document(
                content=content,
                metadata={
                    "source": str(file_path.relative_to(knowledge_path)),
                    "source_type": self._infer_source_type(file_path),
                    "file_path": str(file_path),
                    "indexed_at": datetime.now().isoformat(),
                },
            )

            if chunks:
                self._index_chunks(chunks, file_path)
                logger.info(f"Reindexed: {file_path}")
        except Exception as e:
            logger.error(f"Failed to reindex {file_path}: {e}")

    # ========== Public Search API ==========

    async def search(
        self, query: str, top_k: Optional[int] = None, filters: Optional[Dict] = None
    ) -> List[Dict]:
        """
        Search the knowledge base.

        Args:
            query: Search query text
            top_k: Number of results (default from config)
            filters: Metadata filters

        Returns:
            List of search results with content, score, metadata
        """
        if not self._ready:
            logger.warning("RAG system not ready, returning empty results")
            return []

        return await self._retriever.search(
            query=query, top_k=top_k or self._config.top_k, filters=filters
        )

    async def get_context_for_query(
        self,
        query: str,
        detected_libraries: Optional[List[str]] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        Get formatted RAG context for LLM prompt injection.

        Args:
            query: User query to find relevant context
            detected_libraries: Libraries detected by LibraryDetector (prioritized in search)
            max_tokens: Approximate token limit for context

        Returns:
            Formatted context string for prompt injection
        """
        if not self._ready:
            return ""

        effective_max_tokens = max_tokens or self._config.max_context_tokens
        results = []

        try:
            # Strategy: If libraries detected, search with library filter first
            # Then supplement with general search if needed
            if detected_libraries:
                # Search within detected library files first
                for lib in detected_libraries:
                    lib_filter = {"source": f"{lib}.md"}
                    lib_results = await self.search(
                        query=query,
                        top_k=3,  # Get top 3 from each library
                        filters=lib_filter,
                    )
                    results.extend(lib_results)
                    logger.info(
                        f"RAG library search [{lib}]: {len(lib_results)} results"
                    )

            # If not enough results, do general search
            if len(results) < self._config.top_k:
                remaining = self._config.top_k - len(results)
                general_results = await self.search(query=query, top_k=remaining)
                # Avoid duplicates
                existing_ids = {r.get("id") for r in results if r.get("id")}
                for r in general_results:
                    if r.get("id") not in existing_ids:
                        results.append(r)

            # Sort by score
            results.sort(key=lambda x: x.get("score", 0), reverse=True)

        except Exception as e:
            logger.error(f"Failed to get RAG context: {e}")
            return ""

        if not results:
            return ""

        # Format results as context
        context_parts = []
        char_count = 0
        char_limit = effective_max_tokens * 4  # Rough char-to-token ratio

        for result in results:
            source = result["metadata"].get("source", "unknown")
            section = result["metadata"].get("section", "")
            score = result["score"]

            # Format chunk with source info
            chunk_text = f"[Source: {source}"
            if section:
                chunk_text += f" > {section}"
            chunk_text += f" (relevance: {score:.2f})]\n{result['content']}\n"

            if char_count + len(chunk_text) > char_limit:
                break
            context_parts.append(chunk_text)
            char_count += len(chunk_text)

        if not context_parts:
            return ""

        header = "## 📚 라이브러리 API 참조 (RAG Retrieved)\n\n"
        header += "아래 가이드의 API 사용법을 **반드시** 따르세요.\n\n"
        return header + "\n---\n".join(context_parts)

    def get_status(self) -> Dict[str, Any]:
        """Get RAG system status."""
        return {
            "ready": self._ready,
            "enabled": self._config.is_enabled(),
            "total_documents": self._index_stats["total_documents"],
            "total_chunks": self._index_stats["total_chunks"],
            "last_updated": self._index_stats["last_updated"],
            "knowledge_base_path": str(self._get_knowledge_path()),
            "qdrant_mode": self._config.qdrant.mode,
            "embedding_model": self._config.embedding.get_model_name(),
        }

    @property
    def is_ready(self) -> bool:
        """Check if RAG system is operational."""
        return self._ready

    async def debug_search(
        self,
        query: str,
        imported_libraries: Optional[List[str]] = None,
        top_k: Optional[int] = None,
        include_full_content: bool = False,
        simulate_plan_context: bool = True,
    ) -> Dict[str, Any]:
        """
        전체 파이프라인 리니지를 포함한 디버그 검색.

        반환 정보:
        - 라이브러리 감지 결과
        - 청크별 점수 (dense, BM25, fused)
        - 최종 포맷된 컨텍스트

        Args:
            query: Search query
            imported_libraries: List of imported libraries
            top_k: Override default top_k
            include_full_content: Include full content instead of preview
            simulate_plan_context: Generate formatted context as in plan generation

        Returns:
            Dict with comprehensive debug information
        """
        if not self._ready:
            return {"error": "RAG system not ready"}

        # 1. 라이브러리 감지 (agent.py와 동일 로직)
        try:
            from hdsp_agent_core.knowledge.loader import (
                get_knowledge_base,
                get_library_detector,
            )

            knowledge_base = get_knowledge_base()
            library_detector = get_library_detector()
            available = (
                knowledge_base.list_available_libraries() if knowledge_base else []
            )
            detected_libraries = (
                library_detector.detect(
                    request=query,
                    available_libraries=available,
                    imported_libraries=imported_libraries or [],
                )
                if library_detector
                else []
            )
            detection_method = "deterministic"
        except Exception as e:
            logger.warning(f"Library detection failed: {e}")
            available = []
            detected_libraries = []
            detection_method = "fallback (detection failed)"

        library_detection_info = {
            "input_query": query,
            "imported_libraries": imported_libraries or [],
            "available_libraries": available or [],
            "detected_libraries": detected_libraries,
            "detection_method": detection_method,
        }

        # 2. 설정 정보
        config_info = {
            "top_k": top_k or self._config.top_k,
            "score_threshold": self._config.score_threshold,
            "max_context_tokens": self._config.max_context_tokens,
        }

        # 3. 디버그 검색 수행
        debug_result = await self._retriever.search_with_debug(
            query=query, top_k=top_k or self._config.top_k
        )

        # 4. 청크 디버그 정보 구성
        chunks_info = []
        for chunk in debug_result.chunks:
            content_preview = chunk.content
            if not include_full_content and len(chunk.content) > 200:
                content_preview = chunk.content[:200] + "..."

            chunks_info.append(
                {
                    "chunk_id": chunk.chunk_id,
                    "content_preview": content_preview,
                    "score": chunk.score,
                    "rank": chunk.rank,
                    "metadata": chunk.metadata,
                    "passed_threshold": chunk.passed_threshold,
                }
            )

        # 5. 포맷된 컨텍스트 생성 (get_context_for_query와 동일)
        formatted_context = ""
        if simulate_plan_context:
            passed_chunks = [c for c in debug_result.chunks if c.passed_threshold]

            if passed_chunks:
                context_parts = []
                char_count = 0
                char_limit = (
                    self._config.max_context_tokens * 4
                )  # Rough char-to-token ratio

                for chunk in passed_chunks:
                    source = chunk.metadata.get("source", "unknown")
                    section = chunk.metadata.get("section", "")
                    score = chunk.score

                    # Format chunk with source info
                    chunk_text = f"[Source: {source}"
                    if section:
                        chunk_text += f" > {section}"
                    chunk_text += f" (relevance: {score:.2f})]\n{chunk.content}\n"

                    if char_count + len(chunk_text) > char_limit:
                        break
                    context_parts.append(chunk_text)
                    char_count += len(chunk_text)

                if context_parts:
                    header = "## 📚 라이브러리 API 참조 (RAG Retrieved)\n\n"
                    header += "아래 가이드의 API 사용법을 **반드시** 따르세요.\n\n"
                    formatted_context = header + "\n---\n".join(context_parts)

        return {
            "library_detection": library_detection_info,
            "config": config_info,
            "chunks": chunks_info,
            "total_candidates": debug_result.total_candidates,
            "total_passed_threshold": sum(
                1 for c in debug_result.chunks if c.passed_threshold
            ),
            "search_ms": debug_result.search_ms,
            "formatted_context": formatted_context,
            "context_char_count": len(formatted_context),
            "estimated_context_tokens": len(formatted_context) // 4,
        }


# ============ Singleton Accessor ============

_rag_manager: Optional[RAGManager] = None


def get_rag_manager(config: Optional["RAGConfig"] = None) -> RAGManager:
    """
    Get the singleton RAGManager instance.

    Args:
        config: Optional RAGConfig (only used on first call)

    Returns:
        RAGManager singleton instance
    """
    global _rag_manager
    if _rag_manager is None:
        _rag_manager = RAGManager(config)
    return _rag_manager


def reset_rag_manager() -> None:
    """
    Reset the singleton instance (for testing purposes).
    """
    global _rag_manager
    if _rag_manager is not None:
        _rag_manager._initialized = False
        _rag_manager._ready = False
        _rag_manager = None
    RAGManager._instance = None
    RAGManager._initialized = False
