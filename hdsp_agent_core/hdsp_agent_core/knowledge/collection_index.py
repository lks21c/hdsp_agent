"""
Collection Index - TOC for knowledge collections.

Provides structured information about available knowledge collections
for LLM to select relevant collections per step during planning.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml


@dataclass
class CollectionInfo:
    """Information about a single knowledge collection."""

    name: str
    display_name: str
    description: str
    key_topics: List[str] = field(default_factory=list)
    use_cases: List[str] = field(default_factory=list)
    keywords: List[str] = field(default_factory=list)


class CollectionIndex:
    """
    Manages the collection index (TOC) for knowledge base.

    Provides structured information for LLM to select relevant collections
    during the planning phase.
    """

    def __init__(self, index_path: Optional[str] = None):
        """
        Initialize CollectionIndex.

        Args:
            index_path: Path to collection_index.yaml. If None, uses default path.
        """
        if index_path:
            self.index_path = Path(index_path)
        else:
            self.index_path = Path(__file__).parent / "collection_index.yaml"

        self._collections: Dict[str, CollectionInfo] = {}
        self._loaded = False

    def _load(self) -> None:
        """Load collection index from YAML file."""
        if self._loaded:
            return

        if not self.index_path.exists():
            self._loaded = True
            return

        with open(self.index_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not data or "collections" not in data:
            self._loaded = True
            return

        for item in data.get("collections", []):
            self._collections[item["name"]] = CollectionInfo(
                name=item["name"],
                display_name=item.get("display_name", item["name"]),
                description=item.get("description", ""),
                key_topics=item.get("key_topics", []),
                use_cases=item.get("use_cases", []),
                keywords=item.get("keywords", []),
            )

        self._loaded = True

    def get_collection(self, name: str) -> Optional[CollectionInfo]:
        """
        Get info for a specific collection.

        Args:
            name: Collection name (e.g., 'dask', 'matplotlib')

        Returns:
            CollectionInfo or None if not found
        """
        self._load()
        return self._collections.get(name)

    def list_collections(self) -> List[str]:
        """
        List all available collection names.

        Returns:
            List of collection names
        """
        self._load()
        return list(self._collections.keys())

    def format_for_prompt(self) -> str:
        """
        Format collection index as a string for prompt injection.

        This is included in PLAN_GENERATION_PROMPT to help LLM
        select relevant collections for each step.

        Returns:
            Formatted markdown string for LLM prompt
        """
        self._load()

        if not self._collections:
            return ""

        lines = [
            "## 📚 Available Knowledge Collections",
            "",
            "각 step에서 필요한 라이브러리 가이드를 `requiredCollections`에 지정하세요.",
            "실제 API 가이드는 step 실행 시 조회됩니다.",
            "",
        ]

        for name, info in self._collections.items():
            lines.append(f"### {info.display_name} (`{name}`)")
            lines.append(f"- **설명**: {info.description}")

            if info.key_topics:
                topics = ", ".join(info.key_topics[:3])
                lines.append(f"- **주요 API**: {topics}")

            if info.use_cases:
                cases = ", ".join(info.use_cases[:2])
                lines.append(f"- **사용 시**: {cases}")

            lines.append("")

        return "\n".join(lines)

    def validate_collections(self, collections: List[str]) -> List[str]:
        """
        Validate and filter collection names.

        Args:
            collections: List of requested collection names

        Returns:
            List of valid collection names (only those that exist)
        """
        self._load()
        return [c for c in collections if c in self._collections]


# Singleton instance
_collection_index: Optional[CollectionIndex] = None


def get_collection_index() -> CollectionIndex:
    """Get singleton CollectionIndex instance."""
    global _collection_index
    if _collection_index is None:
        _collection_index = CollectionIndex()
    return _collection_index


def reset_collection_index() -> None:
    """Reset singleton instance (for testing)."""
    global _collection_index
    _collection_index = None
