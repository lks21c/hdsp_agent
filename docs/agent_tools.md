# HDSP Agent - 도구 상세 (Tools)

[← 메인 문서로 돌아가기](./agent_planning_flow.md)

## 목차

- [내장 도구 (Built-in Tools)](#내장-도구-built-in-tools)
- [확장 도구 (Extended Tools)](#확장-도구-extended-tools)
- [도구 위험 수준 요약](#도구-위험-수준-요약)

---

## 내장 도구 (Built-in Tools)

### jupyter_cell

Python 코드 셀을 생성, 수정, 삽입합니다.

| 액션 | 파라미터 | 설명 |
|------|----------|------|
| `CREATE` | `code` | 새 코드 셀 생성 및 실행 |
| `MODIFY` | `code`, `cellId` | 기존 셀 내용 수정 |
| `INSERT_AFTER` | `code`, `cellId` | 지정된 셀 뒤에 새 셀 삽입 |
| `INSERT_BEFORE` | `code`, `cellId` | 지정된 셀 앞에 새 셀 삽입 |

```json
{
  "tool": "jupyter_cell",
  "parameters": {
    "action": "CREATE",
    "code": "import pandas as pd\ndf = pd.read_csv('data.csv')"
  }
}
```

### markdown

마크다운 형식의 설명 셀을 생성합니다.

| 파라미터 | 설명 |
|----------|------|
| `content` | 마크다운 텍스트 |

```json
{
  "tool": "markdown",
  "parameters": {
    "content": "## 데이터 분석 결과\n분석이 완료되었습니다."
  }
}
```

### final_answer

최종 답변을 제공합니다. 변수 치환을 지원합니다.

| 파라미터 | 설명 |
|----------|------|
| `answer` | 최종 답변 텍스트 (`{{변수명}}` 형식으로 치환 가능) |

```json
{
  "tool": "final_answer",
  "parameters": {
    "answer": "데이터 로드가 완료되었습니다. 총 {{row_count}}개의 행이 있습니다."
  }
}
```

### read_file

파일 내용을 읽습니다. 작업 디렉토리 내 파일만 접근 가능합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 파일 경로 (상대 경로) | 필수 |
| `encoding` | 파일 인코딩 | `utf-8` |
| `maxLines` | 최대 읽을 라인 수 | 없음 (전체) |

```json
{
  "tool": "read_file",
  "parameters": {
    "path": "data/config.json",
    "maxLines": 100
  }
}
```

### write_file

파일에 내용을 씁니다. **항상 사용자 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 파일 경로 (상대 경로) | 필수 |
| `content` | 작성할 내용 | 필수 |
| `overwrite` | 기존 파일 덮어쓰기 | `false` |

```json
{
  "tool": "write_file",
  "parameters": {
    "path": "output/result.csv",
    "content": "col1,col2\n1,2",
    "overwrite": true
  }
}
```

### list_files

디렉토리의 파일 목록을 조회합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 디렉토리 경로 | `.` (현재) |
| `recursive` | 재귀적 탐색 | `false` |
| `pattern` | 파일 패턴 (glob) | `*` |

```json
{
  "tool": "list_files",
  "parameters": {
    "path": "data",
    "recursive": true,
    "pattern": "*.csv"
  }
}
```

### execute_command

셸 명령을 실행합니다. **위험한 명령은 사용자 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `command` | 실행할 명령 | 필수 |
| `timeout` | 타임아웃 (초) | `30` |

```json
{
  "tool": "execute_command",
  "parameters": {
    "command": "pip install pandas",
    "timeout": 60
  }
}
```

**위험 명령 패턴 (승인 필요):**
- `rm`, `rm -rf`, `rmdir`
- `sudo`, `su`
- `chmod 777`, `chown`
- `> /dev`, `mkfs`, `dd`
- `curl | sh`, `wget | sh`

### search_files

파일 내용을 검색합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `pattern` | 검색 패턴 (정규식) | 필수 |
| `path` | 검색 시작 경로 | `.` |
| `maxResults` | 최대 결과 수 | `50` |

```json
{
  "tool": "search_files",
  "parameters": {
    "pattern": "import pandas",
    "path": "src",
    "maxResults": 20
  }
}
```

---

## 확장 도구 (Extended Tools)

### install_package

pip 패키지를 설치합니다. **시스템 변경이므로 항상 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `package` | 패키지 이름 | 필수 |
| `version` | 버전 지정 (optional) | 없음 (최신) |
| `upgrade` | 업그레이드 여부 | `false` |

```json
{
  "tool": "install_package",
  "parameters": {
    "package": "pandas",
    "version": "2.0.0",
    "upgrade": true
  }
}
```

**위험 수준:** 🟠 high (항상 승인 필요)

### lint_file

Python 파일의 린트 검사 및 자동 수정을 수행합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 파일 경로 | 필수 |
| `fix` | 자동 수정 여부 | `false` |
| `linter` | 린터 종류 | `ruff` |

```json
{
  "tool": "lint_file",
  "parameters": {
    "path": "src/utils.py",
    "fix": true,
    "linter": "ruff"
  }
}
```

**지원 린터:** `ruff`, `pylint`, `flake8`

**위험 수준:** 🟡 medium

### delete_cell

Jupyter 노트북의 특정 셀을 삭제합니다. **되돌리기 어려우므로 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `cellId` | 삭제할 셀 ID | 필수 |

```json
{
  "tool": "delete_cell",
  "parameters": {
    "cellId": "cell-uuid-1234"
  }
}
```

**위험 수준:** 🟡 medium (승인 필요)

### get_cell_output

특정 셀의 실행 출력을 조회합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `cellId` | 조회할 셀 ID | 필수 |
| `outputType` | 출력 타입 필터 | 없음 (전체) |

```json
{
  "tool": "get_cell_output",
  "parameters": {
    "cellId": "cell-uuid-1234",
    "outputType": "execute_result"
  }
}
```

**출력 타입:** `execute_result`, `stream`, `error`, `display_data`

**위험 수준:** 🟢 low (읽기 전용)

### create_notebook

새 Jupyter 노트북 파일을 생성합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 노트북 경로 | 필수 |
| `kernel` | 커널 이름 | `python3` |

```json
{
  "tool": "create_notebook",
  "parameters": {
    "path": "notebooks/analysis.ipynb",
    "kernel": "python3"
  }
}
```

**위험 수준:** 🟡 medium (비파괴적)

### create_folder

새 폴더(디렉토리)를 생성합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 폴더 경로 | 필수 |

```json
{
  "tool": "create_folder",
  "parameters": {
    "path": "data/output"
  }
}
```

**위험 수준:** 🟢 low (비파괴적)

### delete_file

파일 또는 폴더를 삭제합니다. **되돌릴 수 없으므로 항상 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 삭제할 경로 | 필수 |
| `recursive` | 폴더 재귀 삭제 | `false` |

```json
{
  "tool": "delete_file",
  "parameters": {
    "path": "temp/old_data.csv",
    "recursive": false
  }
}
```

**위험 수준:** 🔴 critical (항상 승인 필요)

### git_operations

Git 버전 관리 작업을 수행합니다. **push/commit 작업은 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `operation` | Git 작업 종류 | 필수 |
| `files` | 대상 파일들 | `[]` |
| `message` | 커밋 메시지 | 없음 |
| `branch` | 브랜치 이름 | 없음 |
| `count` | 로그 개수 | `10` |
| `all` | 모든 파일 대상 | `false` |

**지원 작업:**

| operation | 설명 | 승인 필요 |
|-----------|------|----------|
| `status` | 변경 상태 조회 | ✗ |
| `diff` | 변경 내용 비교 | ✗ |
| `log` | 커밋 히스토리 조회 | ✗ |
| `add` | 스테이징 추가 | ✗ |
| `commit` | 커밋 생성 | ✓ |
| `push` | 원격 푸시 | ✓ |
| `pull` | 원격 풀 | ✗ |
| `branch` | 브랜치 생성/조회 | ✗ |
| `checkout` | 브랜치 전환 | ✗ |
| `stash` | 임시 저장 | ✗ |

```json
{
  "tool": "git_operations",
  "parameters": {
    "operation": "commit",
    "message": "feat: add data processing module",
    "all": true
  }
}
```

**위험 수준:** 🟠 high (push/commit만 승인 필요)

### run_tests

pytest 또는 unittest로 테스트를 실행합니다.

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `path` | 테스트 경로 | `tests/` |
| `pattern` | 테스트 파일 패턴 | `test_*.py` |
| `verbose` | 상세 출력 | `false` |
| `coverage` | 커버리지 측정 | `false` |
| `framework` | 테스트 프레임워크 | `pytest` |

```json
{
  "tool": "run_tests",
  "parameters": {
    "path": "tests/unit",
    "verbose": true,
    "coverage": true,
    "framework": "pytest"
  }
}
```

**응답 예시:**
```json
{
  "success": true,
  "output": "...",
  "stats": {
    "passed": 15,
    "failed": 2,
    "skipped": 1,
    "total": 18,
    "duration": 3.45
  }
}
```

**위험 수준:** 🟡 medium (읽기 위주)

### refactor_code

코드 리팩토링 작업을 수행합니다. **코드 변경이므로 항상 승인이 필요합니다.**

| 파라미터 | 설명 | 기본값 |
|----------|------|--------|
| `operation` | 리팩토링 종류 | 필수 |
| `path` | 파일 경로 | 필수 |
| `oldName` | 기존 이름 | 필수 (rename 시) |
| `newName` | 새 이름 | 필수 (rename/extract 시) |
| `lineStart` | 시작 라인 | 필수 (extract 시) |
| `lineEnd` | 종료 라인 | 필수 (extract 시) |

**지원 작업:**

| operation | 설명 |
|-----------|------|
| `rename_variable` | 변수 이름 변경 |
| `rename_function` | 함수 이름 변경 |
| `extract_function` | 코드 블록을 함수로 추출 |
| `inline_variable` | 변수를 인라인으로 대체 |

```json
{
  "tool": "refactor_code",
  "parameters": {
    "operation": "rename_function",
    "path": "src/utils.py",
    "oldName": "process_data",
    "newName": "transform_dataset"
  }
}
```

```json
{
  "tool": "refactor_code",
  "parameters": {
    "operation": "extract_function",
    "path": "src/main.py",
    "lineStart": 45,
    "lineEnd": 60,
    "newName": "calculate_statistics"
  }
}
```

**위험 수준:** 🟠 high (항상 승인 필요)

---

## 도구 위험 수준 요약

| 위험 수준 | 도구 목록 |
|----------|----------|
| 🟢 low | `markdown`, `final_answer`, `read_file`, `list_files`, `search_files`, `get_cell_output`, `create_folder` |
| 🟡 medium | `jupyter_cell`, `lint_file`, `delete_cell`, `create_notebook`, `run_tests` |
| 🟠 high | `write_file`, `git_operations`, `install_package`, `refactor_code` |
| 🔴 critical | `execute_command`, `delete_file` |

**승인 정책:**
- 🟢 low: 승인 불필요
- 🟡 medium: 조건부 승인 (일부 작업만)
- 🟠 high: 조건부 승인 (위험 작업만) 또는 항상 승인
- 🔴 critical: 항상 승인 필요

---

[← 메인 문서로 돌아가기](./agent_planning_flow.md)
