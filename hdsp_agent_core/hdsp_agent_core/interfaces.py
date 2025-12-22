"""
HDSP Agent Core - Service Interfaces

Abstract service interfaces for Embedded/Proxy mode abstraction.
These interfaces define the contract for agent services that can be
implemented either as direct in-process services or HTTP proxies.
"""

from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict, List, Optional

from hdsp_agent_core.models.agent import (
    PlanRequest,
    PlanResponse,
    RefineRequest,
    RefineResponse,
    ReplanRequest,
    ReplanResponse,
)
from hdsp_agent_core.models.chat import ChatRequest, ChatResponse
from hdsp_agent_core.models.rag import SearchRequest, SearchResponse


class IAgentService(ABC):
    """
    Abstract interface for Agent Service.

    Handles plan generation, code refinement, and replanning operations.
    Can be implemented as:
    - EmbeddedAgentService: Direct in-process execution
    - ProxyAgentService: HTTP proxy to external agent server
    """

    @abstractmethod
    async def generate_plan(self, request: PlanRequest) -> PlanResponse:
        """
        Generate an execution plan from a natural language request.

        Args:
            request: Plan generation request with user request and notebook context

        Returns:
            PlanResponse with structured execution plan
        """
        ...

    @abstractmethod
    async def refine_code(self, request: RefineRequest) -> RefineResponse:
        """
        Refine code after an execution error.

        Args:
            request: Refine request with failed step and error information

        Returns:
            RefineResponse with corrected tool calls
        """
        ...

    @abstractmethod
    async def replan(self, request: ReplanRequest) -> ReplanResponse:
        """
        Determine how to handle a failed step.

        Uses error classification to decide on recovery strategy.

        Args:
            request: Replan request with error details and execution context

        Returns:
            ReplanResponse with decision and changes
        """
        ...

    @abstractmethod
    async def validate_code(self, code: str, notebook_context: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Validate code before execution.

        Args:
            code: Python code to validate
            notebook_context: Optional notebook context for validation

        Returns:
            Validation result with issues and dependencies
        """
        ...


class IChatService(ABC):
    """
    Abstract interface for Chat Service.

    Handles conversational interactions with the LLM.
    Can be implemented as:
    - EmbeddedChatService: Direct in-process LLM calls
    - ProxyChatService: HTTP proxy to external chat server
    """

    @abstractmethod
    async def send_message(self, request: ChatRequest) -> ChatResponse:
        """
        Send a chat message and get a response.

        Args:
            request: Chat request with message and optional conversation ID

        Returns:
            ChatResponse with LLM response and conversation ID
        """
        ...

    @abstractmethod
    async def send_message_stream(
        self, request: ChatRequest
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Send a chat message and get a streaming response.

        Args:
            request: Chat request with message and optional conversation ID

        Yields:
            Stream chunks with partial content
        """
        ...


class IRAGService(ABC):
    """
    Abstract interface for RAG Service.

    Handles retrieval-augmented generation operations.
    Can be implemented as:
    - EmbeddedRAGService: Direct in-process RAG with Qdrant
    - ProxyRAGService: HTTP proxy to external RAG server
    """

    @abstractmethod
    async def search(self, request: SearchRequest) -> SearchResponse:
        """
        Search the knowledge base.

        Args:
            request: Search request with query and optional filters

        Returns:
            SearchResponse with matching documents and scores
        """
        ...

    @abstractmethod
    async def get_context_for_query(
        self,
        query: str,
        detected_libraries: Optional[List[str]] = None,
        max_results: int = 5
    ) -> Optional[str]:
        """
        Get formatted context for a query (for prompt injection).

        Args:
            query: User query
            detected_libraries: Libraries detected in the query
            max_results: Maximum number of results to include

        Returns:
            Formatted context string or None if not available
        """
        ...

    @abstractmethod
    def is_ready(self) -> bool:
        """
        Check if the RAG service is ready.

        Returns:
            True if the service is initialized and ready
        """
        ...

    @abstractmethod
    async def get_index_status(self) -> Dict[str, Any]:
        """
        Get the current index status.

        Returns:
            Index status with document count, collections, etc.
        """
        ...

    @abstractmethod
    async def trigger_reindex(self, force: bool = False) -> Dict[str, Any]:
        """
        Trigger a reindex operation.

        Args:
            force: If True, force full reindex even if not necessary

        Returns:
            Reindex operation status
        """
        ...
