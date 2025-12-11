"""
Knowledge Base - LLM-based library detection for API guides
LLM이 사용자 요청을 분석하여 필요한 라이브러리를 판단하고, 해당 API 가이드를 로드
"""

from pathlib import Path
from typing import List, Dict, Optional, Set

# 라이브러리별 설명 (LLM 판단용)
LIBRARY_DESCRIPTIONS: Dict[str, str] = {
    'matplotlib': '시각화, 그래프, 차트, plot, 히스토그램, 산점도, EDA, 데이터 시각화, seaborn과 함께 사용',
    'dask': '대용량 데이터 처리, pandas 대체, 분산 처리, lazy evaluation, dd.read_csv',
    'polars': '고성능 DataFrame, pandas 대체, Rust 기반, pl.read_csv',
    'pyspark': 'Spark 기반 분산 처리, 빅데이터, SparkSession',
    'vaex': '대용량 데이터 탐색, out-of-core 처리',
    'modin': 'pandas 가속화, 병렬 처리',
    'ray': '분산 컴퓨팅, 병렬 처리 프레임워크',
}

# LLM 라이브러리 판단 프롬프트
LIBRARY_DETECTION_PROMPT = '''사용자의 요청을 분석하여, 코드 작성 시 사용할 라이브러리를 판단하세요.

## 사용 가능한 라이브러리 API 가이드 목록:
{library_list}

## 사용자 요청:
{request}

## 노트북 컨텍스트:
- 이미 import된 라이브러리: {imported_libraries}

## 지시사항:
1. 사용자 요청을 **의미적으로** 분석하세요
2. 코드 작성 시 실제로 사용할 라이브러리만 선택하세요
3. 예: "dask를 적용해줘" → dask 선택
4. 예: "시각화 포함 EDA" → matplotlib 선택
5. 예: "pandas 대신 dask 사용" → dask 선택

## 출력 형식 (JSON만 출력):
{{"libraries": ["library1", "library2"]}}

빈 배열도 가능: {{"libraries": []}}
'''


class KnowledgeBase:
    """라이브러리별 지식 로더"""

    def __init__(self, knowledge_dir: Optional[str] = None):
        if knowledge_dir:
            self.knowledge_dir = Path(knowledge_dir)
        else:
            # 기본 경로: backend/knowledge/libraries
            self.knowledge_dir = Path(__file__).parent / 'libraries'

        self._cache: Dict[str, str] = {}

    def get_library_list_for_prompt(self) -> str:
        """LLM 판단용 라이브러리 목록 생성"""
        available = self.list_available_libraries()
        lines = []
        for lib in available:
            desc = LIBRARY_DESCRIPTIONS.get(lib, '기타 라이브러리')
            lines.append(f"- **{lib}**: {desc}")
        return "\n".join(lines)

    def get_detection_prompt(self, request: str, imported_libraries: List[str] = None) -> str:
        """LLM 라이브러리 판단 프롬프트 생성"""
        library_list = self.get_library_list_for_prompt()
        imported = ", ".join(imported_libraries) if imported_libraries else "없음"

        return LIBRARY_DETECTION_PROMPT.format(
            library_list=library_list,
            request=request,
            imported_libraries=imported
        )

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

    def load_libraries_knowledge(self, libraries: List[str]) -> str:
        """
        지정된 라이브러리들의 가이드 로드

        Args:
            libraries: 라이브러리 이름 목록

        Returns:
            결합된 가이드 문자열
        """
        if not libraries:
            return ''

        guides = []
        for lib in sorted(libraries):
            guide = self.load_library_guide(lib)
            if guide:
                guides.append(f"## {lib.upper()} 라이브러리 API 가이드\n\n{guide}")

        if not guides:
            return ''

        return "\n\n---\n\n".join(guides)

    def format_knowledge_section(self, libraries: List[str]) -> str:
        """
        프롬프트에 삽입할 지식 섹션 포맷팅

        Args:
            libraries: LLM이 판단한 라이브러리 목록

        Returns:
            포맷팅된 지식 섹션 (없으면 빈 문자열)
        """
        knowledge = self.load_libraries_knowledge(libraries)

        if not knowledge:
            return ''

        return f"""
## 📚 라이브러리 API 참조 (반드시 준수!)

아래 가이드의 API 사용법을 **반드시** 따르세요. 특히 ❌ 표시된 잘못된 코드를 피하고 ✅ 올바른 코드를 사용하세요.

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
