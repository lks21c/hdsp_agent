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

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
