"""
Chat Router - Chat and streaming endpoints

Handles conversational interactions with the LLM.
"""

import json
import logging
from typing import Any, AsyncGenerator, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from hdsp_agent_core.managers.config_manager import ConfigManager
from hdsp_agent_core.managers.session_manager import get_session_manager
from hdsp_agent_core.models.chat import ChatRequest, ChatResponse

from agent_server.core.llm_service import LLMService

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_config() -> Dict[str, Any]:
    """Get current configuration (fallback only)"""
    return ConfigManager.get_instance().get_config()


def _build_llm_config(llm_config) -> Dict[str, Any]:
    """
    Build LLM config dict from client-provided LLMConfig.
    Falls back to server config if not provided.
    """
    if llm_config is None:
        return _get_config()

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


def _get_or_create_conversation(conversation_id: str | None) -> str:
    """Get existing conversation or create new one"""
    session_manager = get_session_manager()
    session = session_manager.get_or_create_session(conversation_id)
    return session.id


def _build_context(conversation_id: str, max_messages: int = 5) -> str | None:
    """Build conversation context from history"""
    session_manager = get_session_manager()
    return session_manager.build_context(conversation_id, max_messages)


def _store_messages(
    conversation_id: str, user_message: str, assistant_response: str
) -> None:
    """Store user and assistant messages in conversation history"""
    session_manager = get_session_manager()
    session_manager.store_messages(conversation_id, user_message, assistant_response)


@router.post("/message", response_model=ChatResponse)
async def chat_message(request: ChatRequest) -> Dict[str, Any]:
    """
    Send a chat message and get a response.

    Maintains conversation context across messages using conversation ID.
    """
    logger.info(f"Chat message received: {request.message[:100]}...")

    if not request.message:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        # Use client-provided config or fallback to server config
        config = _build_llm_config(request.llmConfig)

        if not config or not config.get("provider"):
            raise HTTPException(
                status_code=400,
                detail="LLM not configured. Please provide llmConfig with API keys.",
            )

        # Get or create conversation
        conversation_id = _get_or_create_conversation(request.conversationId)

        # Build context from history
        context = _build_context(conversation_id)

        # Call LLM with client-provided config
        llm_service = LLMService(config)
        response = await llm_service.generate_response(request.message, context=context)

        # Store messages
        _store_messages(conversation_id, request.message, response)

        # Get model info
        provider = config.get("provider", "unknown")
        model = config.get(provider, {}).get("model", "unknown")

        return {
            "response": response,
            "conversationId": conversation_id,
            "model": f"{provider}/{model}",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """
    Send a chat message and get a streaming response.

    Returns Server-Sent Events (SSE) with partial responses.
    """
    logger.info(f"Stream chat request: {request.message[:100]}...")

    if not request.message:
        raise HTTPException(status_code=400, detail="message is required")

    async def generate() -> AsyncGenerator[str, None]:
        try:
            # Use client-provided config or fallback to server config
            config = _build_llm_config(request.llmConfig)

            if not config or not config.get("provider"):
                yield f"data: {json.dumps({'error': 'LLM not configured. Please provide llmConfig with API keys.'})}\n\n"
                return

            # Get or create conversation
            conversation_id = _get_or_create_conversation(request.conversationId)

            # Build context
            context = _build_context(conversation_id)

            # Stream LLM response with client-provided config
            llm_service = LLMService(config)
            full_response = ""

            async for chunk in llm_service.generate_response_stream(
                request.message, context=context
            ):
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk, 'done': False})}\n\n"

            # Store messages after streaming complete
            _store_messages(conversation_id, request.message, full_response)

            # Send final chunk with conversation ID
            yield f"data: {json.dumps({'content': '', 'done': True, 'conversationId': conversation_id})}\n\n"

        except Exception as e:
            logger.error(f"Stream chat failed: {e}", exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
