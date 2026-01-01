"""
Search Tools for LangChain Agent

Provides tools for searching code in workspace and notebooks.
These tools return pending_execution status and are executed on the client (Jupyter) side
using subprocess (find/grep/ripgrep).

Key features:
- Returns command info for client-side execution via subprocess
- Supports ripgrep (rg) if available, falls back to grep
- Executes immediately without user approval
- Shows the command being executed in status messages
"""

import logging
import shutil
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SearchWorkspaceInput(BaseModel):
    """Input schema for search_workspace tool"""

    pattern: str = Field(description="Search pattern (regex or text)")
    file_types: List[str] = Field(
        default=["*.py", "*.ipynb"],
        description="File patterns to search (e.g., ['*.py', '*.ipynb'])",
    )
    path: str = Field(default=".", description="Directory to search in")
    max_results: int = Field(default=50, description="Maximum number of results")
    case_sensitive: bool = Field(default=False, description="Case-sensitive search")
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Execution result payload from the client",
    )


class SearchNotebookCellsInput(BaseModel):
    """Input schema for search_notebook_cells tool"""

    pattern: str = Field(description="Search pattern (regex or text)")
    notebook_path: Optional[str] = Field(
        default=None, description="Specific notebook to search (None = all notebooks)"
    )
    cell_type: Optional[str] = Field(
        default=None,
        description="Cell type filter: 'code', 'markdown', or None for all",
    )
    max_results: int = Field(default=30, description="Maximum number of results")
    case_sensitive: bool = Field(default=False, description="Case-sensitive search")
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Execution result payload from the client",
    )


def _is_ripgrep_available() -> bool:
    """Check if ripgrep (rg) is installed and available."""
    return shutil.which("rg") is not None


def _build_grep_command(
    pattern: str,
    file_types: List[str],
    path: str,
    case_sensitive: bool,
    max_results: int,
) -> tuple[str, str]:
    """
    Build a grep/ripgrep command for searching files.

    Returns:
        Tuple of (command_string, tool_name) where tool_name is 'rg' or 'grep'
    """
    # Check ripgrep availability (this check will also be done on client)
    use_ripgrep = _is_ripgrep_available()

    if use_ripgrep:
        # Build ripgrep command
        cmd_parts = ["rg", "--line-number", "--with-filename"]

        if not case_sensitive:
            cmd_parts.append("--ignore-case")

        # Add file type filters using glob patterns
        for ft in file_types:
            cmd_parts.extend(["--glob", ft])

        # Limit results
        cmd_parts.extend(["--max-count", str(max_results)])

        # Escape pattern for shell
        escaped_pattern = pattern.replace("'", "'\\''")
        cmd_parts.append(f"'{escaped_pattern}'")
        cmd_parts.append(path)

        return " ".join(cmd_parts), "rg"
    else:
        # Build find + grep command for cross-platform compatibility
        find_parts = ["find", path, "-type", "f", "("]

        for i, ft in enumerate(file_types):
            if i > 0:
                find_parts.append("-o")
            find_parts.extend(["-name", f"'{ft}'"])

        find_parts.append(")")

        # Add grep with proper flags
        grep_flags = "-n"  # Line numbers
        if not case_sensitive:
            grep_flags += "i"

        # Escape pattern for shell
        escaped_pattern = pattern.replace("'", "'\\''")

        # Combine with xargs for efficiency
        cmd = f"{' '.join(find_parts)} 2>/dev/null | xargs grep -{grep_flags} '{escaped_pattern}' 2>/dev/null | head -n {max_results}"

        return cmd, "grep"


def _build_notebook_search_command(
    pattern: str,
    notebook_path: Optional[str],
    path: str,
    max_results: int,
) -> str:
    """Build a command to find notebooks for searching."""
    if notebook_path:
        return f"echo '{notebook_path}'"
    else:
        return (
            f"find {path} -name '*.ipynb' -type f 2>/dev/null | head -n {max_results}"
        )


@tool(args_schema=SearchWorkspaceInput)
def search_workspace_tool(
    pattern: str,
    file_types: List[str] = None,
    path: str = ".",
    max_results: int = 50,
    case_sensitive: bool = False,
    execution_result: Optional[Dict[str, Any]] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    Search for a pattern across files in the workspace.

    This tool is executed on the client side using subprocess (grep/ripgrep).
    Searches both regular files and Jupyter notebooks.

    Args:
        pattern: Search pattern (regex or text)
        file_types: File patterns to search (default: ['*.py', '*.ipynb'])
        path: Directory to search in (relative to workspace)
        max_results: Maximum number of results to return
        case_sensitive: Whether search is case-sensitive

    Returns:
        Dict with search results or pending_execution status
    """
    if file_types is None:
        file_types = ["*.py", "*.ipynb"]

    # Build the search command
    command, tool_used = _build_grep_command(
        pattern=pattern,
        file_types=file_types,
        path=path,
        case_sensitive=case_sensitive,
        max_results=max_results,
    )

    response: Dict[str, Any] = {
        "tool": "search_workspace_tool",
        "parameters": {
            "pattern": pattern,
            "file_types": file_types,
            "path": path,
            "max_results": max_results,
            "case_sensitive": case_sensitive,
        },
        "command": command,
        "tool_used": tool_used,
        "status": "pending_execution",
        "message": "Search queued for execution by client",
    }

    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "Search executed with client-reported results"
        # Parse the execution result to extract search results
        if isinstance(execution_result, dict):
            response["success"] = execution_result.get("success", False)
            response["results"] = execution_result.get("results", [])
            response["total_results"] = execution_result.get("total_results", 0)
            if "error" in execution_result:
                response["error"] = execution_result["error"]

    return response


@tool(args_schema=SearchNotebookCellsInput)
def search_notebook_cells_tool(
    pattern: str,
    notebook_path: Optional[str] = None,
    cell_type: Optional[str] = None,
    max_results: int = 30,
    case_sensitive: bool = False,
    execution_result: Optional[Dict[str, Any]] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    Search for a pattern in Jupyter notebook cells.

    This tool is executed on the client side.
    Can search a specific notebook or all notebooks in workspace.
    Optionally filter by cell type (code/markdown).

    Args:
        pattern: Search pattern (regex or text)
        notebook_path: Specific notebook to search (None = all)
        cell_type: Filter by cell type ('code', 'markdown', or None)
        max_results: Maximum number of results
        case_sensitive: Whether search is case-sensitive

    Returns:
        Dict with matching cells or pending_execution status
    """
    # Build find command for notebooks
    find_command = _build_notebook_search_command(
        pattern=pattern,
        notebook_path=notebook_path,
        path=".",
        max_results=max_results,
    )

    response: Dict[str, Any] = {
        "tool": "search_notebook_cells_tool",
        "parameters": {
            "pattern": pattern,
            "notebook_path": notebook_path,
            "cell_type": cell_type,
            "max_results": max_results,
            "case_sensitive": case_sensitive,
        },
        "find_command": find_command,
        "status": "pending_execution",
        "message": "Notebook search queued for execution by client",
    }

    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "Notebook search executed with client-reported results"
        # Parse the execution result
        if isinstance(execution_result, dict):
            response["success"] = execution_result.get("success", False)
            response["results"] = execution_result.get("results", [])
            response["total_results"] = execution_result.get("total_results", 0)
            response["notebooks_searched"] = execution_result.get(
                "notebooks_searched", 0
            )
            if "error" in execution_result:
                response["error"] = execution_result["error"]

    return response


def create_search_tools(workspace_root: str = ".") -> List:
    """
    Create search tools (for backward compatibility).

    Note: workspace_root is not used since tools return pending_execution
    and actual execution happens on the client side.
    """
    return [search_workspace_tool, search_notebook_cells_tool]


# Export all tools
SEARCH_TOOLS = [
    search_workspace_tool,
    search_notebook_cells_tool,
]
