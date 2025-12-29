"""
Jupyter Tools for LangChain Agent

Provides tools for interacting with Jupyter notebooks:
- jupyter_cell: Execute Python code in a new cell
- markdown: Add a markdown cell
- final_answer: Complete the task with a summary
"""

from typing import Any, Dict, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class JupyterCellInput(BaseModel):
    """Input schema for jupyter_cell tool"""
    code: str = Field(description="Python code to execute in the notebook cell")
    description: Optional[str] = Field(
        default=None,
        description="Optional description of what this code does"
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional execution result payload from the client"
    )


class MarkdownInput(BaseModel):
    """Input schema for markdown tool"""
    content: str = Field(description="Markdown content to add to the notebook")


class FinalAnswerInput(BaseModel):
    """Input schema for final_answer tool"""
    answer: str = Field(description="Final answer/summary to present to the user")
    summary: Optional[str] = Field(
        default=None,
        description="Optional brief summary of what was accomplished"
    )


@tool(args_schema=JupyterCellInput)
def jupyter_cell_tool(
    code: str,
    description: Optional[str] = None,
    execution_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Execute Python code in a new Jupyter notebook cell.
    
    This tool adds a new code cell at the end of the notebook and executes it.
    The execution is handled by JupyterExecutionMiddleware.
    
    Args:
        code: Python code to execute
        description: Optional description of the code's purpose
        
    Returns:
        Dict containing execution request (actual execution by middleware)
    """
    # Clean code: remove markdown code block wrappers if present
    cleaned_code = code.strip()
    if cleaned_code.startswith("```python"):
        cleaned_code = cleaned_code[9:]
    elif cleaned_code.startswith("```"):
        cleaned_code = cleaned_code[3:]
    if cleaned_code.endswith("```"):
        cleaned_code = cleaned_code[:-3]
    cleaned_code = cleaned_code.strip()

    response: Dict[str, Any] = {
        "tool": "jupyter_cell",
        "parameters": {
            "code": cleaned_code,
            "description": description,
        },
        "status": "pending_execution",
        "message": "Code cell queued for execution by JupyterExecutionMiddleware"
    }
    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "Code cell executed with client-reported results"
    return response


@tool(args_schema=MarkdownInput)
def markdown_tool(content: str) -> Dict[str, Any]:
    """
    Add a markdown cell to the Jupyter notebook.
    
    This tool adds a new markdown cell at the end of the notebook.
    Useful for adding explanations, documentation, or section headers.
    
    Args:
        content: Markdown content to add
        
    Returns:
        Dict containing the markdown addition request
    """
    return {
        "tool": "markdown",
        "parameters": {
            "content": content,
        },
        "status": "completed",
        "message": "Markdown cell added successfully. Continue with the next task."
    }


@tool(args_schema=FinalAnswerInput)
def final_answer_tool(answer: str, summary: Optional[str] = None) -> Dict[str, Any]:
    """
    Complete the task and provide final answer to the user.
    
    Use this tool when you have successfully completed the user's request.
    Provide a clear summary of what was accomplished.
    
    Args:
        answer: Final answer/message to the user
        summary: Optional brief summary
        
    Returns:
        Dict marking task completion
    """
    return {
        "tool": "final_answer",
        "parameters": {
            "answer": answer,
            "summary": summary,
        },
        "status": "complete",
        "message": "Task completed successfully"
    }


# Export all tools
JUPYTER_TOOLS = [
    jupyter_cell_tool,
    markdown_tool,
    final_answer_tool,
]
