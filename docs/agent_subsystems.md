# HDSP Agent - 서브시스템 상세 (Subsystems)

[← 메인 문서로 돌아가기](./agent_planning_flow.md)

## 목차

- [결정론적 서브시스템](#결정론적-서브시스템)
- [Frontend 상태 머신](#frontend-상태-머신)
- [Rate Limit 처리](#rate-limit-처리)

---

## 결정론적 서브시스템

LLM 호출 없이 패턴 매칭으로 처리되는 서브시스템입니다.

### ErrorClassifier

에러 유형을 패턴 기반으로 분류하여 재계획 결정을 내립니다.

```python
# agent-server/agent_server/core/error_classifier.py

class ReplanDecision(Enum):
    REFINE = "refine"           # 현재 step 코드만 수정
    INSERT_STEPS = "insert_steps"  # 새 step 삽입
    REPLACE_STEP = "replace_step"  # step 교체
    REPLAN_REMAINING = "replan_remaining"  # 나머지 전체 재계획
    ABORT = "abort"             # 중단
```

**분류 규칙 예시:**
| 에러 패턴 | 결정 |
|-----------|------|
| `SyntaxError`, `IndentationError` | REFINE |
| `ModuleNotFoundError`, `ImportError` | INSERT_STEPS (import 추가) |
| `NameError` (미정의 변수) | REPLAN_REMAINING |
| `PermissionError`, `OSError` | ABORT |

#### LLM Fallback 메커니즘

패턴 매칭만으로 해결이 어려운 복잡한 에러의 경우, LLM 기반 분석으로 폴백합니다.

**LLM Fallback 트리거 조건:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         에러 발생                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  조건 #1: 동일 에러로 2회 이상 실패?                                       │
│  (previousAttempts >= 2)                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │ Yes                           │ No
                    ▼                               ▼
            ┌──────────────┐            ┌─────────────────────────────────┐
            │  LLM Fallback │            │  조건 #2: 미지의 에러 타입?        │
            └──────────────┘            │  (패턴 매핑에 없음)                │
                                        └─────────────────────────────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │ Yes                           │ No
                                    ▼                               ▼
                            ┌──────────────┐        ┌─────────────────────────────────┐
                            │  LLM Fallback │        │  조건 #3: 복잡한 트레이스백?       │
                            └──────────────┘        │  (2개 이상 Exception 포함)        │
                                                    └─────────────────────────────────┘
                                                                │
                                                ┌───────────────┴───────────────┐
                                                │ Yes                           │ No
                                                ▼                               ▼
                                        ┌──────────────┐            ┌──────────────┐
                                        │  LLM Fallback │            │  패턴 매칭    │
                                        └──────────────┘            └──────────────┘
```

**API 응답 확장:**
```python
class ReplanResponse:
    decision: str       # refine/insert_steps/replace_step/replan_remaining
    analysis: Dict      # 분석 상세 정보
    reasoning: str      # 결정 이유
    changes: Dict       # 제안된 변경사항
    usedLlm: Bool       # LLM 폴백 사용 여부 (NEW)
    confidence: float   # 분석 신뢰도 0.0~1.0 (NEW)
```

**신뢰도 점수:**
- `1.0`: 패턴 매칭 (결정론적)
- `0.8~0.95`: LLM 분석 (높은 신뢰도)
- `0.3~0.7`: LLM 분석 (낮은 신뢰도, 파싱 실패 등)

### StateVerifier

실행 결과의 상태를 검증하고 신뢰도 점수를 계산합니다.

```python
# agent-server/agent_server/core/state_verifier.py

class VerificationResult:
    verified: bool           # 검증 통과 여부
    confidence: float        # 신뢰도 (0.0 ~ 1.0)
    discrepancies: List[str] # 불일치 항목
```

**신뢰도 계산 기준:**
- 출력 존재 여부
- 예상 변수 정의 여부
- 에러 발생 여부
- 실행 시간 정상 범위 여부

### LibraryDetector

요청 텍스트에서 라이브러리 키워드를 감지합니다.

```python
# agent-server/agent_server/knowledge/loader.py

# 키워드 스코어링으로 라이브러리 감지
detected = detector.detect(
    request="dask로 대용량 CSV 병렬 처리",
    available_libraries=["dask", "polars", "pandas"],
    imported_libraries=["pandas"]
)
# 결과: ["dask"]
```

---

## Frontend 상태 머신

```
                                    ┌─────────────┐
                                    │    idle     │
                                    └──────┬──────┘
                                           │ 사용자 요청
                                           ▼
                                    ┌─────────────┐
                                    │  planning   │ ──── POST /agent/plan
                                    └──────┬──────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │   planned   │
                                    └──────┬──────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                              ┌──── │  executing  │ ────┐
                              │     └─────────────┘     │
                              │ 성공                   오류 │
                              ▼                         ▼
                       ┌─────────────┐          ┌─────────────┐
                       │ validating  │          │  reflecting │
                       └──────┬──────┘          └──────┬──────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────┐          ┌─────────────┐
                       │  verifying  │          │ replanning  │
                       └──────┬──────┘          └──────┬──────┘
                              │                        │
          ┌───────────────────┴────────────────────────┘
          │
          ▼
    ┌───────────┐                               ┌──────────┐
    │ completed │                               │  failed  │
    └───────────┘                               └──────────┘
```

### 상태 설명

| 상태 | 설명 |
|------|------|
| `idle` | 대기 상태 |
| `planning` | LLM에 계획 요청 중 |
| `planned` | 계획 수립 완료, 실행 대기 |
| `executing` | 현재 step 실행 중 |
| `validating` | 코드 사전 검증 중 |
| `verifying` | 실행 결과 상태 검증 중 |
| `reflecting` | 오류 분석 중 |
| `replanning` | 재계획 중 |
| `completed` | 모든 step 완료 |
| `failed` | 복구 불가 오류 |

**코드 위치:** `extensions/jupyter/frontend/services/AgentOrchestrator.ts`

---

## Rate Limit 처리

### 개요

API Rate Limit (429) 발생 시 자동으로 다음 API 키로 교체합니다.

```
┌───────────────┐     429 발생      ┌───────────────┐
│   API 호출     │ ──────────────▶  │  키 교체       │
│   (Key #1)    │                  │  (Key #2)     │
└───────────────┘                  └───────────────┘
       │                                  │
       │ 성공                             │ 재시도
       ▼                                  ▼
  ┌───────────┐                    ┌───────────────┐
  │   완료     │                    │  API 재호출    │
  └───────────┘                    └───────────────┘
```

### fetchWithKeyRotation 래퍼

모든 LLM API 호출에 전역으로 적용되는 래퍼입니다.

```typescript
// extensions/jupyter/frontend/services/ApiService.ts

private async fetchWithKeyRotation<T>(
  url: string,
  request: { llmConfig?: any; [key: string]: any },
  options?: {
    onKeyRotation?: (keyIndex: number, totalKeys: number) => void;
    defaultErrorMessage?: string;
  }
): Promise<T>
```

**특징:**
- 최대 10회 재시도
- 성공 시 키 로테이션 상태 리셋
- 모든 키 소진 시 명확한 에러 메시지
- 프론트엔드 전용 (서버는 키를 저장하지 않음)

### 적용 API

- `generateExecutionPlan()`
- `refineStepCode()`
- `replanExecution()`
- `sendMessage()`
- `cellAction()`
- `fileAction()`
- `validateCode()`
- `reflectOnExecution()`
- `verifyState()`

**코드 위치:**
- `extensions/jupyter/frontend/services/ApiService.ts`
- `extensions/jupyter/frontend/services/ApiKeyManager.ts`

---

[← 메인 문서로 돌아가기](./agent_planning_flow.md)
