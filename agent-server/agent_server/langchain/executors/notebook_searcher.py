"""
Notebook Searcher

Provides search functionality for Jupyter notebooks and workspace files.
Supports searching:
- Across all files in workspace
- Within specific notebooks
- By cell type (code/markdown)
- Using regex or text patterns
"""

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class SearchMatch:
    """Single search match result"""
    file_path: str
    cell_index: Optional[int] = None
    cell_type: Optional[str] = None
    line_number: Optional[int] = None
    content: str = ""
    context_before: str = ""
    context_after: str = ""
    match_type: str = "text"  # "text", "cell", "line"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_path": self.file_path,
            "cell_index": self.cell_index,
            "cell_type": self.cell_type,
            "line_number": self.line_number,
            "content": self.content,
            "context_before": self.context_before,
            "context_after": self.context_after,
            "match_type": self.match_type,
        }


@dataclass
class SearchResults:
    """Collection of search results"""
    query: str
    total_matches: int
    files_searched: int
    matches: List[SearchMatch] = field(default_factory=list)
    truncated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "total_matches": self.total_matches,
            "files_searched": self.files_searched,
            "matches": [m.to_dict() for m in self.matches],
            "truncated": self.truncated,
        }


class NotebookSearcher:
    """
    Searches notebooks and workspace files for patterns.
    
    Features:
    - Search across all files in workspace
    - Search within specific notebooks
    - Filter by cell type (code/markdown)
    - Regex or literal text matching
    - Context lines around matches
    
    Usage:
        searcher = NotebookSearcher(workspace_root="/path/to/workspace")
        results = searcher.search_workspace("import pandas")
        results = searcher.search_notebook("analysis.ipynb", "df.head()")
    """

    def __init__(self, workspace_root: str = "."):
        self.workspace_root = os.path.abspath(workspace_root)
        self._contents_manager = None

    def set_contents_manager(self, contents_manager: Any):
        """Set Jupyter contents manager for direct notebook access"""
        self._contents_manager = contents_manager

    def _compile_pattern(
        self,
        pattern: str,
        case_sensitive: bool = False,
        is_regex: bool = False,
    ) -> re.Pattern:
        """Compile search pattern"""
        flags = 0 if case_sensitive else re.IGNORECASE

        if not is_regex:
            pattern = re.escape(pattern)

        try:
            return re.compile(pattern, flags)
        except re.error as e:
            logger.warning(f"Invalid regex pattern: {e}, using literal")
            return re.compile(re.escape(pattern), flags)

    def _read_notebook(self, path: str) -> Optional[Dict[str, Any]]:
        """Read a notebook file"""
        full_path = os.path.join(self.workspace_root, path)

        # Try contents manager first
        if self._contents_manager:
            try:
                model = self._contents_manager.get(path, content=True)
                return model.get("content")
            except Exception:
                pass

        # Fall back to file read
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read notebook {path}: {e}")
            return None

    def _get_context(
        self,
        lines: List[str],
        line_idx: int,
        context_lines: int = 2,
    ) -> tuple:
        """Get context lines before and after a match"""
        start = max(0, line_idx - context_lines)
        end = min(len(lines), line_idx + context_lines + 1)

        before = "\n".join(lines[start:line_idx])
        after = "\n".join(lines[line_idx + 1:end])

        return before, after

    def search_notebook(
        self,
        notebook_path: str,
        pattern: str,
        cell_type: Optional[str] = None,
        case_sensitive: bool = False,
        is_regex: bool = False,
        max_results: int = 50,
        context_lines: int = 2,
    ) -> SearchResults:
        """
        Search within a specific notebook.
        
        Args:
            notebook_path: Path to notebook (relative to workspace)
            pattern: Search pattern
            cell_type: Filter by cell type ("code" or "markdown")
            case_sensitive: Case-sensitive search
            is_regex: Treat pattern as regex
            max_results: Maximum matches to return
            context_lines: Context lines around matches
            
        Returns:
            SearchResults with matches
        """
        compiled = self._compile_pattern(pattern, case_sensitive, is_regex)
        matches: List[SearchMatch] = []

        notebook = self._read_notebook(notebook_path)
        if not notebook:
            return SearchResults(
                query=pattern,
                total_matches=0,
                files_searched=1,
                matches=[],
            )

        cells = notebook.get("cells", [])

        for idx, cell in enumerate(cells):
            current_type = cell.get("cell_type", "code")

            # Filter by cell type
            if cell_type and current_type != cell_type:
                continue

            source = cell.get("source", "")
            if isinstance(source, list):
                source = "".join(source)

            if not compiled.search(source):
                continue

            # Find specific matching lines
            lines = source.split("\n")
            for line_idx, line in enumerate(lines):
                if compiled.search(line):
                    before, after = self._get_context(lines, line_idx, context_lines)

                    matches.append(SearchMatch(
                        file_path=notebook_path,
                        cell_index=idx,
                        cell_type=current_type,
                        line_number=line_idx + 1,
                        content=line.strip()[:200],
                        context_before=before[:100],
                        context_after=after[:100],
                        match_type="line",
                    ))

                    if len(matches) >= max_results:
                        break

            if len(matches) >= max_results:
                break

        return SearchResults(
            query=pattern,
            total_matches=len(matches),
            files_searched=1,
            matches=matches,
            truncated=len(matches) >= max_results,
        )

    def search_workspace(
        self,
        pattern: str,
        file_patterns: Optional[List[str]] = None,
        path: str = ".",
        case_sensitive: bool = False,
        is_regex: bool = False,
        max_results: int = 100,
        include_notebooks: bool = True,
        include_python: bool = True,
    ) -> SearchResults:
        """
        Search across workspace files.
        
        Args:
            pattern: Search pattern
            file_patterns: File glob patterns to include (e.g., ["*.py", "*.ipynb"])
            path: Directory to search (relative to workspace)
            case_sensitive: Case-sensitive search
            is_regex: Treat pattern as regex
            max_results: Maximum matches to return
            include_notebooks: Search in .ipynb files
            include_python: Search in .py files
            
        Returns:
            SearchResults with matches
        """
        import fnmatch

        if file_patterns is None:
            file_patterns = []
            if include_notebooks:
                file_patterns.append("*.ipynb")
            if include_python:
                file_patterns.append("*.py")

        compiled = self._compile_pattern(pattern, case_sensitive, is_regex)
        matches: List[SearchMatch] = []
        files_searched = 0

        search_path = os.path.join(self.workspace_root, path)

        for root, _, filenames in os.walk(search_path):
            for filename in filenames:
                # Check file pattern
                if not any(fnmatch.fnmatch(filename, p) for p in file_patterns):
                    continue

                file_path = os.path.join(root, filename)
                rel_path = os.path.relpath(file_path, self.workspace_root)
                files_searched += 1

                if filename.endswith(".ipynb"):
                    # Search in notebook
                    nb_results = self.search_notebook(
                        rel_path,
                        pattern,
                        case_sensitive=case_sensitive,
                        is_regex=is_regex,
                        max_results=max_results - len(matches),
                    )
                    matches.extend(nb_results.matches)
                else:
                    # Search in regular file
                    file_matches = self._search_in_file(
                        file_path,
                        rel_path,
                        compiled,
                        max_results - len(matches),
                    )
                    matches.extend(file_matches)

                if len(matches) >= max_results:
                    break

            if len(matches) >= max_results:
                break

        return SearchResults(
            query=pattern,
            total_matches=len(matches),
            files_searched=files_searched,
            matches=matches,
            truncated=len(matches) >= max_results,
        )

    def _search_in_file(
        self,
        file_path: str,
        rel_path: str,
        compiled: re.Pattern,
        max_results: int,
    ) -> List[SearchMatch]:
        """Search in a regular text file"""
        matches: List[SearchMatch] = []

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()

            for line_idx, line in enumerate(lines):
                if compiled.search(line):
                    before = ""
                    after = ""

                    if line_idx > 0:
                        before = lines[line_idx - 1].strip()[:100]
                    if line_idx < len(lines) - 1:
                        after = lines[line_idx + 1].strip()[:100]

                    matches.append(SearchMatch(
                        file_path=rel_path,
                        line_number=line_idx + 1,
                        content=line.strip()[:200],
                        context_before=before,
                        context_after=after,
                        match_type="line",
                    ))

                    if len(matches) >= max_results:
                        break

        except Exception as e:
            logger.error(f"Failed to search file {file_path}: {e}")

        return matches

    def search_current_notebook_cells(
        self,
        notebook_path: str,
        pattern: str,
        cell_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search cells in the current notebook.
        
        Convenience method for quick cell search in active notebook.
        
        Args:
            notebook_path: Current notebook path
            pattern: Search pattern
            cell_type: Optional cell type filter
            
        Returns:
            List of matching cells with their indices and content
        """
        results = self.search_notebook(
            notebook_path,
            pattern,
            cell_type=cell_type,
            max_results=20,
        )

        # Group by cell index
        cells_by_index: Dict[int, Dict[str, Any]] = {}

        for match in results.matches:
            idx = match.cell_index
            if idx not in cells_by_index:
                cells_by_index[idx] = {
                    "cell_index": idx,
                    "cell_type": match.cell_type,
                    "matching_lines": [],
                }

            cells_by_index[idx]["matching_lines"].append({
                "line_number": match.line_number,
                "content": match.content,
            })

        return list(cells_by_index.values())

    def get_notebook_structure(self, notebook_path: str) -> Dict[str, Any]:
        """
        Get structural overview of a notebook.
        
        Returns information about cells, imports, and defined symbols.
        
        Args:
            notebook_path: Path to notebook
            
        Returns:
            Dict with notebook structure information
        """
        notebook = self._read_notebook(notebook_path)
        if not notebook:
            return {"error": "Failed to read notebook"}

        cells = notebook.get("cells", [])

        code_cells = []
        markdown_cells = []
        imports = set()
        definitions = set()

        import_pattern = re.compile(r'^(?:import|from)\s+([\w.]+)', re.MULTILINE)
        def_pattern = re.compile(r'^(?:def|class)\s+(\w+)', re.MULTILINE)
        var_pattern = re.compile(r'^(\w+)\s*=', re.MULTILINE)

        for idx, cell in enumerate(cells):
            cell_type = cell.get("cell_type", "code")
            source = cell.get("source", "")
            if isinstance(source, list):
                source = "".join(source)

            cell_info = {
                "index": idx,
                "preview": source[:100] + "..." if len(source) > 100 else source,
                "lines": len(source.split("\n")),
            }

            if cell_type == "code":
                code_cells.append(cell_info)

                # Extract imports
                for match in import_pattern.finditer(source):
                    imports.add(match.group(1).split(".")[0])

                # Extract definitions
                for match in def_pattern.finditer(source):
                    definitions.add(match.group(1))

                # Extract variable assignments
                for match in var_pattern.finditer(source):
                    definitions.add(match.group(1))
            else:
                markdown_cells.append(cell_info)

        return {
            "notebook_path": notebook_path,
            "total_cells": len(cells),
            "code_cells": len(code_cells),
            "markdown_cells": len(markdown_cells),
            "imports": sorted(imports),
            "definitions": sorted(definitions),
            "code_cell_previews": code_cells[:10],
            "markdown_cell_previews": markdown_cells[:5],
        }


# Singleton instance
_searcher_instance: Optional[NotebookSearcher] = None


def get_notebook_searcher(workspace_root: str = ".") -> NotebookSearcher:
    """Get or create NotebookSearcher singleton"""
    global _searcher_instance
    if _searcher_instance is None:
        _searcher_instance = NotebookSearcher(workspace_root)
    return _searcher_instance
