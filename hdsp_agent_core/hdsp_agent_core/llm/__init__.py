"""
HDSP Agent Core - LLM Service

Multi-provider LLM interaction abstraction layer.
"""

from .service import LLMService, call_llm, call_llm_stream

__all__ = [
    "LLMService",
    "call_llm",
    "call_llm_stream",
]
