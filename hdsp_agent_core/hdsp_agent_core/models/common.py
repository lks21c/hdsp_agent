"""
Common Pydantic models for the HDSP Agent Core

Shared data models used across all agent services.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    """Tool call specification"""

    tool: str = Field(description="Tool name (e.g., 'jupyter_cell', 'file_operation')")
    parameters: Dict[str, Any] = Field(
        default_factory=dict, description="Tool parameters"
    )


class ErrorInfo(BaseModel):
    """Error information structure"""

    type: str = Field(default="runtime", description="Error type")
    message: str = Field(default="", description="Error message")
    traceback: Optional[List[str]] = Field(
        default=None, description="Stack trace lines"
    )


class NotebookContext(BaseModel):
    """Notebook execution context"""

    cellCount: int = Field(default=0, description="Number of cells in notebook")
    importedLibraries: List[str] = Field(
        default_factory=list, description="Already imported libraries"
    )
    definedVariables: List[str] = Field(
        default_factory=list, description="Currently defined variables"
    )
    recentCells: List[Dict[str, Any]] = Field(
        default_factory=list, description="Recent cell contents and outputs"
    )


class APIResponse(BaseModel):
    """Generic API response wrapper"""

    success: bool = Field(default=True)
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ============ LLM Configuration (Client-Provided) ============


class GeminiConfig(BaseModel):
    """Gemini provider configuration"""

    apiKey: str = Field(description="Primary Gemini API key")
    apiKeys: Optional[List[str]] = Field(
        default=None,
        description="Multiple API keys for rate limit rotation (max 10)"
    )
    model: str = Field(default="gemini-2.5-flash", description="Model name")


class OpenAIConfig(BaseModel):
    """OpenAI provider configuration"""

    apiKey: str = Field(description="OpenAI API key")
    model: str = Field(default="gpt-4", description="Model name")


class VLLMConfig(BaseModel):
    """vLLM provider configuration"""

    endpoint: str = Field(default="http://localhost:8000", description="vLLM endpoint")
    apiKey: Optional[str] = Field(default=None, description="Optional API key")
    model: str = Field(default="default", description="Model name")


class LLMConfig(BaseModel):
    """
    LLM configuration provided by the client.
    API keys are managed client-side and passed with each request.
    """

    provider: str = Field(
        default="gemini", description="LLM provider (gemini, openai, vllm)"
    )
    gemini: Optional[GeminiConfig] = Field(default=None, description="Gemini config")
    openai: Optional[OpenAIConfig] = Field(default=None, description="OpenAI config")
    vllm: Optional[VLLMConfig] = Field(default=None, description="vLLM config")
