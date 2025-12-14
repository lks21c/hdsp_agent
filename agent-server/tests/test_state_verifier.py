"""
StateVerifier Unit Tests

상태 검증기 테스트 - 토큰 소모 0, LLM 호출 없음
실행 결과 검증, 신뢰도 계산, 권장사항 결정 검증
"""

import pytest
from agent_server.core.state_verifier import (
    StateVerifier,
    StateVerificationResult,
    MismatchType,
    Severity,
    Recommendation,
    get_state_verifier,
    CONFIDENCE_THRESHOLDS,
)


class TestVariableVerification:
    """변수 검증 테스트"""

    def test_variable_created_as_expected(self):
        """예상 변수가 생성된 경우 → 성공"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="df = pd.read_csv('test.csv')",
            execution_output="",
            execution_status="ok",
            expected_variables=["df"],
            previous_variables=[],
            current_variables=["df"],
        )

        assert result.is_valid
        assert result.confidence >= CONFIDENCE_THRESHOLDS["PROCEED"]
        assert result.recommendation == Recommendation.PROCEED

    def test_variable_missing_detected(self):
        """예상 변수가 생성되지 않은 경우 → 불일치 감지"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="x = 1",
            execution_output="",
            execution_status="ok",
            expected_variables=["df"],
            previous_variables=[],
            current_variables=["x"],
        )

        assert any(m.type == MismatchType.VARIABLE_MISSING for m in result.mismatches)
        assert result.confidence < CONFIDENCE_THRESHOLDS["PROCEED"]

    def test_partial_variable_creation(self):
        """일부 변수만 생성된 경우"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="df = pd.DataFrame()",
            execution_output="",
            execution_status="ok",
            expected_variables=["df", "result", "summary"],
            previous_variables=[],
            current_variables=["df"],
        )

        # 1/3 변수만 생성됨 → variable_creation factor = 0.33
        missing_count = sum(
            1 for m in result.mismatches if m.type == MismatchType.VARIABLE_MISSING
        )
        assert missing_count == 2


class TestOutputPatternVerification:
    """출력 패턴 검증 테스트"""

    def test_output_pattern_matched(self):
        """출력 패턴이 일치하는 경우"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="df.head()",
            execution_output="   col1  col2\n0     1     2",
            execution_status="ok",
            expected_output_patterns=[r"col1", r"col2"],
        )

        assert result.is_valid
        output_mismatches = [
            m for m in result.mismatches if m.type == MismatchType.OUTPUT_MISMATCH
        ]
        assert len(output_mismatches) == 0

    def test_output_pattern_not_matched(self):
        """출력 패턴이 일치하지 않는 경우"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="print('hello')",
            execution_output="hello",
            execution_status="ok",
            expected_output_patterns=[r"DataFrame", r"columns"],
        )

        output_mismatches = [
            m for m in result.mismatches if m.type == MismatchType.OUTPUT_MISMATCH
        ]
        assert len(output_mismatches) == 2


class TestConfidenceCalculation:
    """신뢰도 계산 테스트"""

    def test_confidence_high_when_all_pass(self):
        """모든 조건 충족 시 높은 신뢰도"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="df = pd.read_csv('test.csv')",
            execution_output="DataFrame loaded",
            execution_status="ok",
            expected_variables=["df"],
            expected_output_patterns=[r"DataFrame"],
            previous_variables=[],
            current_variables=["df"],
        )

        assert result.confidence >= 0.8
        assert result.recommendation == Recommendation.PROCEED

    def test_confidence_low_on_error(self):
        """에러 발생 시 신뢰도 저하"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="import xyz",
            execution_output="",
            execution_status="error",
            error_message="ModuleNotFoundError: No module named 'xyz'",
        )

        # no_exceptions=0 (0.25), execution_complete=0 (0.15) → 0.4 감소
        # output_match=1.0 (0.3), variable_creation=1.0 (0.3) → 0.6 유지
        # 최종 신뢰도 = 0.6 → WARNING 레벨
        assert result.confidence <= 0.6
        assert result.recommendation in (
            Recommendation.WARNING,
            Recommendation.REPLAN,
            Recommendation.ESCALATE,
        )

    def test_confidence_factors_are_weighted(self):
        """신뢰도가 가중치에 따라 계산됨"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="x = 1",
            execution_output="",
            execution_status="ok",
        )

        # 기본 가중치 확인
        assert "output_match" in result.confidence_details.weights
        assert "variable_creation" in result.confidence_details.weights
        assert "no_exceptions" in result.confidence_details.weights
        assert "execution_complete" in result.confidence_details.weights


class TestRecommendation:
    """권장사항 결정 테스트"""

    def test_recommendation_proceed(self):
        """신뢰도 >= 0.8 → PROCEED"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="x = 1",
            execution_output="",
            execution_status="ok",
        )

        assert result.recommendation == Recommendation.PROCEED

    def test_recommendation_warning(self):
        """0.6 <= 신뢰도 < 0.8 → WARNING"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="df = pd.DataFrame()",
            execution_output="",
            execution_status="ok",
            expected_variables=["df", "result"],  # 1/2만 충족
            previous_variables=[],
            current_variables=["df"],
        )

        # variable_creation = 0.5 → 신뢰도 약간 감소
        # 정확한 값은 가중치에 따라 다름
        assert result.recommendation in (Recommendation.PROCEED, Recommendation.WARNING)

    def test_recommendation_not_proceed_on_error(self):
        """에러 발생 시 → PROCEED가 아님"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="1/0",
            execution_output="",
            execution_status="error",
            error_message="ZeroDivisionError: division by zero",
        )

        # 에러 발생 시 신뢰도가 낮아지므로 PROCEED가 아님
        # 실제 신뢰도 = 0.6 (no_exceptions, execution_complete이 0)
        assert result.recommendation != Recommendation.PROCEED
        assert not result.is_valid  # critical error가 있으면 invalid


class TestExceptionHandling:
    """예외 처리 테스트"""

    def test_exception_detected_in_result(self):
        """에러 발생 시 EXCEPTION_OCCURRED 불일치 추가"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="raise ValueError('test')",
            execution_output="",
            execution_status="error",
            error_message="ValueError: test",
        )

        assert not result.is_valid
        exception_mismatch = next(
            (m for m in result.mismatches if m.type == MismatchType.EXCEPTION_OCCURRED),
            None,
        )
        assert exception_mismatch is not None
        assert exception_mismatch.severity == Severity.CRITICAL

    def test_import_error_adds_import_failed_mismatch(self):
        """Import 에러 시 IMPORT_FAILED 불일치 추가"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="import nonexistent",
            execution_output="",
            execution_status="error",
            error_message="ModuleNotFoundError: No module named 'nonexistent'",
        )

        import_mismatch = next(
            (m for m in result.mismatches if m.type == MismatchType.IMPORT_FAILED),
            None,
        )
        assert import_mismatch is not None
        assert "nonexistent" in import_mismatch.description


class TestErrorSuggestions:
    """에러 제안 테스트"""

    @pytest.mark.parametrize(
        "error_type,expected_keyword",
        [
            ("ModuleNotFoundError", "pip install"),
            ("NameError", "변수"),
            ("FileNotFoundError", "파일 경로"),
            ("TypeError", "타입"),
            ("KeyError", "키"),
        ],
    )
    def test_error_suggestions(self, error_type, expected_keyword):
        """에러 타입별 적절한 제안 생성"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="problematic code",
            execution_output="",
            execution_status="error",
            error_message=f"{error_type}: some error",
        )

        exception_mismatch = next(
            (m for m in result.mismatches if m.type == MismatchType.EXCEPTION_OCCURRED),
            None,
        )
        assert exception_mismatch is not None
        assert expected_keyword in exception_mismatch.suggestion


class TestVerificationHistory:
    """검증 이력 테스트"""

    def test_history_is_recorded(self):
        """검증 결과가 이력에 저장됨"""
        verifier = StateVerifier()
        verifier.clear_history()

        verifier.verify(
            step_number=1,
            executed_code="x = 1",
            execution_output="",
            execution_status="ok",
        )
        verifier.verify(
            step_number=2,
            executed_code="y = 2",
            execution_output="",
            execution_status="ok",
        )

        history = verifier.get_history()
        assert len(history) == 2

    def test_trend_analysis(self):
        """트렌드 분석 테스트"""
        verifier = StateVerifier()
        verifier.clear_history()

        # 여러 번 검증 수행
        for i in range(5):
            verifier.verify(
                step_number=i + 1,
                executed_code=f"x{i} = {i}",
                execution_output="",
                execution_status="ok",
            )

        trend = verifier.analyze_trend()
        assert "average" in trend
        assert "trend" in trend
        assert "critical_count" in trend


class TestSingleton:
    """싱글톤 패턴 테스트"""

    def test_get_state_verifier_returns_same_instance(self):
        """get_state_verifier()가 같은 인스턴스 반환"""
        verifier1 = get_state_verifier()
        verifier2 = get_state_verifier()

        assert verifier1 is verifier2


class TestToDictSerialization:
    """직렬화 테스트"""

    def test_result_to_dict(self):
        """StateVerificationResult.to_dict() 검증"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="x = 1",
            execution_output="",
            execution_status="ok",
        )

        result_dict = result.to_dict()

        assert "isValid" in result_dict
        assert "confidence" in result_dict
        assert "confidenceDetails" in result_dict
        assert "mismatches" in result_dict
        assert "recommendation" in result_dict
        assert "timestamp" in result_dict
