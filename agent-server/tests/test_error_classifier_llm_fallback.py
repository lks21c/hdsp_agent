"""
ErrorClassifier LLM Fallback Unit Tests

LLM Fallback 조건 테스트:
1. 동일 에러로 REFINE 2회 이상 실패
2. 패턴 매핑에 없는 미지의 에러 타입
3. 복잡한 에러 (트레이스백에 2개 이상 Exception)
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent_server.core.error_classifier import (
    ErrorAnalysis,
    ErrorClassifier,
    ReplanDecision,
)


class TestShouldUseLlmFallback:
    """LLM Fallback 사용 여부 결정 테스트"""

    def test_fallback_on_multiple_attempts(self):
        """동일 에러 2회 이상 실패 시 LLM fallback 트리거"""
        classifier = ErrorClassifier()

        should_use, reason = classifier.should_use_llm_fallback(
            error_type="TypeError",
            traceback="",
            previous_attempts=2,
        )

        assert should_use is True
        assert "2회" in reason

    def test_no_fallback_on_first_attempt(self):
        """첫 번째 시도에서는 LLM fallback 안 함"""
        classifier = ErrorClassifier()

        should_use, reason = classifier.should_use_llm_fallback(
            error_type="TypeError",
            traceback="",
            previous_attempts=0,
        )

        assert should_use is False
        assert reason == ""

    def test_fallback_on_unknown_error_type(self):
        """미지의 에러 타입에서 LLM fallback 트리거"""
        classifier = ErrorClassifier()

        should_use, reason = classifier.should_use_llm_fallback(
            error_type="CustomUnknownError",
            traceback="",
            previous_attempts=0,
        )

        assert should_use is True
        assert "미지의 에러" in reason

    def test_fallback_on_complex_traceback(self):
        """복잡한 트레이스백 (2개 이상 Exception)에서 LLM fallback 트리거"""
        classifier = ErrorClassifier()
        complex_traceback = """
        Traceback (most recent call last):
          File "app.py", line 10, in main
            result = process_data()
          File "processor.py", line 25, in process_data
            raise ValueError("Invalid data")
        ValueError: Invalid data

        During handling of the above exception, another exception occurred:

        Traceback (most recent call last):
          File "app.py", line 12, in main
            handle_error()
          File "handler.py", line 5, in handle_error
            raise RuntimeError("Handler failed")
        RuntimeError: Handler failed
        """

        should_use, reason = classifier.should_use_llm_fallback(
            error_type="RuntimeError",
            traceback=complex_traceback,
            previous_attempts=0,
        )

        assert should_use is True
        assert "Exception" in reason

    def test_no_fallback_on_simple_known_error(self):
        """단순한 알려진 에러에서는 LLM fallback 안 함"""
        classifier = ErrorClassifier()

        should_use, reason = classifier.should_use_llm_fallback(
            error_type="TypeError",
            traceback="TypeError: unsupported operand type",
            previous_attempts=0,
        )

        assert should_use is False


class TestCountExceptionsInTraceback:
    """트레이스백 Exception 카운트 테스트"""

    def test_count_single_exception(self):
        """단일 Exception 카운트"""
        classifier = ErrorClassifier()
        traceback = "ValueError: invalid literal for int()"

        count = classifier._count_exceptions_in_traceback(traceback)

        assert count == 1

    def test_count_multiple_exceptions(self):
        """다중 Exception 카운트"""
        classifier = ErrorClassifier()
        traceback = """
        ValueError: invalid literal
        During handling of the above exception, another exception occurred:
        RuntimeError: failed to recover
        """

        count = classifier._count_exceptions_in_traceback(traceback)

        assert count >= 3  # ValueError, RuntimeError, "During handling..."

    def test_count_empty_traceback(self):
        """빈 트레이스백"""
        classifier = ErrorClassifier()

        count = classifier._count_exceptions_in_traceback("")

        assert count == 0


class TestErrorAnalysisNewFields:
    """ErrorAnalysis 새 필드 테스트 (used_llm, confidence)"""

    def test_default_values_for_pattern_matching(self):
        """패턴 매칭 결과의 기본값"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="TypeError",
            error_message="type error",
            traceback="",
        )

        assert result.used_llm is False
        assert result.confidence == 1.0

    def test_to_dict_includes_new_fields(self):
        """to_dict()에 새 필드 포함"""
        analysis = ErrorAnalysis(
            decision=ReplanDecision.REFINE,
            root_cause="test",
            reasoning="test reason",
            used_llm=True,
            confidence=0.85,
        )

        result_dict = analysis.to_dict()

        assert "usedLlm" in result_dict
        assert result_dict["usedLlm"] is True
        assert "confidence" in result_dict
        assert result_dict["confidence"] == 0.85


class TestParseLlmResponse:
    """LLM 응답 파싱 테스트"""

    def test_parse_valid_json_response(self):
        """유효한 JSON 응답 파싱"""
        classifier = ErrorClassifier()
        content = """
        ```json
        {
            "analysis": {
                "root_cause": "타입 불일치 문제",
                "is_approach_problem": false,
                "missing_prerequisites": []
            },
            "decision": "refine",
            "reasoning": "코드 수정으로 해결 가능",
            "confidence": 0.9,
            "changes": {
                "refined_code": null
            }
        }
        ```
        """

        result = classifier._parse_llm_response(content)

        assert result.decision == ReplanDecision.REFINE
        assert result.root_cause == "타입 불일치 문제"
        assert result.used_llm is True
        assert result.confidence == 0.9

    def test_parse_insert_steps_response(self):
        """insert_steps 결정 파싱"""
        classifier = ErrorClassifier()
        content = """
        {
            "analysis": {"root_cause": "패키지 누락"},
            "decision": "insert_steps",
            "reasoning": "패키지 설치 필요",
            "confidence": 0.95,
            "changes": {
                "new_steps": [{"description": "pandas 설치"}]
            }
        }
        """

        result = classifier._parse_llm_response(content)

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.used_llm is True

    def test_parse_invalid_json_falls_back(self):
        """잘못된 JSON은 기본값으로 폴백"""
        classifier = ErrorClassifier()
        content = "This is not valid JSON at all"

        result = classifier._parse_llm_response(content)

        assert result.decision == ReplanDecision.REFINE
        assert result.used_llm is True
        assert result.confidence == 0.3


class TestClassifyWithFallbackSync:
    """classify_with_fallback 동기 경로 테스트 (LLM 클라이언트 없음)"""

    @pytest.mark.asyncio
    async def test_uses_pattern_matching_when_no_fallback_needed(self):
        """LLM fallback 조건 불충족 시 패턴 매칭 사용"""
        classifier = ErrorClassifier()

        result = await classifier.classify_with_fallback(
            error_type="TypeError",
            error_message="type error",
            traceback="",
            previous_attempts=0,
            llm_client=None,
        )

        assert result.decision == ReplanDecision.REFINE
        assert result.used_llm is False

    @pytest.mark.asyncio
    async def test_falls_back_to_pattern_when_no_llm_client(self):
        """LLM 클라이언트 없으면 패턴 매칭으로 폴백"""
        classifier = ErrorClassifier()

        result = await classifier.classify_with_fallback(
            error_type="CustomUnknownError",  # 미지의 에러 → fallback 조건 충족
            error_message="unknown error",
            traceback="",
            previous_attempts=0,
            llm_client=None,  # 클라이언트 없음
        )

        # LLM 없으므로 패턴 매칭으로 폴백
        assert result.used_llm is False


class TestClassifyWithFallbackAsync:
    """classify_with_fallback 비동기 경로 테스트 (LLM 클라이언트 있음)"""

    @pytest.mark.asyncio
    async def test_uses_llm_when_conditions_met(self):
        """LLM fallback 조건 충족 시 LLM 사용"""
        classifier = ErrorClassifier()

        # Mock LLM client
        mock_llm_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content="""
                    ```json
                    {
                        "analysis": {"root_cause": "LLM analyzed error"},
                        "decision": "replace_step",
                        "reasoning": "LLM suggests replacement",
                        "confidence": 0.85,
                        "changes": {}
                    }
                    ```
                    """
                )
            )
        ]
        mock_llm_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await classifier.classify_with_fallback(
            error_type="CustomUnknownError",  # 미지의 에러 → fallback 조건 충족
            error_message="unknown error",
            traceback="",
            previous_attempts=0,
            llm_client=mock_llm_client,
        )

        assert result.decision == ReplanDecision.REPLACE_STEP
        assert result.used_llm is True
        assert result.confidence == 0.85

    @pytest.mark.asyncio
    async def test_falls_back_on_llm_error(self):
        """LLM 호출 실패 시 패턴 매칭으로 폴백"""
        classifier = ErrorClassifier()

        # Mock LLM client that raises an error
        mock_llm_client = MagicMock()
        mock_llm_client.chat.completions.create = AsyncMock(
            side_effect=Exception("API error")
        )

        result = await classifier.classify_with_fallback(
            error_type="CustomUnknownError",
            error_message="unknown error",
            traceback="",
            previous_attempts=0,
            llm_client=mock_llm_client,
        )

        # LLM 실패 → 패턴 매칭으로 폴백
        assert result.used_llm is False
        assert "LLM 실패" in result.reasoning
