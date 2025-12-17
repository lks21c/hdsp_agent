# HDSP Agent - 프로젝트 설정 및 빌드

[← 메인 문서로 돌아가기](./agent_planning_flow.md)

## 목차

- [프로젝트 구조](#프로젝트-구조)
- [빌드 및 실행](#빌드-및-실행)
- [테스트 전략](#테스트-전략)

---

## 프로젝트 구조

### 루트 디렉토리

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

### Agent Server 구조

```
agent-server/
├── pyproject.toml                # FastAPI 의존성
└── agent_server/
    ├── main.py                   # FastAPI 앱 진입점
    ├── routers/                  # API 엔드포인트
    │   ├── agent.py              # /agent/* (Auto-Agent)
    │   ├── chat.py               # /chat/* (채팅)
    │   └── health.py             # GET / (헬스체크)
    ├── schemas/                  # Pydantic 데이터 모델
    ├── core/                     # 핵심 비즈니스 로직
    │   ├── llm_service.py        # LLM 프로바이더 (Gemini/OpenAI)
    │   ├── code_validator.py     # 코드 파싱 및 검증
    │   ├── state_verifier.py     # 실행 상태 검증
    │   └── error_classifier.py   # 에러 분류
    ├── prompts/                  # LLM 프롬프트 템플릿
    ├── knowledge/                # Knowledge Base (라이브러리 가이드)
    ├── rag/                      # Local RAG (Qdrant + 임베딩)
    │   ├── embedding_manager.py  # 임베딩 생성
    │   └── qdrant_manager.py     # 벡터 DB 관리
    └── tests/                    # pytest 테스트
```

### Jupyter Extension 구조

```
extensions/jupyter/
├── jupyter_ext/                  # Python 백엔드 (프록시)
│   ├── handlers.py               # 프록시 핸들러
│   └── config.py                 # Agent Server URL 설정
│
└── frontend/                     # React/TypeScript UI
    ├── components/               # React 컴포넌트
    │   ├── AgentPanel.tsx        # 메인 에이전트 인터페이스
    │   ├── AutoAgentPanel.tsx    # Auto-Agent 오케스트레이션
    │   └── ApprovalDialog.tsx    # 실행 승인 다이얼로그
    ├── services/                 # 비즈니스 로직
    │   ├── ApiService.ts         # REST API 클라이언트
    │   ├── AgentOrchestrator.ts  # 워크플로우 관리
    │   ├── ToolRegistry.ts       # 도구 등록
    │   └── ToolExecutor.ts       # 도구 실행
    ├── types/                    # TypeScript 타입 정의
    └── plugins/                  # JupyterLab 플러그인
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

# JupyterLab에 설치
jupyter labextension develop . --overwrite
```

### JupyterLab 실행

```bash
# Agent Server가 실행 중이어야 함
jupyter lab
```

---

## 테스트 전략

### VCR.py 기반 테스트

LLM API 응답을 녹화하여 재생합니다 (토큰 소비 0).

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

[← 메인 문서로 돌아가기](./agent_planning_flow.md)
