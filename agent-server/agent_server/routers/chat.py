"""
Chat Router - Chat and streaming endpoints

Handles conversational interactions with the LLM.
"""

import json
import logging
import uuid
from typing import Any, AsyncGenerator, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent_server.core.config_manager import ConfigManager
from agent_server.core.llm_service import LLMService
from agent_server.core.session_manager import get_session_manager
from agent_server.schemas.chat import ChatRequest, ChatResponse

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_config() -> Dict[str, Any]:
    """Get current configuration"""
    return ConfigManager.get_instance().get_config()


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
        config = _get_config()

        if not config or not config.get("provider"):
            raise HTTPException(
                status_code=400,
                detail="LLM not configured. Please configure your LLM provider.",
            )

        # Get or create conversation
        conversation_id = _get_or_create_conversation(request.conversationId)

        # Build context from history
        context = _build_context(conversation_id)

        # Call LLM
        llm_service = LLMService(config)
        response = await llm_service.generate(
            request.message, context=context
        )

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
            config = _get_config()

            if not config or not config.get("provider"):
                yield f"data: {json.dumps({'error': 'LLM not configured'})}\n\n"
                return

            # Get or create conversation
            conversation_id = _get_or_create_conversation(request.conversationId)

            # Build context
            context = _build_context(conversation_id)

            # Stream LLM response
            llm_service = LLMService(config)
            full_response = ""

            async for chunk in llm_service.stream(request.message, context=context):
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
