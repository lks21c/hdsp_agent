"""
State Verifier - 상태 검증 레이어 (Phase 1)
각 단계 실행 후 예상 상태와 실제 상태 비교, 신뢰도 계산, 리플래닝 트리거 결정
LLM 호출 없이 결정론적 검증 수행
"""

import re
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional


class MismatchType(Enum):
    """상태 불일치 유형"""

    VARIABLE_MISSING = "variable_missing"
    VARIABLE_TYPE_MISMATCH = "variable_type_mismatch"
    OUTPUT_MISSING = "output_missing"
    OUTPUT_MISMATCH = "output_mismatch"
    FILE_NOT_CREATED = "file_not_created"
    IMPORT_FAILED = "import_failed"
    EXCEPTION_OCCURRED = "exception_occurred"
    PARTIAL_EXECUTION = "partial_execution"


class Severity(Enum):
    """불일치 심각도"""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"


class Recommendation(Enum):
    """권장 사항"""

    PROCEED = "proceed"  # confidence >= 0.8
    WARNING = "warning"  # 0.6 <= confidence < 0.8
    REPLAN = "replan"  # 0.4 <= confidence < 0.6
    ESCALATE = "escalate"  # confidence < 0.4


# 신뢰도 임계값
CONFIDENCE_THRESHOLDS = {
    "PROCEED": 0.8,
    "WARNING": 0.6,
    "REPLAN": 0.4,
    "ESCALATE": 0.2,
}

# 기본 가중치
DEFAULT_WEIGHTS = {
    "output_match": 0.3,
    "variable_creation": 0.3,
    "no_exceptions": 0.25,
    "execution_complete": 0.15,
}


@dataclass
class StateMismatch:
    """개별 상태 불일치 상세 정보"""

    type: MismatchType
    severity: Severity
    description: str
    expected: Optional[str] = None
    actual: Optional[str] = None
    suggestion: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "severity": self.severity.value,
            "description": self.description,
            "expected": self.expected,
            "actual": self.actual,
            "suggestion": self.suggestion,
        }


@dataclass
class ConfidenceScore:
    """신뢰도 계산 상세 정보"""

    overall: float
    factors: Dict[str, float]
    weights: Dict[str, float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall": self.overall,
            "factors": self.factors,
            "weights": self.weights,
        }


@dataclass
class StateVerificationResult:
    """상태 검증 결과"""

    is_valid: bool
    confidence: float
    confidence_details: ConfidenceScore
    mismatches: List[StateMismatch]
    recommendation: Recommendation
    timestamp: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "isValid": self.is_valid,
            "confidence": self.confidence,
            "confidenceDetails": self.confidence_details.to_dict(),
            "mismatches": [m.to_dict() for m in self.mismatches],
            "recommendation": self.recommendation.value,
            "timestamp": self.timestamp,
        }


class StateVerifier:
    """
    상태 검증기 (결정론적, LLM 호출 없음)
    - 실행 결과 기반 상태 불일치 감지
    - 신뢰도 점수 계산
    - 권장 사항 결정
    """

    # 에러 타입별 복구 제안
    ERROR_SUGGESTIONS: Dict[str, str] = {
        "ModuleNotFoundError": "누락된 패키지를 설치하세요 (pip install)",
        "NameError": "변수가 정의되었는지 확인하세요. 이전 셀을 먼저 실행해야 할 수 있습니다.",
        "SyntaxError": "코드 문법을 확인하세요",
        "TypeError": "함수 인자 타입을 확인하세요",
        "ValueError": "입력 값의 범위나 형식을 확인하세요",
        "KeyError": "딕셔너리 키가 존재하는지 확인하세요",
        "IndexError": "리스트/배열 인덱스가 범위 내인지 확인하세요",
        "FileNotFoundError": "파일 경로가 올바른지 확인하세요",
        "AttributeError": "객체에 해당 속성/메서드가 있는지 확인하세요",
    }

    # Import 에러 패턴
    MODULE_ERROR_PATTERNS = [
        r"No module named ['\"]([^'\"]+)['\"]",
        r"cannot import name ['\"]([^'\"]+)['\"]",
    ]

    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or DEFAULT_WEIGHTS.copy()
        self.verification_history: List[StateVerificationResult] = []

    def verify(
        self,
        step_number: int,
        executed_code: str,
        execution_output: str,
        execution_status: str,  # "ok" or "error"
        error_message: Optional[str] = None,
        expected_variables: Optional[List[str]] = None,
        expected_output_patterns: Optional[List[str]] = None,
        previous_variables: Optional[List[str]] = None,
        current_variables: Optional[List[str]] = None,
    ) -> StateVerificationResult:
        """
        스텝 실행 결과 검증

        Args:
            step_number: 실행된 스텝 번호
            executed_code: 실행된 코드
            execution_output: 실행 출력
            execution_status: 실행 상태 ("ok" 또는 "error")
            error_message: 에러 메시지 (있는 경우)
            expected_variables: 예상 변수 목록
            expected_output_patterns: 예상 출력 패턴 목록
            previous_variables: 실행 전 변수 목록
            current_variables: 실행 후 변수 목록

        Returns:
            StateVerificationResult: 검증 결과
        """
        mismatches: List[StateMismatch] = []
        factors = {
            "output_match": 1.0,
            "variable_creation": 1.0,
            "no_exceptions": 1.0,
            "execution_complete": 1.0,
        }

        # 1. 실행 완료 여부 확인
        if execution_status == "error":
            factors["no_exceptions"] = 0.0
            factors["execution_complete"] = 0.0

            # 에러 타입 추출
            error_type = self._extract_error_type(error_message or "")
            suggestion = self.ERROR_SUGGESTIONS.get(
                error_type, "에러 메시지를 확인하고 코드를 수정하세요"
            )

            mismatches.append(
                StateMismatch(
                    type=MismatchType.EXCEPTION_OCCURRED,
                    severity=Severity.CRITICAL,
                    description=f"실행 중 예외 발생: {error_type}",
                    expected="에러 없음",
                    actual=error_message[:200] if error_message else "Unknown error",
                    suggestion=suggestion,
                )
            )

            # Import 에러 특별 처리
            if error_type in ("ModuleNotFoundError", "ImportError"):
                import_mismatch = self._check_import_error(error_message or "")
                if import_mismatch:
                    mismatches.append(import_mismatch)

        # 2. 변수 생성 검증
        if (
            expected_variables
            and previous_variables is not None
            and current_variables is not None
        ):
            var_score, var_mismatches = self._verify_variables(
                expected_variables, previous_variables, current_variables
            )
            factors["variable_creation"] = var_score
            mismatches.extend(var_mismatches)

        # 3. 출력 패턴 검증
        if expected_output_patterns:
            output_score, output_mismatches = self._verify_output_patterns(
                expected_output_patterns, execution_output
            )
            factors["output_match"] = output_score
            mismatches.extend(output_mismatches)

        # 4. 신뢰도 계산
        confidence_details = self._calculate_confidence(factors)

        # 5. 권장 사항 결정
        recommendation = self._determine_recommendation(confidence_details.overall)

        # 6. 유효성 판단 (critical 불일치가 없으면 유효)
        is_valid = not any(m.severity == Severity.CRITICAL for m in mismatches)

        result = StateVerificationResult(
            is_valid=is_valid,
            confidence=confidence_details.overall,
            confidence_details=confidence_details,
            mismatches=mismatches,
            recommendation=recommendation,
            timestamp=int(time.time() * 1000),
        )

        # 이력 저장
        self.verification_history.append(result)

        return result

    def _extract_error_type(self, error_message: str) -> str:
        """에러 메시지에서 에러 타입 추출"""
        # "TypeError: ..." 형태에서 타입 추출
        if ":" in error_message:
            potential_type = error_message.split(":")[0].strip()
            # 알려진 에러 타입인지 확인
            if potential_type in self.ERROR_SUGGESTIONS:
                return potential_type

        # 에러 메시지에서 키워드 검색
        error_keywords = [
            "ModuleNotFoundError",
            "ImportError",
            "NameError",
            "TypeError",
            "ValueError",
            "KeyError",
            "IndexError",
            "FileNotFoundError",
            "AttributeError",
            "SyntaxError",
        ]
        for keyword in error_keywords:
            if keyword in error_message:
                return keyword

        return "RuntimeError"

    def _check_import_error(self, error_message: str) -> Optional[StateMismatch]:
        """Import 에러 확인 및 누락 모듈 추출"""
        for pattern in self.MODULE_ERROR_PATTERNS:
            match = re.search(pattern, error_message, re.IGNORECASE)
            if match:
                module_name = match.group(1).split(".")[0]
                return StateMismatch(
                    type=MismatchType.IMPORT_FAILED,
                    severity=Severity.CRITICAL,
                    description=f"모듈 '{module_name}' import 실패",
                    expected=f"{module_name} 모듈이 설치되어 있어야 함",
                    actual=error_message[:100],
                    suggestion=f"pip install {module_name} 또는 conda install {module_name}로 설치하세요",
                )
        return None

    def _verify_variables(
        self,
        expected_vars: List[str],
        previous_vars: List[str],
        current_vars: List[str],
    ) -> tuple[float, List[StateMismatch]]:
        """변수 생성 검증"""
        mismatches: List[StateMismatch] = []
        previous_set = set(previous_vars)
        current_set = set(current_vars)

        # 새로 생성된 변수
        created_vars = current_set - previous_set

        match_count = 0
        for expected in expected_vars:
            if expected in created_vars or expected in current_set:
                match_count += 1
            else:
                mismatches.append(
                    StateMismatch(
                        type=MismatchType.VARIABLE_MISSING,
                        severity=Severity.MAJOR,
                        description=f"예상 변수 '{expected}'가 생성되지 않음",
                        expected=expected,
                        actual="(없음)",
                        suggestion=f"변수 '{expected}'를 생성하는 코드가 올바르게 실행되었는지 확인하세요",
                    )
                )

        score = match_count / len(expected_vars) if expected_vars else 1.0
        return score, mismatches

    def _verify_output_patterns(
        self,
        patterns: List[str],
        output: str,
    ) -> tuple[float, List[StateMismatch]]:
        """출력 패턴 검증"""
        mismatches: List[StateMismatch] = []

        match_count = 0
        for pattern in patterns:
            try:
                regex = re.compile(pattern, re.IGNORECASE)
                if regex.search(output):
                    match_count += 1
                else:
                    mismatches.append(
                        StateMismatch(
                            type=MismatchType.OUTPUT_MISMATCH,
                            severity=Severity.MINOR,
                            description="출력에서 예상 패턴을 찾을 수 없음",
                            expected=pattern,
                            actual=output[:100] + ("..." if len(output) > 100 else ""),
                        )
                    )
            except re.error:
                # 정규식 오류 시 문자열 포함 검사
                if pattern in output:
                    match_count += 1

        score = match_count / len(patterns) if patterns else 1.0
        return score, mismatches

    def _calculate_confidence(self, factors: Dict[str, float]) -> ConfidenceScore:
        """신뢰도 점수 계산"""
        overall = sum(
            factors.get(key, 0) * self.weights.get(key, 0) for key in self.weights
        )

        # 0과 1 사이로 클램프
        overall = max(0.0, min(1.0, overall))

        return ConfidenceScore(
            overall=overall,
            factors=factors,
            weights=self.weights.copy(),
        )

    def _determine_recommendation(self, confidence: float) -> Recommendation:
        """신뢰도에 따른 권장 사항 결정"""
        if confidence >= CONFIDENCE_THRESHOLDS["PROCEED"]:
            return Recommendation.PROCEED
        elif confidence >= CONFIDENCE_THRESHOLDS["WARNING"]:
            return Recommendation.WARNING
        elif confidence >= CONFIDENCE_THRESHOLDS["REPLAN"]:
            return Recommendation.REPLAN
        else:
            return Recommendation.ESCALATE

    def get_history(self, count: int = 5) -> List[StateVerificationResult]:
        """최근 검증 이력 조회"""
        return self.verification_history[-count:]

    def analyze_trend(self) -> Dict[str, Any]:
        """신뢰도 트렌드 분석"""
        if len(self.verification_history) < 2:
            return {
                "average": self.verification_history[0].confidence
                if self.verification_history
                else 1.0,
                "trend": "stable",
                "critical_count": sum(
                    1 for v in self.verification_history if not v.is_valid
                ),
            }

        confidences = [v.confidence for v in self.verification_history]
        average = sum(confidences) / len(confidences)

        # 최근 3개와 이전 비교
        recent_avg = sum(confidences[-3:]) / min(3, len(confidences))
        previous_avg = (
            sum(confidences[:-3]) / max(1, len(confidences) - 3)
            if len(confidences) > 3
            else recent_avg
        )

        if recent_avg > previous_avg + 0.1:
            trend = "improving"
        elif recent_avg < previous_avg - 0.1:
            trend = "declining"
        else:
            trend = "stable"

        return {
            "average": average,
            "trend": trend,
            "critical_count": sum(
                1 for v in self.verification_history if not v.is_valid
            ),
        }

    def clear_history(self):
        """검증 이력 초기화"""
        self.verification_history = []


# 싱글톤 인스턴스
_state_verifier_instance: Optional[StateVerifier] = None


def get_state_verifier() -> StateVerifier:
    """싱글톤 StateVerifier 반환"""
    global _state_verifier_instance
    if _state_verifier_instance is None:
        _state_verifier_instance = StateVerifier()
    return _state_verifier_instance
