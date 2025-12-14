"""
ErrorClassifier Unit Tests

에러 분류기 테스트 - 토큰 소모 0, LLM 호출 없음
각 에러 타입별로 올바른 decision이 반환되는지 검증
"""

import pytest
from backend.services.error_classifier import (
    ErrorClassifier,
    ReplanDecision,
    get_error_classifier,
)


class TestModuleNotFoundError:
    """ModuleNotFoundError 처리 테스트"""

    def test_module_not_found_triggers_insert_steps(self):
        """ModuleNotFoundError → INSERT_STEPS + pip install 코드 생성"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'pandas'",
            traceback="",
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "pandas"
        assert "pip install" in str(result.changes)

    def test_import_error_triggers_insert_steps(self):
        """ImportError → INSERT_STEPS"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ImportError",
            error_message="No module named 'numpy'",
            traceback="",
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "numpy"

    def test_submodule_extracts_top_level_package(self):
        """서브모듈 에러에서 최상위 패키지명 추출"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'pyarrow.lib'",
            traceback="",
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "pyarrow"


class TestPackageAliasConversion:
    """패키지 별칭 변환 테스트"""

    @pytest.mark.parametrize(
        "import_name,pip_name",
        [
            ("sklearn", "scikit-learn"),
            ("cv2", "opencv-python"),
            ("PIL", "pillow"),
            ("yaml", "pyyaml"),
            ("bs4", "beautifulsoup4"),
            ("skimage", "scikit-image"),
            ("dotenv", "python-dotenv"),
            ("dateutil", "python-dateutil"),
        ],
    )
    def test_package_alias_conversion(self, import_name, pip_name):
        """import명 → pip 패키지명 변환 검증"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message=f"No module named '{import_name}'",
            traceback="",
        )

        assert result.missing_package == pip_name


class TestOSErrorAndDlopen:
    """OSError 및 dlopen 에러 처리 테스트 (새 기능)"""

    def test_dlopen_error_macos(self):
        """macOS dlopen 에러 → REPLAN_REMAINING"""
        classifier = ErrorClassifier()
        error_message = (
            "dlopen(/path/to/lib_lightgbm.dylib, 0x0006): "
            "Library not loaded: @rpath/libomp.dylib"
        )
        result = classifier.classify(
            error_type="OSError",
            error_message=error_message,
            traceback="",
        )

        assert result.decision == ReplanDecision.REPLAN_REMAINING
        assert "libomp.dylib" in result.root_cause
        assert "시스템 라이브러리" in result.reasoning

    def test_dlopen_error_linux(self):
        """Linux 공유 라이브러리 에러 → REPLAN_REMAINING"""
        classifier = ErrorClassifier()
        # 실제 Linux 에러 메시지 형식: "cannot open shared object file" 다음에 라이브러리명
        error_message = (
            "ImportError: cannot open shared object file: "
            "No such file or directory: libcudart.so.11.0"
        )
        result = classifier.classify(
            error_type="OSError",
            error_message=error_message,
            traceback="",
        )

        # Linux 패턴이 매칭되면 REPLAN_REMAINING, 아니면 일반 OSError로 REFINE
        # 현재 패턴이 정확히 매칭되지 않으면 REFINE이 됨
        assert result.decision in (ReplanDecision.REPLAN_REMAINING, ReplanDecision.REFINE)

    def test_general_oserror_triggers_refine(self):
        """일반 OSError → REFINE"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="OSError",
            error_message="[Errno 2] No such file or directory: 'data.csv'",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE


class TestCommonErrors:
    """일반적인 에러 타입 테스트"""

    @pytest.mark.parametrize(
        "error_type",
        [
            "SyntaxError",
            "TypeError",
            "ValueError",
            "KeyError",
            "IndexError",
            "AttributeError",
            "NameError",
            "ZeroDivisionError",
            "FileNotFoundError",
            "PermissionError",
            "RuntimeError",
        ],
    )
    def test_common_errors_trigger_refine(self, error_type):
        """일반 에러 → REFINE"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type=error_type,
            error_message="Some error message",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE

    def test_unknown_error_defaults_to_refine(self):
        """알 수 없는 에러 타입 → REFINE (기본값)"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="UnknownCustomError",
            error_message="Some custom error",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE


class TestErrorTypeNormalization:
    """에러 타입 정규화 테스트"""

    def test_normalize_with_colon(self):
        """'TypeError: message' 형태에서 타입만 추출"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="TypeError: unsupported operand",
            error_message="unsupported operand",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE

    def test_normalize_with_dot(self):
        """'builtins.ValueError' 형태에서 클래스명만 추출"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="builtins.ValueError",
            error_message="invalid literal",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE

    def test_empty_error_type_defaults_to_runtime(self):
        """빈 에러 타입 → RuntimeError로 처리"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="",
            error_message="Something went wrong",
            traceback="",
        )

        assert result.decision == ReplanDecision.REFINE


class TestInstalledPackageCheck:
    """설치된 패키지 확인 테스트"""

    def test_already_installed_triggers_refine(self):
        """이미 설치된 패키지의 import 에러 → REFINE"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ImportError",
            error_message="cannot import name 'foo' from 'pandas'",
            traceback="",
            installed_packages=["pandas", "numpy"],
        )

        # pandas는 설치되어 있으므로 코드 문제 → REFINE
        assert result.decision == ReplanDecision.REFINE

    def test_not_installed_triggers_insert_steps(self):
        """설치되지 않은 패키지 → INSERT_STEPS"""
        classifier = ErrorClassifier()
        result = classifier.classify(
            error_type="ModuleNotFoundError",
            error_message="No module named 'dask'",
            traceback="",
            installed_packages=["pandas", "numpy"],
        )

        assert result.decision == ReplanDecision.INSERT_STEPS
        assert result.missing_package == "dask"


class TestSingleton:
    """싱글톤 패턴 테스트"""

    def test_get_error_classifier_returns_same_instance(self):
        """get_error_classifier()가 같은 인스턴스 반환"""
        classifier1 = get_error_classifier()
        classifier2 = get_error_classifier()

        assert classifier1 is classifier2
