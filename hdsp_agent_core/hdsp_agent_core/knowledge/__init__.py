"""
HDSP Agent Core - Knowledge Base

Deterministic library detection and API guide management.
"""

from .loader import (
    KnowledgeBase,
    KnowledgeLoader,
    LibraryDetector,
    get_knowledge_base,
    get_knowledge_loader,
    get_library_detector,
    LIBRARY_DESCRIPTIONS,
)
from .chunking import (
    DocumentChunker,
    chunk_file,
)
from .collection_index import (
    CollectionIndex,
    CollectionInfo,
    get_collection_index,
    reset_collection_index,
)

__all__ = [
    "KnowledgeBase",
    "KnowledgeLoader",
    "LibraryDetector",
    "get_knowledge_base",
    "get_knowledge_loader",
    "get_library_detector",
    "LIBRARY_DESCRIPTIONS",
    "DocumentChunker",
    "chunk_file",
    "CollectionIndex",
    "CollectionInfo",
    "get_collection_index",
    "reset_collection_index",
]
