"""
Agent Server API Schemas

Pydantic models for request/response validation.
"""

from .common import (
    APIResponse,
    ErrorInfo,
    NotebookContext,
    ToolCall,
)
from .agent import (
    ExecutionPlan,
    PlanRequest,
    PlanResponse,
    PlanStep,
    RefineRequest,
    RefineResponse,
    ReflectRequest,
    ReflectResponse,
    ReplanRequest,
    ReplanResponse,
    ReportExecutionRequest,
    ReportExecutionResponse,
    VerifyStateRequest,
    VerifyStateResponse,
)
from .chat import (
    ChatRequest,
    ChatResponse,
    StreamChunk,
)

__all__ = [
    # Common
    "APIResponse",
    "ErrorInfo",
    "NotebookContext",
    "ToolCall",
    # Agent
    "ExecutionPlan",
    "PlanRequest",
    "PlanResponse",
    "PlanStep",
    "RefineRequest",
    "RefineResponse",
    "ReflectRequest",
    "ReflectResponse",
    "ReplanRequest",
    "ReplanResponse",
    "ReportExecutionRequest",
    "ReportExecutionResponse",
    "VerifyStateRequest",
    "VerifyStateResponse",
    # Chat
    "ChatRequest",
    "ChatResponse",
    "StreamChunk",
]
