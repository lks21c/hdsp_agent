"""
File Tools for LangChain Agent

Provides tools for file system operations:
- read_file: Read file content
- write_file: Write content to file (requires approval)
- list_files: List directory contents
"""

import os
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class ReadFileInput(BaseModel):
    """Input schema for read_file tool"""
    path: str = Field(description="Relative path to the file to read")
    encoding: str = Field(default="utf-8", description="File encoding")


class WriteFileInput(BaseModel):
    """Input schema for write_file tool"""
    path: str = Field(description="Relative path to the file to write")
    content: str = Field(description="Content to write to the file")
    encoding: str = Field(default="utf-8", description="File encoding")


class ListFilesInput(BaseModel):
    """Input schema for list_files tool"""
    path: str = Field(default=".", description="Directory path to list")
    recursive: bool = Field(default=False, description="Whether to list recursively")
    pattern: Optional[str] = Field(
        default=None,
        description="Glob pattern to filter files (e.g., '*.py', '*.ipynb')"
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
    workspace_root: str = "."
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
    try:
        resolved_path = _validate_path(path, workspace_root)

        if not os.path.exists(resolved_path):
            return {
                "tool": "read_file",
                "success": False,
                "error": f"File not found: {path}",
                "path": path,
            }

        if not os.path.isfile(resolved_path):
            return {
                "tool": "read_file",
                "success": False,
                "error": f"Not a file: {path}",
                "path": path,
            }

        with open(resolved_path, "r", encoding=encoding) as f:
            content = f.read()

        return {
            "tool": "read_file",
            "success": True,
            "path": path,
            "content": content,
            "size": len(content),
        }

    except ValueError as e:
        return {
            "tool": "read_file",
            "success": False,
            "error": str(e),
            "path": path,
        }
    except Exception as e:
        return {
            "tool": "read_file",
            "success": False,
            "error": f"Failed to read file: {str(e)}",
            "path": path,
        }


@tool(args_schema=WriteFileInput)
def write_file_tool(
    path: str,
    content: str,
    encoding: str = "utf-8",
    workspace_root: str = "."
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

        return {
            "tool": "write_file",
            "status": "pending_approval",
            "path": path,
            "resolved_path": resolved_path,
            "content_preview": content[:200] + "..." if len(content) > 200 else content,
            "content_length": len(content),
            "message": "File write operation requires user approval",
        }

    except ValueError as e:
        return {
            "tool": "write_file",
            "success": False,
            "error": str(e),
            "path": path,
        }


@tool(args_schema=ListFilesInput)
def list_files_tool(
    path: str = ".",
    recursive: bool = False,
    pattern: Optional[str] = None,
    workspace_root: str = "."
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
    import fnmatch

    try:
        resolved_path = _validate_path(path, workspace_root)

        if not os.path.exists(resolved_path):
            return {
                "tool": "list_files",
                "success": False,
                "error": f"Directory not found: {path}",
                "path": path,
            }

        if not os.path.isdir(resolved_path):
            return {
                "tool": "list_files",
                "success": False,
                "error": f"Not a directory: {path}",
                "path": path,
            }

        files: List[Dict[str, Any]] = []
        dirs: List[str] = []

        if recursive:
            for root, dirnames, filenames in os.walk(resolved_path):
                rel_root = os.path.relpath(root, resolved_path)
                for dirname in dirnames:
                    dir_path = os.path.join(rel_root, dirname) if rel_root != "." else dirname
                    dirs.append(dir_path)
                for filename in filenames:
                    if pattern and not fnmatch.fnmatch(filename, pattern):
                        continue
                    file_path = os.path.join(rel_root, filename) if rel_root != "." else filename
                    full_path = os.path.join(root, filename)
                    files.append({
                        "name": filename,
                        "path": file_path,
                        "size": os.path.getsize(full_path),
                    })
        else:
            for entry in os.scandir(resolved_path):
                if entry.is_dir():
                    dirs.append(entry.name)
                elif entry.is_file():
                    if pattern and not fnmatch.fnmatch(entry.name, pattern):
                        continue
                    files.append({
                        "name": entry.name,
                        "path": entry.name,
                        "size": entry.stat().st_size,
                    })

        return {
            "tool": "list_files",
            "success": True,
            "path": path,
            "directories": sorted(dirs),
            "files": sorted(files, key=lambda x: x["name"]),
            "total_dirs": len(dirs),
            "total_files": len(files),
        }

    except ValueError as e:
        return {
            "tool": "list_files",
            "success": False,
            "error": str(e),
            "path": path,
        }
    except Exception as e:
        return {
            "tool": "list_files",
            "success": False,
            "error": f"Failed to list directory: {str(e)}",
            "path": path,
        }


# Export all tools
FILE_TOOLS = [
    read_file_tool,
    write_file_tool,
    list_files_tool,
]
