"""
RAG Middleware

Injects relevant context from the RAG system before model calls.
Uses the existing RAG manager to retrieve relevant documentation
and code examples based on the user's request.
"""

import logging
from typing import Any, Dict, List, Optional

from agent_server.langchain.state import AgentRuntime, AgentState

logger = logging.getLogger(__name__)


class RAGMiddleware:
    """
    Middleware that injects RAG context before model calls.
    
    This middleware:
    1. Detects required libraries from the user request
    2. Queries the RAG system for relevant documentation
    3. Injects the context into the agent state
    
    Uses @before_model hook pattern from LangChain middleware.
    """

    def __init__(
        self,
        rag_manager: Any = None,
        library_detector: Any = None,
        max_context_length: int = 4000,
        enabled: bool = True,
    ):
        """
        Initialize RAG middleware.
        
        Args:
            rag_manager: RAGManager instance for context retrieval
            library_detector: LibraryDetector for detecting required libraries
            max_context_length: Maximum context length to inject
            enabled: Whether RAG injection is enabled
        """
        self._rag_manager = rag_manager
        self._library_detector = library_detector
        self._max_context_length = max_context_length
        self._enabled = enabled

    @property
    def name(self) -> str:
        return "RAGMiddleware"

    def _get_rag_manager(self):
        """Lazy load RAG manager if not provided"""
        if self._rag_manager is None:
            try:
                from agent_server.core.rag_manager import get_rag_manager
                self._rag_manager = get_rag_manager()
            except ImportError:
                logger.warning("RAG manager not available")
                return None
        return self._rag_manager

    def _get_library_detector(self):
        """Lazy load library detector if not provided"""
        if self._library_detector is None:
            try:
                from hdsp_agent_core.knowledge.loader import get_library_detector
                self._library_detector = get_library_detector()
            except ImportError:
                logger.warning("Library detector not available")
                return None
        return self._library_detector

    def _detect_libraries(
        self,
        request: str,
        imported_libraries: List[str],
    ) -> List[str]:
        """Detect required libraries from the request"""
        detector = self._get_library_detector()
        if detector is None:
            return []

        try:
            from hdsp_agent_core.knowledge.loader import get_knowledge_base
            knowledge_base = get_knowledge_base()
            available = knowledge_base.list_available_libraries()

            if not available:
                return []

            detected = detector.detect(
                request=request,
                available_libraries=available,
                imported_libraries=imported_libraries,
            )

            return detected
        except Exception as e:
            logger.warning(f"Library detection failed: {e}")
            return []

    async def _get_rag_context(
        self,
        query: str,
        detected_libraries: List[str],
    ) -> Optional[str]:
        """Get RAG context for the query"""
        rag_manager = self._get_rag_manager()
        if rag_manager is None or not rag_manager.is_ready:
            return None

        try:
            context = await rag_manager.get_context_for_query(
                query=query,
                detected_libraries=detected_libraries,
            )

            if context and len(context) > self._max_context_length:
                context = context[:self._max_context_length] + "\n... (truncated)"

            return context
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")
            return None

    async def before_model(
        self,
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Optional[Dict[str, Any]]:
        """
        Hook called before each model invocation.
        
        Injects RAG context into the state if available.
        
        Args:
            state: Current agent state
            runtime: Agent runtime context
            
        Returns:
            Updated state fields or None
        """
        if not self._enabled:
            return None

        # Skip if context already injected
        if state.get("rag_context"):
            return None

        user_request = state.get("user_request", "")
        if not user_request:
            return None

        # Detect libraries
        notebook_context = state.get("notebook_context", {})
        imported_libs = notebook_context.get("imported_libraries", [])

        detected_libraries = self._detect_libraries(user_request, imported_libs)

        if detected_libraries:
            logger.info(f"Detected libraries: {detected_libraries}")

        # Get RAG context
        rag_context = await self._get_rag_context(user_request, detected_libraries)

        if rag_context:
            logger.info(f"RAG context injected: {len(rag_context)} chars")
            return {
                "rag_context": rag_context,
                "detected_libraries": detected_libraries,
            }

        return {"detected_libraries": detected_libraries}

    def format_context_for_prompt(
        self,
        rag_context: Optional[str],
        detected_libraries: List[str],
    ) -> str:
        """
        Format RAG context for inclusion in the prompt.
        
        Args:
            rag_context: Retrieved RAG context
            detected_libraries: List of detected libraries
            
        Returns:
            Formatted context string
        """
        if not rag_context:
            return ""

        parts = []

        if detected_libraries:
            parts.append(f"## Detected Libraries: {', '.join(detected_libraries)}")

        parts.append("## Relevant Documentation")
        parts.append(rag_context)

        return "\n\n".join(parts)


def create_rag_middleware(
    rag_manager: Any = None,
    max_context_length: int = 4000,
    enabled: bool = True,
) -> RAGMiddleware:
    """
    Factory function to create RAG middleware.
    
    Args:
        rag_manager: Optional RAGManager instance
        max_context_length: Maximum context length
        enabled: Whether to enable RAG
        
    Returns:
        Configured RAGMiddleware instance
    """
    return RAGMiddleware(
        rag_manager=rag_manager,
        max_context_length=max_context_length,
        enabled=enabled,
    )
