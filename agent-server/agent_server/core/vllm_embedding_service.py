"""
vLLM Embedding Service - Remote embedding generation using vLLM server.

Features:
- GPU-accelerated embeddings via vLLM server
- OpenAI-compatible API interface
- Retry logic for reliability
- Support for large models (qwen3-embedding-8b, gte-Qwen2-7B, etc.)

Prerequisites:
- vLLM embedding server running (e.g., http://10.222.52.31:8000)
- Model loaded on vLLM server
"""

import logging
import os
from typing import TYPE_CHECKING, List, Optional

import httpx
import time

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import EmbeddingConfig

logger = logging.getLogger(__name__)


class VLLMEmbeddingService:
    """
    Remote embedding generation using vLLM server.

    Design Principles:
    - Stateless client (vLLM server holds the model)
    - Retry logic for network resilience
    - OpenAI-compatible API interface

    Usage:
        service = get_vllm_embedding_service()
        embeddings = service.embed_texts(["text1", "text2"])
        query_embedding = service.embed_query("search query")
    """

    _instance: Optional["VLLMEmbeddingService"] = None
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

        # vLLM configuration from environment variables
        self._endpoint = os.environ.get("HDSP_VLLM_ENDPOINT", "http://localhost:8000")
        self._model = os.environ.get("HDSP_VLLM_MODEL", "qwen3-embedding-8b")
        self._dimension = int(os.environ.get("HDSP_VLLM_DIMENSION", "8192"))

        # HTTP client with retry
        self._client = httpx.AsyncClient(
            base_url=self._endpoint,
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )

        logger.info(
            f"vLLM Embedding Service initialized: "
            f"endpoint={self._endpoint}, model={self._model}, dim={self._dimension}"
        )

    @property
    def dimension(self) -> int:
        """Get embedding dimension"""
        return self._dimension

    async def _call_vllm_api(self, texts: List[str], max_retries: int = 3) -> List[List[float]]:
        """
        Call vLLM embedding API with retry logic.

        Args:
            texts: List of text strings to embed
            max_retries: Maximum number of retry attempts

        Returns:
            List of embedding vectors

        Raises:
            Exception if all retries fail
        """
        payload = {
            "model": self._model,
            "input": texts,
        }

        last_error = None
        for attempt in range(max_retries):
            try:
                response = await self._client.post("/v1/embeddings", json=payload)
                response.raise_for_status()

                data = response.json()
                # Sort by index to ensure correct order
                sorted_items = sorted(data["data"], key=lambda x: x["index"])
                embeddings = [item["embedding"] for item in sorted_items]
                return embeddings

            except httpx.HTTPStatusError as e:
                last_error = e
                logger.warning(
                    f"vLLM API HTTP error (attempt {attempt + 1}/{max_retries}): "
                    f"{e.response.status_code} - {e.response.text}"
                )
            except httpx.RequestError as e:
                last_error = e
                logger.warning(
                    f"vLLM API connection error (attempt {attempt + 1}/{max_retries}): {e}"
                )
            except Exception as e:
                last_error = e
                logger.error(f"Unexpected error calling vLLM API: {e}")
                break

        raise Exception(f"Failed to connect to vLLM after {max_retries} attempts: {last_error}")

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts (documents/passages).

        Args:
            texts: List of text strings to embed

        Returns:
            List of embedding vectors (as lists of floats)
        """
        if not texts:
            return []

        try:
            return await self._call_vllm_api(texts)
        except Exception as e:
            logger.error(f"Failed to generate embeddings via vLLM: {e}")
            raise

    async def embed_query(self, query: str) -> List[float]:
        """
        Generate embedding for a single query.

        Args:
            query: Query string

        Returns:
            Embedding vector as list of floats
        """
        if not query:
            raise ValueError("Query cannot be empty")

        try:
            embeddings = await self._call_vllm_api([query])
            return embeddings[0]
        except Exception as e:
            logger.error(f"Failed to generate query embedding via vLLM: {e}")
            raise

    async def embed_batch(
        self, texts: List[str], batch_size: Optional[int] = None
    ) -> List[List[float]]:
        """
        Generate embeddings with batching for large document sets.

        Args:
            texts: List of text strings to embed
            batch_size: Override default batch size (for vLLM, can handle large batches)

        Returns:
            List of embedding vectors
        """
        if not texts:
            return []

        # vLLM can handle large batches efficiently
        effective_batch_size = batch_size or 100
        all_embeddings = []

        for i in range(0, len(texts), effective_batch_size):
            batch = texts[i : i + effective_batch_size]
            embeddings = await self._call_vllm_api(batch)
            all_embeddings.extend(embeddings)

        return all_embeddings

    def get_model_info(self) -> dict:
        """Get information about the vLLM embedding service"""
        return {
            "backend": "vllm",
            "endpoint": self._endpoint,
            "model_name": self._model,
            "dimension": self._dimension,
        }

    async def close(self):
        """Close HTTP client connection"""
        await self._client.aclose()


# ============ Singleton Accessor ============

_vllm_embedding_service: Optional[VLLMEmbeddingService] = None


def get_vllm_embedding_service(
    config: Optional["EmbeddingConfig"] = None,
) -> VLLMEmbeddingService:
    """
    Get the singleton VLLMEmbeddingService instance.

    Args:
        config: Optional EmbeddingConfig (only used on first call)

    Returns:
        VLLMEmbeddingService singleton instance
    """
    global _vllm_embedding_service
    if _vllm_embedding_service is None:
        _vllm_embedding_service = VLLMEmbeddingService(config)
    return _vllm_embedding_service


def reset_vllm_embedding_service() -> None:
    """
    Reset the singleton instance (for testing purposes).
    """
    global _vllm_embedding_service
    if _vllm_embedding_service is not None:
        _vllm_embedding_service._initialized = False
        _vllm_embedding_service = None
    VLLMEmbeddingService._instance = None
    VLLMEmbeddingService._initialized = False