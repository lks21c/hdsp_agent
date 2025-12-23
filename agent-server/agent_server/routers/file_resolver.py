"""
File Resolution Router - Handle ambiguous file path resolution
"""

import glob as glob_module
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()


# ============ Utility Functions ============


def find_files_by_name(
    filename: str, search_paths: List[str], max_depth: int = 5
) -> List[dict]:
    """
    Find all files matching the given filename in search paths.

    Args:
        filename: The filename to search for
        search_paths: List of directory paths to search in
        max_depth: Maximum directory depth to search (default: 5)

    Returns:
        List of dictionaries with 'path' and 'relative' keys
    """
    matches = []
    base_path = search_paths[0] if search_paths else os.getcwd()

    for search_path in search_paths:
        search_path = os.path.abspath(search_path)

        # Walk through directory tree with depth limit
        for root, dirs, files in os.walk(search_path):
            # Calculate current depth
            depth = root[len(search_path) :].count(os.sep)
            if depth > max_depth:
                continue

            if filename in files:
                full_path = os.path.join(root, filename)
                relative = os.path.relpath(full_path, base_path)

                matches.append(
                    {
                        "path": full_path,
                        "relative": relative,
                        "dir": os.path.dirname(relative) or ".",
                    }
                )

    return matches


def find_files_by_pattern(
    pattern: str, search_paths: List[str], recursive: bool = True, max_depth: int = 5
) -> List[dict]:
    """
    Find all files matching the given pattern (supports glob).

    Args:
        pattern: The pattern to search for (e.g., "train.csv", "train*", "*.csv")
        search_paths: List of directory paths to search in
        recursive: Whether to search recursively (default: True)
        max_depth: Maximum directory depth to search (default: 5)

    Returns:
        List of dictionaries with 'path', 'relative', and 'dir' keys
    """
    matches = []
    base_path = search_paths[0] if search_paths else os.getcwd()

    for search_path in search_paths:
        search_path = os.path.abspath(search_path)

        # Construct search pattern
        if recursive and "**" not in pattern:
            # Recursive search: auto-add ** if not present
            search_pattern = os.path.join(search_path, "**", pattern)
        else:
            search_pattern = os.path.join(search_path, pattern)

        # Execute glob search
        files = glob_module.glob(search_pattern, recursive=recursive)

        # Limit results and convert to relative paths
        for file_path in files[:500]:  # Max 500 files
            try:
                relative = os.path.relpath(file_path, base_path)
                matches.append(
                    {
                        "path": os.path.abspath(file_path),
                        "relative": relative,
                        "dir": os.path.dirname(relative) or ".",
                    }
                )
            except ValueError:
                # Handle case where file_path and base_path are on different drives (Windows)
                matches.append(
                    {
                        "path": os.path.abspath(file_path),
                        "relative": file_path,
                        "dir": os.path.dirname(file_path) or ".",
                    }
                )

    return matches


def parse_user_selection(selection_text: str, options: List[dict]) -> Optional[dict]:
    """
    Parse user's selection input and return the chosen file.

    Args:
        selection_text: User's input (e.g., "1", "2", etc.)
        options: List of file options

    Returns:
        Selected file dict or None if invalid
    """
    try:
        # Try to parse as number
        selection_num = int(selection_text.strip())
        if 1 <= selection_num <= len(options):
            return options[selection_num - 1]
    except ValueError:
        pass

    return None


# ============ Request/Response Models ============


class ResolveFileRequest(BaseModel):
    """Request to resolve a file path or pattern"""

    filename: Optional[str] = None  # Exact filename (backward compatible)
    pattern: Optional[str] = None  # Glob pattern (new)
    recursive: bool = True
    notebook_dir: Optional[str] = Field(None, alias="notebookDir")
    cwd: Optional[str] = None


class FileOption(BaseModel):
    """A single file option"""

    path: str
    relative: str
    dir: str


class ResolveFileResponse(BaseModel):
    """Response for file resolution"""

    # If single match:
    path: Optional[str] = None
    relative: Optional[str] = None

    # If multiple matches (requires user selection):
    requires_selection: bool = False
    filename: Optional[str] = None
    options: Optional[List[FileOption]] = None
    message: Optional[str] = None

    # If error:
    error: Optional[str] = None


class SelectFileRequest(BaseModel):
    """User's file selection"""

    selection: str  # "1", "2", etc.
    options: List[FileOption]


class SelectFileResponse(BaseModel):
    """Selected file"""

    path: str
    relative: str


# ============ Endpoints ============


@router.post("/resolve", response_model=ResolveFileResponse)
async def resolve_file(request: ResolveFileRequest) -> ResolveFileResponse:
    """
    Resolve a file path or pattern, returning selection prompt if ambiguous.

    Supports:
    - Exact filename: filename="train.csv"
    - Glob pattern: pattern="train*.csv", pattern="*.csv"

    Either 'filename' or 'pattern' must be provided.

    If multiple files are found, returns options for user to select.
    If single file is found, returns the path directly.
    If no files are found, returns error.
    """
    try:
        # Validate input: at least one of filename or pattern
        search_term = request.pattern or request.filename
        if not search_term:
            return ResolveFileResponse(
                error="Either 'filename' or 'pattern' parameter is required"
            )

        cwd = request.cwd or os.getcwd()
        search_paths = [cwd]

        if request.notebook_dir and request.notebook_dir != cwd:
            search_paths.insert(0, request.notebook_dir)

        # Debug logging
        print(f"[FileResolver] pattern={search_term}, recursive={request.recursive}")
        print(f"[FileResolver] cwd={cwd}")
        print(f"[FileResolver] notebook_dir={request.notebook_dir}")
        print(f"[FileResolver] search_paths={search_paths}")

        # Search for files
        if request.pattern:
            # Use glob pattern search
            matches = find_files_by_pattern(
                request.pattern, search_paths, recursive=request.recursive
            )
        else:
            # Use exact filename search (backward compatible)
            matches = find_files_by_name(request.filename, search_paths)

        if len(matches) == 0:
            return ResolveFileResponse(
                error=f"'{search_term}' 파일을 찾을 수 없습니다."
            )

        elif len(matches) == 1:
            # Single match - return directly
            return ResolveFileResponse(
                path=matches[0]["path"], relative=matches[0]["relative"]
            )

        else:
            # Multiple matches - request user selection
            display_count = min(len(matches), 20)  # Show max 20
            message = f"'{search_term}' 패턴과 일치하는 파일이 {len(matches)}개 발견되었습니다.\n\n"
            for idx, match in enumerate(matches[:display_count], 1):
                message += f"{idx}. {match['relative']}\n"

            if len(matches) > display_count:
                message += f"\n... 외 {len(matches) - display_count}개 파일\n"

            message += f"\n번호를 선택해주세요 (1-{display_count})"

            return ResolveFileResponse(
                requires_selection=True,
                filename=search_term,
                options=[FileOption(**m) for m in matches],
                message=message,
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/select", response_model=SelectFileResponse)
async def select_file(request: SelectFileRequest) -> SelectFileResponse:
    """
    Process user's file selection.

    Takes user's selection (e.g., "1", "2") and returns the chosen file.
    """
    try:
        options_dicts = [opt.dict() for opt in request.options]
        selected = parse_user_selection(request.selection, options_dicts)

        if selected is None:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid selection '{request.selection}'. Please choose a number between 1 and {len(request.options)}",
            )

        return SelectFileResponse(path=selected["path"], relative=selected["relative"])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
