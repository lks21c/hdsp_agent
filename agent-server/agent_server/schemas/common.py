"""
Common Pydantic models for the Agent Server API
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
