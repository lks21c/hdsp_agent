"""
Chat API Pydantic models

Models for chat message requests and responses.
"""

from typing import Optional

from pydantic import BaseModel, Field

from .common import LLMConfig


class ChatRequest(BaseModel):
    """Request body for chat messages"""

    message: str = Field(description="User's chat message")
    conversationId: Optional[str] = Field(
        default=None, description="Conversation ID for context continuity"
    )
    llmConfig: Optional[LLMConfig] = Field(
        default=None, description="LLM configuration with API keys (client-provided)"
    )


class ChatResponse(BaseModel):
    """Response body for chat messages"""

    response: str = Field(description="Assistant's response")
    conversationId: str = Field(description="Conversation ID for future messages")
    model: Optional[str] = Field(default=None, description="Model used for response")


class StreamChunk(BaseModel):
    """Single chunk in a streaming response"""

    content: str = Field(description="Partial content")
    done: bool = Field(default=False, description="Whether streaming is complete")
    conversationId: Optional[str] = Field(
        default=None, description="Conversation ID (sent in final chunk)"
    )
