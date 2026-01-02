"""
Error Recovery Scenarios - E2E Integration Tests

에러 복구 시나리오 통합 테스트 - Mock LLM 사용, 토큰 0
전체 흐름: 에러 발생 → 분류 → 상태 검증 → 복구 결정
"""

from agent_server.core.error_classifier import (
    ErrorClassifier,
    ReplanDecision,
)
from agent_server.core.state_verifier import (
    MismatchType,
    Recommendation,
    StateVerifier,
)


class TestCSVLoadEncodingErrorRecovery:
    """
    시나리오: CSV 로드 → 인코딩 에러 → 자동 수정

    Step 1: import pandas (성공)
    Step 2: df = pd.read_csv('data.csv') (실패 - UnicodeDecodeError)
    → ErrorClassifier: REFINE 결정
    → StateVerifier: REPLAN 권장
    Step 2 (Refined): df = pd.read_csv('data.csv', encoding='utf-8') (성공)
    """

    def test_unicode_error_triggers_refine(self):
        """UnicodeDecodeError → REFINE 결정"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="UnicodeDecodeError",
            error_message="'utf-8' codec can't decode byte 0x80",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE
        assert "코드 수정" in result.reasoning

    def test_state_verifier_detects_encoding_error(self):
        """StateVerifier가 인코딩 에러 감지"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('data.csv')",
            execution_output="",
            execution_status="error",
            error_message="UnicodeDecodeError: 'utf-8' codec can't decode",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd"],
        )

        assert not result.is_valid
        assert result.recommendation in (Recommendation.REPLAN, Recommendation.ESCALATE)

    def test_recovery_flow_integration(self):
        """전체 복구 흐름 통합 테스트"""
        classifier = ErrorClassifier()
        verifier = StateVerifier()
        verifier.clear_history()

        # Step 1: import pandas (성공)
        step1_result = verifier.verify(
            step_number=1,
            executed_code="import pandas as pd",
            execution_output="",
            execution_status="ok",
        )
        assert step1_result.is_valid

        # Step 2: CSV 로드 (실패)
        step2_result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('data.csv')",
            execution_output="",
            execution_status="error",
            error_message="UnicodeDecodeError: 'utf-8' codec can't decode",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd"],
        )
        assert not step2_result.is_valid

        # 에러 분류
        error_analysis = classifier.classify(
            error_type="UnicodeDecodeError",
            error_message="'utf-8' codec can't decode",
            traceback="",
        )
        assert error_analysis.decision == ReplanDecision.REFINE

        # Step 2 (Refined): 성공
        step2_refined_result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('data.csv', encoding='cp949')",
            execution_output="DataFrame loaded",
            execution_status="ok",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd", "df"],
        )
        assert step2_refined_result.is_valid


class TestMissingPackageAutoInstall:
    """
    시나리오: 패키지 미설치 → pip install 추가 → 재시도

    Step 1: import dask (실패 - ModuleNotFoundError)
    → ErrorClassifier: INSERT_STEPS 결정 + pip install 코드 생성
    Step 1.1 (추가): !pip install dask (성공)
    Step 1 (재시도): import dask (성공)
    """

    def test_module_not_found_triggers_install_step(self):
        """ModuleNotFoundError → pip install 스텝 추가"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'dask'",
            traceback="",
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "dask"
        assert "new_steps" in result.changes
        assert len(result.changes["new_steps"]) > 0

    def test_pip_install_code_generation(self):
        """pip install 코드가 올바르게 생성되는지"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'lightgbm'",
            traceback="",
        )

        new_steps = result.changes.get("new_steps", [])
        assert len(new_steps) > 0

        pip_step = new_steps[0]
        assert "toolCalls" in pip_step
        assert pip_step["toolCalls"][0]["tool"] == "jupyter_cell"

        pip_code = pip_step["toolCalls"][0]["parameters"]["code"]
        assert "pip install" in pip_code
        assert "lightgbm" in pip_code

    def test_state_verifier_detects_import_failure(self):
        """StateVerifier가 import 실패 감지"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="import dask",
            execution_output="",
            execution_status="error",
            error_message="ModuleNotFoundError: No module named 'dask'",
        )

        import_mismatch = next(
            (m for m in result.mismatches if m.type == MismatchType.IMPORT_FAILED),
            None,
        )
        assert import_mismatch is not None
        assert "dask" in import_mismatch.description

    def test_full_recovery_flow(self):
        """패키지 설치 전체 복구 흐름"""
        classifier = ErrorClassifier()
        verifier = StateVerifier()
        verifier.clear_history()

        # Step 1: import dask (실패)
        step1_result = verifier.verify(
            step_number=1,
            executed_code="import dask.dataframe as dd",
            execution_output="",
            execution_status="error",
            error_message="ModuleNotFoundError: No module named 'dask'",
        )
        assert not step1_result.is_valid

        # 에러 분류 → INSERT_STEPS
        error_analysis = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'dask'",
            traceback="",
        )
        assert error_analysis.decision == ReplanDecision.INSERT_STEPS

        # Step 1.1: pip install (성공 가정)
        step1_1_result = verifier.verify(
            step_number=1,
            executed_code="!pip install dask",
            execution_output="Successfully installed dask-2024.1.0",
            execution_status="ok",
        )
        assert step1_1_result.is_valid

        # Step 1 재시도: import dask (성공)
        step1_retry_result = verifier.verify(
            step_number=1,
            executed_code="import dask.dataframe as dd",
            execution_output="",
            execution_status="ok",
        )
        assert step1_retry_result.is_valid


class TestDlopenErrorEscalation:
    """
    시나리오: dlopen 에러 (시스템 라이브러리 문제)

    Step 1: import lightgbm (실패 - OSError/dlopen)
    → ErrorClassifier: REPLAN_REMAINING 결정
    → 사용자에게 시스템 라이브러리 설치 안내 필요
    """

    def test_dlopen_error_triggers_replan_remaining(self):
        """dlopen 에러 → REPLAN_REMAINING"""
        classifier = ErrorClassifier()

        # 실제 LightGBM dlopen 에러 메시지
        error_message = (
            "dlopen(/path/to/lib_lightgbm.dylib, 0x0006): "
            "Library not loaded: @rpath/libomp.dylib\n"
            "Referenced from: /path/to/lib_lightgbm.dylib\n"
            "Reason: tried: '/opt/homebrew/opt/libomp/lib/libomp.dylib' (no such file)"
        )

        result = classifier.classify(
            error_type="OSError",
            error_message=error_message,
            traceback="",
        )

        assert result.decision == ReplanDecision.REPLAN_REMAINING
        assert "system_dependency" in result.changes

    def test_state_verifier_detects_critical_error(self):
        """StateVerifier가 critical 에러 감지"""
        verifier = StateVerifier()
        result = verifier.verify(
            step_number=1,
            executed_code="import lightgbm",
            execution_output="",
            execution_status="error",
            error_message="OSError: dlopen(/path/to/lib_lightgbm.dylib): Library not loaded",
        )

        assert not result.is_valid
        exception_mismatch = next(
            (m for m in result.mismatches if m.type == MismatchType.EXCEPTION_OCCURRED),
            None,
        )
        assert exception_mismatch is not None
        assert exception_mismatch.severity.value == "critical"


class TestMultipleSequentialErrors:
    """
    시나리오: 여러 에러가 순차적으로 발생하는 경우

    Step 1: import pandas (성공)
    Step 2: df = pd.read_csv('data.csv') (실패 - FileNotFoundError)
    → REFINE → 경로 수정
    Step 2 (Refined): df = pd.read_csv('./data/data.csv') (실패 - UnicodeDecodeError)
    → REFINE → 인코딩 수정
    Step 2 (Refined 2): df = pd.read_csv('./data/data.csv', encoding='cp949') (성공)
    """

    def test_sequential_error_handling(self):
        """순차적 에러 처리"""
        classifier = ErrorClassifier()
        verifier = StateVerifier()
        verifier.clear_history()

        # Step 2 첫 번째 시도: FileNotFoundError
        step2_v1_result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('data.csv')",
            execution_output="",
            execution_status="error",
            error_message="FileNotFoundError: [Errno 2] No such file or directory",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd"],
        )
        assert not step2_v1_result.is_valid

        error1 = classifier.classify(
            error_type="FileNotFoundError",
            error_message="[Errno 2] No such file or directory",
            traceback="",
        )
        assert error1.decision == ReplanDecision.REFINE

        # Step 2 두 번째 시도: UnicodeDecodeError
        step2_v2_result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('./data/data.csv')",
            execution_output="",
            execution_status="error",
            error_message="UnicodeDecodeError: 'utf-8' codec can't decode",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd"],
        )
        assert not step2_v2_result.is_valid

        error2 = classifier.classify(
            error_type="UnicodeDecodeError",
            error_message="'utf-8' codec can't decode",
            traceback="",
        )
        assert error2.decision == ReplanDecision.REFINE

        # Step 2 세 번째 시도: 성공
        step2_v3_result = verifier.verify(
            step_number=2,
            executed_code="df = pd.read_csv('./data/data.csv', encoding='cp949')",
            execution_output="DataFrame loaded successfully",
            execution_status="ok",
            expected_variables=["df"],
            previous_variables=["pd"],
            current_variables=["pd", "df"],
        )
        assert step2_v3_result.is_valid

        # 트렌드 분석
        trend = verifier.analyze_trend()
        assert trend["critical_count"] == 2  # 두 번의 실패


class TestComplexDependencyScenario:
    """
    시나리오: 복잡한 의존성 체인

    dask 설치 → pyarrow 설치 → 데이터 로드
    간접 의존성 에러 처리
    """

    def test_indirect_dependency_error(self):
        """간접 의존성 에러 (pyarrow가 dask에 필요)"""
        classifier = ErrorClassifier()

        # dask import 시 pyarrow 간접 의존성 에러
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'pyarrow'",
            traceback="File dask/dataframe/io/parquet/core.py\n"
            "  import pyarrow as pa\n"
            "ModuleNotFoundError: No module named 'pyarrow'",
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "pyarrow"

    def test_chained_package_installation(self):
        """연쇄 패키지 설치 시나리오"""
        classifier = ErrorClassifier()
        verifier = StateVerifier()
        verifier.clear_history()

        # Step 1: dask import (실패 - dask 없음)
        error1 = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'dask'",
            traceback="",
        )
        assert error1.decision == ReplanDecision.INSERT_STEPS
        assert error1.missing_package == "dask"

        # pip install dask (성공 가정)

        # Step 1 재시도: dask import (실패 - pyarrow 없음)
        error2 = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'pyarrow'",
            traceback="",
        )
        assert error2.decision == ReplanDecision.INSERT_STEPS
        assert error2.missing_package == "pyarrow"

        # pip install pyarrow (성공 가정)

        # Step 1 최종: 성공
        final_result = verifier.verify(
            step_number=1,
            executed_code="import dask.dataframe as dd",
            execution_output="",
            execution_status="ok",
        )
        assert final_result.is_valid


class TestErrorAnalysisSerialization:
    """ErrorAnalysis 직렬화 테스트"""

    def test_error_analysis_to_dict(self):
        """ErrorAnalysis.to_dict() 검증"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'pandas'",
            traceback="",
        )

        result_dict = result.to_dict()

        assert "analysis" in result_dict
        assert "decision" in result_dict
        assert "reasoning" in result_dict
        assert "changes" in result_dict

        assert result_dict["analysis"]["root_cause"] is not None
        assert result_dict["decision"] == "insert_steps"
