"""
Local Embedding Service - Wraps sentence-transformers for local embedding generation.

Features:
- Zero external API calls (data sovereignty)
- Lazy model loading (only when first needed)
- Thread-safe singleton pattern
- Configurable model and device
- E5 model prefix handling for optimal performance

Default model: intfloat/multilingual-e5-small (384 dimensions, Korean support)
"""

import logging
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import EmbeddingConfig

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Local embedding generation using sentence-transformers.

    Design Principles:
    - No external API calls (data sovereignty)
    - Lazy model loading (only when needed)
    - Thread-safe singleton pattern
    - Configurable model and device

    Usage:
        service = get_embedding_service()
        embeddings = service.embed_texts(["text1", "text2"])
        query_embedding = service.embed_query("search query")
    """

    _instance: Optional["EmbeddingService"] = None
    _initialized: bool = False

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config: Optional["EmbeddingConfig"] = None):
        if self._initialized:
            return
        self._initialized = True

        from hdsp_agent_core.models.rag import EmbeddingConfig

        self._config = config or EmbeddingConfig()
        self._model = None
        self._dimension: Optional[int] = None
        self._is_e5_model: bool = False

    @property
    def model(self):
        """Lazy load the embedding model"""
        if self._model is None:
            self._load_model()
        return self._model

    def _load_model(self) -> None:
        """Load the sentence-transformers model"""
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError(
                "sentence-transformers is required for RAG. "
                "Install with: pip install sentence-transformers"
            )

        model_name = self._config.get_model_name()
        device = self._config.get_device()

        logger.info(f"Loading embedding model: {model_name} on {device}")

        try:
            self._model = SentenceTransformer(
                model_name, device=device, cache_folder=self._config.cache_folder
            )
            self._dimension = self._model.get_sentence_embedding_dimension()

            # Check if E5 model (requires special prefix)
            self._is_e5_model = "e5" in model_name.lower()

            logger.info(
                f"Embedding model loaded successfully. "
                f"Dimension: {self._dimension}, E5 model: {self._is_e5_model}"
            )
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")
            raise

    @property
    def dimension(self) -> int:
        """Get embedding dimension (triggers model load if needed)"""
        if self._dimension is None:
            _ = self.model  # Trigger lazy load
        return self._dimension

    def _prepare_texts(self, texts: List[str], is_query: bool = False) -> List[str]:
        """
        Prepare texts for embedding, adding E5 prefixes if needed.

        E5 models require specific prefixes:
        - "query: " for search queries
        - "passage: " for documents/passages
        """
        if not self._is_e5_model:
            return texts

        prefix = "query: " if is_query else "passage: "
        return [prefix + text for text in texts]

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts (documents/passages).

        Args:
            texts: List of text strings to embed

        Returns:
            List of embedding vectors (as lists of floats)
        """
        if not texts:
            return []

        # Prepare texts with prefix if E5 model
        prepared_texts = self._prepare_texts(texts, is_query=False)

        try:
            embeddings = self.model.encode(
                prepared_texts,
                batch_size=self._config.batch_size,
                show_progress_bar=len(texts) > 100,
                convert_to_numpy=True,
                normalize_embeddings=self._config.normalize_embeddings,
            )
            return embeddings.tolist()
        except Exception as e:
            logger.error(f"Failed to generate embeddings: {e}")
            raise

    def embed_query(self, query: str) -> List[float]:
        """
        Generate embedding for a single query.

        Uses "query: " prefix for E5 models to optimize search retrieval.

        Args:
            query: Query string

        Returns:
            Embedding vector as list of floats
        """
        if not query:
            raise ValueError("Query cannot be empty")

        # Prepare query with prefix if E5 model
        prepared_query = self._prepare_texts([query], is_query=True)[0]

        try:
            embedding = self.model.encode(
                prepared_query,
                convert_to_numpy=True,
                normalize_embeddings=self._config.normalize_embeddings,
            )
            return embedding.tolist()
        except Exception as e:
            logger.error(f"Failed to generate query embedding: {e}")
            raise

    def embed_batch(
        self, texts: List[str], batch_size: Optional[int] = None
    ) -> List[List[float]]:
        """
        Generate embeddings with custom batch size for large document sets.

        Args:
            texts: List of text strings to embed
            batch_size: Override default batch size

        Returns:
            List of embedding vectors
        """
        if not texts:
            return []

        prepared_texts = self._prepare_texts(texts, is_query=False)
        effective_batch_size = batch_size or self._config.batch_size

        try:
            embeddings = self.model.encode(
                prepared_texts,
                batch_size=effective_batch_size,
                show_progress_bar=True,
                convert_to_numpy=True,
                normalize_embeddings=self._config.normalize_embeddings,
            )
            return embeddings.tolist()
        except Exception as e:
            logger.error(f"Failed to generate batch embeddings: {e}")
            raise

    def get_model_info(self) -> dict:
        """Get information about the loaded model"""
        return {
            "model_name": self._config.get_model_name(),
            "dimension": self.dimension,
            "device": self._config.get_device(),
            "is_e5_model": self._is_e5_model,
            "normalize_embeddings": self._config.normalize_embeddings,
            "loaded": self._model is not None,
        }


# ============ Singleton Accessor ============

_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service(
    config: Optional["EmbeddingConfig"] = None,
) -> EmbeddingService:
    """
    Get the singleton EmbeddingService instance.

    Args:
        config: Optional EmbeddingConfig (only used on first call)

    Returns:
        EmbeddingService singleton instance
    """
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService(config)
    return _embedding_service


def reset_embedding_service() -> None:
    """
    Reset the singleton instance (for testing purposes).
    """
    global _embedding_service
    if _embedding_service is not None:
        _embedding_service._initialized = False
        _embedding_service._model = None
        _embedding_service = None
    EmbeddingService._instance = None
    EmbeddingService._initialized = False
