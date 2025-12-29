"""
Code Search Middleware

Automatically searches workspace and notebook cells for relevant code
before model calls. Helps the agent understand existing code context.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from agent_server.langchain.executors.notebook_searcher import (
    NotebookSearcher,
    get_notebook_searcher,
)
from agent_server.langchain.state import AgentRuntime, AgentState, SearchResult

logger = logging.getLogger(__name__)


class CodeSearchMiddleware:
    """
    Middleware that searches for relevant code before model calls.
    
    This middleware:
    1. Extracts search terms from the user request
    2. Searches workspace files and notebook cells
    3. Injects relevant code context into the state
    
    Uses @before_model hook pattern from LangChain middleware.
    """

    def __init__(
        self,
        notebook_searcher: Optional[NotebookSearcher] = None,
        workspace_root: str = ".",
        max_results: int = 10,
        auto_search: bool = True,
        search_patterns: Optional[List[str]] = None,
        enabled: bool = True,
    ):
        """
        Initialize code search middleware.

        Args:
            notebook_searcher: NotebookSearcher instance
            workspace_root: Root directory for searches
            max_results: Maximum search results to include
            auto_search: Automatically extract and search patterns
            search_patterns: Additional patterns to always search
            enabled: Whether the middleware is enabled
        """
        self._searcher = notebook_searcher
        self._workspace_root = workspace_root
        self._max_results = max_results
        self._auto_search = auto_search
        self._search_patterns = search_patterns or []
        self._enabled = enabled

    @property
    def name(self) -> str:
        return "CodeSearchMiddleware"

    def _get_searcher(self) -> NotebookSearcher:
        """Get or create notebook searcher"""
        if self._searcher is None:
            self._searcher = get_notebook_searcher(self._workspace_root)
        return self._searcher

    def _extract_search_terms(self, request: str) -> List[str]:
        """
        Extract potential search terms from user request.
        
        Looks for:
        - Variable names (snake_case, camelCase)
        - Function calls (func_name(), methodName())
        - Class names (PascalCase)
        - File references (*.py, *.ipynb)
        - Quoted strings
        """
        terms = set()

        # Extract quoted strings
        quoted = re.findall(r'["\']([^"\']+)["\']', request)
        terms.update(quoted)

        # Extract potential identifiers (excluding common words)
        common_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "have", "has", "had", "do", "does", "did", "will", "would",
            "could", "should", "may", "might", "must", "shall", "can",
            "for", "and", "or", "but", "in", "on", "at", "to", "from",
            "with", "by", "about", "into", "through", "during", "before",
            "after", "above", "below", "between", "under", "again",
            "further", "then", "once", "here", "there", "when", "where",
            "why", "how", "all", "each", "every", "both", "few", "more",
            "most", "other", "some", "such", "no", "nor", "not", "only",
            "own", "same", "so", "than", "too", "very", "just", "also",
            "now", "please", "help", "want", "need", "make", "create",
            "use", "using", "show", "display", "get", "set", "add",
            "remove", "delete", "update", "change", "modify", "fix",
        }

        # Look for identifiers (snake_case, camelCase, PascalCase)
        identifiers = re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\b', request)
        for ident in identifiers:
            if ident.lower() not in common_words and len(ident) > 2:
                terms.add(ident)

        # Look for file patterns
        file_patterns = re.findall(r'\b(\w+\.(?:py|ipynb|csv|json|txt))\b', request)
        terms.update(file_patterns)

        # Look for function/method calls
        func_calls = re.findall(r'\b(\w+)\s*\(', request)
        for func in func_calls:
            if func.lower() not in common_words:
                terms.add(func)

        return list(terms)[:10]  # Limit to top 10 terms

    async def before_model(
        self,
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Optional[Dict[str, Any]]:
        """
        Hook called before each model invocation.

        Searches for relevant code and injects into state.

        Args:
            state: Current agent state
            runtime: Agent runtime context

        Returns:
            Updated state fields or None
        """
        # Skip if middleware is disabled
        if not self._enabled:
            return None

        # Skip if search results already present
        if state.get("search_results"):
            return None

        user_request = state.get("user_request", "")
        if not user_request:
            return None

        search_results: List[SearchResult] = []
        searcher = self._get_searcher()

        # Get current notebook path
        notebook_context = state.get("notebook_context", {})
        current_notebook = notebook_context.get("notebook_path", "")

        # Auto-extract search terms
        if self._auto_search:
            terms = self._extract_search_terms(user_request)
            terms.extend(self._search_patterns)
        else:
            terms = self._search_patterns

        if not terms:
            return None

        logger.info(f"Searching for terms: {terms}")

        # Search current notebook first
        if current_notebook:
            for term in terms[:5]:  # Limit terms for current notebook
                try:
                    results = searcher.search_notebook(
                        current_notebook,
                        term,
                        max_results=3,
                    )
                    for match in results.matches:
                        search_results.append(SearchResult(
                            file_path=match.file_path,
                            cell_index=match.cell_index,
                            line_number=match.line_number,
                            content=match.content,
                            match_type="cell",
                        ))
                except Exception as e:
                    logger.warning(f"Notebook search failed: {e}")

        # Search workspace for remaining capacity
        remaining = self._max_results - len(search_results)
        if remaining > 0:
            for term in terms[:3]:  # Limit workspace searches
                try:
                    results = searcher.search_workspace(
                        term,
                        max_results=remaining,
                    )
                    for match in results.matches:
                        # Avoid duplicates
                        if not any(
                            r["file_path"] == match.file_path and
                            r.get("line_number") == match.line_number
                            for r in search_results
                        ):
                            search_results.append(SearchResult(
                                file_path=match.file_path,
                                cell_index=match.cell_index,
                                line_number=match.line_number,
                                content=match.content,
                                match_type=match.match_type,
                            ))
                except Exception as e:
                    logger.warning(f"Workspace search failed: {e}")

        if search_results:
            logger.info(f"Found {len(search_results)} relevant code snippets")
            return {"search_results": search_results[:self._max_results]}

        return None

    def format_search_results_for_prompt(
        self,
        search_results: List[SearchResult],
    ) -> str:
        """
        Format search results for inclusion in the prompt.
        
        Args:
            search_results: List of search results
            
        Returns:
            Formatted context string
        """
        if not search_results:
            return ""

        lines = ["## Relevant Code from Workspace"]

        for i, result in enumerate(search_results[:self._max_results], 1):
            file_path = result.get("file_path", "unknown")
            cell_idx = result.get("cell_index")
            line_num = result.get("line_number")
            content = result.get("content", "")

            location = f"{file_path}"
            if cell_idx is not None:
                location += f" [Cell {cell_idx}]"
            if line_num is not None:
                location += f":L{line_num}"

            lines.append(f"\n### {i}. {location}")
            lines.append(f"```\n{content}\n```")

        return "\n".join(lines)


def create_code_search_middleware(
    workspace_root: str = ".",
    max_results: int = 10,
    auto_search: bool = True,
) -> CodeSearchMiddleware:
    """
    Factory function to create code search middleware.
    
    Args:
        workspace_root: Root directory for searches
        max_results: Maximum results to include
        auto_search: Auto-extract search terms from request
        
    Returns:
        Configured CodeSearchMiddleware instance
    """
    return CodeSearchMiddleware(
        workspace_root=workspace_root,
        max_results=max_results,
        auto_search=auto_search,
    )
