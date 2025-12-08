"""
Knowledge Base - Mini RAG for library-specific guides
Detects library mentions in user requests and loads relevant API guides
"""

import os
import re
from pathlib import Path
from typing import List, Dict, Optional, Set

# 라이브러리 키워드 매핑 (트리거 → 파일명)
LIBRARY_TRIGGERS: Dict[str, str] = {
    # Dask
    'dask': 'dask',
    'dask.dataframe': 'dask',
    'dd.read': 'dask',

    # Polars
    'polars': 'polars',
    'pl.read': 'polars',

    # PySpark
    'pyspark': 'pyspark',
    'spark': 'pyspark',
    'sparkdf': 'pyspark',

    # Vaex
    'vaex': 'vaex',

    # Modin
    'modin': 'modin',

    # Ray
    'ray': 'ray',
}


class KnowledgeBase:
    """라이브러리별 지식 로더"""

    def __init__(self, knowledge_dir: Optional[str] = None):
        if knowledge_dir:
            self.knowledge_dir = Path(knowledge_dir)
        else:
            # 기본 경로: backend/knowledge/libraries
            self.knowledge_dir = Path(__file__).parent / 'libraries'

        self._cache: Dict[str, str] = {}

    def detect_libraries(self, text: str) -> Set[str]:
        """
        텍스트에서 라이브러리 키워드 감지

        Args:
            text: 사용자 요청 또는 컨텍스트 텍스트

        Returns:
            감지된 라이브러리 이름 집합
        """
        detected = set()
        text_lower = text.lower()

        for trigger, library in LIBRARY_TRIGGERS.items():
            # 단어 경계 고려한 매칭
            pattern = r'\b' + re.escape(trigger.lower()) + r'\b'
            if re.search(pattern, text_lower):
                detected.add(library)

        return detected

    def load_library_guide(self, library: str) -> Optional[str]:
        """
        라이브러리 가이드 파일 로드

        Args:
            library: 라이브러리 이름 (예: 'dask', 'polars')

        Returns:
            가이드 내용 또는 None
        """
        # 캐시 확인
        if library in self._cache:
            return self._cache[library]

        # 파일 로드
        file_path = self.knowledge_dir / f'{library}.md'
        if file_path.exists():
            content = file_path.read_text(encoding='utf-8')
            self._cache[library] = content
            return content

        return None

    def get_relevant_knowledge(self, request: str, context: str = '') -> str:
        """
        사용자 요청과 컨텍스트에서 관련 지식 추출

        Args:
            request: 사용자 요청
            context: 노트북 컨텍스트 (임포트된 라이브러리 등)

        Returns:
            관련 지식 문자열 (없으면 빈 문자열)
        """
        # 요청과 컨텍스트에서 라이브러리 감지
        combined_text = f"{request} {context}"
        libraries = self.detect_libraries(combined_text)

        if not libraries:
            return ''

        # 감지된 모든 라이브러리의 가이드 로드
        guides = []
        for lib in sorted(libraries):  # 정렬하여 일관된 순서 보장
            guide = self.load_library_guide(lib)
            if guide:
                guides.append(f"## {lib.upper()} 라이브러리 API 가이드\n\n{guide}")

        if not guides:
            return ''

        return "\n\n---\n\n".join(guides)

    def format_knowledge_section(self, request: str, context: str = '') -> str:
        """
        프롬프트에 삽입할 지식 섹션 포맷팅

        Args:
            request: 사용자 요청
            context: 노트북 컨텍스트

        Returns:
            포맷팅된 지식 섹션 (없으면 빈 문자열)
        """
        knowledge = self.get_relevant_knowledge(request, context)

        if not knowledge:
            return ''

        return f"""
## 📚 라이브러리 API 참조 (자동 로드됨)

{knowledge}

---
"""

    def list_available_libraries(self) -> List[str]:
        """사용 가능한 라이브러리 가이드 목록"""
        if not self.knowledge_dir.exists():
            return []

        return [f.stem for f in self.knowledge_dir.glob('*.md')]


# 싱글톤 인스턴스
_knowledge_base_instance: Optional[KnowledgeBase] = None


def get_knowledge_base() -> KnowledgeBase:
    """싱글톤 KnowledgeBase 반환"""
    global _knowledge_base_instance
    if _knowledge_base_instance is None:
        _knowledge_base_instance = KnowledgeBase()
    return _knowledge_base_instance


# 별칭 (하위 호환성)
KnowledgeLoader = KnowledgeBase
get_knowledge_loader = get_knowledge_base
