# Claude Code Instructions

## 🔴 CRITICAL: Background Process Management

**동일 종류의 백그라운드 프로세스는 반드시 1개만 유지해야 함.**

### 규칙
1. **새 백그라운드 프로세스 시작 전**: 반드시 기존 동일 프로세스가 실행 중인지 확인
2. **중복 감지 시**: 기존 프로세스를 먼저 종료(KillShell) 후 새 프로세스 시작
3. **허용되는 최대 개수**:
   - `jupyter lab`: 1개
   - `tsc -w` (TypeScript watch): 1개
   - `labextension watch`: 1개
   - `npm run watch` / `yarn watch`: 1개

### 백그라운드 시작 전 체크리스트
```bash
# 1. 현재 실행 중인 프로세스 확인
# BashOutput으로 기존 백그라운드 태스크 상태 확인

# 2. 동일 종류 프로세스가 있으면 KillShell로 종료

# 3. 그 후에만 새 프로세스 시작
```

### 위반 시 발생하는 문제
- 포트 충돌 (예: jupyter가 8888, 8889 동시에 뜸)
- 리소스 낭비
- 빌드 충돌 및 파일 락 문제
- 사용자 혼란

---

## Diff-First Workflow (MANDATORY for Code Changes)
**When using Edit, Write, or NotebookEdit tools to modify code, ALWAYS follow this workflow:**
1. Show diff in ```diff``` code blocks with full method context
2. **승인 판단**:
   - **사용자가 명확히 변경 지시** ("X를 Y로 바꿔줘", "~으로 해줘" 등) → diff 확인 후 **바로 적용**
   - **내가 변경을 제안하는 경우** → "이 변경사항을 적용하시겠습니까? (y/n)" 승인 요청
3. **After approval received (or direct instruction):**
   a. Apply changes using the appropriate tool
   b. For Python files: Automatically run lint checks (ruff check --fix, ruff format)
   c. Report lint results (no additional approval needed unless lint errors remain)

**Scope**:
- Applies to: Edit, Write, NotebookEdit tools (code modification)
- Applies to ALL file types: Python, JavaScript, TypeScript, config files, markdown, etc.
- **명확한 지시 = 승인**: 사용자가 구체적으로 변경을 지시하면 추가 승인 불필요

---

## 🔴 MANDATORY: Unit Test Requirement

**코드 수정 시 반드시 유닛테스트를 작성하고 실행하여 검증해야 함.**

### 규칙
1. **모든 코드 변경 시 적용**: Frontend (TypeScript/React) 및 Backend (Python) 모두 해당
2. **테스트 작성**: 새로운 기능 추가 또는 버그 수정 시 관련 테스트 작성
3. **테스트 실행**: 변경 완료 전 반드시 테스트 실행하여 통과 확인
4. **기존 테스트 유지**: 기존 테스트가 깨지지 않도록 보장

### 테스트 실행 명령어
```bash
# Backend (Python)
python -m pytest tests/ -v

# Frontend (TypeScript)
yarn test
# 또는
npm run test
```

### 테스트 위치
- **Backend**: `tests/` 디렉토리
- **Frontend**: `src/__tests__/` 또는 `*.test.ts`, `*.test.tsx` 파일

### 예외 상황
- 단순 문서 수정 (README, 주석 등)
- 설정 파일 수정 (단, 기능에 영향을 주는 경우 테스트 필요)
- 긴급 핫픽스 (단, 이후 테스트 추가 필수)

---

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
