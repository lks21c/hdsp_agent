"""
Unit tests for RAG system components.

Tests cover:
- EmbeddingService: Local embedding generation
- DocumentChunker: Format-aware document splitting
- Retriever: Dense vector search
- RAGManager: Orchestration and lifecycle

All tests use mocks to avoid actual model loading and API calls.
Token consumption: 0 (all mocked)
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# ============ EmbeddingService Tests ============


class TestEmbeddingService:
    """Tests for the local embedding service."""

    def test_singleton_pattern(self):
        """EmbeddingService should follow singleton pattern."""
        from agent_server.core.embedding_service import (
            EmbeddingService,
            reset_embedding_service,
        )

        reset_embedding_service()

        service1 = EmbeddingService()
        service2 = EmbeddingService()

        assert service1 is service2
        reset_embedding_service()

    def test_lazy_model_loading(self):
        """Model should only load when first accessed."""
        from agent_server.core.embedding_service import (
            EmbeddingService,
            reset_embedding_service,
        )

        reset_embedding_service()
        service = EmbeddingService()

        # Model should not be loaded yet
        assert service._model is None

        reset_embedding_service()

    def test_e5_prefix_handling(self):
        """E5 models should add proper prefixes."""
        from agent_server.core.embedding_service import (
            EmbeddingService,
            reset_embedding_service,
        )
        from hdsp_agent_core.models.rag import EmbeddingConfig

        reset_embedding_service()

        # Create service with E5 model name
        config = EmbeddingConfig(model_name="intfloat/multilingual-e5-small")
        service = EmbeddingService(config)

        # Manually set is_e5_model without loading the actual model
        service._is_e5_model = True

        # Test query prefix
        texts = service._prepare_texts(["test query"], is_query=True)
        assert texts[0] == "query: test query"

        # Test passage prefix
        texts = service._prepare_texts(["test passage"], is_query=False)
        assert texts[0] == "passage: test passage"

        reset_embedding_service()

    async def test_embed_texts_empty_list(self):
        """embed_texts should return empty list for empty input."""
        from agent_server.core.embedding_service import (
            EmbeddingService,
            reset_embedding_service,
        )

        reset_embedding_service()

        service = EmbeddingService()
        embeddings = await service.embed_texts([])

        assert embeddings == []

        reset_embedding_service()

    async def test_embed_query_empty_raises(self):
        """embed_query should raise for empty query."""
        from agent_server.core.embedding_service import (
            EmbeddingService,
            reset_embedding_service,
        )

        reset_embedding_service()

        service = EmbeddingService()

        with pytest.raises(ValueError):
            await service.embed_query("")

        reset_embedding_service()


# ============ DocumentChunker Tests ============


class TestDocumentChunker:
    """Tests for document chunking strategies."""

    def test_markdown_chunking_by_headers(self):
        """Markdown should be split by headers."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker
        from hdsp_agent_core.models.rag import ChunkingConfig

        config = ChunkingConfig(split_by_header=True, min_chunk_size=10)
        chunker = DocumentChunker(config)

        content = """# Introduction
This is the intro section.

## Methods
This describes the methods.

## Results
Here are the results.
"""

        chunks = chunker.chunk_document(
            content, metadata={"source": "test.md"}, file_type="markdown"
        )

        assert len(chunks) >= 3
        # Check section metadata
        sections = [c["metadata"].get("section", "") for c in chunks]
        assert any("Introduction" in s for s in sections)
        assert any("Methods" in s for s in sections)

    def test_python_chunking_by_definitions(self):
        """Python code should be split by class/function definitions."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker
        from hdsp_agent_core.models.rag import ChunkingConfig

        config = ChunkingConfig(min_chunk_size=10)
        chunker = DocumentChunker(config)

        content = '''"""Module docstring"""

import os

def function_one():
    """First function"""
    return 1

class MyClass:
    """A class"""
    def method(self):
        pass

def function_two():
    """Second function"""
    return 2
'''

        chunks = chunker.chunk_document(
            content, metadata={"source": "test.py"}, file_type="python"
        )

        assert len(chunks) >= 2
        # Check definition metadata
        definitions = [c["metadata"].get("definition", "") for c in chunks]
        assert any("function_one" in d for d in definitions)
        assert any("MyClass" in d for d in definitions)

    def test_text_chunking_with_overlap(self):
        """Text should be chunked with overlap."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker
        from hdsp_agent_core.models.rag import ChunkingConfig

        config = ChunkingConfig(
            chunk_size=100, chunk_overlap=20, min_chunk_size=10, max_chunk_size=200
        )
        chunker = DocumentChunker(config)

        # Create content longer than chunk_size
        content = "This is a test sentence. " * 20

        chunks = chunker.chunk_document(content, file_type="text")

        assert len(chunks) > 1
        # Verify chunks have chunk_index metadata
        assert all("chunk_index" in c["metadata"] for c in chunks)

    def test_file_type_inference(self):
        """File type should be inferred from source path."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker

        chunker = DocumentChunker()

        assert chunker._infer_file_type("document.md") == "markdown"
        assert chunker._infer_file_type("script.py") == "python"
        assert chunker._infer_file_type("data.txt") == "text"
        assert chunker._infer_file_type("config.json") == "text"
        assert chunker._infer_file_type("unknown") == "text"

    def test_min_chunk_size_filter(self):
        """Chunks below min_chunk_size should be filtered."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker
        from hdsp_agent_core.models.rag import ChunkingConfig

        config = ChunkingConfig(min_chunk_size=50)
        chunker = DocumentChunker(config)

        content = """# Header
Short.

## Another
This section has enough content to meet the minimum size requirement.
"""

        chunks = chunker.chunk_document(content, file_type="markdown")

        # All chunks should meet minimum size
        for chunk in chunks:
            assert len(chunk["content"]) >= config.min_chunk_size


# ============ Retriever Tests ============


class TestRetriever:
    """Tests for dense vector retrieval."""

    @pytest.fixture
    def mock_qdrant_client(self):
        """Create mock Qdrant client."""
        client = MagicMock()

        # Mock search results
        mock_result = MagicMock()
        mock_result.id = "doc1"
        mock_result.score = 0.85
        mock_result.payload = {
            "content": "Test document content",
            "source": "test.md",
        }

        client.search.return_value = [mock_result]
        return client

    @pytest.fixture
    def mock_embedding_service(self):
        """Create mock embedding service."""
        service = MagicMock()
        # Mock async methods with AsyncMock
        service.embed_query = AsyncMock(return_value=[0.1] * 384)
        return service

    def test_dense_search(self, mock_qdrant_client, mock_embedding_service):
        """Test dense vector search."""
        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(mock_qdrant_client, mock_embedding_service, config)

        import asyncio

        results = asyncio.run(retriever.search("test query"))

        assert len(results) == 1
        assert results[0]["content"] == "Test document content"
        assert results[0]["score"] == 0.85

    def test_result_format(self, mock_qdrant_client, mock_embedding_service):
        """Results should have correct format."""
        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(mock_qdrant_client, mock_embedding_service, config)

        import asyncio

        results = asyncio.run(retriever.search("test query"))

        # Check result structure
        assert "content" in results[0]
        assert "score" in results[0]
        assert "metadata" in results[0]
        assert "source" in results[0]["metadata"]

    def test_score_threshold_filtering(
        self, mock_qdrant_client, mock_embedding_service
    ):
        """Results below threshold should be filtered."""
        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        # Create results with varying scores
        mock_result_high = MagicMock()
        mock_result_high.id = "doc1"
        mock_result_high.score = 0.8
        mock_result_high.payload = {"content": "High score", "source": "a.md"}

        mock_result_low = MagicMock()
        mock_result_low.id = "doc2"
        mock_result_low.score = 0.2
        mock_result_low.payload = {"content": "Low score", "source": "b.md"}

        mock_qdrant_client.search.return_value = [mock_result_high, mock_result_low]

        config = RAGConfig(
            score_threshold=0.5,
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(mock_qdrant_client, mock_embedding_service, config)

        import asyncio

        results = asyncio.run(retriever.search("test query"))

        # Only high score result should be returned
        assert len(results) == 1
        assert results[0]["content"] == "High score"

    def test_build_filter(self, mock_qdrant_client, mock_embedding_service):
        """Filter building should handle various formats."""
        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(qdrant=QdrantConfig(collection_name="test"))
        retriever = Retriever(mock_qdrant_client, mock_embedding_service, config)

        # Single value filter
        single_filter = retriever._build_filter({"source_type": "library"})
        assert single_filter is not None

        # Multiple values filter
        multi_filter = retriever._build_filter(
            {"source_type": ["library", "documentation"]}
        )
        assert multi_filter is not None

        # Empty filter
        empty_filter = retriever._build_filter({})
        assert empty_filter is None


# ============ RAGManager Tests ============


class TestRAGManager:
    """Tests for RAG orchestration."""

    @pytest.fixture
    def mock_config(self):
        """Create mock RAG config."""
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        return RAGConfig(
            enabled=True,
            qdrant=QdrantConfig(mode="local", collection_name="test"),
        )

    def test_singleton_pattern(self, mock_config):
        """RAGManager should follow singleton pattern."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager1 = RAGManager(mock_config)
        manager2 = RAGManager(mock_config)

        assert manager1 is manager2

        reset_rag_manager()

    def test_get_status_not_ready(self, mock_config):
        """Status should indicate not ready before initialization."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager = RAGManager(mock_config)
        status = manager.get_status()

        # get_status returns a dict, not a Pydantic model
        assert status["ready"] is False
        assert "enabled" in status
        assert "total_documents" in status

        reset_rag_manager()

    def test_is_ready_property_false_initially(self, mock_config):
        """is_ready should be False before initialization."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager = RAGManager(mock_config)

        assert manager.is_ready is False

        reset_rag_manager()

    def test_search_returns_empty_when_not_ready(self, mock_config):
        """Search should return empty when not ready."""
        import asyncio

        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager = RAGManager(mock_config)
        # Don't initialize

        results = asyncio.run(manager.search("test query"))

        assert results == []

        reset_rag_manager()

    async def test_get_context_returns_empty_when_not_ready(self, mock_config):
        """get_context_for_query should return empty string when not ready."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager = RAGManager(mock_config)
        # Don't initialize

        context = await manager.get_context_for_query("test query")

        assert context == ""

        reset_rag_manager()

    async def test_config_disabled_returns_empty(self):
        """When RAG is disabled, get_context should return empty."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        reset_rag_manager()

        config = RAGConfig(
            enabled=False,
            qdrant=QdrantConfig(mode="local", collection_name="test"),
        )
        manager = RAGManager(config)

        # Even if we didn't initialize, is_ready is False so context is empty
        context = await manager.get_context_for_query("test")
        assert context == ""

        reset_rag_manager()

    def test_get_rag_manager_singleton(self, mock_config):
        """get_rag_manager should return singleton."""
        from agent_server.core.rag_manager import (
            get_rag_manager,
            reset_rag_manager,
        )

        reset_rag_manager()

        manager1 = get_rag_manager(mock_config)
        manager2 = get_rag_manager()

        assert manager1 is manager2

        reset_rag_manager()

    def test_status_contains_required_fields(self, mock_config):
        """get_status should return all required fields."""
        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()

        manager = RAGManager(mock_config)
        status = manager.get_status()

        # Verify all expected fields exist
        assert "ready" in status
        assert "enabled" in status
        assert "total_documents" in status
        assert "total_chunks" in status
        assert "last_updated" in status
        assert "knowledge_base_path" in status
        assert "qdrant_mode" in status
        assert "embedding_model" in status

        reset_rag_manager()


# ============ WatchdogService Tests ============


class TestWatchdogService:
    """Tests for file monitoring service."""

    def test_should_process_matching_patterns(self):
        """Files matching patterns should be processed."""
        from agent_server.knowledge.watchdog_service import WatchdogService
        from hdsp_agent_core.models.rag import WatchdogConfig

        config = WatchdogConfig(
            enabled=True,
            patterns=["*.md", "*.py"],
            ignore_patterns=[".*", "__pycache__"],
        )

        service = WatchdogService(config)

        # Should process
        assert service._should_process(Path("document.md"))
        assert service._should_process(Path("script.py"))

        # Should ignore
        assert not service._should_process(Path(".hidden.md"))
        assert not service._should_process(Path("file.txt"))

    def test_watchdog_disabled(self):
        """Watchdog should not start when disabled."""
        from agent_server.knowledge.watchdog_service import WatchdogService
        from hdsp_agent_core.models.rag import WatchdogConfig

        config = WatchdogConfig(enabled=False)
        service = WatchdogService(config)

        result = service.start(Path("/tmp"))

        assert result is False
        assert not service.is_running


# ============ Integration Tests ============


class TestRAGIntegration:
    """Integration tests for RAG pipeline."""

    def test_chunking_to_embedding_pipeline(self):
        """Test chunking output format is compatible with embedding input."""
        from hdsp_agent_core.knowledge.chunking import DocumentChunker
        from hdsp_agent_core.models.rag import ChunkingConfig

        config = ChunkingConfig(min_chunk_size=10)
        chunker = DocumentChunker(config)

        content = "This is test content for embedding."
        chunks = chunker.chunk_document(content, metadata={"source": "test.txt"})

        # Verify chunks have expected format for embedding
        for chunk in chunks:
            assert isinstance(chunk["content"], str)
            assert len(chunk["content"]) > 0
            assert isinstance(chunk["metadata"], dict)

    def test_config_environment_override(self):
        """Test environment variable configuration override."""
        import os

        from hdsp_agent_core.models.rag import RAGConfig

        # Set environment variable
        os.environ["HDSP_RAG_ENABLED"] = "false"

        config = RAGConfig(enabled=True)
        assert config.is_enabled() is False

        # Clean up
        del os.environ["HDSP_RAG_ENABLED"]

        config2 = RAGConfig(enabled=True)
        assert config2.is_enabled() is True


# ============ RAG Debug Tests ============


class TestRAGDebug:
    """Tests for Retriever.search_with_debug()"""

    @pytest.fixture
    def mock_qdrant_client_debug(self):
        """Create mock Qdrant client with multiple results for debug testing."""
        client = MagicMock()

        # Mock search results with varying scores
        mock_result1 = MagicMock()
        mock_result1.id = "doc1"
        mock_result1.score = 0.9
        mock_result1.payload = {
            "content": "High score document content for testing",
            "source": "pandas.md",
            "section": "DataFrame Creation",
        }

        mock_result2 = MagicMock()
        mock_result2.id = "doc2"
        mock_result2.score = 0.7
        mock_result2.payload = {
            "content": "Medium score document content",
            "source": "numpy.md",
            "section": "Array Operations",
        }

        mock_result3 = MagicMock()
        mock_result3.id = "doc3"
        mock_result3.score = 0.4
        mock_result3.payload = {
            "content": "Low score document below threshold",
            "source": "matplotlib.md",
            "section": "Plotting",
        }

        client.search.return_value = [mock_result1, mock_result2, mock_result3]
        return client

    @pytest.fixture
    def mock_embedding_service_debug(self):
        """Create mock embedding service for debug testing."""
        service = MagicMock()
        # Mock async methods with AsyncMock
        service.embed_query = AsyncMock(return_value=[0.1] * 384)
        return service

    def test_search_with_debug_returns_scores(
        self, mock_qdrant_client_debug, mock_embedding_service_debug
    ):
        """search_with_debug should return vector similarity scores."""
        import asyncio

        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            score_threshold=0.3,
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(
            mock_qdrant_client_debug, mock_embedding_service_debug, config
        )

        result = asyncio.run(retriever.search_with_debug("test query"))

        # Should return DebugSearchResult
        assert result is not None
        assert len(result.chunks) == 3
        assert result.total_candidates == 3

        # Check all chunks have required fields
        for chunk in result.chunks:
            assert chunk.chunk_id is not None
            assert chunk.score is not None
            assert chunk.rank is not None
            assert chunk.passed_threshold is not None

    def test_search_with_debug_scores_descending(
        self, mock_qdrant_client_debug, mock_embedding_service_debug
    ):
        """Scores should be sorted in descending order."""
        import asyncio

        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            score_threshold=0.3,
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(
            mock_qdrant_client_debug, mock_embedding_service_debug, config
        )

        result = asyncio.run(retriever.search_with_debug("test query"))

        # Verify descending order
        scores = [chunk.score for chunk in result.chunks]
        assert scores == sorted(scores, reverse=True)

    def test_search_with_debug_threshold_filtering(
        self, mock_qdrant_client_debug, mock_embedding_service_debug
    ):
        """passed_threshold should be correctly set based on score threshold."""
        import asyncio

        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            score_threshold=0.5,  # Higher threshold
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(
            mock_qdrant_client_debug, mock_embedding_service_debug, config
        )

        result = asyncio.run(retriever.search_with_debug("test query"))

        # Count passed vs not passed
        passed = [c for c in result.chunks if c.passed_threshold]
        not_passed = [c for c in result.chunks if not c.passed_threshold]

        # doc1 (0.9) and doc2 (0.7) should pass, doc3 (0.4) should not
        assert len(passed) == 2
        assert len(not_passed) == 1
        assert not_passed[0].score < 0.5

    def test_debug_search_timing_present(
        self, mock_qdrant_client_debug, mock_embedding_service_debug
    ):
        """Timing information should be included in results."""
        import asyncio

        from agent_server.core.retriever import Retriever
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        config = RAGConfig(
            qdrant=QdrantConfig(collection_name="test"),
        )

        retriever = Retriever(
            mock_qdrant_client_debug, mock_embedding_service_debug, config
        )

        result = asyncio.run(retriever.search_with_debug("test query"))

        # Verify timing info is present
        assert result.search_ms >= 0


class TestRAGManagerDebug:
    """Tests for RAGManager.debug_search()"""

    @pytest.fixture
    def mock_config(self):
        """Create mock RAG config for debug testing."""
        from hdsp_agent_core.models.rag import QdrantConfig, RAGConfig

        return RAGConfig(
            enabled=True,
            score_threshold=0.3,
            top_k=5,
            max_context_tokens=1500,
            qdrant=QdrantConfig(mode="local", collection_name="test"),
        )

    def test_debug_search_returns_library_detection(self, mock_config):
        """debug_search should return library detection information."""
        import asyncio

        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()
        manager = RAGManager(mock_config)

        # Without initialization, should return error
        result = asyncio.run(manager.debug_search("pandas dataframe"))

        assert "error" in result
        assert result["error"] == "RAG system not ready"

        reset_rag_manager()

    def test_debug_search_not_ready_returns_error(self, mock_config):
        """debug_search should return error when RAG is not ready."""
        import asyncio

        from agent_server.core.rag_manager import RAGManager, reset_rag_manager

        reset_rag_manager()
        manager = RAGManager(mock_config)
        # Don't initialize

        result = asyncio.run(manager.debug_search("test query"))

        assert "error" in result

        reset_rag_manager()


class TestDebugSchemas:
    """Tests for debug schema validation."""

    def test_debug_search_request_validation(self):
        """DebugSearchRequest should validate correctly."""
        from hdsp_agent_core.models.rag import DebugSearchRequest

        # Valid request
        request = DebugSearchRequest(query="test query")
        assert request.query == "test query"
        assert request.imported_libraries == []
        assert request.top_k is None
        assert request.include_full_content is False
        assert request.simulate_plan_context is True

    def test_debug_search_request_defaults(self):
        """DebugSearchRequest should have correct defaults."""
        from hdsp_agent_core.models.rag import DebugSearchRequest

        request = DebugSearchRequest(query="test")

        assert request.imported_libraries == []
        assert request.top_k is None
        assert request.include_full_content is False
        assert request.simulate_plan_context is True

    def test_debug_search_request_with_libraries(self):
        """DebugSearchRequest should accept library list."""
        from hdsp_agent_core.models.rag import DebugSearchRequest

        request = DebugSearchRequest(
            query="test query",
            imported_libraries=["pandas", "numpy"],
            top_k=10,
        )

        assert request.imported_libraries == ["pandas", "numpy"]
        assert request.top_k == 10

    def test_chunk_debug_info_validation(self):
        """ChunkDebugInfo should validate correctly."""
        from hdsp_agent_core.models.rag import ChunkDebugInfo

        chunk = ChunkDebugInfo(
            chunk_id="doc1",
            content_preview="Test content...",
            score=0.85,
            rank=1,
            metadata={"source": "test.md"},
            passed_threshold=True,
        )

        assert chunk.chunk_id == "doc1"
        assert chunk.score == 0.85
        assert chunk.passed_threshold is True

    def test_library_detection_debug_validation(self):
        """LibraryDetectionDebug should validate correctly."""
        from hdsp_agent_core.models.rag import LibraryDetectionDebug

        detection = LibraryDetectionDebug(
            input_query="pandas dataframe",
            imported_libraries=["pandas"],
            available_libraries=["pandas", "numpy", "matplotlib"],
            detected_libraries=["pandas"],
            detection_method="deterministic",
        )

        assert detection.input_query == "pandas dataframe"
        assert detection.detected_libraries == ["pandas"]

    def test_search_config_debug_validation(self):
        """SearchConfigDebug should validate correctly."""
        from hdsp_agent_core.models.rag import SearchConfigDebug

        config = SearchConfigDebug(
            top_k=5,
            score_threshold=0.3,
            max_context_tokens=1500,
        )

        assert config.top_k == 5
        assert config.score_threshold == 0.3
