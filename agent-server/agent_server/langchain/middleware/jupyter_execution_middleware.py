"""
Jupyter Execution Middleware

Handles actual execution of code in Jupyter kernel.
Wraps jupyter_cell tool calls to execute code and return results.
"""

import asyncio
import logging
from typing import Any, Callable, Dict, Optional

from agent_server.langchain.executors.jupyter_executor import (
    JupyterExecutor,
    get_jupyter_executor,
)
from agent_server.langchain.state import AgentRuntime, AgentState

logger = logging.getLogger(__name__)


class JupyterExecutionMiddleware:
    """
    Middleware that executes code in Jupyter kernel.
    
    This middleware:
    1. Wraps jupyter_cell and markdown tool calls
    2. Executes code using JupyterExecutor
    3. Returns execution results to the agent
    4. Handles execution errors and timeouts
    
    Uses @wrap_tool_call hook pattern from LangChain middleware.
    """

    def __init__(
        self,
        executor: Optional[JupyterExecutor] = None,
        timeout: float = 60.0,
        add_to_notebook: bool = True,
        enabled: bool = True,
    ):
        """
        Initialize Jupyter execution middleware.
        
        Args:
            executor: JupyterExecutor instance
            timeout: Execution timeout in seconds
            add_to_notebook: Whether to add cells to notebook
            enabled: Whether execution is enabled
        """
        self._executor = executor
        self._timeout = timeout
        self._add_to_notebook = add_to_notebook
        self._enabled = enabled

    @property
    def name(self) -> str:
        return "JupyterExecutionMiddleware"

    def _get_executor(self, runtime: AgentRuntime) -> JupyterExecutor:
        """Get executor from runtime or create default"""
        if runtime and runtime.jupyter_executor:
            return runtime.jupyter_executor
        if self._executor:
            return self._executor
        return get_jupyter_executor()

    async def wrap_tool_call(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        next_call: Callable,
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Dict[str, Any]:
        """
        Wrap tool calls to handle Jupyter execution.
        
        For jupyter_cell tools, executes code in kernel.
        For other tools, passes through to next handler.
        
        Args:
            tool_name: Name of the tool
            tool_input: Tool input parameters
            next_call: Next handler in chain
            state: Current agent state
            runtime: Agent runtime context
            
        Returns:
            Tool execution result
        """
        if not self._enabled:
            return await next_call(tool_name, tool_input)

        # Handle jupyter_cell execution
        if tool_name == "jupyter_cell_tool":
            return await self._execute_jupyter_cell(
                tool_input, state, runtime
            )

        # Handle markdown cell
        if tool_name == "markdown_tool":
            return await self._add_markdown_cell(
                tool_input, state, runtime
            )

        # Handle final_answer
        if tool_name == "final_answer_tool":
            return await self._handle_final_answer(
                tool_input, state, runtime
            )

        # Pass through for other tools
        return await next_call(tool_name, tool_input)

    async def _execute_jupyter_cell(
        self,
        tool_input: Dict[str, Any],
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Dict[str, Any]:
        """Execute code in Jupyter cell"""
        code = tool_input.get("code", "")
        if not code:
            return {
                "success": False,
                "error": "No code provided",
            }

        # Check for validation failure
        if tool_input.get("validation_failed"):
            errors = tool_input.get("validation_errors", [])
            return {
                "success": False,
                "error_type": "ValidationError",
                "error": "Code validation failed",
                "validation_errors": errors,
                "message": "Please fix validation errors and try again",
            }

        executor = self._get_executor(runtime)

        # Initialize executor if needed
        if not executor.is_initialized:
            notebook_context = state.get("notebook_context", {})
            kernel_id = notebook_context.get("kernel_id")
            notebook_path = notebook_context.get("notebook_path")

            if kernel_id and notebook_path:
                await executor.initialize(kernel_id, notebook_path)
            else:
                logger.warning("Kernel/notebook not available, using mock execution")

        try:
            result = await asyncio.wait_for(
                executor.execute_code(
                    code,
                    timeout=self._timeout,
                    add_to_notebook=self._add_to_notebook,
                ),
                timeout=self._timeout + 5,
            )

            # Update execution history in state
            execution_history = state.get("execution_history", [])
            execution_history.append(result.to_dict())
            state["execution_history"] = execution_history

            if result.success:
                return {
                    "success": True,
                    "output": result.output,
                    "execution_count": result.execution_count,
                    "cell_index": result.cell_index,
                    "display_data": result.display_data,
                }
            else:
                # Update error state
                state["error_count"] = state.get("error_count", 0) + 1
                state["last_error"] = {
                    "error_type": result.error_type,
                    "error_message": result.error_message,
                    "traceback": result.traceback,
                }

                return {
                    "success": False,
                    "error_type": result.error_type,
                    "error": result.error_message,
                    "traceback": result.traceback,
                    "output": result.output,
                }

        except asyncio.TimeoutError:
            logger.error(f"Execution timeout after {self._timeout}s")
            state["error_count"] = state.get("error_count", 0) + 1
            state["last_error"] = {
                "error_type": "TimeoutError",
                "error_message": f"Execution timed out after {self._timeout} seconds",
            }

            return {
                "success": False,
                "error_type": "TimeoutError",
                "error": f"Execution timed out after {self._timeout} seconds",
            }
        except Exception as e:
            logger.error(f"Execution failed: {e}")
            state["error_count"] = state.get("error_count", 0) + 1
            state["last_error"] = {
                "error_type": type(e).__name__,
                "error_message": str(e),
            }

            return {
                "success": False,
                "error_type": type(e).__name__,
                "error": str(e),
            }

    async def _add_markdown_cell(
        self,
        tool_input: Dict[str, Any],
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Dict[str, Any]:
        """Add markdown cell to notebook"""
        content = tool_input.get("content", "")
        if not content:
            return {
                "success": False,
                "error": "No content provided",
            }

        executor = self._get_executor(runtime)

        if not executor.is_initialized:
            return {
                "success": True,
                "message": "[Mock] Markdown cell would be added",
                "content": content[:100],
            }

        try:
            cell_index = await executor.add_markdown_cell(content)

            return {
                "success": True,
                "cell_index": cell_index,
                "message": "Markdown cell added successfully",
            }
        except Exception as e:
            logger.error(f"Failed to add markdown cell: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    async def _handle_final_answer(
        self,
        tool_input: Dict[str, Any],
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Dict[str, Any]:
        """Handle final answer tool"""
        answer = tool_input.get("answer", "")
        summary = tool_input.get("summary", "")

        # Update state
        state["final_answer"] = answer
        state["is_complete"] = True

        return {
            "success": True,
            "answer": answer,
            "summary": summary,
            "message": "Task completed",
            "is_complete": True,
        }


def create_jupyter_execution_middleware(
    timeout: float = 60.0,
    add_to_notebook: bool = True,
    enabled: bool = True,
) -> JupyterExecutionMiddleware:
    """
    Factory function to create Jupyter execution middleware.
    
    Args:
        timeout: Execution timeout in seconds
        add_to_notebook: Add cells to notebook
        enabled: Whether to enable execution
        
    Returns:
        Configured JupyterExecutionMiddleware instance
    """
    return JupyterExecutionMiddleware(
        timeout=timeout,
        add_to_notebook=add_to_notebook,
        enabled=enabled,
    )
