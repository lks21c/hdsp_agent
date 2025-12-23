"""
RAG Configuration and API Pydantic Models

Defines configuration schemas for the Local RAG system including:
- Qdrant vector database settings
- Embedding model settings
- Document chunking settings
- File watchdog settings
- Search API request/response models
"""

import os
from typing import Optional, List, Literal, Dict, Any
from pydantic import BaseModel, Field


class QdrantConfig(BaseModel):
    """Qdrant vector database configuration"""

    mode: Literal["local", "server", "cloud"] = Field(
        default="local",
        description="Deployment mode: local (file-based), server (Docker), cloud"
    )
    # Local mode settings
    local_path: Optional[str] = Field(
        default=None,
        description="Path for local Qdrant storage. Defaults to ~/.hdsp_agent/qdrant"
    )
    # Server mode settings
    url: Optional[str] = Field(
        default="http://localhost:6333",
        description="Qdrant server URL for server/cloud mode"
    )
    api_key: Optional[str] = Field(
        default=None,
        description="API key for cloud mode"
    )
    # Collection settings
    collection_name: str = Field(
        default="hdsp_knowledge",
        description="Vector collection name"
    )

    def get_local_path(self) -> str:
        """Get resolved local path with environment variable support"""
        if self.local_path:
            return os.path.expanduser(self.local_path)
        # Check environment variable
        env_path = os.environ.get("HDSP_QDRANT_PATH")
        if env_path:
            return os.path.expanduser(env_path)
        # Default path
        return os.path.expanduser("~/.hdsp_agent/qdrant")


class EmbeddingConfig(BaseModel):
    """Embedding model configuration"""

    model_name: str = Field(
        default="intfloat/multilingual-e5-small",
        description="HuggingFace model name for embeddings"
    )
    device: Literal["cpu", "cuda", "mps"] = Field(
        default="cpu",
        description="Device for embedding computation"
    )
    batch_size: int = Field(
        default=32,
        description="Batch size for embedding generation"
    )
    cache_folder: Optional[str] = Field(
        default=None,
        description="Model cache folder. Defaults to ~/.cache/huggingface"
    )
    # Model-specific settings
    normalize_embeddings: bool = Field(
        default=True,
        description="Normalize embeddings for cosine similarity"
    )

    def get_model_name(self) -> str:
        """Get model name with environment variable override"""
        return os.environ.get("HDSP_EMBEDDING_MODEL", self.model_name)

    def get_device(self) -> str:
        """Get device with environment variable override"""
        return os.environ.get("HDSP_EMBEDDING_DEVICE", self.device)


class ChunkingConfig(BaseModel):
    """Document chunking configuration"""

    chunk_size: int = Field(
        default=512,
        description="Target chunk size in characters"
    )
    chunk_overlap: int = Field(
        default=50,
        description="Overlap between chunks in characters"
    )
    split_by_header: bool = Field(
        default=True,
        description="Split markdown by headers for semantic boundaries"
    )
    min_chunk_size: int = Field(
        default=100,
        description="Minimum chunk size to include"
    )
    max_chunk_size: int = Field(
        default=2000,
        description="Maximum chunk size (hard limit)"
    )


class WatchdogConfig(BaseModel):
    """File monitoring configuration"""

    enabled: bool = Field(
        default=True,
        description="Enable file system monitoring"
    )
    debounce_seconds: float = Field(
        default=2.0,
        description="Debounce time for file change events"
    )
    patterns: List[str] = Field(
        default=["*.md", "*.py", "*.txt", "*.json"],
        description="File patterns to monitor"
    )
    ignore_patterns: List[str] = Field(
        default=[".*", "__pycache__", "*.pyc", "*.egg-info"],
        description="Patterns to ignore"
    )


class RAGConfig(BaseModel):
    """Main RAG system configuration"""

    enabled: bool = Field(
        default=True,
        description="Enable RAG system"
    )
    knowledge_base_path: Optional[str] = Field(
        default=None,
        description="Path to knowledge base. Defaults to built-in libraries/"
    )
    qdrant: QdrantConfig = Field(default_factory=QdrantConfig)
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    chunking: ChunkingConfig = Field(default_factory=ChunkingConfig)
    watchdog: WatchdogConfig = Field(default_factory=WatchdogConfig)

    # Retrieval settings
    top_k: int = Field(
        default=5,
        description="Number of chunks to retrieve"
    )
    score_threshold: float = Field(
        default=0.3,
        description="Minimum similarity score threshold"
    )
    max_context_tokens: int = Field(
        default=1500,
        description="Maximum tokens for RAG context injection"
    )

    def is_enabled(self) -> bool:
        """Check if RAG is enabled with environment variable override"""
        env_enabled = os.environ.get("HDSP_RAG_ENABLED", "").lower()
        if env_enabled in ("false", "0", "no"):
            return False
        if env_enabled in ("true", "1", "yes"):
            return True
        return self.enabled

    def get_knowledge_base_path(self) -> Optional[str]:
        """Get knowledge base path with environment variable support"""
        # Environment variable takes precedence
        env_path = os.environ.get("HDSP_KNOWLEDGE_PATH")
        if env_path:
            return os.path.expanduser(env_path)
        if self.knowledge_base_path:
            return os.path.expanduser(self.knowledge_base_path)
        return None  # Will use built-in default


# ============ API Request/Response Models ============


class SearchRequest(BaseModel):
    """Request body for explicit RAG search"""

    query: str = Field(
        description="Search query"
    )
    top_k: Optional[int] = Field(
        default=None,
        description="Override default top_k"
    )
    filters: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Metadata filters (e.g., {'source_type': 'library'})"
    )
    include_score: bool = Field(
        default=True,
        description="Include relevance scores in results"
    )


class SearchResult(BaseModel):
    """Single search result"""

    content: str = Field(
        description="Chunk content"
    )
    score: float = Field(
        description="Relevance score (0-1)"
    )
    metadata: Dict[str, Any] = Field(
        description="Chunk metadata (source, type, etc.)"
    )


class SearchResponse(BaseModel):
    """Response body for RAG search"""

    results: List[SearchResult] = Field(
        description="Search results sorted by relevance"
    )
    query: str = Field(
        description="Original query"
    )
    total_results: int = Field(
        description="Total matching chunks"
    )


class IndexStatusResponse(BaseModel):
    """Response body for index status"""

    ready: bool = Field(
        description="Whether RAG system is ready"
    )
    total_documents: int = Field(
        default=0,
        description="Total indexed documents"
    )
    total_chunks: int = Field(
        default=0,
        description="Total indexed chunks"
    )
    last_updated: Optional[str] = Field(
        default=None,
        description="Last index update timestamp"
    )
    knowledge_base_path: Optional[str] = Field(
        default=None,
        description="Current knowledge base path"
    )


class ReindexRequest(BaseModel):
    """Request body for manual reindexing"""

    force: bool = Field(
        default=False,
        description="Force full reindex even if files unchanged"
    )
    path: Optional[str] = Field(
        default=None,
        description="Specific file or directory to reindex"
    )


class ReindexResponse(BaseModel):
    """Response body for reindex operation"""

    success: bool = Field(
        description="Whether reindex completed successfully"
    )
    indexed: int = Field(
        description="Number of files indexed"
    )
    skipped: int = Field(
        description="Number of files skipped (unchanged)"
    )
    errors: List[Dict[str, str]] = Field(
        default=[],
        description="List of indexing errors"
    )


# ============ Debug Models ============


class ChunkDebugInfo(BaseModel):
    """Chunk detail score information for debugging"""

    chunk_id: str
    content_preview: str  # First 200 chars
    score: float  # Vector similarity score (0-1)
    rank: int  # Ranking
    metadata: Dict[str, Any]  # source, section etc.
    passed_threshold: bool  # Whether threshold passed


class LibraryDetectionDebug(BaseModel):
    """Library detection phase debug information"""

    input_query: str
    imported_libraries: List[str]
    available_libraries: List[str]
    detected_libraries: List[str]
    detection_method: str


class SearchConfigDebug(BaseModel):
    """Search configuration information"""

    top_k: int
    score_threshold: float
    max_context_tokens: int


class DebugSearchRequest(BaseModel):
    """Debug search request"""

    query: str = Field(description="Search query for debugging")
    imported_libraries: List[str] = Field(
        default=[], description="List of imported libraries to filter search"
    )
    top_k: Optional[int] = Field(default=None, description="Override default top_k")
    include_full_content: bool = Field(
        default=False, description="Include full content instead of preview"
    )
    simulate_plan_context: bool = Field(
        default=True, description="Generate formatted context as in plan generation"
    )


class DebugSearchResponse(BaseModel):
    """Debug search response"""

    library_detection: LibraryDetectionDebug
    config: SearchConfigDebug
    chunks: List[ChunkDebugInfo]
    total_candidates: int
    total_passed_threshold: int
    search_ms: float  # Vector search time in milliseconds
    formatted_context: str
    context_char_count: int
    estimated_context_tokens: int


# ============ Factory Functions ============


def get_default_rag_config() -> RAGConfig:
    """Get default RAG configuration with environment variable overrides"""
    return RAGConfig(
        enabled=True,
        qdrant=QdrantConfig(mode="local"),
        embedding=EmbeddingConfig(
            model_name="intfloat/multilingual-e5-small",
            device="cpu"
        ),
        chunking=ChunkingConfig(),
        watchdog=WatchdogConfig()
    )
