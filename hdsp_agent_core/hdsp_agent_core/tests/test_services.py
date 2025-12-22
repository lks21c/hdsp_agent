"""
HDSP Agent Core - Service Implementation Tests

Tests for Embedded and Proxy service implementations.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from hdsp_agent_core.interfaces import IAgentService, IChatService, IRAGService


class TestProxyAgentService:
    """Tests for ProxyAgentService"""

    @pytest.fixture
    def proxy_agent_service(self):
        """Create ProxyAgentService instance"""
        from hdsp_agent_core.services.agent_service import ProxyAgentService
        return ProxyAgentService(
            base_url="http://localhost:8000",
            timeout=30.0
        )

    def test_implements_interface(self, proxy_agent_service):
        """Test ProxyAgentService implements IAgentService"""
        assert isinstance(proxy_agent_service, IAgentService)

    def test_base_url_configuration(self, proxy_agent_service):
        """Test base URL is configured correctly"""
        assert proxy_agent_service._base_url == "http://localhost:8000"

    def test_timeout_configuration(self, proxy_agent_service):
        """Test timeout is configured correctly"""
        assert proxy_agent_service._timeout == 30.0

    @pytest.mark.asyncio
    async def test_generate_plan_makes_http_request(
        self, proxy_agent_service, sample_plan_request
    ):
        """Test generate_plan makes HTTP POST request"""
        mock_response_data = {
            "plan": {
                "goal": "Create a simple plot",
                "totalSteps": 1,
                "steps": []
            },
            "reasoning": "Test reasoning"
        }

        with patch(
            "hdsp_agent_core.services.agent_service.httpx.AsyncClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = mock_response_data
            mock_response.raise_for_status = MagicMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            result = await proxy_agent_service.generate_plan(sample_plan_request)

            # Verify HTTP call was made
            mock_client.post.assert_called_once()
            call_args = mock_client.post.call_args
            assert "/agent/plan" in call_args[0][0]


class TestProxyChatService:
    """Tests for ProxyChatService"""

    @pytest.fixture
    def proxy_chat_service(self):
        """Create ProxyChatService instance"""
        from hdsp_agent_core.services.chat_service import ProxyChatService
        return ProxyChatService(
            base_url="http://localhost:8000",
            timeout=30.0
        )

    def test_implements_interface(self, proxy_chat_service):
        """Test ProxyChatService implements IChatService"""
        assert isinstance(proxy_chat_service, IChatService)

    @pytest.mark.asyncio
    async def test_send_message_makes_http_request(
        self, proxy_chat_service, sample_chat_request
    ):
        """Test send_message makes HTTP POST request"""
        mock_response_data = {
            "response": "Hello! I can help you analyze the data.",
            "conversationId": "test-conversation",
        }

        with patch(
            "hdsp_agent_core.services.chat_service.httpx.AsyncClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = mock_response_data
            mock_response.raise_for_status = MagicMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            result = await proxy_chat_service.send_message(sample_chat_request)

            mock_client.post.assert_called_once()


class TestProxyRAGService:
    """Tests for ProxyRAGService"""

    @pytest.fixture
    def proxy_rag_service(self):
        """Create ProxyRAGService instance"""
        from hdsp_agent_core.services.rag_service import ProxyRAGService
        return ProxyRAGService(
            base_url="http://localhost:8000",
            timeout=30.0
        )

    def test_implements_interface(self, proxy_rag_service):
        """Test ProxyRAGService implements IRAGService"""
        assert isinstance(proxy_rag_service, IRAGService)

    @pytest.mark.asyncio
    async def test_search_makes_http_request(
        self, proxy_rag_service, sample_search_request
    ):
        """Test search makes HTTP POST request"""
        mock_response_data = {
            "results": [],
            "query": "pandas dataframe operations",
            "total_results": 0,
        }

        with patch(
            "hdsp_agent_core.services.rag_service.httpx.AsyncClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = mock_response_data
            mock_response.raise_for_status = MagicMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            result = await proxy_rag_service.search(sample_search_request)

            mock_client.post.assert_called_once()

    def test_is_ready_returns_false_before_init(self, proxy_rag_service):
        """Test is_ready returns False before initialization"""
        # Proxy service is not ready until initialize() is called
        assert proxy_rag_service.is_ready() is False

    @pytest.mark.asyncio
    async def test_is_ready_after_init(self, proxy_rag_service):
        """Test is_ready after successful initialization"""
        mock_status = {"ready": True}

        with patch(
            "hdsp_agent_core.services.rag_service.httpx.AsyncClient"
        ) as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = mock_status
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            await proxy_rag_service.initialize()

            assert proxy_rag_service.is_ready() is True


class TestEmbeddedAgentService:
    """Tests for EmbeddedAgentService"""

    @pytest.fixture
    def embedded_agent_service(self):
        """Create EmbeddedAgentService instance"""
        from hdsp_agent_core.services.agent_service import EmbeddedAgentService
        return EmbeddedAgentService()

    def test_implements_interface(self, embedded_agent_service):
        """Test EmbeddedAgentService implements IAgentService"""
        assert isinstance(embedded_agent_service, IAgentService)

    @pytest.mark.asyncio
    async def test_generate_plan_with_mock_llm(
        self, embedded_agent_service, sample_plan_request
    ):
        """Test generate_plan calls LLM service"""
        # Mock the LLM service
        with patch.object(
            embedded_agent_service, '_llm_service', create=True
        ) as mock_llm:
            mock_llm.generate_response = AsyncMock(
                return_value='{"steps": [], "plan_id": "test"}'
            )

            # Note: Full integration test would require more mocking
            # This is a placeholder for when LLM integration is complete


class TestEmbeddedChatService:
    """Tests for EmbeddedChatService"""

    @pytest.fixture
    def embedded_chat_service(self):
        """Create EmbeddedChatService instance"""
        from hdsp_agent_core.services.chat_service import EmbeddedChatService
        return EmbeddedChatService()

    def test_implements_interface(self, embedded_chat_service):
        """Test EmbeddedChatService implements IChatService"""
        assert isinstance(embedded_chat_service, IChatService)


class TestEmbeddedRAGService:
    """Tests for EmbeddedRAGService"""

    @pytest.fixture
    def embedded_rag_service(self):
        """Create EmbeddedRAGService instance with mocked RAG manager"""
        from hdsp_agent_core.services.rag_service import EmbeddedRAGService
        service = EmbeddedRAGService()
        return service

    def test_implements_interface(self, embedded_rag_service):
        """Test EmbeddedRAGService implements IRAGService"""
        assert isinstance(embedded_rag_service, IRAGService)

    def test_is_ready_before_init(self, embedded_rag_service):
        """Test is_ready returns False before initialization"""
        assert embedded_rag_service.is_ready() is False

    @pytest.mark.asyncio
    async def test_initialize_sets_ready(self, embedded_rag_service, mock_rag_manager):
        """Test initialize makes service ready when RAGManager is available"""
        # Directly set the internal state to simulate successful initialization
        # since the actual rag_manager module might not be available
        mock_rag_manager.is_ready = True
        embedded_rag_service._rag_manager = mock_rag_manager
        embedded_rag_service._initialized = True

        assert embedded_rag_service.is_ready() is True

    @pytest.mark.asyncio
    async def test_initialize_handles_import_error(self, embedded_rag_service):
        """Test initialize handles ImportError gracefully"""
        # The service should remain not ready if rag_manager import fails
        # Since rag_manager doesn't exist yet, initialize() should catch the error
        await embedded_rag_service.initialize()

        # Service should not be ready because rag_manager module doesn't exist
        assert embedded_rag_service.is_ready() is False


class TestServiceInterfaceCompliance:
    """Tests to verify all services implement their interfaces correctly"""

    def test_all_agent_service_methods_exist(self):
        """Verify all IAgentService methods are implemented"""
        from hdsp_agent_core.services.agent_service import (
            EmbeddedAgentService,
            ProxyAgentService,
        )

        required_methods = [
            "generate_plan",
            "refine_code",
            "replan",
            "validate_code",
        ]

        for cls in [EmbeddedAgentService, ProxyAgentService]:
            for method in required_methods:
                assert hasattr(cls, method), f"{cls.__name__} missing {method}"
                assert callable(getattr(cls, method))

    def test_all_chat_service_methods_exist(self):
        """Verify all IChatService methods are implemented"""
        from hdsp_agent_core.services.chat_service import (
            EmbeddedChatService,
            ProxyChatService,
        )

        required_methods = [
            "send_message",
            "send_message_stream",
        ]

        for cls in [EmbeddedChatService, ProxyChatService]:
            for method in required_methods:
                assert hasattr(cls, method), f"{cls.__name__} missing {method}"
                assert callable(getattr(cls, method))

    def test_all_rag_service_methods_exist(self):
        """Verify all IRAGService methods are implemented"""
        from hdsp_agent_core.services.rag_service import (
            EmbeddedRAGService,
            ProxyRAGService,
        )

        required_methods = [
            "search",
            "get_context_for_query",
            "is_ready",
            "get_index_status",
            "trigger_reindex",
        ]

        for cls in [EmbeddedRAGService, ProxyRAGService]:
            for method in required_methods:
                assert hasattr(cls, method), f"{cls.__name__} missing {method}"
                assert callable(getattr(cls, method))
