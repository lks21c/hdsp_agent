"""
Search Tools for LangChain Agent

Provides tools for searching code in workspace and notebooks:
- search_workspace: Search files in the workspace
- search_notebook_cells: Search cells in Jupyter notebooks
"""

import json
import os
import re
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class SearchWorkspaceInput(BaseModel):
    """Input schema for search_workspace tool"""
    pattern: str = Field(description="Search pattern (regex or text)")
    file_types: List[str] = Field(
        default=["*.py", "*.ipynb"],
        description="File patterns to search (e.g., ['*.py', '*.ipynb'])"
    )
    path: str = Field(default=".", description="Directory to search in")
    max_results: int = Field(default=50, description="Maximum number of results")
    case_sensitive: bool = Field(default=False, description="Case-sensitive search")


class SearchNotebookCellsInput(BaseModel):
    """Input schema for search_notebook_cells tool"""
    pattern: str = Field(description="Search pattern (regex or text)")
    notebook_path: Optional[str] = Field(
        default=None,
        description="Specific notebook to search (None = all notebooks)"
    )
    cell_type: Optional[str] = Field(
        default=None,
        description="Cell type filter: 'code', 'markdown', or None for all"
    )
    max_results: int = Field(default=30, description="Maximum number of results")
    case_sensitive: bool = Field(default=False, description="Case-sensitive search")


def _search_in_file(
    file_path: str,
    pattern: str,
    case_sensitive: bool = False
) -> List[Dict[str, Any]]:
    """Search for pattern in a regular file"""
    results = []
    flags = 0 if case_sensitive else re.IGNORECASE

    try:
        compiled = re.compile(pattern, flags)
    except re.error:
        # If pattern is not valid regex, use literal search
        compiled = re.compile(re.escape(pattern), flags)

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line_num, line in enumerate(f, 1):
                if compiled.search(line):
                    results.append({
                        "file_path": file_path,
                        "line_number": line_num,
                        "content": line.strip()[:200],
                        "match_type": "line",
                    })
    except Exception:
        pass

    return results


def _search_in_notebook(
    notebook_path: str,
    pattern: str,
    cell_type: Optional[str] = None,
    case_sensitive: bool = False
) -> List[Dict[str, Any]]:
    """Search for pattern in a Jupyter notebook"""
    results = []
    flags = 0 if case_sensitive else re.IGNORECASE

    try:
        compiled = re.compile(pattern, flags)
    except re.error:
        compiled = re.compile(re.escape(pattern), flags)

    try:
        with open(notebook_path, "r", encoding="utf-8") as f:
            notebook = json.load(f)

        cells = notebook.get("cells", [])
        for idx, cell in enumerate(cells):
            current_type = cell.get("cell_type", "code")

            # Filter by cell type if specified
            if cell_type and current_type != cell_type:
                continue

            source = cell.get("source", [])
            if isinstance(source, list):
                source = "".join(source)

            if compiled.search(source):
                # Find matching lines
                matching_lines = []
                for line_num, line in enumerate(source.split("\n"), 1):
                    if compiled.search(line):
                        matching_lines.append({
                            "line": line_num,
                            "content": line.strip()[:150]
                        })

                results.append({
                    "file_path": notebook_path,
                    "cell_index": idx,
                    "cell_type": current_type,
                    "content": source[:300] + "..." if len(source) > 300 else source,
                    "matching_lines": matching_lines[:5],
                    "match_type": "cell",
                })
    except Exception:
        pass

    return results


@tool(args_schema=SearchWorkspaceInput)
def search_workspace_tool(
    pattern: str,
    file_types: List[str] = None,
    path: str = ".",
    max_results: int = 50,
    case_sensitive: bool = False,
    workspace_root: str = "."
) -> Dict[str, Any]:
    """
    Search for a pattern across files in the workspace.
    
    Searches both regular files and Jupyter notebooks.
    For notebooks, searches within cell contents.
    
    Args:
        pattern: Search pattern (regex or text)
        file_types: File patterns to search (default: ['*.py', '*.ipynb'])
        path: Directory to search in
        max_results: Maximum number of results to return
        case_sensitive: Whether search is case-sensitive
        
    Returns:
        Dict with search results
    """
    import fnmatch

    if file_types is None:
        file_types = ["*.py", "*.ipynb"]

    results = []
    files_searched = 0

    try:
        search_path = os.path.normpath(os.path.join(workspace_root, path))

        for root, _, filenames in os.walk(search_path):
            for filename in filenames:
                # Check if file matches any pattern
                if not any(fnmatch.fnmatch(filename, ft) for ft in file_types):
                    continue

                file_path = os.path.join(root, filename)
                rel_path = os.path.relpath(file_path, workspace_root)
                files_searched += 1

                if filename.endswith(".ipynb"):
                    # Search in notebook
                    matches = _search_in_notebook(
                        file_path, pattern, None, case_sensitive
                    )
                    for m in matches:
                        m["file_path"] = rel_path
                    results.extend(matches)
                else:
                    # Search in regular file
                    matches = _search_in_file(file_path, pattern, case_sensitive)
                    for m in matches:
                        m["file_path"] = rel_path
                    results.extend(matches)

                if len(results) >= max_results:
                    break

            if len(results) >= max_results:
                break

        return {
            "tool": "search_workspace",
            "success": True,
            "pattern": pattern,
            "path": path,
            "files_searched": files_searched,
            "total_results": len(results),
            "results": results[:max_results],
            "truncated": len(results) > max_results,
        }

    except Exception as e:
        return {
            "tool": "search_workspace",
            "success": False,
            "error": f"Search failed: {str(e)}",
            "pattern": pattern,
        }


@tool(args_schema=SearchNotebookCellsInput)
def search_notebook_cells_tool(
    pattern: str,
    notebook_path: Optional[str] = None,
    cell_type: Optional[str] = None,
    max_results: int = 30,
    case_sensitive: bool = False,
    workspace_root: str = "."
) -> Dict[str, Any]:
    """
    Search for a pattern in Jupyter notebook cells.
    
    Can search a specific notebook or all notebooks in workspace.
    Optionally filter by cell type (code/markdown).
    
    Args:
        pattern: Search pattern (regex or text)
        notebook_path: Specific notebook to search (None = all)
        cell_type: Filter by cell type ('code', 'markdown', or None)
        max_results: Maximum number of results
        case_sensitive: Whether search is case-sensitive
        
    Returns:
        Dict with matching cells
    """
    results = []
    notebooks_searched = 0

    try:
        if notebook_path:
            # Search specific notebook
            full_path = os.path.normpath(
                os.path.join(workspace_root, notebook_path)
            )
            if os.path.exists(full_path) and full_path.endswith(".ipynb"):
                matches = _search_in_notebook(
                    full_path, pattern, cell_type, case_sensitive
                )
                for m in matches:
                    m["file_path"] = notebook_path
                results.extend(matches)
                notebooks_searched = 1
        else:
            # Search all notebooks
            for root, _, filenames in os.walk(workspace_root):
                for filename in filenames:
                    if not filename.endswith(".ipynb"):
                        continue

                    file_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(file_path, workspace_root)
                    notebooks_searched += 1

                    matches = _search_in_notebook(
                        file_path, pattern, cell_type, case_sensitive
                    )
                    for m in matches:
                        m["file_path"] = rel_path
                    results.extend(matches)

                    if len(results) >= max_results:
                        break

                if len(results) >= max_results:
                    break

        return {
            "tool": "search_notebook_cells",
            "success": True,
            "pattern": pattern,
            "notebook_path": notebook_path,
            "cell_type": cell_type,
            "notebooks_searched": notebooks_searched,
            "total_results": len(results),
            "results": results[:max_results],
            "truncated": len(results) > max_results,
        }

    except Exception as e:
        return {
            "tool": "search_notebook_cells",
            "success": False,
            "error": f"Search failed: {str(e)}",
            "pattern": pattern,
        }


# Export all tools
SEARCH_TOOLS = [
    search_workspace_tool,
    search_notebook_cells_tool,
]
