# Agent Server 분리 아키텍처 마이그레이션

## 진행 상태: Phase 4 완료 ✅

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

### Phase 3: 통합 테스트 ✅

1. **Agent Server 독립 실행 테스트** ✅
   ```bash
   cd agent-server
   poetry install  # 성공
   poetry run pytest tests/ -v  # 118 tests passed
   poetry run uvicorn agent_server.main:app --port 8000
   # Health check: {"status":"healthy","version":"1.0.0"}
   ```

2. **Jupyter Extension 빌드 테스트** ✅
   ```bash
   cd extensions/jupyter
   touch yarn.lock  # 독립 프로젝트로 설정
   jlpm install  # 의존성 설치 완료
   jlpm build:lib  # TypeScript 빌드 성공
   jupyter labextension build . --development True  # webpack 빌드 성공
   pip install -e .  # 패키지 설치 완료
   # Extension status: @hdsp-agent/extension enabled OK
   ```

3. **통합 E2E 테스트** ✅
   - Agent Server → Jupyter Proxy 연결 확인
   - `/hdsp-agent/config` 프록시 테스트 성공
   - Config 응답: `{"provider":"gemini",...}` 정상 수신

4. **발견된 사항**
   - SVG 아이콘 복사 필요: `cp frontend/styles/icons/*.svg lib/styles/icons/`
   - 기존 `backend` 서버 익스텐션이 여전히 활성 상태
   - 새로운 `jupyter_ext`는 Phase 4에서 전환 필요

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

## 완료된 작업 (Phase 4)

### Phase 4: 정리 및 전환 ✅

1. **서버 익스텐션 전환** ✅
   ```bash
   # 기존 backend 비활성화
   jupyter server extension disable backend --sys-prefix
   jupyter server extension disable backend --user

   # hdsp_agent.json 설정 파일 삭제 (backend: true 설정 제거)
   rm ~/.jupyter/jupyter_server_config.d/hdsp_agent.json
   rm $VIRTUAL_ENV/etc/jupyter/jupyter_server_config.d/hdsp_agent.json

   # 새로운 jupyter_ext 활성화
   jupyter server extension enable jupyter_ext
   ```

2. **빌드 스크립트 수정** ✅
   - `extensions/jupyter/package.json`에 SVG 복사 스크립트 추가
   - `"prebuild:lib": "mkdir -p lib/styles/icons && cp -r frontend/styles/icons/* lib/styles/icons/"`
   - `"build:lib": "jlpm prebuild:lib && tsc"`

3. **루트 파일 정리** ✅
   - `tsconfig.json` → 삭제 (extensions/jupyter에 존재)
   - `playwright.config.ts` → 삭제 (extensions/jupyter에 존재)
   - `install.json` → 삭제 (extensions/jupyter에 존재)
   - `node_modules/` → 삭제 (618MB, extensions/jupyter에서 별도 관리)
   - `lib/`, `dist/` → 삭제 (빌드 결과물)
   - `pyproject.toml` → 수정 (monorepo 구조로 변경)

4. **기존 backend/ 폴더 상태**
   - 서버 익스텐션으로서는 비활성화됨
   - 레거시 참조를 위해 유지 (추후 완전 삭제 가능)
   - 새로운 기능은 agent-server/ 및 extensions/jupyter/ 사용

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

## 마이그레이션 완료 ✅

모든 Phase가 완료되었습니다. 새로운 아키텍처:

```
[Agent Server (FastAPI :8000)]     ← agent-server/
        ↑ HTTP/WebSocket
        └── Jupyter Extension      ← extensions/jupyter/
              (thin client)
```

### 실행 방법

**1. Agent Server 실행**
```bash
cd agent-server
poetry install
poetry run uvicorn agent_server.main:app --port 8000
```

**2. Jupyter Lab 실행**
```bash
cd extensions/jupyter
jlpm install && jlpm build
pip install -e .
jupyter lab
```

### 향후 개선 사항
- [ ] backend/ 폴더 완전 삭제 (레거시 코드 정리)
- [ ] VS Code Extension 추가 (extensions/vscode/)
- [ ] PyCharm Extension 추가 (extensions/pycharm/)
