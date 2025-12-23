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
]
