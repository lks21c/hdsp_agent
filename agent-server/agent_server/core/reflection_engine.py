"""
Reflection Engine Service
실행 결과 분석 및 적응적 조정을 위한 서비스

Checkpoint 기반 실행 검증과 Reflection을 통한 계획 조정
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ImpactSeverity(Enum):
    """영향도 심각도"""

    NONE = "none"
    MINOR = "minor"
    MAJOR = "major"
    CRITICAL = "critical"


class ReflectionAction(Enum):
    """Reflection 결과에 따른 액션"""

    CONTINUE = "continue"  # 계속 진행
    ADJUST = "adjust"  # 조정 후 진행
    RETRY = "retry"  # 현재 단계 재시도
    REPLAN = "replan"  # 전체 계획 재수립


class AdjustmentType(Enum):
    """조정 유형"""

    MODIFY_CODE = "modify_code"
    ADD_STEP = "add_step"
    REMOVE_STEP = "remove_step"
    CHANGE_APPROACH = "change_approach"


@dataclass
class ReflectionEvaluation:
    """Checkpoint 평가 결과"""

    checkpoint_passed: bool
    output_matches_expected: bool
    confidence_score: float  # 0.0 ~ 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "checkpoint_passed": self.checkpoint_passed,
            "output_matches_expected": self.output_matches_expected,
            "confidence_score": self.confidence_score,
        }


@dataclass
class ReflectionAnalysis:
    """실행 분석 결과"""

    success_factors: List[str] = field(default_factory=list)
    failure_factors: List[str] = field(default_factory=list)
    unexpected_outcomes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success_factors": self.success_factors,
            "failure_factors": self.failure_factors,
            "unexpected_outcomes": self.unexpected_outcomes,
        }


@dataclass
class ReflectionImpact:
    """남은 단계에 대한 영향"""

    affected_steps: List[int] = field(default_factory=list)
    severity: ImpactSeverity = ImpactSeverity.NONE
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "affected_steps": self.affected_steps,
            "severity": self.severity.value,
            "description": self.description,
        }


@dataclass
class Adjustment:
    """계획 조정 항목"""

    step_number: int
    change_type: AdjustmentType
    description: str
    new_content: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "step_number": self.step_number,
            "change_type": self.change_type.value,
            "description": self.description,
        }
        if self.new_content:
            result["new_content"] = self.new_content
        return result


@dataclass
class ReflectionRecommendations:
    """조정 권장사항"""

    action: ReflectionAction
    adjustments: List[Adjustment] = field(default_factory=list)
    reasoning: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "action": self.action.value,
            "adjustments": [adj.to_dict() for adj in self.adjustments],
            "reasoning": self.reasoning,
        }


@dataclass
class ReflectionResult:
    """Reflection 전체 결과"""

    evaluation: ReflectionEvaluation
    analysis: ReflectionAnalysis
    impact_on_remaining: ReflectionImpact
    recommendations: ReflectionRecommendations

    def to_dict(self) -> Dict[str, Any]:
        return {
            "evaluation": self.evaluation.to_dict(),
            "analysis": self.analysis.to_dict(),
            "impact_on_remaining": self.impact_on_remaining.to_dict(),
            "recommendations": self.recommendations.to_dict(),
        }


class ReflectionEngine:
    """실행 결과 분석 및 Reflection 엔진"""

    def __init__(self):
        pass

    def evaluate_checkpoint(
        self,
        execution_status: str,
        execution_output: str,
        expected_outcome: Optional[str],
        validation_criteria: Optional[List[str]],
        error_message: Optional[str] = None,
    ) -> ReflectionEvaluation:
        """
        Checkpoint 평가

        Args:
            execution_status: 실행 상태 ('ok', 'error')
            execution_output: 실행 출력
            expected_outcome: 예상 결과
            validation_criteria: 검증 기준 목록
            error_message: 오류 메시지 (있는 경우)

        Returns:
            ReflectionEvaluation: 평가 결과
        """
        # 기본 평가
        is_success = execution_status == "ok" and not error_message

        # 출력 매칭 평가 (간단한 휴리스틱)
        output_matches = True
        if expected_outcome and execution_output:
            # 예상 결과의 키워드가 출력에 포함되는지 확인
            expected_keywords = expected_outcome.lower().split()
            output_lower = execution_output.lower()
            matches = sum(1 for kw in expected_keywords if kw in output_lower)
            output_matches = matches >= len(expected_keywords) * 0.5

        # 검증 기준 평가
        criteria_passed = 0
        total_criteria = len(validation_criteria) if validation_criteria else 0
        if validation_criteria:
            for criterion in validation_criteria:
                # 간단한 키워드 매칭
                if any(
                    word in execution_output.lower()
                    for word in criterion.lower().split()
                ):
                    criteria_passed += 1

        # 신뢰도 점수 계산
        confidence = 0.0
        if is_success:
            confidence = 0.5
            if output_matches:
                confidence += 0.3
            if total_criteria > 0:
                confidence += 0.2 * (criteria_passed / total_criteria)
        else:
            confidence = 0.2 if execution_output else 0.0

        return ReflectionEvaluation(
            checkpoint_passed=is_success and output_matches,
            output_matches_expected=output_matches,
            confidence_score=min(confidence, 1.0),
        )

    def analyze_execution(
        self,
        execution_status: str,
        execution_output: str,
        error_message: Optional[str],
        executed_code: str,
    ) -> ReflectionAnalysis:
        """
        실행 결과 분석

        Args:
            execution_status: 실행 상태
            execution_output: 실행 출력
            error_message: 오류 메시지
            executed_code: 실행된 코드

        Returns:
            ReflectionAnalysis: 분석 결과
        """
        success_factors = []
        failure_factors = []
        unexpected_outcomes = []

        if execution_status == "ok":
            success_factors.append("코드가 오류 없이 실행됨")

            # 출력 분석
            if execution_output:
                if (
                    "error" in execution_output.lower()
                    or "warning" in execution_output.lower()
                ):
                    unexpected_outcomes.append("출력에 오류/경고 메시지 포함")
                if len(execution_output) > 10000:
                    unexpected_outcomes.append("출력이 예상보다 큼")

            # 코드 패턴 분석
            if "try:" in executed_code and "except" in executed_code:
                success_factors.append("예외 처리 포함")

        else:
            failure_factors.append(f"실행 실패: {error_message or '알 수 없는 오류'}")

            # 일반적인 오류 패턴 분석
            if error_message:
                error_lower = error_message.lower()
                if "nameerror" in error_lower:
                    failure_factors.append("정의되지 않은 변수 사용")
                elif (
                    "importerror" in error_lower or "modulenotfounderror" in error_lower
                ):
                    failure_factors.append("필요한 모듈 import 누락")
                elif "syntaxerror" in error_lower:
                    failure_factors.append("문법 오류")
                elif "typeerror" in error_lower:
                    failure_factors.append("타입 불일치")
                elif "keyerror" in error_lower or "indexerror" in error_lower:
                    failure_factors.append("데이터 접근 오류")

        return ReflectionAnalysis(
            success_factors=success_factors,
            failure_factors=failure_factors,
            unexpected_outcomes=unexpected_outcomes,
        )

    def assess_impact(
        self,
        evaluation: ReflectionEvaluation,
        analysis: ReflectionAnalysis,
        remaining_steps: Optional[List[Dict[str, Any]]],
    ) -> ReflectionImpact:
        """
        남은 단계에 대한 영향 평가

        Args:
            evaluation: Checkpoint 평가 결과
            analysis: 실행 분석 결과
            remaining_steps: 남은 단계 목록

        Returns:
            ReflectionImpact: 영향 평가 결과
        """
        if not remaining_steps:
            return ReflectionImpact(
                affected_steps=[],
                severity=ImpactSeverity.NONE,
                description="남은 단계 없음",
            )

        affected_steps = []
        severity = ImpactSeverity.NONE
        description = ""

        # Checkpoint 실패 시 영향 평가
        if not evaluation.checkpoint_passed:
            # 모든 후속 단계가 영향받을 가능성
            affected_steps = [
                step.get("stepNumber", i + 1) for i, step in enumerate(remaining_steps)
            ]

            if analysis.failure_factors:
                # 심각한 오류 유형 확인
                critical_errors = [
                    "정의되지 않은 변수",
                    "필요한 모듈 import 누락",
                    "문법 오류",
                ]
                if any(
                    err in factor
                    for factor in analysis.failure_factors
                    for err in critical_errors
                ):
                    severity = ImpactSeverity.CRITICAL
                    description = "핵심 오류로 인해 후속 단계 실행 불가"
                else:
                    severity = ImpactSeverity.MAJOR
                    description = "실행 오류로 인해 후속 단계에 영향"
            else:
                severity = ImpactSeverity.MINOR
                description = "예상과 다른 결과로 후속 단계 조정 필요"

        elif analysis.unexpected_outcomes:
            # 예상치 못한 결과가 있는 경우
            severity = ImpactSeverity.MINOR
            affected_steps = (
                [remaining_steps[0].get("stepNumber", 1)] if remaining_steps else []
            )
            description = "예상치 못한 출력으로 다음 단계 검토 필요"

        return ReflectionImpact(
            affected_steps=affected_steps, severity=severity, description=description
        )

    def generate_recommendations(
        self,
        evaluation: ReflectionEvaluation,
        analysis: ReflectionAnalysis,
        impact: ReflectionImpact,
    ) -> ReflectionRecommendations:
        """
        조정 권장사항 생성

        Args:
            evaluation: Checkpoint 평가 결과
            analysis: 실행 분석 결과
            impact: 영향 평가 결과

        Returns:
            ReflectionRecommendations: 권장사항
        """
        adjustments = []
        reasoning = ""

        # 성공적인 경우
        if evaluation.checkpoint_passed and evaluation.confidence_score >= 0.7:
            return ReflectionRecommendations(
                action=ReflectionAction.CONTINUE,
                adjustments=[],
                reasoning="실행이 성공적이며 예상 결과와 일치함",
            )

        # 실패 유형에 따른 권장사항
        if impact.severity == ImpactSeverity.CRITICAL:
            # 심각한 오류 - 재계획 권장
            return ReflectionRecommendations(
                action=ReflectionAction.REPLAN,
                adjustments=[],
                reasoning="핵심 오류로 인해 전체 계획 재수립 필요",
            )

        if impact.severity == ImpactSeverity.MAJOR:
            # 주요 오류 - 재시도 또는 조정
            if "정의되지 않은 변수" in str(analysis.failure_factors):
                adjustments.append(
                    Adjustment(
                        step_number=0,  # 현재 단계
                        change_type=AdjustmentType.ADD_STEP,
                        description="필요한 변수 정의 단계 추가",
                    )
                )
            elif "import 누락" in str(analysis.failure_factors):
                adjustments.append(
                    Adjustment(
                        step_number=0,
                        change_type=AdjustmentType.MODIFY_CODE,
                        description="필요한 import 문 추가",
                    )
                )
            else:
                adjustments.append(
                    Adjustment(
                        step_number=0,
                        change_type=AdjustmentType.MODIFY_CODE,
                        description="오류 수정",
                    )
                )

            return ReflectionRecommendations(
                action=ReflectionAction.RETRY,
                adjustments=adjustments,
                reasoning="오류 수정 후 재시도 필요",
            )

        if impact.severity == ImpactSeverity.MINOR:
            # 경미한 조정 - 조정 후 계속
            return ReflectionRecommendations(
                action=ReflectionAction.ADJUST,
                adjustments=adjustments,
                reasoning="경미한 조정 후 계속 진행 가능",
            )

        # 기본: 계속 진행
        return ReflectionRecommendations(
            action=ReflectionAction.CONTINUE,
            adjustments=[],
            reasoning="특별한 조정 없이 진행 가능",
        )

    def reflect(
        self,
        step_number: int,
        step_description: str,
        executed_code: str,
        execution_status: str,
        execution_output: str,
        error_message: Optional[str] = None,
        expected_outcome: Optional[str] = None,
        validation_criteria: Optional[List[str]] = None,
        remaining_steps: Optional[List[Dict[str, Any]]] = None,
    ) -> ReflectionResult:
        """
        전체 Reflection 수행

        Args:
            step_number: 단계 번호
            step_description: 단계 설명
            executed_code: 실행된 코드
            execution_status: 실행 상태 ('ok' 또는 'error')
            execution_output: 실행 출력
            error_message: 오류 메시지 (있는 경우)
            expected_outcome: 예상 결과
            validation_criteria: 검증 기준 목록
            remaining_steps: 남은 단계 목록

        Returns:
            ReflectionResult: Reflection 결과
        """
        # 1. Checkpoint 평가
        evaluation = self.evaluate_checkpoint(
            execution_status=execution_status,
            execution_output=execution_output,
            expected_outcome=expected_outcome,
            validation_criteria=validation_criteria,
            error_message=error_message,
        )

        # 2. 실행 분석
        analysis = self.analyze_execution(
            execution_status=execution_status,
            execution_output=execution_output,
            error_message=error_message,
            executed_code=executed_code,
        )

        # 3. 영향 평가
        impact = self.assess_impact(
            evaluation=evaluation, analysis=analysis, remaining_steps=remaining_steps
        )

        # 4. 권장사항 생성
        recommendations = self.generate_recommendations(
            evaluation=evaluation, analysis=analysis, impact=impact
        )

        return ReflectionResult(
            evaluation=evaluation,
            analysis=analysis,
            impact_on_remaining=impact,
            recommendations=recommendations,
        )
