"""
Code Validator Service
Pyflakes/AST 기반 코드 품질 검증 서비스

실행 전 코드의 문법 오류, 미정의 변수, 미사용 import 등을 사전 감지
"""

import ast
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any
from io import StringIO


class IssueSeverity(Enum):
    """검증 이슈 심각도"""
    ERROR = "error"        # 실행 실패 예상
    WARNING = "warning"    # 잠재적 문제
    INFO = "info"          # 참고 정보


class IssueCategory(Enum):
    """검증 이슈 카테고리"""
    SYNTAX = "syntax"                    # 문법 오류
    UNDEFINED_NAME = "undefined_name"    # 미정의 변수/함수
    UNUSED_IMPORT = "unused_import"      # 미사용 import
    UNUSED_VARIABLE = "unused_variable"  # 미사용 변수
    REDEFINED = "redefined"              # 재정의
    IMPORT_ERROR = "import_error"        # import 오류
    TYPE_ERROR = "type_error"            # 타입 관련 이슈


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
            "code_snippet": self.code_snippet
        }


@dataclass
class DependencyInfo:
    """코드 의존성 정보"""
    imports: List[str] = field(default_factory=list)           # import된 모듈
    from_imports: Dict[str, List[str]] = field(default_factory=dict)  # from X import Y
    defined_names: List[str] = field(default_factory=list)     # 정의된 변수/함수/클래스
    used_names: List[str] = field(default_factory=list)        # 사용된 이름들
    undefined_names: List[str] = field(default_factory=list)   # 미정의 이름들

    def to_dict(self) -> Dict[str, Any]:
        return {
            "imports": self.imports,
            "from_imports": self.from_imports,
            "defined_names": self.defined_names,
            "used_names": self.used_names,
            "undefined_names": self.undefined_names
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

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "issues": [issue.to_dict() for issue in self.issues],
            "dependencies": self.dependencies.to_dict() if self.dependencies else None,
            "has_errors": self.has_errors,
            "has_warnings": self.has_warnings,
            "summary": self.summary
        }


class CodeValidator:
    """코드 품질 검증 서비스"""

    # Python 내장 이름들 (미정의로 잡히면 안 되는 것들)
    BUILTIN_NAMES = set(dir(__builtins__) if isinstance(__builtins__, dict) else dir(__builtins__))
    BUILTIN_NAMES.update({
        'True', 'False', 'None', 'print', 'len', 'range', 'str', 'int', 'float',
        'list', 'dict', 'set', 'tuple', 'bool', 'type', 'object', 'super',
        'open', 'input', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter',
        'sum', 'min', 'max', 'abs', 'round', 'pow', 'divmod',
        'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
        'callable', 'iter', 'next', 'id', 'hash', 'repr', 'ascii', 'bin', 'hex', 'oct',
        'ord', 'chr', 'format', 'vars', 'dir', 'help', 'locals', 'globals',
        'staticmethod', 'classmethod', 'property',
        'Exception', 'BaseException', 'ValueError', 'TypeError', 'KeyError',
        'IndexError', 'AttributeError', 'ImportError', 'RuntimeError',
        'StopIteration', 'GeneratorExit', 'AssertionError', 'NotImplementedError',
        '__name__', '__file__', '__doc__', '__package__',
        # Jupyter/IPython 특수 변수
        'In', 'Out', '_', '__', '___', 'get_ipython', 'display',
        '_i', '_ii', '_iii', '_ih', '_oh', '_dh',
    })

    # 일반적인 데이터 과학 라이브러리들 (미정의로 잡히면 안 되는 것들)
    COMMON_LIBRARY_NAMES = {
        # 데이터 처리
        'pd', 'np', 'dd', 'da', 'xr',  # pandas, numpy, dask.dataframe, dask.array, xarray
        # 시각화
        'plt', 'sns', 'px', 'go', 'fig', 'ax',  # matplotlib, seaborn, plotly
        # 머신러닝
        'tf', 'torch', 'sk', 'nn', 'F', 'optim',  # tensorflow, pytorch, sklearn
        # 기타 라이브러리
        'scipy', 'cv2', 'PIL', 'Image', 'requests', 'json', 'os', 'sys', 're',
        'datetime', 'time', 'math', 'random', 'collections', 'itertools', 'functools',
        # 추가 common aliases
        'tqdm', 'glob', 'Path', 'pickle', 'csv', 'io', 'logging', 'warnings',
        'gc', 'subprocess', 'shutil', 'pathlib', 'typing', 'copy', 'multiprocessing',
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
        lines = code.split('\n')
        processed_lines = []

        for line in lines:
            stripped = line.lstrip()
            # ! 셸 명령어 (예: !pip install, !{sys.executable})
            if stripped.startswith('!'):
                # 들여쓰기 유지하면서 pass로 대체
                indent = len(line) - len(stripped)
                processed_lines.append(' ' * indent + 'pass  # shell command')
            # % 매직 명령어 (예: %matplotlib inline, %%time)
            elif stripped.startswith('%'):
                indent = len(line) - len(stripped)
                processed_lines.append(' ' * indent + 'pass  # magic command')
            else:
                processed_lines.append(line)

        return '\n'.join(processed_lines)

    def _init_known_names(self):
        """노트북 컨텍스트에서 알려진 이름들 초기화"""
        self.known_names.update(self.BUILTIN_NAMES)
        self.known_names.update(self.COMMON_LIBRARY_NAMES)

        # 노트북에서 정의된 변수들
        defined_vars = self.notebook_context.get('definedVariables', [])
        self.known_names.update(defined_vars)

        # 노트북에서 import된 라이브러리들
        imported_libs = self.notebook_context.get('importedLibraries', [])
        self.known_names.update(imported_libs)

    def validate_syntax(self, code: str) -> ValidationResult:
        """AST 기반 문법 검사"""
        issues = []

        # Jupyter magic command 전처리
        processed_code = self._preprocess_jupyter_code(code)

        try:
            ast.parse(processed_code)
        except SyntaxError as e:
            issues.append(ValidationIssue(
                severity=IssueSeverity.ERROR,
                category=IssueCategory.SYNTAX,
                message=f"문법 오류: {e.msg}",
                line=e.lineno,
                column=e.offset,
                code_snippet=e.text.strip() if e.text else None
            ))

        has_errors = any(issue.severity == IssueSeverity.ERROR for issue in issues)

        return ValidationResult(
            is_valid=not has_errors,
            issues=issues,
            has_errors=has_errors,
            has_warnings=False,
            summary="문법 오류 없음" if not has_errors else f"문법 오류 {len(issues)}개 발견"
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
                    deps.defined_names.append(name.split('.')[0])

            elif isinstance(node, ast.ImportFrom):
                module = node.module or ''
                imported_names = []
                for alias in node.names:
                    name = alias.asname if alias.asname else alias.name
                    imported_names.append(name)
                    deps.defined_names.append(name)
                deps.from_imports[module] = imported_names

        # 정의된 이름 분석
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
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
            elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
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
                if (name not in local_defined and
                    name not in self.known_names and
                    not name.startswith('_')):

                    # 모듈 attribute access 패턴인지 확인 (xxx.yyy의 xxx)
                    # 이 경우 import 가능성이 있으므로 WARNING으로 처리
                    if name in attribute_access_names:
                        issues.append(ValidationIssue(
                            severity=IssueSeverity.WARNING,
                            category=IssueCategory.UNDEFINED_NAME,
                            message=f"'{name}'이(가) 정의되지 않았습니다 (모듈 import 필요 가능성)",
                            line=node.lineno,
                            column=node.col_offset
                        ))
                    else:
                        issues.append(ValidationIssue(
                            severity=IssueSeverity.ERROR,
                            category=IssueCategory.UNDEFINED_NAME,
                            message=f"'{name}'이(가) 정의되지 않았습니다",
                            line=node.lineno,
                            column=node.col_offset
                        ))
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
            pyflakes_api.check(processed_code, '<code>', reporter)
        except Exception:
            return issues

        # 경고 파싱
        warnings_output = warning_stream.getvalue()
        for line in warnings_output.strip().split('\n'):
            if not line:
                continue

            # Pyflakes 출력 형식: <file>:<line>:<col>: <message>
            # 또는: <file>:<line>: <message>
            parts = line.split(':', 3)
            if len(parts) >= 3:
                try:
                    line_num = int(parts[1])
                    message = parts[-1].strip()

                    # 카테고리 결정
                    category = IssueCategory.UNDEFINED_NAME
                    severity = IssueSeverity.WARNING

                    if 'undefined name' in message.lower():
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
                    elif 'imported but unused' in message.lower():
                        category = IssueCategory.UNUSED_IMPORT
                        severity = IssueSeverity.WARNING
                    elif 'assigned to but never used' in message.lower():
                        category = IssueCategory.UNUSED_VARIABLE
                        severity = IssueSeverity.INFO
                    elif 'redefinition' in message.lower():
                        category = IssueCategory.REDEFINED
                        severity = IssueSeverity.WARNING

                    issues.append(ValidationIssue(
                        severity=severity,
                        category=category,
                        message=message,
                        line=line_num
                    ))
                except (ValueError, IndexError):
                    continue

        return issues

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
                summary=f"문법 오류로 인해 검증 중단: {len(all_issues)}개 오류"
            )

        # 2. 의존성 분석
        dependencies = self.analyze_dependencies(code)

        # 3. 미정의 변수 검사
        undefined_issues = self.check_undefined_names(code)
        all_issues.extend(undefined_issues)

        # 4. Pyflakes 검사 (가능한 경우)
        pyflakes_issues = self.check_with_pyflakes(code)

        # Pyflakes 이슈 중 중복되지 않는 것만 추가
        existing_messages = {issue.message for issue in all_issues}
        for issue in pyflakes_issues:
            if issue.message not in existing_messages:
                all_issues.append(issue)

        # 5. 의존성에서 미정의 이름 업데이트
        undefined_names = [
            issue.message.split("'")[1]
            for issue in all_issues
            if issue.category == IssueCategory.UNDEFINED_NAME
        ]
        dependencies.undefined_names = list(set(undefined_names))

        # 결과 집계
        has_errors = any(issue.severity == IssueSeverity.ERROR for issue in all_issues)
        has_warnings = any(issue.severity == IssueSeverity.WARNING for issue in all_issues)

        error_count = sum(1 for issue in all_issues if issue.severity == IssueSeverity.ERROR)
        warning_count = sum(1 for issue in all_issues if issue.severity == IssueSeverity.WARNING)

        if has_errors:
            summary = f"검증 실패: {error_count}개 오류, {warning_count}개 경고"
        elif has_warnings:
            summary = f"검증 통과 (경고 {warning_count}개)"
        else:
            summary = "검증 통과"

        return ValidationResult(
            is_valid=not has_errors,
            issues=all_issues,
            dependencies=dependencies,
            has_errors=has_errors,
            has_warnings=has_warnings,
            summary=summary
        )

    def quick_check(self, code: str) -> Dict[str, Any]:
        """빠른 검사 (API 응답용 간소화 버전)"""
        result = self.full_validation(code)

        return {
            "valid": result.is_valid,
            "errors": [
                {"message": i.message, "line": i.line}
                for i in result.issues if i.severity == IssueSeverity.ERROR
            ],
            "warnings": [
                {"message": i.message, "line": i.line}
                for i in result.issues if i.severity == IssueSeverity.WARNING
            ],
            "summary": result.summary
        }
