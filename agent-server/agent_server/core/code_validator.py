"""
Code Validator Service
Ruff/Pyflakes/AST 기반 코드 품질 검증 서비스

실행 전 코드의 문법 오류, 미정의 변수, 미사용 import,
코딩 스타일, 보안 취약점 등을 사전 감지

검증 도구:
- Ruff: 초고속 린터 (Rust 기반, 700+ 규칙)
- Pyflakes: 미사용 import/변수 감지 (fallback)
- AST: 구문 분석 및 의존성 추출
"""

import ast
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple


class IssueSeverity(Enum):
    """검증 이슈 심각도"""

    ERROR = "error"  # 실행 실패 예상
    WARNING = "warning"  # 잠재적 문제
    INFO = "info"  # 참고 정보


class IssueCategory(Enum):
    """검증 이슈 카테고리"""

    SYNTAX = "syntax"  # 문법 오류
    UNDEFINED_NAME = "undefined_name"  # 미정의 변수/함수
    UNUSED_IMPORT = "unused_import"  # 미사용 import
    UNUSED_VARIABLE = "unused_variable"  # 미사용 변수
    REDEFINED = "redefined"  # 재정의
    IMPORT_ERROR = "import_error"  # import 오류
    TYPE_ERROR = "type_error"  # 타입 관련 이슈
    STYLE = "style"  # 코딩 스타일 (Ruff)
    SECURITY = "security"  # 보안 취약점 (Ruff)
    COMPLEXITY = "complexity"  # 코드 복잡도 (Ruff)
    BEST_PRACTICE = "best_practice"  # 권장 사항 (Ruff)


@dataclass
class ValidationIssue:
    """검증 이슈"""

    severity: IssueSeverity
    category: IssueCategory
    message: str
    line: Optional[int] = None
    column: Optional[int] = None
    code_snippet: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity.value,
            "category": self.category.value,
            "message": self.message,
            "line": self.line,
            "column": self.column,
            "code_snippet": self.code_snippet,
        }


@dataclass
class DependencyInfo:
    """코드 의존성 정보"""

    imports: List[str] = field(default_factory=list)  # import된 모듈
    from_imports: Dict[str, List[str]] = field(default_factory=dict)  # from X import Y
    defined_names: List[str] = field(default_factory=list)  # 정의된 변수/함수/클래스
    used_names: List[str] = field(default_factory=list)  # 사용된 이름들
    undefined_names: List[str] = field(default_factory=list)  # 미정의 이름들

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imports": self.imports,
            "from_imports": self.from_imports,
            "defined_names": self.defined_names,
            "used_names": self.used_names,
            "undefined_names": self.undefined_names,
        }


@dataclass
class ValidationResult:
    """검증 결과"""

    is_valid: bool
    issues: List[ValidationIssue] = field(default_factory=list)
    dependencies: Optional[DependencyInfo] = None
    has_errors: bool = False
    has_warnings: bool = False
    summary: str = ""
    fixed_code: Optional[str] = None  # 자동 수정된 코드
    fixed_count: int = 0  # 자동 수정된 이슈 수

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "issues": [issue.to_dict() for issue in self.issues],
            "dependencies": self.dependencies.to_dict() if self.dependencies else None,
            "has_errors": self.has_errors,
            "has_warnings": self.has_warnings,
            "summary": self.summary,
            "fixed_code": self.fixed_code,
            "fixed_count": self.fixed_count,
        }


class CodeValidator:
    """코드 품질 검증 서비스"""

    # Python 내장 이름들 (미정의로 잡히면 안 되는 것들)
    BUILTIN_NAMES = set(
        dir(__builtins__) if isinstance(__builtins__, dict) else dir(__builtins__)
    )
    BUILTIN_NAMES.update(
        {
            "True",
            "False",
            "None",
            "print",
            "len",
            "range",
            "str",
            "int",
            "float",
            "list",
            "dict",
            "set",
            "tuple",
            "bool",
            "type",
            "object",
            "super",
            "open",
            "input",
            "sorted",
            "reversed",
            "enumerate",
            "zip",
            "map",
            "filter",
            "all",
            "any",  # ★ 중요: iterable 검사 내장 함수
            "sum",
            "min",
            "max",
            "abs",
            "round",
            "pow",
            "divmod",
            "isinstance",
            "issubclass",
            "hasattr",
            "getattr",
            "setattr",
            "delattr",
            "callable",
            "iter",
            "next",
            "id",
            "hash",
            "repr",
            "ascii",
            "bin",
            "hex",
            "oct",
            "ord",
            "chr",
            "format",
            "vars",
            "dir",
            "help",
            "locals",
            "globals",
            "slice",
            "frozenset",
            "bytes",
            "bytearray",
            "memoryview",  # ★ 추가 내장 타입
            "complex",
            "setattr",
            "delattr",  # ★ 추가 내장 함수
            "staticmethod",
            "classmethod",
            "property",
            "exec",
            "eval",
            "compile",
            "globals",
            "locals",
            "breakpoint",
            "Exception",
            "BaseException",
            "ValueError",
            "TypeError",
            "KeyError",
            "IndexError",
            "AttributeError",
            "ImportError",
            "RuntimeError",
            "StopIteration",
            "GeneratorExit",
            "AssertionError",
            "NotImplementedError",
            "NameError",
            "ZeroDivisionError",
            "FileNotFoundError",
            "IOError",
            "OSError",
            "PermissionError",
            "TimeoutError",
            "ConnectionError",
            "BrokenPipeError",
            "MemoryError",
            "RecursionError",
            "OverflowError",
            "FloatingPointError",
            "ArithmeticError",
            "LookupError",
            "UnicodeError",
            "UnicodeDecodeError",
            "UnicodeEncodeError",
            "SyntaxError",
            "IndentationError",
            "TabError",
            "SystemError",
            "SystemExit",
            "KeyboardInterrupt",
            "BufferError",
            "EOFError",
            "ModuleNotFoundError",
            "UnboundLocalError",
            "ReferenceError",
            "EnvironmentError",
            "Warning",
            "UserWarning",
            "DeprecationWarning",
            "PendingDeprecationWarning",
            "RuntimeWarning",
            "SyntaxWarning",
            "FutureWarning",
            "ImportWarning",
            "UnicodeWarning",
            "BytesWarning",
            "ResourceWarning",
            "ConnectionAbortedError",
            "ConnectionRefusedError",
            "ConnectionResetError",
            "FileExistsError",
            "IsADirectoryError",
            "NotADirectoryError",
            "InterruptedError",
            "ChildProcessError",
            "ProcessLookupError",
            "BlockingIOError",
            "__name__",
            "__file__",
            "__doc__",
            "__package__",
            # Jupyter/IPython 특수 변수
            "In",
            "Out",
            "_",
            "__",
            "___",
            "get_ipython",
            "display",
            "_i",
            "_ii",
            "_iii",
            "_ih",
            "_oh",
            "_dh",
        }
    )

    # 일반적인 데이터 과학 라이브러리들 (미정의로 잡히면 안 되는 것들)
    COMMON_LIBRARY_NAMES = {
        # 데이터 처리
        "pd",
        "np",
        "dd",
        "da",
        "xr",  # pandas, numpy, dask.dataframe, dask.array, xarray
        # 시각화
        "plt",
        "sns",
        "px",
        "go",
        "fig",
        "ax",  # matplotlib, seaborn, plotly
        # 머신러닝
        "tf",
        "torch",
        "sk",
        "nn",
        "F",
        "optim",  # tensorflow, pytorch, sklearn
        # 기타 라이브러리
        "scipy",
        "cv2",
        "PIL",
        "Image",
        "requests",
        "json",
        "os",
        "sys",
        "re",
        "datetime",
        "time",
        "math",
        "random",
        "collections",
        "itertools",
        "functools",
        # 추가 common aliases
        "tqdm",
        "glob",
        "Path",
        "pickle",
        "csv",
        "io",
        "logging",
        "warnings",
        "gc",
        "subprocess",
        "shutil",
        "pathlib",
        "typing",
        "copy",
        "multiprocessing",
    }

    def __init__(self, notebook_context: Optional[Dict[str, Any]] = None):
        """
        Args:
            notebook_context: 노트북 컨텍스트 (이전 셀에서 정의된 변수 등)
        """
        self.notebook_context = notebook_context or {}
        self.known_names = set()
        self._init_known_names()

    def _preprocess_jupyter_code(self, code: str) -> str:
        """Jupyter magic command 전처리 (AST 파싱 전)

        ! 로 시작하는 셸 명령과 % 로 시작하는 매직 명령을
        pass 문으로 대체하여 AST 파싱이 가능하도록 함
        """
        lines = code.split("\n")
        processed_lines = []

        for line in lines:
            stripped = line.lstrip()
            # ! 셸 명령어 (예: !pip install, !{sys.executable})
            if stripped.startswith("!"):
                # 들여쓰기 유지하면서 pass로 대체
                indent = len(line) - len(stripped)
                processed_lines.append(" " * indent + "pass  # shell command")
            # % 매직 명령어 (예: %matplotlib inline, %%time)
            elif stripped.startswith("%"):
                indent = len(line) - len(stripped)
                processed_lines.append(" " * indent + "pass  # magic command")
            else:
                processed_lines.append(line)

        return "\n".join(processed_lines)

    def _init_known_names(self):
        """노트북 컨텍스트에서 알려진 이름들 초기화"""
        self.known_names.update(self.BUILTIN_NAMES)
        self.known_names.update(self.COMMON_LIBRARY_NAMES)

        # 노트북에서 정의된 변수들
        defined_vars = self.notebook_context.get("definedVariables", [])
        self.known_names.update(defined_vars)

        # 노트북에서 import된 라이브러리들
        imported_libs = self.notebook_context.get("importedLibraries", [])
        self.known_names.update(imported_libs)

    def validate_syntax(self, code: str) -> ValidationResult:
        """AST 기반 문법 검사"""
        issues = []

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)

        try:
            ast.parse(processed_code)
        except SyntaxError as e:
            issues.append(
                ValidationIssue(
                    severity=IssueSeverity.ERROR,
                    category=IssueCategory.SYNTAX,
                    message=f"문법 오류: {e.msg}",
                    line=e.lineno,
                    column=e.offset,
                    code_snippet=e.text.strip() if e.text else None,
                )
            )

        has_errors = any(issue.severity == IssueSeverity.ERROR for issue in issues)

        return ValidationResult(
            is_valid=not has_errors,
            issues=issues,
            has_errors=has_errors,
            has_warnings=False,
            summary="문법 오류 없음"
            if not has_errors
            else f"문법 오류 {len(issues)}개 발견",
        )

    def analyze_dependencies(self, code: str) -> DependencyInfo:
        """코드의 의존성 분석 (import, 정의된 이름, 사용된 이름)"""
        deps = DependencyInfo()

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)

        try:
            tree = ast.parse(processed_code)
        except SyntaxError:
            return deps

        # import 분석
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.asname if alias.asname else alias.name
                    deps.imports.append(name)
                    deps.defined_names.append(name.split(".")[0])

            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                imported_names = []
                for alias in node.names:
                    name = alias.asname if alias.asname else alias.name
                    imported_names.append(name)
                    deps.defined_names.append(name)
                deps.from_imports[module] = imported_names

        # 정의된 이름 분석
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) or isinstance(
                node, ast.AsyncFunctionDef
            ):
                deps.defined_names.append(node.name)
            elif isinstance(node, ast.ClassDef):
                deps.defined_names.append(node.name)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        deps.defined_names.append(target.id)
                    elif isinstance(target, ast.Tuple):
                        for elt in target.elts:
                            if isinstance(elt, ast.Name):
                                deps.defined_names.append(elt.id)
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                deps.defined_names.append(node.target.id)
            elif isinstance(node, ast.For):
                # for 루프 변수 처리 (단일 변수 및 튜플 언패킹)
                if isinstance(node.target, ast.Name):
                    deps.defined_names.append(node.target.id)
                elif isinstance(node.target, ast.Tuple):
                    for elt in node.target.elts:
                        if isinstance(elt, ast.Name):
                            deps.defined_names.append(elt.id)
            # ★ Exception handler 변수 처리 (except Exception as e:)
            elif isinstance(node, ast.ExceptHandler) and node.name:
                deps.defined_names.append(node.name)
            # ★ List/Set/Dict comprehension 및 Generator expression의 루프 변수 처리
            elif isinstance(
                node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)
            ):
                for generator in node.generators:
                    if isinstance(generator.target, ast.Name):
                        deps.defined_names.append(generator.target.id)
                    elif isinstance(generator.target, ast.Tuple):
                        for elt in generator.target.elts:
                            if isinstance(elt, ast.Name):
                                deps.defined_names.append(elt.id)
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                for item in node.items:
                    if item.optional_vars and isinstance(item.optional_vars, ast.Name):
                        deps.defined_names.append(item.optional_vars.id)
            # ★ Lambda 매개변수 처리
            elif isinstance(node, ast.Lambda):
                for arg in node.args.args:
                    deps.defined_names.append(arg.arg)
                # *args, **kwargs도 처리
                if node.args.vararg:
                    deps.defined_names.append(node.args.vararg.arg)
                if node.args.kwarg:
                    deps.defined_names.append(node.args.kwarg.arg)

        # 사용된 이름 분석
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                deps.used_names.append(node.id)

        # 중복 제거
        deps.defined_names = list(set(deps.defined_names))
        deps.used_names = list(set(deps.used_names))

        return deps

    def check_undefined_names(self, code: str) -> List[ValidationIssue]:
        """미정의 변수/함수 감지

        모듈 attribute access 패턴(xxx.yyy)에서 xxx가 undefined인 경우:
        - WARNING으로 처리 (import 가능성 있음)
        - 실제 실행에서 ModuleNotFoundError로 구체적인 에러를 받을 수 있음
        """
        issues = []

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)

        try:
            tree = ast.parse(processed_code)
        except SyntaxError:
            return issues

        deps = self.analyze_dependencies(code)

        # 코드에서 정의된 이름들 수집
        local_defined = set(deps.defined_names)

        # attribute access의 대상이 되는 이름들 수집 (xxx.yyy 패턴의 xxx)
        attribute_access_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute):
                # xxx.yyy 형태에서 xxx 추출
                current = node.value
                while isinstance(current, ast.Attribute):
                    current = current.value
                if isinstance(current, ast.Name):
                    attribute_access_names.add(current.id)

        # 사용된 이름 중 정의되지 않은 것 찾기
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                name = node.id
                if (
                    name not in local_defined
                    and name not in self.known_names
                    and not name.startswith("_")
                ):
                    # 모듈 attribute access 패턴인지 확인 (xxx.yyy의 xxx)
                    # 이 경우 import 가능성이 있으므로 WARNING으로 처리
                    if name in attribute_access_names:
                        issues.append(
                            ValidationIssue(
                                severity=IssueSeverity.WARNING,
                                category=IssueCategory.UNDEFINED_NAME,
                                message=f"'{name}'이(가) 정의되지 않았습니다 (모듈 import 필요 가능성)",
                                line=node.lineno,
                                column=node.col_offset,
                            )
                        )
                    else:
                        issues.append(
                            ValidationIssue(
                                severity=IssueSeverity.ERROR,
                                category=IssueCategory.UNDEFINED_NAME,
                                message=f"'{name}'이(가) 정의되지 않았습니다",
                                line=node.lineno,
                                column=node.col_offset,
                            )
                        )
                    deps.undefined_names.append(name)

        # 중복 이슈 제거 (같은 이름에 대해 여러 번 보고하지 않음)
        seen_names = set()
        unique_issues = []
        for issue in issues:
            name = issue.message.split("'")[1]
            if name not in seen_names:
                seen_names.add(name)
                unique_issues.append(issue)

        return unique_issues

    def check_with_pyflakes(self, code: str) -> List[ValidationIssue]:
        """Pyflakes 정적 분석 (사용 가능한 경우)

        undefined name 처리 시 모듈 attribute access 패턴을 확인하여
        WARNING으로 처리 (실제 실행에서 구체적인 에러를 받을 수 있도록)
        """
        issues = []

        try:
            from pyflakes import api as pyflakes_api
            from pyflakes import reporter as pyflakes_reporter
        except ImportError:
            # pyflakes가 설치되지 않은 경우 스킵
            return issues

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)

        # attribute access 패턴 감지를 위해 AST 분석
        attribute_access_names = set()
        try:
            tree = ast.parse(processed_code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute):
                    current = node.value
                    while isinstance(current, ast.Attribute):
                        current = current.value
                    if isinstance(current, ast.Name):
                        attribute_access_names.add(current.id)
        except SyntaxError:
            pass

        # Pyflakes 출력 캡처
        warning_stream = StringIO()
        error_stream = StringIO()

        reporter = pyflakes_reporter.Reporter(warning_stream, error_stream)

        try:
            pyflakes_api.check(processed_code, "<code>", reporter)
        except Exception:
            return issues

        # 경고 파싱
        warnings_output = warning_stream.getvalue()
        for line in warnings_output.strip().split("\n"):
            if not line:
                continue

            # Pyflakes 출력 형식: <file>:<line>:<col>: <message>
            # 또는: <file>:<line>: <message>
            parts = line.split(":", 3)
            if len(parts) >= 3:
                try:
                    line_num = int(parts[1])
                    message = parts[-1].strip()

                    # 카테고리 결정
                    category = IssueCategory.UNDEFINED_NAME
                    severity = IssueSeverity.WARNING

                    if "undefined name" in message.lower():
                        category = IssueCategory.UNDEFINED_NAME
                        # undefined name에서 이름 추출하여 패턴 확인
                        # 형식: "undefined name 'xxx'"
                        match = re.search(r"'([^']+)'", message)
                        if match:
                            undef_name = match.group(1)
                            # ★ 노트북 컨텍스트에서 이미 알려진 이름이면 무시
                            if undef_name in self.known_names:
                                continue  # 이 이슈는 추가하지 않음
                            elif undef_name in attribute_access_names:
                                # 모듈 패턴이면 WARNING (실제 실행에서 구체적인 에러 확인)
                                severity = IssueSeverity.WARNING
                                message = f"{message} (모듈 import 필요 가능성)"
                            else:
                                severity = IssueSeverity.ERROR
                        else:
                            severity = IssueSeverity.ERROR
                    elif "imported but unused" in message.lower():
                        category = IssueCategory.UNUSED_IMPORT
                        severity = IssueSeverity.WARNING
                    elif "assigned to but never used" in message.lower():
                        category = IssueCategory.UNUSED_VARIABLE
                        severity = IssueSeverity.INFO
                    elif "redefinition" in message.lower():
                        category = IssueCategory.REDEFINED
                        severity = IssueSeverity.WARNING

                    issues.append(
                        ValidationIssue(
                            severity=severity,
                            category=category,
                            message=message,
                            line=line_num,
                        )
                    )
                except (ValueError, IndexError):
                    continue

        return issues

    def check_with_ruff(
        self, code: str, auto_fix: bool = True
    ) -> Tuple[str, List[ValidationIssue]]:
        """Ruff 기반 고급 정적 분석 (700+ 규칙) + 자동 수정

        Args:
            code: 검사할 Python 코드
            auto_fix: True면 자동 수정 가능한 이슈를 수정하고 수정된 코드 반환

        Returns:
            Tuple of (fixed_code, unfixable_issues)
            - fixed_code: 자동 수정된 코드 (auto_fix=False면 원본 코드)
            - unfixable_issues: 자동 수정 불가능한 이슈 목록

        Ruff 규칙 카테고리:
        - F: Pyflakes (미정의/미사용 변수)
        - E/W: pycodestyle (스타일)
        - C90: mccabe (복잡도)
        - S: flake8-bandit (보안)
        - B: flake8-bugbear (버그 패턴)
        """
        import json
        import shutil

        issues = []
        fixed_code = code  # 기본값은 원본 코드

        # Ruff 실행 파일 찾기
        ruff_path = shutil.which("ruff")
        if not ruff_path:
            # Ruff가 설치되지 않음 - 원본 코드와 빈 리스트 반환
            return fixed_code, issues

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)
        # 원본 코드의 magic command 위치 저장 (복원용)
        magic_lines = self._extract_magic_lines(code)

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".py", delete=False, encoding="utf-8"
            ) as f:
                f.write(processed_code)
                temp_path = f.name

            # Pass 1: 자동 수정 (auto_fix=True인 경우)
            if auto_fix:
                subprocess.run(
                    [
                        ruff_path,
                        "check",
                        temp_path,
                        "--fix",
                        "--select=F,E,W,C90,S,B",
                        "--ignore=E501,W292",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                # 수정된 코드 읽기
                with open(temp_path, "r", encoding="utf-8") as f:
                    fixed_processed_code = f.read()

                # 수정이 있었는지 확인
                if fixed_processed_code != processed_code:
                    # Magic command 복원
                    fixed_code = self._restore_magic_lines(
                        fixed_processed_code, magic_lines
                    )

            # Pass 2: 남은 오류 확인 (수정 불가능한 것들)
            result = subprocess.run(
                [
                    ruff_path,
                    "check",
                    temp_path,
                    "--output-format=json",
                    "--select=F,E,W,C90,S,B",
                    "--ignore=E501,W292",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )

            # JSON 결과 파싱
            if result.stdout.strip():
                ruff_issues = json.loads(result.stdout)

                for item in ruff_issues:
                    code_rule = item.get("code", "")
                    message = item.get("message", "")
                    line = item.get("location", {}).get("row", 1)

                    # 규칙 코드로 카테고리 및 심각도 결정
                    category, severity = self._categorize_ruff_rule(code_rule)

                    # 노트북 컨텍스트에서 알려진 이름이면 무시 (F821: undefined name)
                    if code_rule == "F821":
                        match = re.search(r"`([^`]+)`", message)
                        if match:
                            undef_name = match.group(1)
                            if undef_name in self.known_names:
                                continue

                    issues.append(
                        ValidationIssue(
                            severity=severity,
                            category=category,
                            message=f"[{code_rule}] {message}",
                            line=line,
                        )
                    )

        except subprocess.TimeoutExpired:
            # Ruff 타임아웃 - 원본 코드 반환
            pass
        except FileNotFoundError:
            # Ruff가 설치되지 않음
            pass
        except json.JSONDecodeError:
            # JSON 파싱 오류
            pass
        except Exception:
            # 기타 오류
            pass
        finally:
            # 임시 파일 삭제
            if temp_path:
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass

        return fixed_code, issues

    def _extract_magic_lines(self, code: str) -> Dict[int, str]:
        """원본 코드에서 Jupyter magic command 라인 추출

        Returns:
            Dict[line_number, original_line] - 0-indexed line numbers
        """
        magic_lines = {}
        for i, line in enumerate(code.split("\n")):
            stripped = line.lstrip()
            if stripped.startswith("!") or stripped.startswith("%"):
                magic_lines[i] = line
        return magic_lines

    def _restore_magic_lines(
        self, processed_code: str, magic_lines: Dict[int, str]
    ) -> str:
        """전처리된 코드에 원본 magic command 복원"""
        if not magic_lines:
            return processed_code

        lines = processed_code.split("\n")
        for line_num, original_line in magic_lines.items():
            if line_num < len(lines):
                lines[line_num] = original_line
        return "\n".join(lines)

    def _count_fixes(self, original: str, fixed: str) -> int:
        """수정된 라인 수 계산"""
        original_lines = original.split("\n")
        fixed_lines = fixed.split("\n")
        count = 0
        for i, (orig, fix) in enumerate(zip(original_lines, fixed_lines)):
            if orig != fix:
                count += 1
        # 라인 수 차이도 고려
        count += abs(len(original_lines) - len(fixed_lines))
        return count

    def _categorize_ruff_rule(self, code: str) -> tuple:
        """Ruff 규칙 코드를 카테고리와 심각도로 변환"""
        # F: Pyflakes 규칙
        if code.startswith("F"):
            if code in ("F821", "F822", "F823"):  # undefined name
                return IssueCategory.UNDEFINED_NAME, IssueSeverity.ERROR
            elif code in ("F401",):  # unused import
                return IssueCategory.UNUSED_IMPORT, IssueSeverity.WARNING
            elif code in ("F841",):  # unused variable
                return IssueCategory.UNUSED_VARIABLE, IssueSeverity.INFO
            else:
                return IssueCategory.SYNTAX, IssueSeverity.WARNING

        # E: pycodestyle 에러
        elif code.startswith("E"):
            if code.startswith("E9"):  # 런타임 에러 (SyntaxError 등)
                return IssueCategory.SYNTAX, IssueSeverity.ERROR
            else:
                return IssueCategory.STYLE, IssueSeverity.INFO

        # W: pycodestyle 경고
        elif code.startswith("W"):
            return IssueCategory.STYLE, IssueSeverity.INFO

        # C90: mccabe 복잡도
        elif code.startswith("C9"):
            return IssueCategory.COMPLEXITY, IssueSeverity.WARNING

        # S: 보안 (flake8-bandit)
        elif code.startswith("S"):
            if code in ("S101",):  # assert 사용 (테스트 코드에서는 OK)
                return IssueCategory.SECURITY, IssueSeverity.INFO
            elif code in (
                "S102",
                "S103",
                "S104",
                "S105",
                "S106",
                "S107",
            ):  # 하드코딩 비밀번호 등
                return IssueCategory.SECURITY, IssueSeverity.WARNING
            else:
                return IssueCategory.SECURITY, IssueSeverity.WARNING

        # B: flake8-bugbear (버그 패턴)
        elif code.startswith("B"):
            return IssueCategory.BEST_PRACTICE, IssueSeverity.WARNING

        # 기본값
        return IssueCategory.STYLE, IssueSeverity.INFO

    def full_validation(self, code: str) -> ValidationResult:
        """전체 검증 수행"""
        all_issues = []

        # 1. 문법 검사
        syntax_result = self.validate_syntax(code)
        all_issues.extend(syntax_result.issues)

        # 문법 오류가 있으면 더 이상 진행하지 않음
        if syntax_result.has_errors:
            return ValidationResult(
                is_valid=False,
                issues=all_issues,
                has_errors=True,
                has_warnings=False,
                summary=f"문법 오류로 인해 검증 중단: {len(all_issues)}개 오류",
            )

        # 2. 의존성 분석
        dependencies = self.analyze_dependencies(code)

        # 3. 미정의 변수 검사
        undefined_issues = self.check_undefined_names(code)
        all_issues.extend(undefined_issues)

        # 4. Ruff 검사 (우선) - 더 포괄적이고 빠름 + 자동 수정
        fixed_code, ruff_issues = self.check_with_ruff(code)

        # Ruff 이슈 중 중복되지 않는 것만 추가
        existing_messages = {issue.message for issue in all_issues}
        for issue in ruff_issues:
            # 메시지 정규화 (Ruff 규칙 코드 제외)
            base_msg = re.sub(r"\[F\d+\]\s*", "", issue.message)
            if (
                base_msg not in existing_messages
                and issue.message not in existing_messages
            ):
                all_issues.append(issue)
                existing_messages.add(issue.message)

        # 5. Pyflakes 검사 (Ruff fallback) - Ruff가 실패했거나 추가 검사
        pyflakes_issues = self.check_with_pyflakes(code)

        # Pyflakes 이슈 중 중복되지 않는 것만 추가
        for issue in pyflakes_issues:
            if issue.message not in existing_messages:
                all_issues.append(issue)
                existing_messages.add(issue.message)

        # 6. 의존성에서 미정의 이름 업데이트
        undefined_names = []
        for issue in all_issues:
            if issue.category == IssueCategory.UNDEFINED_NAME:
                # 다양한 메시지 포맷 지원
                # Pyflakes: "undefined name 'xxx'" 또는 "'xxx'이(가) 정의되지 않았습니다"
                # Ruff: "[F821] Undefined name `xxx`"
                msg = issue.message
                name = None
                if "'" in msg:
                    parts = msg.split("'")
                    if len(parts) >= 2:
                        name = parts[1]
                elif "`" in msg:
                    parts = msg.split("`")
                    if len(parts) >= 2:
                        name = parts[1]
                if name:
                    undefined_names.append(name)
        dependencies.undefined_names = list(set(undefined_names))

        # 결과 집계
        has_errors = any(issue.severity == IssueSeverity.ERROR for issue in all_issues)
        has_warnings = any(
            issue.severity == IssueSeverity.WARNING for issue in all_issues
        )

        error_count = sum(
            1 for issue in all_issues if issue.severity == IssueSeverity.ERROR
        )
        warning_count = sum(
            1 for issue in all_issues if issue.severity == IssueSeverity.WARNING
        )

        # 자동 수정 여부 확인
        code_was_fixed = fixed_code != code
        fixed_count = 0
        if code_was_fixed:
            # 수정 전후 라인 수 비교로 대략적인 수정 수 계산
            orig_lines = code.split("\n")
            fixed_lines = fixed_code.split("\n")
            fixed_count = sum(1 for o, f in zip(orig_lines, fixed_lines) if o != f)
            fixed_count += abs(len(orig_lines) - len(fixed_lines))

        if has_errors:
            summary = f"검증 실패: {error_count}개 오류, {warning_count}개 경고"
        elif has_warnings:
            if code_was_fixed:
                summary = (
                    f"검증 통과 ({fixed_count}개 자동 수정, 경고 {warning_count}개)"
                )
            else:
                summary = f"검증 통과 (경고 {warning_count}개)"
        else:
            if code_was_fixed:
                summary = f"검증 통과 ({fixed_count}개 자동 수정)"
            else:
                summary = "검증 통과"

        return ValidationResult(
            is_valid=not has_errors,
            issues=all_issues,
            dependencies=dependencies,
            has_errors=has_errors,
            has_warnings=has_warnings,
            summary=summary,
            fixed_code=fixed_code if code_was_fixed else None,
            fixed_count=fixed_count,
        )

    def quick_check(self, code: str) -> Dict[str, Any]:
        """빠른 검사 (API 응답용 간소화 버전)"""
        result = self.full_validation(code)

        return {
            "valid": result.is_valid,
            "errors": [
                {"message": i.message, "line": i.line}
                for i in result.issues
                if i.severity == IssueSeverity.ERROR
            ],
            "warnings": [
                {"message": i.message, "line": i.line}
                for i in result.issues
                if i.severity == IssueSeverity.WARNING
            ],
            "summary": result.summary,
            "fixedCode": result.fixed_code,
            "fixedCount": result.fixed_count,
        }


class APIPatternChecker:
    """
    라이브러리별 API 안티패턴 감지
    실행 전에 잘못된 API 사용을 감지하여 에러 예방
    토큰 절약: replan 호출 자체를 방지하여 간접적으로 절약
    """

    # Dask 안티패턴 (가장 흔한 실수들)
    DASK_ANTIPATTERNS = [
        # head() 후 compute() - head()는 이미 pandas DataFrame 반환
        (
            r"\.head\([^)]*\)\.compute\(\)",
            "head()는 이미 pandas DataFrame을 반환합니다. compute() 불필요!",
        ),
        # columns.compute() - columns는 이미 pandas Index
        (
            r"\.columns\.compute\(\)",
            "columns는 이미 pandas Index입니다. compute() 불필요!",
        ),
        # dtypes.compute() - dtypes도 이미 pandas
        (r"\.dtypes\.compute\(\)", "dtypes는 이미 pandas입니다. compute() 불필요!"),
        # value_counts(normalize=True) - Dask는 지원 안함
        (
            r"\.value_counts\(\s*normalize\s*=\s*True",
            "Dask는 value_counts(normalize=True)를 지원하지 않습니다.",
        ),
        # value_counts().unstack() - Dask Series에 unstack 없음
        (
            r"\.value_counts\([^)]*\)\.unstack\(",
            "Dask Series에는 unstack() 메서드가 없습니다.",
        ),
        # corr() 전체 - 문자열 컬럼 포함 시 에러
        (
            r"(?<!\[\w+\])\.corr\(\)\.compute\(\)",
            "corr()는 숫자형 컬럼만 선택 후 사용하세요: df[numeric_cols].corr().compute()",
        ),
    ]

    # Matplotlib 안티패턴
    MATPLOTLIB_ANTIPATTERNS = [
        # tick_params에 ha 파라미터 사용 - 지원 안함
        (
            r"tick_params\([^)]*ha\s*=",
            "tick_params()에 ha 파라미터는 사용 불가. plt.setp(ax.get_xticklabels(), ha='right') 사용하세요.",
        ),
        # tick_params에 rotation과 ha 함께 - 지원 안함
        (
            r"tick_params\([^)]*rotation\s*=",
            "tick_params()에 rotation 파라미터는 사용 불가. plt.xticks(rotation=...) 사용하세요.",
        ),
    ]

    # Pandas 안티패턴 (일반적인 실수)
    PANDAS_ANTIPATTERNS = [
        # inplace=True와 할당 동시 사용
        (
            r"=\s*\w+\.\w+\([^)]*inplace\s*=\s*True",
            "inplace=True 사용 시 할당하지 마세요. 결과가 None입니다.",
        ),
        # iterrows() 대신 itertuples() 권장
        (
            r"\.iterrows\(\)",
            "iterrows()는 느립니다. 가능하면 itertuples() 또는 벡터 연산을 사용하세요.",
            IssueSeverity.INFO,
        ),  # INFO로 처리 (경고만)
    ]

    # Polars 안티패턴
    POLARS_ANTIPATTERNS = [
        # pandas 스타일 인덱싱
        (
            r"\.loc\[",
            "Polars는 .loc 인덱싱을 지원하지 않습니다. filter() 또는 select()를 사용하세요.",
        ),
        (
            r"\.iloc\[",
            "Polars는 .iloc 인덱싱을 지원하지 않습니다. slice() 또는 row()를 사용하세요.",
        ),
    ]

    # 라이브러리별 패턴 매핑
    LIBRARY_PATTERNS = {
        "dask": DASK_ANTIPATTERNS,
        "matplotlib": MATPLOTLIB_ANTIPATTERNS,
        "pandas": PANDAS_ANTIPATTERNS,
        "polars": POLARS_ANTIPATTERNS,
    }

    def check(
        self, code: str, detected_libraries: List[str] = None
    ) -> List[ValidationIssue]:
        """
        코드에서 API 안티패턴 검사

        Args:
            code: 검사할 Python 코드
            detected_libraries: 사용 중인 라이브러리 목록

        Returns:
            발견된 API 안티패턴 이슈 목록
        """
        issues = []
        detected_libraries = detected_libraries or []

        # 코드에서 라이브러리 사용 감지 (import 또는 alias)
        libraries_in_use = self._detect_libraries_in_code(code, detected_libraries)

        for lib in libraries_in_use:
            patterns = self.LIBRARY_PATTERNS.get(lib, [])

            for pattern_info in patterns:
                # 패턴이 (pattern, message) 또는 (pattern, message, severity) 형태
                if len(pattern_info) == 2:
                    pattern, message = pattern_info
                    severity = IssueSeverity.WARNING
                else:
                    pattern, message, severity = pattern_info

                matches = list(re.finditer(pattern, code))
                for match in matches:
                    # 매칭 위치에서 라인 번호 계산
                    line_num = code[: match.start()].count("\n") + 1

                    issues.append(
                        ValidationIssue(
                            severity=severity,
                            category=IssueCategory.BEST_PRACTICE,
                            message=f"[API 패턴] {message}",
                            line=line_num,
                            code_snippet=match.group(0)[:50],
                        )
                    )

        return issues

    def _detect_libraries_in_code(
        self, code: str, detected_libraries: List[str]
    ) -> List[str]:
        """코드에서 사용 중인 라이브러리 감지"""
        libraries = set(detected_libraries)

        # import 문에서 감지
        import_patterns = {
            "dask": [r"import\s+dask", r"from\s+dask", r"\bdd\.", r"\bda\."],
            "matplotlib": [
                r"import\s+matplotlib",
                r"from\s+matplotlib",
                r"\bplt\.",
                r"import\s+seaborn",
                r"\bsns\.",
            ],
            "pandas": [r"import\s+pandas", r"from\s+pandas", r"\bpd\."],
            "polars": [r"import\s+polars", r"from\s+polars", r"\bpl\."],
        }

        for lib, patterns in import_patterns.items():
            for pattern in patterns:
                if re.search(pattern, code, re.IGNORECASE):
                    libraries.add(lib)
                    break

        return list(libraries)


# APIPatternChecker 싱글톤 인스턴스
_api_pattern_checker_instance: Optional[APIPatternChecker] = None


def get_api_pattern_checker() -> APIPatternChecker:
    """싱글톤 APIPatternChecker 반환"""
    global _api_pattern_checker_instance
    if _api_pattern_checker_instance is None:
        _api_pattern_checker_instance = APIPatternChecker()
    return _api_pattern_checker_instance
