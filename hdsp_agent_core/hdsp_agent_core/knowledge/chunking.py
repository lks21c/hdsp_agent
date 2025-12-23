"""
Document Chunking - Text splitters for different document formats.

Provides intelligent chunking strategies:
- Markdown: Split by headers for semantic boundaries
- Python: Split by class/function definitions
- Plain text: Character-based with overlap

Each strategy preserves context and adds relevant metadata.
"""

import re
import logging
from typing import List, Dict, Any, Optional, TYPE_CHECKING
from pathlib import Path

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import ChunkingConfig

logger = logging.getLogger(__name__)


class DocumentChunker:
    """
    Intelligent document chunking with format-aware splitting.

    Strategies:
    - Markdown: Split by headers (##) for semantic boundaries
    - Python: Split by class/function definitions
    - Plain text: Character-based with sentence boundary respect

    Usage:
        chunker = DocumentChunker(config)
        chunks = chunker.chunk_document(content, metadata={"source": "file.md"})
    """

    def __init__(self, config: Optional["ChunkingConfig"] = None):
        from hdsp_agent_core.models.rag import ChunkingConfig
        self._config = config or ChunkingConfig()

    def chunk_document(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        file_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Chunk document based on content type.

        Args:
            content: Document content
            metadata: Base metadata for all chunks
            file_type: Override file type detection ("markdown", "python", "text")

        Returns:
            List of chunks with content and metadata
        """
        metadata = metadata or {}

        # Infer file type from metadata if not provided
        if not file_type:
            source = metadata.get("source", "")
            file_type = self._infer_file_type(source)

        # Route to appropriate chunker
        if file_type == "markdown" and self._config.split_by_header:
            chunks = self._chunk_markdown(content)
        elif file_type == "python":
            chunks = self._chunk_python(content)
        else:
            chunks = self._chunk_text(content)

        # Filter by minimum size and add metadata
        result = []
        for chunk in chunks:
            chunk_content = chunk["content"].strip()
            if len(chunk_content) >= self._config.min_chunk_size:
                result.append({
                    "content": chunk_content,
                    "metadata": {
                        **metadata,
                        **chunk.get("metadata", {})
                    }
                })

        logger.debug(f"Chunked document into {len(result)} chunks (type={file_type})")
        return result

    def _infer_file_type(self, source: str) -> str:
        """Infer file type from source path"""
        source_lower = source.lower()
        if source_lower.endswith(".md"):
            return "markdown"
        elif source_lower.endswith(".py"):
            return "python"
        elif source_lower.endswith((".txt", ".json", ".yaml", ".yml")):
            return "text"
        else:
            return "text"

    def _chunk_markdown(self, content: str) -> List[Dict[str, Any]]:
        """
        Split markdown by headers while preserving context.

        Strategy:
        - Split on header boundaries (# ## ### etc.)
        - Track header hierarchy for section context
        - Respect max chunk size with sub-splitting
        """
        # Pattern for markdown headers
        header_pattern = r'^(#{1,6})\s+(.+)$'

        lines = content.split('\n')
        chunks = []
        current_chunk_lines = []
        current_headers = []  # Stack of (level, text)

        for line in lines:
            header_match = re.match(header_pattern, line)

            if header_match:
                # Save current chunk if it has content
                if current_chunk_lines:
                    chunk_content = '\n'.join(current_chunk_lines).strip()
                    if chunk_content:
                        section_path = ' > '.join(h[1] for h in current_headers) if current_headers else "Introduction"
                        chunks.append({
                            "content": chunk_content,
                            "metadata": {"section": section_path}
                        })

                # Update header stack
                level = len(header_match.group(1))
                header_text = header_match.group(2).strip()

                # Pop headers of same or lower level
                while current_headers and current_headers[-1][0] >= level:
                    current_headers.pop()

                current_headers.append((level, header_text))
                current_chunk_lines = [line]
            else:
                current_chunk_lines.append(line)

                # Check chunk size limit
                chunk_text = '\n'.join(current_chunk_lines)
                if len(chunk_text) >= self._config.max_chunk_size:
                    section_path = ' > '.join(h[1] for h in current_headers) if current_headers else "Content"
                    chunks.append({
                        "content": chunk_text.strip(),
                        "metadata": {"section": section_path}
                    })
                    # Keep overlap for context continuity
                    overlap_lines = self._get_overlap_lines(current_chunk_lines)
                    current_chunk_lines = overlap_lines

        # Save final chunk
        if current_chunk_lines:
            chunk_content = '\n'.join(current_chunk_lines).strip()
            if chunk_content:
                section_path = ' > '.join(h[1] for h in current_headers) if current_headers else "Content"
                chunks.append({
                    "content": chunk_content,
                    "metadata": {"section": section_path}
                })

        return chunks

    def _chunk_python(self, content: str) -> List[Dict[str, Any]]:
        """
        Split Python code by class/function definitions.

        Strategy:
        - Identify top-level class and function definitions
        - Keep each definition as a separate chunk
        - Preserve import statements and module docstrings
        """
        # Pattern for class and function definitions (top-level only)
        def_pattern = r'^(class|def|async\s+def)\s+(\w+)'

        lines = content.split('\n')
        chunks = []
        current_chunk_lines = []
        current_def = None
        in_multiline_string = False

        for i, line in enumerate(lines):
            # Track multiline strings to avoid false positives
            triple_quote_count = line.count('"""') + line.count("'''")
            if triple_quote_count % 2 == 1:
                in_multiline_string = not in_multiline_string

            def_match = re.match(def_pattern, line)

            # Check if this is a top-level definition (not indented)
            if def_match and not line.startswith((' ', '\t')) and not in_multiline_string:
                # Save current chunk
                if current_chunk_lines:
                    chunk_content = '\n'.join(current_chunk_lines).strip()
                    if chunk_content:
                        chunks.append({
                            "content": chunk_content,
                            "metadata": {"definition": current_def or "module"}
                        })

                current_def = f"{def_match.group(1)} {def_match.group(2)}"
                current_chunk_lines = [line]
            else:
                current_chunk_lines.append(line)

                # Check max chunk size
                if len('\n'.join(current_chunk_lines)) >= self._config.max_chunk_size:
                    chunks.append({
                        "content": '\n'.join(current_chunk_lines).strip(),
                        "metadata": {"definition": current_def or "module"}
                    })
                    overlap_lines = self._get_overlap_lines(current_chunk_lines)
                    current_chunk_lines = overlap_lines

        # Save final chunk
        if current_chunk_lines:
            chunk_content = '\n'.join(current_chunk_lines).strip()
            if chunk_content:
                chunks.append({
                    "content": chunk_content,
                    "metadata": {"definition": current_def or "module"}
                })

        return chunks

    def _chunk_text(self, content: str) -> List[Dict[str, Any]]:
        """
        Character-based chunking with intelligent boundary detection.

        Strategy:
        - Target chunk_size characters
        - Prefer breaking at paragraph, sentence, or word boundaries
        - Maintain overlap for context continuity
        """
        chunks = []
        chunk_size = self._config.chunk_size
        overlap = self._config.chunk_overlap

        start = 0
        chunk_index = 0

        while start < len(content):
            end = start + chunk_size

            # Don't exceed content length
            if end >= len(content):
                chunk_content = content[start:].strip()
                if chunk_content:
                    chunks.append({
                        "content": chunk_content,
                        "metadata": {"chunk_index": chunk_index}
                    })
                break

            # Try to find a good break point
            break_point = self._find_break_point(content, start, end)
            end = break_point

            chunk_content = content[start:end].strip()
            if chunk_content:
                chunks.append({
                    "content": chunk_content,
                    "metadata": {"chunk_index": chunk_index}
                })

            # Move start with overlap
            start = max(end - overlap, start + 1)
            chunk_index += 1

            # Safety check to prevent infinite loop
            if chunk_index > 10000:
                logger.warning("Chunk limit reached, truncating document")
                break

        return chunks

    def _find_break_point(self, content: str, start: int, end: int) -> int:
        """
        Find the best break point near the target end position.

        Priority: paragraph > sentence > word > hard cut
        """
        search_start = start + (end - start) // 2  # Search in latter half

        # Try paragraph break (double newline)
        para_break = content.rfind('\n\n', search_start, end)
        if para_break > search_start:
            return para_break + 2

        # Try sentence break (. or ! or ? followed by space or newline)
        sentence_pattern = r'[.!?]\s'
        for match in re.finditer(sentence_pattern, content[search_start:end]):
            last_match_end = search_start + match.end()
        else:
            last_match_end = None

        # Find last sentence break
        for i in range(end - 1, search_start, -1):
            if i + 1 < len(content) and content[i] in '.!?' and content[i + 1] in ' \n':
                return i + 1

        # Try word break (space or newline)
        space_break = content.rfind(' ', search_start, end)
        if space_break > search_start:
            return space_break + 1

        newline_break = content.rfind('\n', search_start, end)
        if newline_break > search_start:
            return newline_break + 1

        # Hard cut at end
        return end

    def _get_overlap_lines(self, lines: List[str]) -> List[str]:
        """Get lines for overlap context."""
        total_chars = 0
        overlap_lines = []

        for line in reversed(lines):
            total_chars += len(line) + 1  # +1 for newline
            overlap_lines.insert(0, line)
            if total_chars >= self._config.chunk_overlap:
                break

        return overlap_lines


def chunk_file(
    file_path: Path,
    config: Optional["ChunkingConfig"] = None,
    base_metadata: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Convenience function to chunk a file directly.

    Args:
        file_path: Path to the file to chunk
        config: Optional ChunkingConfig
        base_metadata: Base metadata to include in all chunks

    Returns:
        List of chunks with content and metadata
    """
    content = file_path.read_text(encoding="utf-8")

    metadata = base_metadata or {}
    metadata["source"] = file_path.name
    metadata["file_path"] = str(file_path)

    chunker = DocumentChunker(config)
    return chunker.chunk_document(content, metadata=metadata)
