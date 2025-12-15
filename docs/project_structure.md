# HDSP Agent - 프로젝트 구조

## 개요

HDSP Agent는 **모노레포 구조**로 관리되는 AI 기반 코드 어시스턴트입니다.
주요 컴포넌트가 분리된 **클라이언트-서버 아키텍처**를 채택합니다.

### 주요 컴포넌트

| 컴포넌트 | 위치 | 역할 | 기술 스택 |
|----------|------|------|-----------|
| **Agent Server** | `agent-server/` | LLM 호출, 코드 분석 | FastAPI, Python |
| **Jupyter Extension** | `extensions/jupyter/` | JupyterLab UI | React, TypeScript |

### 아키텍처 다이어그램

```
┌─────────────────────────────┐          HTTP/REST          ┌─────────────────────────────┐
│     JupyterLab Extension    │  ◀────────────────────────▶ │       Agent Server          │
│         (Frontend)          │         Port 8000           │        (FastAPI)            │
│                             │                             │                             │
│  - React UI Components      │                             │  - LLM Service              │
│  - ApiService (REST)        │                             │  - Code Validator           │
│  - AgentOrchestrator        │                             │  - State Verifier           │
└─────────────────────────────┘                             └─────────────────────────────┘
```

---

## 루트 디렉토리 구조

```
hdsp_agent/
├── agent-server/             # FastAPI 백엔드 서버 (독립 실행)
├── extensions/
│   └── jupyter/              # JupyterLab 확장 (Thin Client)
├── docs/                     # 프로젝트 문서
├── ui-tests/                 # Playwright E2E 테스트
├── .taskmaster/              # Task 관리 설정
├── .serena/                  # 프로젝트 메모리
├── pyproject.toml            # 루트 Poetry 설정
├── build.sh                  # 빌드 자동화 스크립트
├── CLAUDE.md                 # Claude Code 지침
└── README.md                 # 메인 문서
```

---

## Agent Server 구조

독립적으로 실행 가능한 FastAPI 서버입니다.

```
agent-server/
├── pyproject.toml                # FastAPI 의존성
├── README.md
│
└── agent_server/
    ├── __init__.py
    ├── main.py                   # FastAPI 앱 진입점
    │
    ├── routers/                  # API 엔드포인트
    │   ├── __init__.py
    │   ├── health.py             # GET / (헬스체크)
    │   ├── config.py             # GET/POST /config
    │   ├── agent.py              # /agent/* (Auto-Agent)
    │   └── chat.py               # /chat/* (채팅)
    │
    ├── schemas/                  # Pydantic 데이터 모델
    │   ├── __init__.py
    │   ├── common.py             # 공통 모델 (ExecutionError, ToolCall)
    │   ├── agent.py              # Agent 요청/응답 스키마
    │   └── chat.py               # Chat 요청/응답 스키마
    │
    ├── core/                     # 핵심 비즈니스 로직
    │   ├── __init__.py
    │   ├── llm_service.py        # LLM 프로바이더 (Gemini/OpenAI)
    │   ├── code_validator.py     # 코드 파싱 및 검증
    │   ├── state_verifier.py     # 실행 상태 검증
    │   ├── error_classifier.py   # 에러 분류
    │   ├── context_condenser.py  # 컨텍스트 압축
    │   ├── reflection_engine.py  # 에러 복구 계획
    │   ├── session_manager.py    # 세션 영속화
    │   ├── config_manager.py     # 설정 관리
    │   └── api_key_manager.py    # API 키 관리
    │
    ├── prompts/                  # LLM 프롬프트 템플릿
    │   ├── __init__.py
    │   ├── auto_agent_prompts.py # 계획 생성 프롬프트
    │   ├── cell_action_prompts.py# 셀 액션 프롬프트
    │   └── file_action_prompts.py# 파일 액션 프롬프트
    │
    ├── knowledge/                # Knowledge Base (Mini RAG)
    │   ├── __init__.py
    │   ├── loader.py             # 지식 로더
    │   └── libraries/            # 라이브러리 가이드
    │       ├── dask.md
    │       ├── polars.md
    │       └── matplotlib.md
    │
    └── tests/                    # pytest 테스트
        ├── __init__.py
        ├── conftest.py           # VCR.py 설정
        ├── cassettes/            # LLM 응답 녹화
        ├── test_agent_plan.py
        ├── test_error_classifier.py
        └── test_state_verifier.py
```

### 핵심 모듈 설명

| 모듈 | 파일 | 역할 |
|------|------|------|
| **LLMService** | `core/llm_service.py` | Gemini/OpenAI API 호출, 응답 파싱 |
| **CodeValidator** | `core/code_validator.py` | Python AST 파싱, 구문 검증, Ruff 연동 |
| **StateVerifier** | `core/state_verifier.py` | 실행 결과 상태 검증 (결정론적) |
| **ErrorClassifier** | `core/error_classifier.py` | 에러 패턴 분류, 재계획 결정 (결정론적) |
| **ContextCondenser** | `core/context_condenser.py` | 토큰 최적화, 컨텍스트 압축 |
| **SessionManager** | `core/session_manager.py` | 대화 세션 저장/복원 |

---

## Jupyter Extension 구조

JupyterLab용 UI 확장입니다. Thin Client 아키텍처로 로직은 Agent Server에 위임합니다.

```
extensions/jupyter/
├── pyproject.toml                # Jupyter 확장 패키지 설정
├── package.json                  # npm 빌드 설정
├── tsconfig.json                 # TypeScript 설정
├── README.md
│
├── jupyter_ext/                  # Python 백엔드 (프록시)
│   ├── __init__.py               # 확장 진입점
│   ├── _version.py               # 버전 관리
│   ├── config.py                 # Agent Server URL 설정
│   ├── handlers.py               # 프록시 핸들러
│   └── etc/jupyter/
│       └── jupyter_server_config.d/
│           └── hdsp_jupyter_extension.json
│
├── frontend/                     # React/TypeScript UI
│   ├── index.ts                  # 메인 진입점
│   │
│   ├── components/               # React 컴포넌트
│   │   ├── AgentPanel.tsx        # 메인 에이전트 인터페이스
│   │   ├── AutoAgentPanel.tsx    # Auto-Agent 오케스트레이션
│   │   ├── SettingsPanel.tsx     # 설정 UI
│   │   ├── ApprovalDialog.tsx    # 실행 승인 다이얼로그
│   │   └── TaskProgressWidget.tsx# 진행 상황 표시
│   │
│   ├── services/                 # 비즈니스 로직
│   │   ├── ApiService.ts         # REST API 클라이언트
│   │   ├── ApiKeyManager.ts      # API 키 로테이션
│   │   ├── AgentOrchestrator.ts  # 워크플로우 관리
│   │   ├── ContextManager.ts     # 컨텍스트 상태 관리
│   │   ├── CheckpointManager.ts  # 체크포인트 영속화
│   │   ├── ToolRegistry.ts       # 도구 등록
│   │   └── ToolExecutor.ts       # 도구 실행
│   │
│   ├── hooks/                    # React 커스텀 훅
│   │   ├── index.ts
│   │   ├── useChatState.ts       # 채팅 상태 관리
│   │   └── useScrollBehavior.ts  # 스크롤 동작
│   │
│   ├── plugins/                  # JupyterLab 플러그인
│   │   ├── sidebar-plugin.ts     # 사이드바 등록
│   │   ├── cell-buttons-plugin.ts# 셀 액션 버튼
│   │   └── save-interceptor-plugin.ts
│   │
│   ├── types/                    # TypeScript 타입 정의
│   │   ├── index.ts
│   │   └── auto-agent.ts         # Auto-Agent 타입
│   │
│   ├── utils/                    # 유틸리티
│   │   ├── markdownRenderer.ts   # 마크다운 렌더링
│   │   └── SafetyChecker.ts      # 안전성 검증
│   │
│   └── styles/                   # CSS 스타일
│       ├── index.css
│       └── icons/                # SVG 아이콘
│           ├── agent.svg
│           └── settings.svg
│
├── lib/                          # 컴파일된 TypeScript 출력
└── ui-tests/                     # Playwright E2E 테스트
    ├── fixtures.ts               # 네트워크 모킹
    └── agent.spec.ts
```

### 핵심 모듈 설명

| 모듈 | 파일 | 역할 |
|------|------|------|
| **ApiService** | `services/ApiService.ts` | Agent Server REST 호출, Rate Limit 처리 |
| **ApiKeyManager** | `services/ApiKeyManager.ts` | API 키 저장, 자동 로테이션 |
| **AgentOrchestrator** | `services/AgentOrchestrator.ts` | 계획 실행, 상태 머신 관리 |
| **ContextManager** | `services/ContextManager.ts` | 노트북 컨텍스트 수집 |
| **ToolExecutor** | `services/ToolExecutor.ts` | jupyter_cell, markdown 등 도구 실행 |

---

## 데이터 흐름

### 요청 처리 흐름

```
┌──────────────────────────────────────────────────────────────────────────┐
│  1. 사용자 입력 (JupyterLab UI)                                           │
│     └─▶ AutoAgentPanel.tsx                                               │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  2. 컨텍스트 수집                                                          │
│     └─▶ ContextManager.ts (노트북 상태, 변수, 임포트 수집)                  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  3. API 요청 전송                                                          │
│     └─▶ ApiService.ts (fetchWithKeyRotation → Rate Limit 자동 처리)       │
│         └─▶ POST http://localhost:8000/agent/plan                        │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  4. Agent Server 처리                                                      │
│     ├─▶ routers/agent.py (요청 파싱)                                       │
│     ├─▶ knowledge/loader.py (라이브러리 지식 로드)                          │
│     ├─▶ prompts/ (프롬프트 생성)                                           │
│     └─▶ core/llm_service.py (LLM 호출)                                     │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  5. 계획 실행                                                              │
│     └─▶ AgentOrchestrator.ts                                             │
│         └─▶ ToolExecutor.ts (jupyter_cell, markdown 실행)                 │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  6. 상태 검증 & 재계획                                                      │
│     ├─▶ StateVerifier (실행 결과 검증)                                      │
│     └─▶ ErrorClassifier (에러 발생 시 재계획 결정)                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 빌드 및 실행

### Agent Server 실행

```bash
# 의존성 설치
cd agent-server
poetry install

# 서버 실행 (포트 8000)
poetry run uvicorn agent_server.main:app --host 0.0.0.0 --port 8000 --reload
```

### Jupyter Extension 빌드

```bash
# 의존성 설치
cd extensions/jupyter
pip install -e .
jlpm install

# 개발 모드 빌드
jlpm build

# 프로덕션 빌드
jlpm build:prod

# JupyterLab에 설치
jupyter labextension develop . --overwrite
```

### JupyterLab 실행

```bash
# Agent Server가 실행 중이어야 함
jupyter lab
```

### 테스트 실행

```bash
# Agent Server 테스트
cd agent-server
poetry run pytest tests/ -v

# Jupyter Extension E2E 테스트
cd extensions/jupyter
jlpm test:ui
```

---

## 환경 설정

### 환경 변수

```bash
# .env 파일 예시
GEMINI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
AGENT_SERVER_PORT=8000
AGENT_SERVER_HOST=0.0.0.0
LOG_LEVEL=INFO
```

### Jupyter Extension 설정

`extensions/jupyter/jupyter_ext/config.py`:
```python
AGENT_SERVER_URL = "http://localhost:8000"
```

---

## 테스트 전략

### VCR.py 기반 테스트

LLM API 응답을 녹화하여 재생합니다 (토큰 소비 0).

```
agent-server/tests/
├── conftest.py           # VCR.py 설정
├── cassettes/            # 녹화된 응답 (YAML)
│   ├── test_plan_*.yaml
│   └── ...
└── test_*.py             # 테스트 파일
```

**녹화 모드:**
```bash
# 최초 녹화 (토큰 소비)
poetry run pytest tests/ --record-mode=once

# 재생 (토큰 0)
poetry run pytest tests/
```

### E2E 테스트

Playwright + Galata로 UI 테스트:

```bash
cd extensions/jupyter
jlpm test:ui          # 헤드리스
jlpm test:ui:headed   # 브라우저 표시
```

---

## 관련 문서

- [agent_planning_flow.md](./agent_planning_flow.md) - Plan-and-Execute 아키텍처 흐름
