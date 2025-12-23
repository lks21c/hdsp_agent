"""
Agent Server API Schemas

Re-export from hdsp_agent_core.models for backward compatibility.
"""

from hdsp_agent_core.models.agent import (
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
from hdsp_agent_core.models.chat import (
    ChatRequest,
    ChatResponse,
    StreamChunk,
)
from hdsp_agent_core.models.common import (
    APIResponse,
    ErrorInfo,
    NotebookContext,
    ToolCall,
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
