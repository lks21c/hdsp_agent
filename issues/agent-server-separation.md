# Agent Server 분리 아키텍처 마이그레이션

## 진행 상태: Phase 2 완료 ✅

**시작일**: 2024-12-15
**마지막 업데이트**: 2024-12-15

---

## 목표

현재 Jupyter 전용 에이전트를 **FastAPI 기반 독립 Agent Server**와 **IDE별 클라이언트 확장**으로 분리

```
[Agent Server (FastAPI :8000)]
        ↑ HTTP/WebSocket
        ├── Jupyter Extension (thin client)
        ├── VS Code Extension (future)
        └── PyCharm Extension (future)
```

---

## 완료된 작업

### Phase 1: Agent Server 추출 ✅

1. **디렉토리 구조 생성**
   ```
   agent-server/
   ├── pyproject.toml              # FastAPI dependencies
   ├── README.md
   ├── agent_server/
   │   ├── __init__.py
   │   ├── main.py                 # FastAPI 앱 엔트리포인트
   │   ├── routers/
   │   │   ├── health.py           # GET /health, GET /
   │   │   ├── config.py           # GET/POST /config
   │   │   ├── agent.py            # /agent/plan, /refine, /replan, /verify-state
   │   │   └── chat.py             # /chat/message, /chat/stream (SSE)
   │   ├── core/                   # backend/services/ 에서 이동
   │   │   ├── llm_service.py
   │   │   ├── code_validator.py
   │   │   ├── error_classifier.py
   │   │   ├── state_verifier.py
   │   │   ├── context_condenser.py
   │   │   ├── session_manager.py
   │   │   ├── config_manager.py
   │   │   ├── api_key_manager.py
   │   │   └── ...
   │   ├── prompts/                # backend/prompts/ 에서 복사
   │   ├── knowledge/              # backend/knowledge/ 에서 복사
   │   └── schemas/                # Pydantic 모델
   │       ├── common.py
   │       ├── agent.py
   │       └── chat.py
   └── tests/                      # 118 tests 통과 ✅
   ```

2. **수정된 import 경로**
   - `from backend.services.` → `from agent_server.core.`
   - `from ..prompts.` → `from agent_server.prompts.`

3. **테스트 결과**: 118 tests passed ✅

### Phase 2: Jupyter Extension 분리 ✅

1. **디렉토리 구조 생성**
   ```
   extensions/jupyter/
   ├── pyproject.toml              # Jupyter extension package
   ├── package.json                # Frontend build config
   ├── tsconfig.json
   ├── README.md
   ├── LICENSE
   ├── install.json
   ├── jupyter_ext/
   │   ├── __init__.py             # Extension hooks
   │   ├── _version.py
   │   ├── config.py               # Agent Server URL 설정
   │   └── handlers.py             # Proxy handlers
   ├── frontend/                   # React UI (복사됨)
   ├── style/
   ├── ui-tests/
   └── playwright.config.ts
   ```

2. **Proxy 핸들러 구현** (`handlers.py`)
   - `BaseProxyHandler`: 일반 요청 프록시
   - `StreamProxyHandler`: SSE 스트리밍 프록시
   - `HealthHandler`: 로컬 헬스체크 + Agent Server 연결 확인

3. **엔드포인트 매핑**
   | Jupyter Endpoint | Agent Server Endpoint |
   |------------------|----------------------|
   | `/hdsp-agent/config` | `/config` |
   | `/hdsp-agent/auto-agent/plan` | `/agent/plan` |
   | `/hdsp-agent/auto-agent/refine` | `/agent/refine` |
   | `/hdsp-agent/auto-agent/replan` | `/agent/replan` |
   | `/hdsp-agent/chat/message` | `/chat/message` |
   | `/hdsp-agent/chat/stream` | `/chat/stream` |

---

## 남은 작업

### Phase 3: 통합 테스트 (예상 1주)

1. **Agent Server 독립 실행 테스트**
   ```bash
   cd agent-server
   poetry install
   poetry run uvicorn agent_server.main:app --reload --port 8000
   ```

2. **Jupyter Extension 빌드 테스트**
   ```bash
   cd extensions/jupyter
   yarn install
   yarn build
   pip install -e .
   jupyter labextension develop . --overwrite
   ```

3. **통합 E2E 테스트**
   ```bash
   # Terminal 1: Agent Server
   cd agent-server && poetry run uvicorn agent_server.main:app --port 8000

   # Terminal 2: Jupyter Lab
   cd extensions/jupyter && jupyter lab

   # Terminal 3: UI Tests
   cd extensions/jupyter && yarn test:ui
   ```

### Phase 4: 정리 (예상 0.5주)

1. **기존 backend/ 폴더 처리**
   - `backend/services/` → 삭제 (agent-server/로 이동 완료)
   - `backend/prompts/`, `backend/knowledge/` → 삭제 (복사 완료)
   - `backend/handlers/` → 삭제 예정 (proxy로 대체)
   - `backend/__init__.py` → 삭제 예정
   - `backend/labextension/` → extensions/jupyter/로 이동

2. **루트 파일 정리**
   - `package.json` → extensions/jupyter/로 이동 완료
   - `tsconfig.json` → extensions/jupyter/로 이동 완료
   - `ui-tests/` → extensions/jupyter/로 이동 완료

3. **문서 업데이트**
   - `CLAUDE.md` 업데이트
   - `README.md` 업데이트

---

## 주요 설정

### Agent Server 환경변수
```bash
# .env
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

### Jupyter Extension 환경변수
```bash
# Agent Server URL (기본값: http://localhost:8000)
export AGENT_SERVER_URL=http://localhost:8000
```

---

## 테스트 명령어

### Agent Server 테스트
```bash
cd agent-server
poetry install
poetry run pytest tests/ -v
```

### Jupyter Extension 빌드
```bash
cd extensions/jupyter
yarn install
yarn build
```

---

## 참고 문서

- **전체 계획**: `~/.claude/plans/proud-skipping-cosmos.md`
- **Agent Server README**: `agent-server/README.md`
- **Jupyter Extension README**: `extensions/jupyter/README.md`

---

## 이어서 작업할 때

1. Phase 3부터 시작
2. Agent Server 실행 확인
3. Jupyter Extension 빌드 확인
4. 통합 테스트 실행
