"""
Shell command tool for LangChain agent.

Execution is handled by the Jupyter extension (client) after HITL approval.
"""

from typing import Any, Dict, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class ExecuteCommandInput(BaseModel):
    """Input schema for execute_command_tool."""

    command: str = Field(description="Shell command to execute")
    stdin: Optional[str] = Field(
        default="y\n",
        description="Input to provide to the command for interactive prompts (default: 'y\\n' for yes/no prompts)",
    )
    timeout: Optional[int] = Field(
        default=600000, description="Timeout in milliseconds"
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None, description="Optional execution result payload from the client"
    )


@tool(args_schema=ExecuteCommandInput)
def execute_command_tool(
    command: str,
    stdin: Optional[str] = "y\n",
    timeout: Optional[int] = 600000,
    execution_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Execute a shell command via the client (Jupyter extension).
    The agent server only coordinates the request. The client performs the
    actual execution after user approval and returns execution_result.

    - Interactive prompts are auto-answered with "y" by default
    - NEVER run long-running commands (servers, watch, dev) or endless processes
    """
    response: Dict[str, Any] = {
        "tool": "execute_command_tool",
        "parameters": {"command": command, "stdin": stdin, "timeout": timeout},
        "status": "pending_execution",
        "message": "Shell command queued for execution by client",
    }
    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "Shell command executed with client-reported results"
    return response
