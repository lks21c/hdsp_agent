"""
HDSP Agent Core - ServiceFactory Tests

Tests for ServiceFactory mode detection, initialization, and service creation.
"""

import os
from unittest.mock import AsyncMock, patch

import pytest

from hdsp_agent_core.factory import AgentMode, ServiceFactory, get_service_factory
from hdsp_agent_core.interfaces import IAgentService, IChatService, IRAGService


class TestAgentMode:
    """Tests for AgentMode enum"""

    def test_embedded_mode_value(self):
        """Test embedded mode has correct value"""
        assert AgentMode.EMBEDDED.value == "embedded"

    def test_proxy_mode_value(self):
        """Test proxy mode has correct value"""
        assert AgentMode.PROXY.value == "proxy"


class TestServiceFactorySingleton:
    """Tests for ServiceFactory singleton pattern"""

    def test_get_instance_returns_same_instance(self, reset_factory):
        """Test get_instance returns the same instance"""
        instance1 = ServiceFactory.get_instance()
        instance2 = ServiceFactory.get_instance()
        assert instance1 is instance2

    def test_reset_instance_clears_singleton(self, reset_factory):
        """Test reset_instance clears the singleton"""
        instance1 = ServiceFactory.get_instance()
        ServiceFactory.reset_instance()
        instance2 = ServiceFactory.get_instance()
        assert instance1 is not instance2

    def test_get_service_factory_convenience_function(self, reset_factory):
        """Test get_service_factory returns singleton"""
        factory1 = get_service_factory()
        factory2 = ServiceFactory.get_instance()
        assert factory1 is factory2


class TestServiceFactoryModeDetection:
    """Tests for mode detection from environment"""

    def test_default_mode_is_proxy(self, reset_factory):
        """Test default mode is proxy when no env var set"""
        with patch.dict(os.environ, {}, clear=True):
            # Clear HDSP_AGENT_MODE if it exists
            os.environ.pop("HDSP_AGENT_MODE", None)
            factory = ServiceFactory()
            assert factory.mode == AgentMode.PROXY
            assert factory.is_proxy is True
            assert factory.is_embedded is False

    def test_embedded_mode_detection(self, reset_factory, mock_env_embedded):
        """Test embedded mode is detected from env var"""
        factory = ServiceFactory()
        assert factory.mode == AgentMode.EMBEDDED
        assert factory.is_embedded is True
        assert factory.is_proxy is False

    def test_proxy_mode_detection(self, reset_factory, mock_env_proxy):
        """Test proxy mode is detected from env var"""
        factory = ServiceFactory()
        assert factory.mode == AgentMode.PROXY
        assert factory.is_proxy is True
        assert factory.is_embedded is False

    def test_case_insensitive_mode_detection(self, reset_factory):
        """Test mode detection is case-insensitive"""
        with patch.dict(os.environ, {"HDSP_AGENT_MODE": "EMBEDDED"}):
            factory = ServiceFactory()
            assert factory.mode == AgentMode.EMBEDDED

    def test_invalid_mode_defaults_to_proxy(self, reset_factory):
        """Test invalid mode defaults to proxy"""
        with patch.dict(os.environ, {"HDSP_AGENT_MODE": "invalid_mode"}):
            factory = ServiceFactory()
            assert factory.mode == AgentMode.PROXY


class TestServiceFactoryConfiguration:
    """Tests for proxy mode configuration"""

    def test_default_server_url(self, reset_factory):
        """Test default server URL"""
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("AGENT_SERVER_URL", None)
            factory = ServiceFactory()
            assert factory.server_url == "http://localhost:8000"

    def test_custom_server_url(self, reset_factory, mock_env_proxy_with_url):
        """Test custom server URL from env var"""
        factory = ServiceFactory()
        assert factory.server_url == "http://agent.example.com:9000"

    def test_default_timeout(self, reset_factory):
        """Test default timeout"""
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("AGENT_SERVER_TIMEOUT", None)
            factory = ServiceFactory()
            assert factory.timeout == 120.0

    def test_custom_timeout(self, reset_factory, mock_env_proxy_with_url):
        """Test custom timeout from env var"""
        factory = ServiceFactory()
        assert factory.timeout == 60.0


class TestServiceFactoryInitialization:
    """Tests for ServiceFactory initialization"""

    def test_not_initialized_by_default(self, reset_factory, mock_env_proxy):
        """Test factory is not initialized by default"""
        factory = ServiceFactory.get_instance()
        assert factory.is_initialized is False

    @pytest.mark.asyncio
    async def test_initialize_proxy_mode(self, reset_factory, mock_env_proxy):
        """Test initialization in proxy mode"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        assert factory.is_initialized is True

    @pytest.mark.asyncio
    async def test_initialize_embedded_mode(self, reset_factory, mock_env_embedded):
        """Test initialization in embedded mode"""
        # Mock the RAG service initialization
        with patch(
            "hdsp_agent_core.services.rag_service.EmbeddedRAGService.initialize",
            new_callable=AsyncMock
        ):
            factory = ServiceFactory.get_instance()
            await factory.initialize()
            assert factory.is_initialized is True

    @pytest.mark.asyncio
    async def test_double_initialization_is_noop(self, reset_factory, mock_env_proxy):
        """Test calling initialize twice is safe"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        await factory.initialize()  # Should not raise
        assert factory.is_initialized is True

    @pytest.mark.asyncio
    async def test_shutdown_resets_state(self, reset_factory, mock_env_proxy):
        """Test shutdown resets initialization state"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        assert factory.is_initialized is True
        await factory.shutdown()
        assert factory.is_initialized is False


class TestServiceFactoryServiceAccess:
    """Tests for service accessor methods"""

    @pytest.mark.asyncio
    async def test_get_agent_service_after_init(self, reset_factory, mock_env_proxy):
        """Test get_agent_service returns service after init"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        service = factory.get_agent_service()
        assert service is not None
        assert isinstance(service, IAgentService)

    @pytest.mark.asyncio
    async def test_get_chat_service_after_init(self, reset_factory, mock_env_proxy):
        """Test get_chat_service returns service after init"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        service = factory.get_chat_service()
        assert service is not None
        assert isinstance(service, IChatService)

    @pytest.mark.asyncio
    async def test_get_rag_service_after_init(self, reset_factory, mock_env_proxy):
        """Test get_rag_service returns service after init"""
        factory = ServiceFactory.get_instance()
        await factory.initialize()
        service = factory.get_rag_service()
        assert service is not None
        assert isinstance(service, IRAGService)

    def test_get_agent_service_before_init_raises(self, reset_factory, mock_env_proxy):
        """Test get_agent_service raises before initialization"""
        factory = ServiceFactory.get_instance()
        with pytest.raises(RuntimeError, match="not initialized"):
            factory.get_agent_service()

    def test_get_chat_service_before_init_raises(self, reset_factory, mock_env_proxy):
        """Test get_chat_service raises before initialization"""
        factory = ServiceFactory.get_instance()
        with pytest.raises(RuntimeError, match="not initialized"):
            factory.get_chat_service()

    def test_get_rag_service_before_init_raises(self, reset_factory, mock_env_proxy):
        """Test get_rag_service raises before initialization"""
        factory = ServiceFactory.get_instance()
        with pytest.raises(RuntimeError, match="not initialized"):
            factory.get_rag_service()


class TestServiceFactoryModeSpecificServices:
    """Tests for mode-specific service creation"""

    @pytest.mark.asyncio
    async def test_proxy_mode_creates_proxy_services(
        self, reset_factory, mock_env_proxy
    ):
        """Test proxy mode creates ProxyXxxService instances"""
        from hdsp_agent_core.services.agent_service import ProxyAgentService
        from hdsp_agent_core.services.chat_service import ProxyChatService
        from hdsp_agent_core.services.rag_service import ProxyRAGService

        factory = ServiceFactory.get_instance()
        await factory.initialize()

        assert isinstance(factory.get_agent_service(), ProxyAgentService)
        assert isinstance(factory.get_chat_service(), ProxyChatService)
        assert isinstance(factory.get_rag_service(), ProxyRAGService)

    @pytest.mark.asyncio
    async def test_embedded_mode_creates_embedded_services(
        self, reset_factory, mock_env_embedded
    ):
        """Test embedded mode creates EmbeddedXxxService instances"""
        from hdsp_agent_core.services.agent_service import EmbeddedAgentService
        from hdsp_agent_core.services.chat_service import EmbeddedChatService
        from hdsp_agent_core.services.rag_service import EmbeddedRAGService

        # Mock RAG initialization
        with patch(
            "hdsp_agent_core.services.rag_service.EmbeddedRAGService.initialize",
            new_callable=AsyncMock
        ):
            factory = ServiceFactory.get_instance()
            await factory.initialize()

            assert isinstance(factory.get_agent_service(), EmbeddedAgentService)
            assert isinstance(factory.get_chat_service(), EmbeddedChatService)
            assert isinstance(factory.get_rag_service(), EmbeddedRAGService)
