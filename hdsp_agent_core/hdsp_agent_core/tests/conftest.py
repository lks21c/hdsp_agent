"""
HDSP Agent Core - Test Configuration and Fixtures

Provides pytest fixtures for testing ServiceFactory and service implementations.
"""

import os
from typing import Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def reset_factory():
    """Reset ServiceFactory singleton before each test"""
    from hdsp_agent_core.factory import ServiceFactory
    ServiceFactory.reset_instance()
    yield
    ServiceFactory.reset_instance()


@pytest.fixture
def mock_env_embedded():
    """Set environment to embedded mode"""
    with patch.dict(os.environ, {"HDSP_AGENT_MODE": "embedded"}, clear=False):
        yield


@pytest.fixture
def mock_env_proxy():
    """Set environment to proxy mode"""
    with patch.dict(os.environ, {"HDSP_AGENT_MODE": "proxy"}, clear=False):
        yield


@pytest.fixture
def mock_env_proxy_with_url():
    """Set environment to proxy mode with custom server URL"""
    with patch.dict(
        os.environ,
        {
            "HDSP_AGENT_MODE": "proxy",
            "AGENT_SERVER_URL": "http://agent.example.com:9000",
            "AGENT_SERVER_TIMEOUT": "60.0",
        },
        clear=False,
    ):
        yield


@pytest.fixture
def mock_llm_service():
    """Mock LLM service for testing"""
    mock = MagicMock()
    mock.generate_response = AsyncMock(return_value="mocked response")
    mock.generate_response_stream = AsyncMock()
    return mock


@pytest.fixture
def mock_rag_manager():
    """Mock RAG manager for testing"""
    mock = MagicMock()
    mock.initialize = AsyncMock()
    mock.search = AsyncMock(return_value=[])
    mock.get_context_for_query = AsyncMock(return_value="mocked context")
    mock.is_ready = MagicMock(return_value=True)
    mock.get_index_status = AsyncMock(return_value={"status": "ready"})
    mock.shutdown = AsyncMock()
    return mock


@pytest.fixture
def sample_plan_request():
    """Sample plan request for testing"""
    from hdsp_agent_core.models.agent import PlanRequest
    from hdsp_agent_core.models.common import NotebookContext
    return PlanRequest(
        request="Create a simple plot",
        notebookContext=NotebookContext(),
    )


@pytest.fixture
def sample_chat_request():
    """Sample chat request for testing"""
    from hdsp_agent_core.models.chat import ChatRequest
    return ChatRequest(
        message="Hello, how can I analyze this data?",
        conversationId="test-conversation",
    )


@pytest.fixture
def sample_search_request():
    """Sample search request for testing"""
    from hdsp_agent_core.models.rag import SearchRequest
    return SearchRequest(
        query="pandas dataframe operations",
        top_k=5,
    )
