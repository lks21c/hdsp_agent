"""
HDSP Agent Core - Service Factory

ServiceFactory for creating Embedded or Proxy service implementations
based on the HDSP_AGENT_MODE environment variable.

Modes:
- embedded: Services run directly in-process (development mode)
- proxy: Services proxy to external agent server via HTTP (production mode)
"""

import logging
import os
from enum import Enum
from typing import Optional

from hdsp_agent_core.interfaces import IAgentService, IChatService, IRAGService

logger = logging.getLogger(__name__)


class AgentMode(Enum):
    """Agent execution mode"""
    EMBEDDED = "embedded"  # Direct in-process execution
    PROXY = "proxy"        # HTTP proxy to external server


class ServiceFactory:
    """
    Factory for creating service instances based on execution mode.

    Singleton pattern ensures consistent service instances across the application.

    Usage:
        factory = ServiceFactory.get_instance()
        await factory.initialize()

        agent_service = factory.get_agent_service()
        chat_service = factory.get_chat_service()
        rag_service = factory.get_rag_service()

    Environment Variables:
        HDSP_AGENT_MODE: "embedded" or "proxy" (default: "proxy")
        AGENT_SERVER_URL: URL for proxy mode (default: "http://localhost:8000")
        AGENT_SERVER_TIMEOUT: HTTP timeout in seconds (default: 120.0)
    """

    _instance: Optional["ServiceFactory"] = None

    def __init__(self):
        """Initialize factory (use get_instance() instead)"""
        self._mode = self._detect_mode()
        self._initialized = False

        # Service instances (lazy loaded)
        self._agent_service: Optional[IAgentService] = None
        self._chat_service: Optional[IChatService] = None
        self._rag_service: Optional[IRAGService] = None

        # Proxy configuration
        self._server_url = os.environ.get("AGENT_SERVER_URL", "http://localhost:8000")
        self._timeout = float(os.environ.get("AGENT_SERVER_TIMEOUT", "120.0"))

        logger.info(f"ServiceFactory created with mode: {self._mode.value}")

    @classmethod
    def get_instance(cls) -> "ServiceFactory":
        """Get singleton factory instance"""
        if cls._instance is None:
            cls._instance = ServiceFactory()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton instance (for testing)"""
        cls._instance = None

    def _detect_mode(self) -> AgentMode:
        """Detect execution mode from environment variable"""
        mode_str = os.environ.get("HDSP_AGENT_MODE", "proxy").lower()

        if mode_str == "embedded":
            return AgentMode.EMBEDDED
        elif mode_str == "proxy":
            return AgentMode.PROXY
        else:
            logger.warning(
                f"Unknown HDSP_AGENT_MODE '{mode_str}', defaulting to proxy"
            )
            return AgentMode.PROXY

    @property
    def mode(self) -> AgentMode:
        """Get current execution mode"""
        return self._mode

    @property
    def is_embedded(self) -> bool:
        """Check if running in embedded mode"""
        return self._mode == AgentMode.EMBEDDED

    @property
    def is_proxy(self) -> bool:
        """Check if running in proxy mode"""
        return self._mode == AgentMode.PROXY

    @property
    def is_initialized(self) -> bool:
        """Check if factory has been initialized"""
        return self._initialized

    @property
    def server_url(self) -> str:
        """Get agent server URL (for proxy mode)"""
        return self._server_url

    @property
    def timeout(self) -> float:
        """Get HTTP timeout (for proxy mode)"""
        return self._timeout

    async def initialize(self) -> None:
        """
        Initialize all services based on current mode.

        For embedded mode: Initializes RAG manager, loads knowledge base
        For proxy mode: Validates server connectivity
        """
        if self._initialized:
            logger.debug("ServiceFactory already initialized")
            return

        logger.info(f"Initializing ServiceFactory in {self._mode.value} mode")

        if self.is_embedded:
            await self._initialize_embedded_services()
        else:
            await self._initialize_proxy_services()

        self._initialized = True
        logger.info(f"ServiceFactory initialization complete ({self._mode.value} mode)")

    async def _initialize_embedded_services(self) -> None:
        """Initialize services for embedded mode"""
        from hdsp_agent_core.services.agent_service import EmbeddedAgentService
        from hdsp_agent_core.services.chat_service import EmbeddedChatService
        from hdsp_agent_core.services.rag_service import EmbeddedRAGService

        # Create service instances
        self._agent_service = EmbeddedAgentService()
        self._chat_service = EmbeddedChatService()
        self._rag_service = EmbeddedRAGService()

        # Initialize RAG service (may need async initialization)
        await self._rag_service.initialize()

        logger.info("Embedded services initialized")

    async def _initialize_proxy_services(self) -> None:
        """Initialize services for proxy mode"""
        from hdsp_agent_core.services.agent_service import ProxyAgentService
        from hdsp_agent_core.services.chat_service import ProxyChatService
        from hdsp_agent_core.services.rag_service import ProxyRAGService

        # Create proxy service instances
        self._agent_service = ProxyAgentService(
            base_url=self._server_url,
            timeout=self._timeout
        )
        self._chat_service = ProxyChatService(
            base_url=self._server_url,
            timeout=self._timeout
        )
        self._rag_service = ProxyRAGService(
            base_url=self._server_url,
            timeout=self._timeout
        )

        # Optionally validate connectivity
        # await self._validate_server_connectivity()

        logger.info(f"Proxy services initialized (server: {self._server_url})")

    async def shutdown(self) -> None:
        """Shutdown all services and cleanup resources"""
        logger.info("Shutting down ServiceFactory")

        # Cleanup RAG service
        if self._rag_service and hasattr(self._rag_service, "shutdown"):
            await self._rag_service.shutdown()

        # Reset service instances
        self._agent_service = None
        self._chat_service = None
        self._rag_service = None
        self._initialized = False

        logger.info("ServiceFactory shutdown complete")

    def get_agent_service(self) -> IAgentService:
        """
        Get the Agent service instance.

        Returns:
            IAgentService implementation based on current mode

        Raises:
            RuntimeError: If factory not initialized
        """
        if not self._initialized:
            raise RuntimeError(
                "ServiceFactory not initialized. Call await factory.initialize() first."
            )
        return self._agent_service

    def get_chat_service(self) -> IChatService:
        """
        Get the Chat service instance.

        Returns:
            IChatService implementation based on current mode

        Raises:
            RuntimeError: If factory not initialized
        """
        if not self._initialized:
            raise RuntimeError(
                "ServiceFactory not initialized. Call await factory.initialize() first."
            )
        return self._chat_service

    def get_rag_service(self) -> IRAGService:
        """
        Get the RAG service instance.

        Returns:
            IRAGService implementation based on current mode

        Raises:
            RuntimeError: If factory not initialized
        """
        if not self._initialized:
            raise RuntimeError(
                "ServiceFactory not initialized. Call await factory.initialize() first."
            )
        return self._rag_service


# Convenience function for getting the singleton factory
def get_service_factory() -> ServiceFactory:
    """Get the singleton ServiceFactory instance"""
    return ServiceFactory.get_instance()
