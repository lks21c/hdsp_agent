"""
Chat Service Implementations

Embedded and Proxy implementations of IChatService.
"""

import json
import logging
from typing import Any, AsyncGenerator, Dict, Optional

import httpx

from hdsp_agent_core.interfaces import IChatService
from hdsp_agent_core.llm import LLMService
from hdsp_agent_core.managers import get_config_manager, get_session_manager
from hdsp_agent_core.models.chat import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)


class EmbeddedChatService(IChatService):
    """
    Embedded implementation of Chat Service.

    Executes chat logic directly in-process without HTTP calls.
    Used in development mode (HDSP_AGENT_MODE=embedded).
    """

    def __init__(self):
        """Initialize embedded chat service"""
        self._config_manager = get_config_manager()
        self._session_manager = get_session_manager()
        logger.info("EmbeddedChatService initialized")

    def _get_config(self) -> Dict[str, Any]:
        """Get current LLM configuration"""
        return self._config_manager.get_config()

    def _build_llm_config(self, llm_config) -> Dict[str, Any]:
        """Build LLM config dict from client-provided config"""
        if llm_config is None:
            return self._get_config()

        config = {"provider": llm_config.provider}

        if llm_config.gemini:
            config["gemini"] = {
                "apiKey": llm_config.gemini.apiKey,
                "model": llm_config.gemini.model,
            }

        if llm_config.openai:
            config["openai"] = {
                "apiKey": llm_config.openai.apiKey,
                "model": llm_config.openai.model,
            }

        if llm_config.vllm:
            config["vllm"] = {
                "endpoint": llm_config.vllm.endpoint,
                "apiKey": llm_config.vllm.apiKey,
                "model": llm_config.vllm.model,
            }

        return config

    def _get_or_create_conversation(self, conversation_id: Optional[str]) -> str:
        """Get existing conversation or create new one"""
        session = self._session_manager.get_or_create_session(conversation_id)
        return session.id

    def _build_context(self, conversation_id: str, max_messages: int = 5) -> Optional[str]:
        """Build conversation context from history"""
        return self._session_manager.build_context(conversation_id, max_messages)

    def _store_messages(
        self, conversation_id: str, user_message: str, assistant_response: str
    ) -> None:
        """Store user and assistant messages in conversation history"""
        self._session_manager.store_messages(
            conversation_id, user_message, assistant_response
        )

    async def send_message(self, request: ChatRequest) -> ChatResponse:
        """Send a chat message and get a response"""
        logger.info(f"[Embedded] Chat message: {request.message[:100]}...")

        config = self._build_llm_config(request.llmConfig)

        if not config or not config.get("provider"):
            raise ValueError("LLM not configured. Please provide llmConfig with API keys.")

        # Get or create conversation
        conversation_id = self._get_or_create_conversation(request.conversationId)

        # Build context from history
        context = self._build_context(conversation_id)

        # Call LLM
        llm_service = LLMService(config)
        response = await llm_service.generate_response(
            request.message, context=context
        )

        # Store messages
        self._store_messages(conversation_id, request.message, response)

        # Get model info
        provider = config.get("provider", "unknown")
        model = config.get(provider, {}).get("model", "unknown")

        return ChatResponse(
            response=response,
            conversationId=conversation_id,
            model=f"{provider}/{model}",
        )

    async def send_message_stream(
        self, request: ChatRequest
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Send a chat message and get a streaming response"""
        logger.info(f"[Embedded] Chat stream: {request.message[:100]}...")

        config = self._build_llm_config(request.llmConfig)

        if not config or not config.get("provider"):
            yield {"error": "LLM not configured. Please provide llmConfig with API keys."}
            return

        # Get or create conversation
        conversation_id = self._get_or_create_conversation(request.conversationId)

        # Build context
        context = self._build_context(conversation_id)

        # Stream LLM response
        llm_service = LLMService(config)
        full_response = ""

        try:
            async for chunk in llm_service.generate_response_stream(
                request.message, context=context
            ):
                full_response += chunk
                yield {"content": chunk, "done": False}

            # Store messages after streaming complete
            self._store_messages(conversation_id, request.message, full_response)

            # Send final chunk
            yield {"content": "", "done": True, "conversationId": conversation_id}

        except Exception as e:
            logger.error(f"Stream chat failed: {e}", exc_info=True)
            yield {"error": str(e)}


class ProxyChatService(IChatService):
    """
    Proxy implementation of Chat Service.

    Forwards requests to external agent server via HTTP.
    Used in production mode (HDSP_AGENT_MODE=proxy).
    """

    def __init__(self, base_url: str, timeout: float = 120.0):
        """Initialize proxy chat service"""
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        logger.info(f"ProxyChatService initialized (server: {self._base_url})")

    async def send_message(self, request: ChatRequest) -> ChatResponse:
        """Send message via proxy"""
        logger.info(f"[Proxy] Chat message: {request.message[:100]}...")

        url = f"{self._base_url}/chat/message"
        data = request.model_dump(mode="json")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(url, json=data)
            response.raise_for_status()
            result = response.json()

        return ChatResponse(**result)

    async def send_message_stream(
        self, request: ChatRequest
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Send message and stream response via proxy"""
        logger.info(f"[Proxy] Chat stream: {request.message[:100]}...")

        url = f"{self._base_url}/chat/stream"
        data = request.model_dump(mode="json")

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            async with client.stream("POST", url, json=data) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            chunk_data = json.loads(line[6:])
                            yield chunk_data
                        except json.JSONDecodeError:
                            continue
