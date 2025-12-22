# Embedded Agent Server Architecture

## Issue Summary
Development 모드에서는 별도 서버 프로세스 없이 Jupyter extension 내에서 agent server가 동작하고, Production 모드에서는 K8s pod으로 별도 배포하는 dual-mode 아키텍처 구현.

## 목표
- **Development**: 하나의 wheel 설치로 Jupyter 내에서 agent server 동작 (별도 프로세스 없음)
- **Production**: Agent server는 K8s pod으로 별도 배포, Jupyter extension은 HTTP proxy로 통신

## 핵심 설계

### 아키텍처 다이어그램

```
Development Mode (HDSP_AGENT_MODE=embedded)
┌─────────────────────────────────────────────────────┐
│ JupyterLab Process                                  │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │ Frontend (TS)   │───▶│ Tornado Handlers        │ │
│  └─────────────────┘    │   ↓                     │ │
│                         │ ServiceFactory          │ │
│                         │   ↓                     │ │
│                         │ AgentService (direct)   │ │
│                         │   ↓                     │ │
│                         │ hdsp_agent_core         │ │
│                         │ (LLM, RAG, Session)     │ │
│                         └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘

Production Mode (HDSP_AGENT_MODE=proxy)
┌─────────────────────────────┐     ┌─────────────────────────┐
│ JupyterLab Process          │     │ K8s Pod: Agent Server   │
│  ┌─────────────────┐        │     │  ┌─────────────────────┐│
│  │ Frontend (TS)   │───▶────│─────│─▶│ FastAPI             ││
│  └─────────────────┘        │HTTP │  │   ↓                 ││
│  ┌─────────────────┐        │     │  │ hdsp_agent_core     ││
│  │ ProxyService    │───▶────│─────│─▶│ (LLM, RAG, Session) ││
│  └─────────────────┘        │     │  └─────────────────────┘│
└─────────────────────────────┘     └─────────────────────────┘
```

### 기술적 배경
- Tornado 5.0+ 부터 asyncio 기반으로 동작
- Jupyter Server와 FastAPI 로직이 같은 이벤트 루프 공유 가능
- HTTP 없이 직접 async 함수 호출 가능

### Service Interface 패턴

```python
# Embedded: 직접 호출 (같은 프로세스)
ServiceFactory.get_agent_service() → AgentService → llm_service.generate()

# Proxy: HTTP 호출 (외부 서버)
ServiceFactory.get_agent_service() → ProxyAgentService → httpx.post("/agent/plan")
```

## 패키지 구조 변경

### 새로운 구조

```
hdsp_agent/
├── hdsp_agent_core/              # NEW: 공유 코어 라이브러리
│   ├── __init__.py
│   ├── interfaces.py             # Abstract service interfaces
│   ├── factory.py                # ServiceFactory (mode selector)
│   │
│   ├── services/                 # Service implementations
│   │   ├── agent_service.py      # Direct implementation
│   │   ├── chat_service.py
│   │   ├── rag_service.py
│   │   └── proxy_service.py      # HTTP proxy implementation
│   │
│   ├── managers/                 # FROM: agent_server/core/
│   │   ├── session_manager.py
│   │   ├── config_manager.py
│   │   └── rag_manager.py
│   │
│   ├── llm/                      # FROM: agent_server/core/llm_*
│   │   ├── service.py
│   │   ├── client.py
│   │   └── providers.py
│   │
│   ├── models/                   # FROM: agent_server/schemas/
│   │   ├── agent.py
│   │   ├── chat.py
│   │   ├── common.py
│   │   └── rag.py
│   │
│   ├── knowledge/                # FROM: agent_server/knowledge/
│   │   ├── chunking.py
│   │   ├── loader.py
│   │   └── watchdog_service.py
│   │
│   └── prompts/                  # FROM: agent_server/prompts/
│       └── auto_agent_prompts.py
│
├── agent-server/                 # Thin FastAPI wrapper (production)
│   └── agent_server/
│       ├── main.py               # FastAPI app
│       └── routers/              # Routes → ServiceFactory
│
├── extensions/jupyter/           # JupyterLab extension
│   └── jupyter_ext/
│       ├── __init__.py           # Mode initialization
│       └── handlers.py           # Handlers → ServiceFactory
│
└── pyproject.toml                # Root package config
```

## 환경 변수

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `HDSP_AGENT_MODE` | `embedded` / `proxy` | `embedded` | 모드 선택 |
| `AGENT_SERVER_URL` | URL | `http://localhost:8000` | proxy 모드에서 서버 주소 |
| `AGENT_SERVER_TIMEOUT` | seconds | `120.0` | HTTP timeout |
| `RAG_ENABLED` | `true` / `false` | `true` | RAG 활성화 여부 |

## 구현 단계

### Phase 1: Core 패키지 생성 및 코드 이동
1. `hdsp_agent_core/` 디렉토리 구조 생성
2. `agent_server/schemas/` → `hdsp_agent_core/models/` 이동
3. `agent_server/core/` managers → `hdsp_agent_core/managers/` 이동
4. `agent_server/core/llm_*` → `hdsp_agent_core/llm/` 이동
5. `agent_server/prompts/` → `hdsp_agent_core/prompts/` 이동
6. `agent_server/knowledge/` → `hdsp_agent_core/knowledge/` 이동

### Phase 2: Service Interface 구현
1. `hdsp_agent_core/interfaces.py` - Abstract interfaces 정의
2. `hdsp_agent_core/services/agent_service.py` - Direct implementation
3. `hdsp_agent_core/services/chat_service.py` - Direct implementation
4. `hdsp_agent_core/services/proxy_service.py` - HTTP proxy implementation
5. `hdsp_agent_core/factory.py` - ServiceFactory 구현

### Phase 3: Consumer 업데이트
1. `agent-server/routers/*.py` - ServiceFactory 사용으로 변경
2. `extensions/jupyter/handlers.py` - ServiceFactory 사용으로 변경
3. `extensions/jupyter/__init__.py` - 모드별 초기화 로직

### Phase 4: 패키지 설정
1. `hdsp_agent_core/pyproject.toml` 생성
2. `agent-server/pyproject.toml` - core 의존성 추가
3. `extensions/jupyter/pyproject.toml` - core 의존성 추가
4. Root `pyproject.toml` - workspace 설정

### Phase 5: 테스트 업데이트
1. `hdsp_agent_core/tests/` - 서비스 단위 테스트
2. 기존 테스트 import 경로 수정
3. 모드 전환 통합 테스트

## 수정할 주요 파일

### 이동 대상 (agent-server → hdsp_agent_core)
- `agent-server/agent_server/schemas/*.py` → `hdsp_agent_core/models/`
- `agent-server/agent_server/core/config_manager.py` → `hdsp_agent_core/managers/`
- `agent-server/agent_server/core/session_manager.py` → `hdsp_agent_core/managers/`
- `agent-server/agent_server/core/rag_manager.py` → `hdsp_agent_core/managers/`
- `agent-server/agent_server/core/llm_service.py` → `hdsp_agent_core/llm/service.py`
- `agent-server/agent_server/core/llm_client.py` → `hdsp_agent_core/llm/client.py`
- `agent-server/agent_server/prompts/` → `hdsp_agent_core/prompts/`
- `agent-server/agent_server/knowledge/` → `hdsp_agent_core/knowledge/`

### 신규 생성
- `hdsp_agent_core/__init__.py`
- `hdsp_agent_core/interfaces.py`
- `hdsp_agent_core/factory.py`
- `hdsp_agent_core/services/agent_service.py`
- `hdsp_agent_core/services/chat_service.py`
- `hdsp_agent_core/services/proxy_service.py`
- `hdsp_agent_core/pyproject.toml`

### 수정 대상
- `agent-server/agent_server/routers/agent.py` - ServiceFactory 사용
- `agent-server/agent_server/routers/chat.py` - ServiceFactory 사용
- `agent-server/agent_server/main.py` - lifespan 수정
- `extensions/jupyter/jupyter_ext/handlers.py` - Proxy 제거, ServiceFactory 사용
- `extensions/jupyter/jupyter_ext/__init__.py` - 모드별 초기화
- `extensions/jupyter/pyproject.toml` - core 의존성

## 리스크 및 고려사항

1. **Singleton 관리**: RAGManager, ConfigManager 등 싱글톤이 두 모드에서 동일하게 동작해야 함
2. **Asyncio 이벤트 루프**: Tornado와 공유하는 asyncio 루프에서 블로킹 방지
3. **메모리 사용량**: RAG embedded 시 sentence-transformers 모델 로딩으로 메모리 증가 (~500MB+)
4. **테스트 격리**: 모드별 테스트가 서로 영향 주지 않도록 fixture 설계

## 예상 작업량
- Phase 1: 코드 이동 및 import 수정 (중간)
- Phase 2: Service interface 구현 (핵심, 많음)
- Phase 3: Consumer 업데이트 (중간)
- Phase 4: 패키지 설정 (적음)
- Phase 5: 테스트 (중간)

## 참고 자료
- Tornado 5.0+ asyncio integration
- FastAPI Sub Applications
- Jupyter Server Extension development

---

**Created**: 2024-12-23
**Status**: Planned
**Priority**: Medium
