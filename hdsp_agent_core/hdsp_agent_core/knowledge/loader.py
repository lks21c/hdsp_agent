"""
Knowledge Base - Deterministic library detection for API guides

Keyword matching + regex based library detection for loading appropriate API guides.
(No LLM calls - saves tokens and improves reliability)
"""

from pathlib import Path
from typing import List, Dict, Optional, Set
import re

# Library descriptions (reference)
LIBRARY_DESCRIPTIONS: Dict[str, str] = {
    'matplotlib': 'Visualization, graphs, charts, plot, histogram, scatter plot, EDA, data visualization, used with seaborn',
    'dask': 'Large-scale data processing, pandas replacement, distributed processing, lazy evaluation, dd.read_csv',
    'polars': 'High-performance DataFrame, pandas replacement, Rust-based, pl.read_csv',
    'pyspark': 'Spark-based distributed processing, big data, SparkSession',
    'vaex': 'Large-scale data exploration, out-of-core processing',
    'modin': 'pandas acceleration, parallel processing',
    'ray': 'Distributed computing, parallel processing framework',
}


class LibraryDetector:
    """
    Deterministic library detection (no LLM calls).
    Uses keyword matching + regex to detect required libraries from user requests.
    """

    # Explicit library mention patterns (highest priority)
    EXPLICIT_PATTERNS: Dict[str, str] = {
        r'\bdask\b': 'dask',
        r'\bpolars\b': 'polars',
        r'\bpyspark\b': 'pyspark',
        r'\bvaex\b': 'vaex',
        r'\bmodin\b': 'modin',
        r'\bray\b': 'ray',
        r'\bmatplotlib\b': 'matplotlib',
        r'\bseaborn\b': 'matplotlib',  # seaborn -> matplotlib guide
        r'\bplt\.': 'matplotlib',
        r'\bdd\.read': 'dask',
        r'\bpl\.read': 'polars',
        r'\bpl\.DataFrame': 'polars',
    }

    # Keyword scores per library (0.0 ~ 1.0)
    KEYWORD_SCORES: Dict[str, Dict[str, float]] = {
        'dask': {
            '대용량': 0.7,
            'big data': 0.7,
            'bigdata': 0.7,
            '빅데이터': 0.7,
            'lazy': 0.8,
            'lazy evaluation': 0.9,
            'out-of-core': 0.9,
            'out of core': 0.9,
            '분산 처리': 0.6,
            'distributed': 0.6,
            'parallel dataframe': 0.8,
            '병렬 데이터프레임': 0.8,
        },
        'polars': {
            'rust 기반': 0.9,
            'rust-based': 0.9,
            'fast dataframe': 0.7,
            '고성능 dataframe': 0.7,
            '빠른 데이터프레임': 0.7,
        },
        'matplotlib': {
            '시각화': 0.7,
            'visualization': 0.7,
            'visualize': 0.7,
            'plot': 0.7,
            'chart': 0.7,
            'graph': 0.6,
            '그래프': 0.6,
            '차트': 0.7,
            'histogram': 0.8,
            '히스토그램': 0.8,
            'scatter': 0.8,
            '산점도': 0.8,
            'line plot': 0.8,
            '라인 플롯': 0.8,
            'bar chart': 0.8,
            '막대 그래프': 0.8,
            'eda': 0.5,
            '탐색적 데이터 분석': 0.6,
            'figure': 0.5,
            'subplot': 0.8,
            'heatmap': 0.7,
            '히트맵': 0.7,
        },
        'pyspark': {
            'spark': 0.9,
            'sparksession': 0.95,
            'spark session': 0.95,
            'rdd': 0.9,
            'hadoop': 0.7,
            '클러스터': 0.6,
            'cluster': 0.6,
        },
        'vaex': {
            'vaex': 1.0,
            'memory mapping': 0.8,
            '메모리 매핑': 0.8,
        },
        'modin': {
            'modin': 1.0,
            'pandas 가속': 0.8,
            'pandas acceleration': 0.8,
        },
        'ray': {
            'ray': 0.9,
            '분산 컴퓨팅': 0.7,
            'distributed computing': 0.7,
        },
    }

    # Score threshold
    SCORE_THRESHOLD = 0.7

    def detect(
        self,
        request: str,
        available_libraries: List[str],
        imported_libraries: List[str] = None
    ) -> List[str]:
        """
        Detect required libraries from user request.

        Args:
            request: User's natural language request
            available_libraries: List of libraries with available guides
            imported_libraries: Already imported libraries (optional)

        Returns:
            List of detected libraries
        """
        request_lower = request.lower()
        detected: Set[str] = set()

        # Step 1: Explicit pattern matching (highest priority)
        for pattern, lib in self.EXPLICIT_PATTERNS.items():
            if lib in available_libraries and re.search(pattern, request, re.IGNORECASE):
                detected.add(lib)

        # Step 2: Keyword scoring
        for lib, keywords in self.KEYWORD_SCORES.items():
            if lib in detected or lib not in available_libraries:
                continue

            max_score = 0.0
            for keyword, score in keywords.items():
                if keyword.lower() in request_lower:
                    max_score = max(max_score, score)

            if max_score >= self.SCORE_THRESHOLD:
                detected.add(lib)

        # Step 3: Consider already imported libraries
        if imported_libraries:
            for lib in imported_libraries:
                lib_lower = lib.lower()
                # seaborn -> matplotlib
                if lib_lower == 'seaborn' and 'matplotlib' in available_libraries:
                    detected.add('matplotlib')
                elif lib_lower in available_libraries:
                    detected.add(lib_lower)

        return list(detected)


# LibraryDetector singleton instance
_library_detector_instance: Optional[LibraryDetector] = None


def get_library_detector() -> LibraryDetector:
    """Get singleton LibraryDetector"""
    global _library_detector_instance
    if _library_detector_instance is None:
        _library_detector_instance = LibraryDetector()
    return _library_detector_instance


# LLM library detection prompt
LIBRARY_DETECTION_PROMPT = '''Analyze the user's request and determine which libraries to use for code generation.

## Available Library API Guides:
{library_list}

## User Request:
{request}

## Notebook Context:
- Already imported libraries: {imported_libraries}

## Instructions:
1. Analyze the user request **semantically**
2. Select only libraries that will actually be used in code generation
3. Example: "Apply dask" → select dask
4. Example: "EDA with visualization" → select matplotlib
5. Example: "Use dask instead of pandas" → select dask

## Output Format (JSON only):
{{"libraries": ["library1", "library2"]}}

Empty array is also valid: {{"libraries": []}}
'''


class KnowledgeBase:
    """Library knowledge loader"""

    def __init__(self, knowledge_dir: Optional[str] = None):
        if knowledge_dir:
            self.knowledge_dir = Path(knowledge_dir)
        else:
            # Default path: knowledge/libraries
            self.knowledge_dir = Path(__file__).parent / 'libraries'

        self._cache: Dict[str, str] = {}

    def get_library_list_for_prompt(self) -> str:
        """Generate library list for LLM detection"""
        available = self.list_available_libraries()
        lines = []
        for lib in available:
            desc = LIBRARY_DESCRIPTIONS.get(lib, 'Other library')
            lines.append(f"- **{lib}**: {desc}")
        return "\n".join(lines)

    def get_detection_prompt(self, request: str, imported_libraries: List[str] = None) -> str:
        """Generate LLM library detection prompt"""
        library_list = self.get_library_list_for_prompt()
        imported = ", ".join(imported_libraries) if imported_libraries else "None"

        return LIBRARY_DETECTION_PROMPT.format(
            library_list=library_list,
            request=request,
            imported_libraries=imported
        )

    def load_library_guide(self, library: str) -> Optional[str]:
        """
        Load library guide file.

        Args:
            library: Library name (e.g., 'dask', 'polars')

        Returns:
            Guide content or None
        """
        # Check cache
        if library in self._cache:
            return self._cache[library]

        # Load file
        file_path = self.knowledge_dir / f'{library}.md'
        if file_path.exists():
            content = file_path.read_text(encoding='utf-8')
            self._cache[library] = content
            return content

        return None

    def load_libraries_knowledge(self, libraries: List[str]) -> str:
        """
        Load guides for specified libraries.

        Args:
            libraries: List of library names

        Returns:
            Combined guide string
        """
        if not libraries:
            return ''

        guides = []
        for lib in sorted(libraries):
            guide = self.load_library_guide(lib)
            if guide:
                guides.append(f"## {lib.upper()} Library API Guide\n\n{guide}")

        if not guides:
            return ''

        return "\n\n---\n\n".join(guides)

    def format_knowledge_section(self, libraries: List[str]) -> str:
        """
        Format knowledge section for prompt injection.

        Args:
            libraries: List of libraries detected by LLM

        Returns:
            Formatted knowledge section (empty string if none)
        """
        knowledge = self.load_libraries_knowledge(libraries)

        if not knowledge:
            return ''

        return f"""
## 📚 Library API Reference (MUST follow!)

Follow the API usage in the guides below. Avoid ❌ incorrect code and use ✅ correct code.

{knowledge}

---
"""

    def list_available_libraries(self) -> List[str]:
        """List available library guides"""
        if not self.knowledge_dir.exists():
            return []

        return [f.stem for f in self.knowledge_dir.glob('*.md')]


# Singleton instance
_knowledge_base_instance: Optional[KnowledgeBase] = None


def get_knowledge_base() -> KnowledgeBase:
    """Get singleton KnowledgeBase"""
    global _knowledge_base_instance
    if _knowledge_base_instance is None:
        _knowledge_base_instance = KnowledgeBase()
    return _knowledge_base_instance


# Alias (backward compatibility)
KnowledgeLoader = KnowledgeBase
get_knowledge_loader = get_knowledge_base
