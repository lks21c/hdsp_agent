"""
Error Classifier - 결정론적 에러 분류 및 Replan 결정
LLM 호출 없이 에러 타입 기반으로 refine/insert_steps/replace_step/replan_remaining 결정
토큰 절약: ~1,000-2,000 토큰/세션
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Dict, Any

from agent_server.prompts.auto_agent_prompts import PIP_INDEX_OPTION


class ReplanDecision(Enum):
    """Replan 결정 타입"""

    REFINE = "refine"  # 같은 접근법으로 코드만 수정
    INSERT_STEPS = "insert_steps"  # 선행 작업 추가 (패키지 설치 등)
    REPLACE_STEP = "replace_step"  # 완전히 다른 접근법으로 교체
    REPLAN_REMAINING = "replan_remaining"  # 남은 단계 모두 재계획


@dataclass
class ErrorAnalysis:
    """에러 분석 결과"""

    decision: ReplanDecision
    root_cause: str
    reasoning: str
    missing_package: Optional[str] = None
    changes: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """API 응답용 딕셔너리 변환"""
        return {
            "analysis": {
                "root_cause": self.root_cause,
                "is_approach_problem": self.decision
                in (ReplanDecision.REPLACE_STEP, ReplanDecision.REPLAN_REMAINING),
                "missing_prerequisites": [self.missing_package]
                if self.missing_package
                else [],
            },
            "decision": self.decision.value,
            "reasoning": self.reasoning,
            "changes": self.changes,
        }


class ErrorClassifier:
    """
    결정론적 에러 분류기 (LLM 호출 없음)
    에러 타입 기반으로 replan 결정을 자동으로 수행

    규칙:
    - ModuleNotFoundError/ImportError → 무조건 INSERT_STEPS (pip install)
    - SyntaxError/TypeError/ValueError 등 → REFINE (코드 수정)
    - FileNotFoundError → REFINE (경로 수정 시도)
    """

    # 패키지명 별칭 매핑 (import명 → pip 패키지명)
    PACKAGE_ALIASES: Dict[str, str] = {
        "sklearn": "scikit-learn",
        "cv2": "opencv-python",
        "PIL": "pillow",
        "yaml": "pyyaml",
        "bs4": "beautifulsoup4",
        "skimage": "scikit-image",
        "dotenv": "python-dotenv",
        "dateutil": "python-dateutil",
    }

    # 에러 타입별 결정 매핑
    ERROR_DECISION_MAP: Dict[str, ReplanDecision] = {
        # INSERT_STEPS: 패키지 설치 필요
        "ModuleNotFoundError": ReplanDecision.INSERT_STEPS,
        "ImportError": ReplanDecision.INSERT_STEPS,
        # REFINE: 코드 수정으로 해결 가능
        "SyntaxError": ReplanDecision.REFINE,
        "TypeError": ReplanDecision.REFINE,
        "ValueError": ReplanDecision.REFINE,
        "KeyError": ReplanDecision.REFINE,
        "IndexError": ReplanDecision.REFINE,
        "AttributeError": ReplanDecision.REFINE,
        "NameError": ReplanDecision.REFINE,
        "ZeroDivisionError": ReplanDecision.REFINE,
        "FileNotFoundError": ReplanDecision.REFINE,
        "PermissionError": ReplanDecision.REFINE,
        "RuntimeError": ReplanDecision.REFINE,
        "AssertionError": ReplanDecision.REFINE,
        "StopIteration": ReplanDecision.REFINE,
        "RecursionError": ReplanDecision.REFINE,
        "MemoryError": ReplanDecision.REFINE,
        "OverflowError": ReplanDecision.REFINE,
        "FloatingPointError": ReplanDecision.REFINE,
        "UnicodeError": ReplanDecision.REFINE,
        "UnicodeDecodeError": ReplanDecision.REFINE,
        "UnicodeEncodeError": ReplanDecision.REFINE,
        "OSError": ReplanDecision.REFINE,  # 기본값, dlopen은 별도 처리
    }

    # dlopen 에러 패턴 (시스템 라이브러리 누락)
    DLOPEN_ERROR_PATTERNS = [
        r"dlopen\([^)]+\).*Library not loaded.*?(\w+\.dylib)",  # macOS
        r"cannot open shared object file.*?lib(\w+)\.so",  # Linux
        r"DLL load failed.*?(\w+\.dll)",  # Windows
    ]

    # ModuleNotFoundError 추출 패턴
    MODULE_ERROR_PATTERNS = [
        r"ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]",
        r"ImportError: No module named ['\"]([^'\"]+)['\"]",
        r"ImportError: cannot import name ['\"]([^'\"]+)['\"]",
        r"No module named ['\"]([^'\"]+)['\"]",
    ]

    def __init__(self, pip_index_option: str = None):
        """
        Args:
            pip_index_option: pip install 시 사용할 인덱스 옵션 (환경별)
        """
        self.pip_index_option = pip_index_option or PIP_INDEX_OPTION

    def classify(
        self,
        error_type: str,
        error_message: str,
        traceback: str = "",
        installed_packages: List[str] = None,
    ) -> ErrorAnalysis:
        """
        에러를 분류하고 replan 결정 반환

        Args:
            error_type: 에러 타입 (예: 'ModuleNotFoundError')
            error_message: 에러 메시지
            traceback: 스택 트레이스
            installed_packages: 설치된 패키지 목록

        Returns:
            ErrorAnalysis: 에러 분석 결과 및 replan 결정
        """
        installed_packages = installed_packages or []
        installed_lower = {pkg.lower() for pkg in installed_packages}

        # Step 1: 에러 타입 정규화
        error_type_normalized = self._normalize_error_type(error_type)

        # Step 2: ModuleNotFoundError/ImportError 특별 처리
        if error_type_normalized in ("ModuleNotFoundError", "ImportError"):
            return self._handle_module_error(error_message, traceback, installed_lower)

        # Step 2.5: OSError 중 dlopen 에러 특별 처리
        if error_type_normalized == "OSError":
            return self._handle_os_error(error_message, traceback)

        # Step 3: 에러 타입 기반 결정
        decision = self.ERROR_DECISION_MAP.get(
            error_type_normalized,
            ReplanDecision.REFINE,  # 기본값: REFINE
        )

        return ErrorAnalysis(
            decision=decision,
            root_cause=self._get_error_description(
                error_type_normalized, error_message
            ),
            reasoning=f"{error_type_normalized}는 코드 수정으로 해결 가능합니다.",
            changes={"refined_code": None},  # LLM이 코드 생성
        )

    def _normalize_error_type(self, error_type: str) -> str:
        """에러 타입 정규화"""
        if not error_type:
            return "RuntimeError"

        # 'ModuleNotFoundError: ...' 형태에서 타입만 추출
        if ":" in error_type:
            error_type = error_type.split(":")[0].strip()

        # 전체 경로에서 클래스명만 추출 (예: 'builtins.ValueError' → 'ValueError')
        if "." in error_type:
            error_type = error_type.split(".")[-1]

        return error_type

    def _handle_module_error(
        self, error_message: str, traceback: str, installed_packages: set
    ) -> ErrorAnalysis:
        """
        ModuleNotFoundError/ImportError 처리

        CRITICAL: 에러 메시지에서 패키지명 추출 (사용자 코드 아님!)
        """
        full_text = f"{error_message}\n{traceback}"

        # 패키지명 추출
        missing_pkg = self._extract_missing_package(full_text)

        if not missing_pkg:
            # 패키지명을 찾지 못한 경우 REFINE으로 폴백
            return ErrorAnalysis(
                decision=ReplanDecision.REFINE,
                root_cause="Import 에러 발생, 패키지명 추출 실패",
                reasoning="패키지명을 특정할 수 없어 코드 수정 시도",
                changes={"refined_code": None},
            )

        # pip 패키지명으로 변환
        pip_pkg = self._get_pip_package_name(missing_pkg)

        # 이미 설치된 패키지인지 확인
        if pip_pkg.lower() in installed_packages:
            # 패키지는 설치되어 있지만 import 실패 → 코드 문제
            return ErrorAnalysis(
                decision=ReplanDecision.REFINE,
                root_cause=f"'{missing_pkg}' import 실패 (패키지는 이미 설치됨)",
                reasoning="패키지가 설치되어 있으므로 import 구문 또는 코드 수정 필요",
                changes={"refined_code": None},
            )

        # pip install 코드 생성
        pip_command = self._generate_pip_install(pip_pkg)

        return ErrorAnalysis(
            decision=ReplanDecision.INSERT_STEPS,
            root_cause=f"'{missing_pkg}' 모듈이 설치되지 않음",
            reasoning="ModuleNotFoundError는 항상 패키지 설치로 해결합니다.",
            missing_package=pip_pkg,
            changes={
                "new_steps": [
                    {
                        "description": f"{pip_pkg} 패키지 설치",
                        "toolCalls": [
                            {
                                "tool": "jupyter_cell",
                                "parameters": {"code": pip_command},
                            }
                        ],
                    }
                ]
            },
        )

    def _handle_os_error(
        self,
        error_message: str,
        traceback: str,
    ) -> ErrorAnalysis:
        """
        OSError 처리 - dlopen 에러 감지
        """
        full_text = f"{error_message}\n{traceback}"

        # dlopen 에러 패턴 확인
        for pattern in self.DLOPEN_ERROR_PATTERNS:
            match = re.search(pattern, full_text, re.IGNORECASE | re.DOTALL)
            if match:
                missing_lib = match.group(1) if match.groups() else "unknown"
                return ErrorAnalysis(
                    decision=ReplanDecision.REPLAN_REMAINING,
                    root_cause=f"시스템 라이브러리 누락: {missing_lib}",
                    reasoning="dlopen 에러는 시스템 라이브러리 문제입니다. pip으로 해결할 수 없으며, 시스템 패키지 관리자(brew/apt)로 설치가 필요합니다.",
                    changes={"system_dependency": missing_lib},
                )

        # 일반 OSError는 REFINE
        return ErrorAnalysis(
            decision=ReplanDecision.REFINE,
            root_cause=f"OSError: {error_message[:150]}",
            reasoning="일반 OSError는 코드 수정으로 해결을 시도합니다.",
            changes={"refined_code": None},
        )

    def _extract_missing_package(self, text: str) -> Optional[str]:
        """에러 메시지에서 누락된 패키지명 추출"""
        for pattern in self.MODULE_ERROR_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                pkg = match.group(1)
                # 최상위 패키지만 반환 (예: 'pyarrow.lib' → 'pyarrow')
                return pkg.split(".")[0]
        return None

    def _get_pip_package_name(self, import_name: str) -> str:
        """import 이름을 pip 패키지명으로 변환"""
        return self.PACKAGE_ALIASES.get(import_name, import_name)

    def _generate_pip_install(self, package: str) -> str:
        """pip install 명령 생성"""
        if self.pip_index_option:
            return f"!pip install {self.pip_index_option} --timeout 180 {package}"
        return f"!pip install --timeout 180 {package}"

    def _get_error_description(self, error_type: str, error_msg: str) -> str:
        """에러 타입별 설명 생성"""
        descriptions = {
            "SyntaxError": "문법 오류",
            "TypeError": "타입 불일치",
            "ValueError": "값 오류",
            "KeyError": "딕셔너리/데이터프레임 키 없음",
            "IndexError": "인덱스 범위 초과",
            "AttributeError": "속성/메서드 없음",
            "NameError": "변수 미정의",
            "FileNotFoundError": "파일을 찾을 수 없음",
            "ZeroDivisionError": "0으로 나누기",
            "PermissionError": "권한 없음",
            "RuntimeError": "런타임 에러",
            "MemoryError": "메모리 부족",
        }
        base = descriptions.get(error_type, error_type)
        # 에러 메시지에서 핵심 부분만 추출 (150자 제한)
        msg_preview = error_msg[:150] if error_msg else ""
        return f"{base}: {msg_preview}"


# 싱글톤 인스턴스
_error_classifier_instance: Optional[ErrorClassifier] = None


def get_error_classifier() -> ErrorClassifier:
    """싱글톤 ErrorClassifier 반환"""
    global _error_classifier_instance
    if _error_classifier_instance is None:
        _error_classifier_instance = ErrorClassifier()
    return _error_classifier_instance
