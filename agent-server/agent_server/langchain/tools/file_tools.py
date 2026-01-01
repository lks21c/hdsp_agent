"""
File Tools for LangChain Agent

Provides tools for file system operations:
- read_file: Read file content
- write_file: Write content to file (requires approval)
- list_files: List directory contents
"""

import os
from typing import Any, Dict, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class ReadFileInput(BaseModel):
    """Input schema for read_file tool"""

    path: str = Field(description="Relative path to the file to read")
    encoding: str = Field(default="utf-8", description="File encoding")
    max_lines: Optional[int] = Field(
        default=None,
        description="Maximum number of lines to read",
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional execution result payload from the client",
    )


class WriteFileInput(BaseModel):
    """Input schema for write_file tool"""

    path: str = Field(description="Relative path to the file to write")
    content: str = Field(description="Content to write to the file")
    encoding: str = Field(default="utf-8", description="File encoding")
    overwrite: bool = Field(
        default=False,
        description="Whether to overwrite an existing file (default: false)",
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional execution result payload from the client",
    )


class ListFilesInput(BaseModel):
    """Input schema for list_files tool"""

    path: str = Field(default=".", description="Directory path to list")
    recursive: bool = Field(default=False, description="Whether to list recursively")
    pattern: Optional[str] = Field(
        default=None,
        description="Glob pattern to filter files (e.g., '*.py', '*.ipynb')",
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional execution result payload from the client",
    )


def _validate_path(path: str, workspace_root: str = ".") -> str:
    """
    Validate and resolve file path.

    Security checks:
    - No absolute paths allowed
    - No parent directory traversal (..)
    - Must be within workspace root
    """
    # Block absolute paths
    if os.path.isabs(path):
        raise ValueError(f"Absolute paths not allowed: {path}")

    # Block parent directory traversal
    if ".." in path:
        raise ValueError(f"Parent directory traversal not allowed: {path}")

    # Resolve to absolute path within workspace
    normalized_path = path or "."
    resolved_abs = os.path.abspath(os.path.join(workspace_root, normalized_path))
    workspace_abs = os.path.abspath(workspace_root)

    # Ensure resolved path is within workspace
    if os.path.commonpath([workspace_abs, resolved_abs]) != workspace_abs:
        raise ValueError(f"Path escapes workspace: {path}")

    return resolved_abs


@tool(args_schema=ReadFileInput)
def read_file_tool(
    path: str,
    encoding: str = "utf-8",
    max_lines: Optional[int] = None,
    execution_result: Optional[Dict[str, Any]] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    Read content from a file.

    Only relative paths within the workspace are allowed.
    Absolute paths and parent directory traversal (..) are blocked.

    Args:
        path: Relative path to the file
        encoding: File encoding (default: utf-8)

    Returns:
        Dict with file content or error
    """
    if os.path.isabs(path):
        return {
            "tool": "read_file_tool",
            "success": False,
            "error": f"Absolute paths not allowed: {path}",
            "path": path,
        }
    if ".." in path:
        return {
            "tool": "read_file_tool",
            "success": False,
            "error": f"Parent directory traversal not allowed: {path}",
            "path": path,
        }

    response: Dict[str, Any] = {
        "tool": "read_file_tool",
        "parameters": {
            "path": path,
            "encoding": encoding,
            "max_lines": max_lines,
        },
        "status": "pending_execution",
        "message": "File read queued for execution by client",
    }
    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "File read executed with client-reported results"
    return response


@tool(args_schema=WriteFileInput)
def write_file_tool(
    path: str,
    content: str,
    encoding: str = "utf-8",
    overwrite: bool = False,
    execution_result: Optional[Dict[str, Any]] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    Write content to a file.

    This operation requires user approval before execution.
    Only relative paths within the workspace are allowed.

    Args:
        path: Relative path to the file
        content: Content to write
        encoding: File encoding (default: utf-8)

    Returns:
        Dict with operation status (pending approval)
    """
    try:
        resolved_path = _validate_path(path, workspace_root)

        response: Dict[str, Any] = {
            "tool": "write_file_tool",
            "parameters": {
                "path": path,
                "encoding": encoding,
                "overwrite": overwrite,
            },
            "status": "pending_approval",
            "path": path,
            "resolved_path": resolved_path,
            "content_preview": content[:200] + "..." if len(content) > 200 else content,
            "content_length": len(content),
            "message": "File write operation requires user approval",
        }
        if execution_result is not None:
            response["execution_result"] = execution_result
            response["status"] = "complete"
            response["message"] = "File write executed with client-reported results"
        return response

    except ValueError as e:
        return {
            "tool": "write_file_tool",
            "success": False,
            "error": str(e),
            "path": path,
        }


@tool(args_schema=ListFilesInput)
def list_files_tool(
    path: str = ".",
    recursive: bool = False,
    pattern: Optional[str] = None,
    execution_result: Optional[Dict[str, Any]] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    List files and directories.

    Args:
        path: Directory path to list (default: current directory)
        recursive: Whether to list recursively
        pattern: Optional glob pattern to filter (e.g., '*.py')

    Returns:
        Dict with list of files and directories
    """
    response: Dict[str, Any] = {
        "tool": "list_files_tool",
        "parameters": {
            "path": path,
            "recursive": recursive,
            "pattern": pattern,
        },
        "status": "pending_execution",
        "message": "File listing queued for execution by client",
    }
    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "File listing executed with client-reported results"
    return response


# Export all tools
FILE_TOOLS = [
    read_file_tool,
    write_file_tool,
    list_files_tool,
]
