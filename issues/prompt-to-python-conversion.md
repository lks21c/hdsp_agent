# LLM 프롬프트 → Python 메서드 전환 계획

**생성일**: 2025-12-13
**목적**: 토큰 절약 및 신뢰도 향상을 위해 LLM 프롬프트로 처리하던 결정론적 작업들을 Python 메서드로 전환

## 예상 효과
- **토큰 절감**: 세션당 2,000-6,000 토큰 절약
- **신뢰도 향상**: 결정론적 동작으로 일관성 100% 보장
- **응답 속도**: LLM 호출 감소로 레이턴시 개선

---

## 구현 항목 (4개 영역)

### 1. 라이브러리 감지 (Library Detection)
**현재**: LLM이 사용자 요청 분석 → 필요 라이브러리 판단
**전환**: 키워드 매칭 + 정규식 기반 결정론적 감지

**수정 파일**:
- `backend/knowledge/loader.py` - `LibraryDetector` 클래스 추가
- `backend/handlers/auto_agent.py:118-168` - `_detect_required_libraries()` 수정

**토큰 절감**: ~600-800/세션

---

### 2. 에러 분류 및 Replan 결정 (Error Classification)
**현재**: LLM이 에러 분석 → refine/insert_steps/replace_step/replan_remaining 결정
**전환**: 에러 타입별 결정 테이블 + 패키지 추출 로직

**수정 파일**:
- `backend/services/error_classifier.py` (신규) - `ErrorClassifier` 클래스
- `backend/handlers/auto_agent.py:375-460` - `AutoAgentReplanHandler` 수정

**하이브리드 접근**:
- `INSERT_STEPS`: Python이 완전 처리 (pip install 코드 자동 생성)
- `REFINE`: Python이 결정, LLM이 수정 코드 생성

**토큰 절감**: ~1,000-2,000/세션

---

### 3. 최종 요약 생성 (Final Answer)
**현재**: LLM이 실행 결과 요약 생성 (200자 이내)
**전환**: 템플릿 기반 요약 생성

**수정 파일**:
- `backend/services/summary_generator.py` (신규) - `SummaryGenerator` 클래스
- `backend/prompts/auto_agent_prompts.py` - `format_final_answer_prompt` 대체

**토큰 절감**: ~300-500/세션

---

### 4. API 패턴 검증 (Pre-execution Check)
**현재**: 프롬프트에 API 사용법 가이드 포함
**전환**: 실행 전 안티패턴 자동 감지 + 경고/수정

**수정 파일**:
- `backend/services/code_validator.py` - `APIPatternChecker` 클래스 추가
- `backend/knowledge/libraries/*.md` 참조하여 패턴 추출

**효과**: 에러 예방으로 replan 호출 자체를 감소 (간접적 토큰 절감 0-3,000)

---

## 구현 순서

| 순서 | 항목 | 파일 | 상태 |
|------|------|------|------|
| 1 | 라이브러리 감지 | loader.py, auto_agent.py | ✅ |
| 2 | 에러 분류 | error_classifier.py (신규), auto_agent.py | ✅ |
| 3 | API 패턴 검증 | code_validator.py, auto_agent.py | ✅ |
| 4 | 최종 요약 생성 | summary_generator.py (신규) | ✅ |

---

## 수정 대상 파일 목록

### 신규 생성
- `backend/services/error_classifier.py`
- `backend/services/summary_generator.py`

### 수정
- `backend/knowledge/loader.py` - LibraryDetector 추가
- `backend/handlers/auto_agent.py` - 핸들러 통합
- `backend/services/code_validator.py` - APIPatternChecker 추가

### 참조 (읽기 전용)
- `backend/prompts/auto_agent_prompts.py` - 기존 규칙 참조
- `backend/knowledge/libraries/*.md` - 안티패턴 참조
