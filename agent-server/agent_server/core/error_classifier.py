"""
Error Classifier - 결정론적 에러 분류 및 Replan 결정
LLM 호출 없이 에러 타입 기반으로 refine/insert_steps/replace_step/replan_remaining 결정
토큰 절약: ~1,000-2,000 토큰/세션

LLM Fallback 조건:
1. 동일 에러로 REFINE 2회 이상 실패
2. 패턴 매핑에 없는 미지의 에러 타입
3. 복잡한 에러 (트레이스백에 2개 이상 Exception)
"""

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from hdsp_agent_core.prompts.auto_agent_prompts import PIP_INDEX_OPTION


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
    used_llm: bool = False  # LLM Fallback 사용 여부
    confidence: float = 1.0  # 분석 신뢰도 (패턴 매칭=1.0, LLM=0.0~1.0)

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
            "usedLlm": self.used_llm,
            "confidence": self.confidence,
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

        # Step 0: 일반 타입('runtime' 등)일 경우 traceback에서 실제 에러 추출
        if error_type in ("runtime", "timeout", "safety", "validation", "environment"):
            actual_error_type = self._extract_error_type_from_traceback(
                traceback, error_message
            )
            if actual_error_type:
                error_type = actual_error_type

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

    def _extract_error_type_from_traceback(
        self, traceback: str, error_message: str
    ) -> Optional[str]:
        """
        traceback에서 실제 Python 에러 타입 추출

        프론트엔드가 error.type을 'runtime'으로 보낼 때,
        traceback에서 실제 에러 타입(ModuleNotFoundError, ImportError 등)을 찾음

        Args:
            traceback: 스택 트레이스 문자열
            error_message: 에러 메시지

        Returns:
            추출된 에러 타입 (예: 'ModuleNotFoundError') 또는 None
        """
        if not traceback:
            return None

        # traceback의 마지막 줄에서 에러 타입 추출
        # 형식: "ModuleNotFoundError: No module named 'matplotlib'"
        lines = traceback.strip().split("\n")

        # 뒤에서부터 에러 타입 라인 찾기
        for line in reversed(lines):
            line = line.strip()

            # ANSI 색상 코드 제거
            line = re.sub(r"\x1b\[[0-9;]*m", "", line)

            # Python 에러 타입 패턴 매칭
            # 예: "ModuleNotFoundError: ..." 또는 "ModuleNotFoundError                       Traceback..."
            error_pattern = r"^([A-Z][a-zA-Z0-9]*Error|[A-Z][a-zA-Z0-9]*Exception)[\s:]"
            match = re.match(error_pattern, line)

            if match:
                return match.group(1)

        return None

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

    # =========================================================================
    # LLM Fallback 관련 메서드
    # =========================================================================

    def _count_exceptions_in_traceback(self, traceback: str) -> int:
        """트레이스백에서 Exception 개수 카운트"""
        if not traceback:
            return 0
        # 다양한 Exception 패턴 매칭
        patterns = [
            r"\b\w+Error\b",  # ValueError, TypeError 등
            r"\b\w+Exception\b",  # CustomException 등
            r"During handling of the above exception",  # 연쇄 예외
        ]
        count = 0
        for pattern in patterns:
            count += len(re.findall(pattern, traceback))
        return count

    def should_use_llm_fallback(
        self,
        error_type: str,
        traceback: str = "",
        previous_attempts: int = 0,
    ) -> tuple[bool, str]:
        """
        LLM Fallback 사용 여부 결정

        Returns:
            (should_use: bool, reason: str)
        """
        # 조건 1: 동일 에러로 REFINE 2회 이상 실패
        if previous_attempts >= 2:
            return True, f"동일 에러 {previous_attempts}회 실패 후 LLM 분석 필요"

        # 조건 2: 패턴 매핑에 없는 미지의 에러 타입
        error_type_normalized = self._normalize_error_type(error_type)
        if error_type_normalized not in self.ERROR_DECISION_MAP:
            return True, f"미지의 에러 타입: {error_type_normalized}"

        # 조건 3: 복잡한 에러 (트레이스백에 2개 이상 Exception)
        exception_count = self._count_exceptions_in_traceback(traceback)
        if exception_count >= 2:
            return True, f"복잡한 에러 (트레이스백에 {exception_count}개 Exception)"

        return False, ""

    async def classify_with_fallback(
        self,
        error_type: str,
        error_message: str,
        traceback: str = "",
        installed_packages: List[str] = None,
        previous_attempts: int = 0,
        previous_codes: List[str] = None,
        llm_client=None,
        model: str = "gpt-4o-mini",
    ) -> ErrorAnalysis:
        """
        패턴 매칭 우선, 조건 충족 시 LLM Fallback

        Args:
            error_type: 에러 타입
            error_message: 에러 메시지
            traceback: 스택 트레이스
            installed_packages: 설치된 패키지 목록
            previous_attempts: 이전 시도 횟수
            previous_codes: 이전에 시도한 코드들
            llm_client: LLM 클라이언트 (AsyncOpenAI 호환)
            model: 사용할 모델명

        Returns:
            ErrorAnalysis: 에러 분석 결과
        """
        # Step 1: LLM Fallback 필요 여부 확인
        should_use_llm, fallback_reason = self.should_use_llm_fallback(
            error_type, traceback, previous_attempts
        )

        # Step 2: 패턴 매칭 우선 시도
        if not should_use_llm:
            return self.classify(
                error_type, error_message, traceback, installed_packages
            )

        # Step 3: LLM Fallback
        if llm_client is None:
            # LLM 클라이언트 없으면 패턴 매칭으로 폴백
            print(
                f"[ErrorClassifier] LLM 클라이언트 없음, 패턴 매칭 사용: {fallback_reason}"
            )
            return self.classify(
                error_type, error_message, traceback, installed_packages
            )

        print(f"[ErrorClassifier] LLM Fallback 사용: {fallback_reason}")
        return await self._classify_with_llm(
            error_type=error_type,
            error_message=error_message,
            traceback=traceback,
            previous_attempts=previous_attempts,
            previous_codes=previous_codes or [],
            llm_client=llm_client,
            model=model,
        )

    async def _classify_with_llm(
        self,
        error_type: str,
        error_message: str,
        traceback: str,
        previous_attempts: int,
        previous_codes: List[str],
        llm_client,
        model: str,
    ) -> ErrorAnalysis:
        """LLM을 사용한 에러 분석"""
        from hdsp_agent_core.prompts.auto_agent_prompts import (
            format_error_analysis_prompt,
        )

        prompt = format_error_analysis_prompt(
            error_type=error_type,
            error_message=error_message,
            traceback=traceback,
            previous_attempts=previous_attempts,
            previous_codes=previous_codes,
        )

        try:
            response = await llm_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=2000,
            )

            content = response.choices[0].message.content
            return self._parse_llm_response(content)

        except Exception as e:
            print(f"[ErrorClassifier] LLM 호출 실패: {e}")
            # LLM 실패 시 패턴 매칭으로 폴백
            result = self.classify(error_type, error_message, traceback, [])
            result.reasoning += f" (LLM 실패로 패턴 매칭 사용: {str(e)[:50]})"
            return result

    def _parse_llm_response(self, content: str) -> ErrorAnalysis:
        """LLM 응답 파싱"""
        try:
            # JSON 블록 추출
            json_match = re.search(r"```json\s*([\s\S]*?)\s*```", content)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_str = content

            data = json.loads(json_str)

            # decision 파싱
            decision_str = data.get("decision", "refine")
            decision_map = {
                "refine": ReplanDecision.REFINE,
                "insert_steps": ReplanDecision.INSERT_STEPS,
                "replace_step": ReplanDecision.REPLACE_STEP,
                "replan_remaining": ReplanDecision.REPLAN_REMAINING,
            }
            decision = decision_map.get(decision_str, ReplanDecision.REFINE)

            # confidence 추출
            confidence = float(data.get("confidence", 0.8))

            return ErrorAnalysis(
                decision=decision,
                root_cause=data.get("analysis", {}).get("root_cause", "LLM 분석 결과"),
                reasoning=data.get("reasoning", "LLM 분석 기반 결정"),
                changes=data.get("changes", {}),
                used_llm=True,
                confidence=confidence,
            )

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"[ErrorClassifier] LLM 응답 파싱 실패: {e}")
            return ErrorAnalysis(
                decision=ReplanDecision.REFINE,
                root_cause="LLM 응답 파싱 실패",
                reasoning=f"파싱 오류로 기본값(refine) 사용: {str(e)[:50]}",
                changes={"refined_code": None},
                used_llm=True,
                confidence=0.3,
            )


# 싱글톤 인스턴스
_error_classifier_instance: Optional[ErrorClassifier] = None


def get_error_classifier() -> ErrorClassifier:
    """싱글톤 ErrorClassifier 반환"""
    global _error_classifier_instance
    if _error_classifier_instance is None:
        _error_classifier_instance = ErrorClassifier()
    return _error_classifier_instance
