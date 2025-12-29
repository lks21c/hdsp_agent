# HDSP 내부 환경 설정 가이드

HDSP Agent를 내부망(Sagemaker Studio, HDSP JupyterHub)에서 사용하기 위한 설정 가이드입니다.

---

## 📋 사전 준비

### 1. whl 파일 준비

로컬 환경에서 빌드:

```bash
./build.sh
```

생성된 whl 파일 위치:
```
extensions/jupyter/dist/jupyter_ext-X.X.X-py3-none-any.whl
```

### 2. whl 파일 내부망 반입

생성된 whl 파일을 HDSP/Sagemaker 환경으로 복사합니다.

---

## 🔧 환경별 설정

### 1️⃣ Sagemaker Studio

#### Step 1: Knowledge Base 디렉토리 생성

터미널에서 실행:

```bash
mkdir -p /home/sagemaker-user/hdsp_knowledge/libraries
```

#### Step 2: 환경변수 설정

**방법 A: Jupyter 노트북 셀에서 설정 (임시)**

노트북 셀 상단에 다음 코드 실행:

```python
import os

# Knowledge Base 경로
os.environ['HDSP_KNOWLEDGE_PATH'] = '/home/sagemaker-user/hdsp_knowledge/libraries'

# vLLM Embedding Backend
os.environ['HDSP_EMBEDDING_BACKEND'] = 'vllm'
os.environ['HDSP_VLLM_ENDPOINT'] = 'http://<VLLM_SERVER_IP>:8000'  # 실제 주소로 변경
os.environ['HDSP_VLLM_MODEL'] = 'qwen3-embedding-8b'
os.environ['HDSP_VLLM_DIMENSION'] = '8192'

# Qdrant 설정 (로컬 파일 기반)
os.environ['QDRANT_MODE'] = 'local'

# Agent 모드
os.environ['HDSP_AGENT_MODE'] = 'embedded'
os.environ['HDSP_RAG_ENABLED'] = 'true'
```

**방법 B: Jupyter 설정 파일 (영구 설정)**

`~/.jupyter/jupyter_notebook_config.py` 파일 생성/수정:

```python
import os

c = get_config()  # noqa

# Knowledge Base 경로
os.environ['HDSP_KNOWLEDGE_PATH'] = '/home/sagemaker-user/hdsp_knowledge/libraries'

# vLLM Embedding Backend
os.environ['HDSP_EMBEDDING_BACKEND'] = 'vllm'
os.environ['HDSP_VLLM_ENDPOINT'] = 'http://<VLLM_SERVER_IP>:8000'  # 실제 주소로 변경
os.environ['HDSP_VLLM_MODEL'] = 'qwen3-embedding-8b'
os.environ['HDSP_VLLM_DIMENSION'] = '8192'

# Qdrant 설정
os.environ['QDRANT_MODE'] = 'local'

# Agent 모드
os.environ['HDSP_AGENT_MODE'] = 'embedded'
os.environ['HDSP_RAG_ENABLED'] = 'true'
```

#### Step 3: whl 설치

터미널 또는 노트북 셀에서:

```bash
pip install --user jupyter_ext-X.X.X-py3-none-any.whl
```

#### Step 4: Jupyter 확장 활성화

```bash
jupyter labextension list  # 설치 확인
jupyter lab build          # 필요시 빌드
```

#### Step 5: Knowledge Base 문서 추가

```bash
# 예시: CLAUDE.md 파일 추가
cp /path/to/CLAUDE.md /home/sagemaker-user/hdsp_knowledge/libraries/
```

지원 파일 형식: `*.md`, `*.py`, `*.txt`, `*.json`

---

### 2️⃣ HDSP JupyterHub

#### Step 1: Knowledge Base 디렉토리 생성

JupyterHub 터미널이 제한적이므로 노트북 셀에서 생성:

```python
import os
from pathlib import Path

knowledge_path = Path('/home/sagemaker-user/hdsp_knowledge/libraries')
knowledge_path.mkdir(parents=True, exist_ok=True)
print(f"Created: {knowledge_path}")
```

#### Step 2: 환경변수 설정

**방법 A: Jupyter 매직 명령어 (간단)**

노트북 셀에서:

```python
%env HDSP_KNOWLEDGE_PATH=/home/sagemaker-user/hdsp_knowledge/libraries
%env HDSP_EMBEDDING_BACKEND=vllm
%env HDSP_VLLM_ENDPOINT=http://<VLLM_SERVER_IP>:8000
%env HDSP_VLLM_MODEL=qwen3-embedding-8b
%env HDSP_VLLM_DIMENSION=8192
%env QDRANT_MODE=local
%env HDSP_AGENT_MODE=embedded
%env HDSP_RAG_ENABLED=true
```

**방법 B: Python 코드 (방법 A와 동일)**

```python
import os

os.environ['HDSP_KNOWLEDGE_PATH'] = '/home/sagemaker-user/hdsp_knowledge/libraries'
os.environ['HDSP_EMBEDDING_BACKEND'] = 'vllm'
os.environ['HDSP_VLLM_ENDPOINT'] = 'http://<VLLM_SERVER_IP>:8000'  # 실제 주소로 변경
os.environ['HDSP_VLLM_MODEL'] = 'qwen3-embedding-8b'
os.environ['HDSP_VLLM_DIMENSION'] = '8192'
os.environ['QDRANT_MODE'] = 'local'
os.environ['HDSP_AGENT_MODE'] = 'embedded'
os.environ['HDSP_RAG_ENABLED'] = 'true'
```

**방법 C: Jupyter 설정 파일 (영구 설정)**

`~/.jupyter/jupyter_notebook_config.py` - Sagemaker Studio와 동일

#### Step 3: whl 설치

노트북 셀에서:

```python
!pip install --user jupyter_ext-X.X.X-py3-none-any.whl
```

또는 터미널 접근이 가능하다면:

```bash
pip install --user jupyter_ext-X.X.X-py3-none-any.whl
```

#### Step 4: Jupyter 재시작

JupyterHub에서 커널 재시작:

- Kernel → Restart Kernel
- 또는 JupyterHub 세션 재시작

#### Step 5: Knowledge Base 문서 추가

노트북 셀에서:

```python
# 예시: 파일 업로드 후 복사
!cp /tmp/uploaded/CLAUDE.md /home/sagemaker-user/hdsp_knowledge/libraries/
```

---

## 🔍 설정 검증

### 1. RAG 시스템 상태 확인

노트북 셀에서:

```python
import requests

# Agent Server 상태 확인 (embedded 모드에서 자동 시작됨)
response = requests.get('http://localhost:8000/rag/status')
print(response.json())
```

예상 출력:

```json
{
  "ready": true,
  "total_documents": 1,
  "total_chunks": 5,
  "knowledge_base_path": "/home/sagemaker-user/hdsp_knowledge/libraries"
}
```

### 2. RAG 검색 테스트

```python
response = requests.post(
    'http://localhost:8000/rag/search',
    json={
        "query": "Claude Code 사용법",
        "top_k": 3,
        "include_score": True
    }
)
print(response.json())
```

### 3. 재인덱싱 (문서 추가/수정 후)

```python
response = requests.post(
    'http://localhost:8000/rag/reindex',
    json={"force": True}
)
print(response.json())
```

---

## 📝 환경변수 전체 목록

| 환경변수 | 설명 | 기본값 | 필수 |
|---------|------|--------|------|
| `HDSP_KNOWLEDGE_PATH` | Knowledge base 디렉토리 경로 | `site-packages/agent_server/knowledge/libraries` | 권장 |
| `HDSP_EMBEDDING_BACKEND` | Embedding 백엔드 (`local` 또는 `vllm`) | `local` | ✅ |
| `HDSP_VLLM_ENDPOINT` | vLLM 서버 주소 | `http://localhost:8000` | ✅ (vLLM 사용 시) |
| `HDSP_VLLM_MODEL` | vLLM 모델 이름 | `qwen3-embedding-8b` | ✅ (vLLM 사용 시) |
| `HDSP_VLLM_DIMENSION` | Embedding 차원 | `8192` | ✅ (vLLM 사용 시) |
| `QDRANT_MODE` | Qdrant 모드 (`local`, `server`, `cloud`) | `local` | - |
| `HDSP_AGENT_MODE` | Agent 모드 (`embedded`, `proxy`) | `embedded` | - |
| `HDSP_RAG_ENABLED` | RAG 기능 활성화 | `true` | - |

---

## ⚠️ 주의사항

### 1. 환경변수 설정 시점

- **whl 설치 전** 또는 **Jupyter 커널 시작 전**에 환경변수를 설정해야 합니다.
- 이미 실행 중인 커널에서는 환경변수 변경이 반영되지 않을 수 있습니다.

### 2. Knowledge Base 경로

- **절대 경로**를 사용하세요: `/home/sagemaker-user/hdsp_knowledge/libraries`
- `~` (tilde)는 피하세요: `os.path.expanduser()`로 처리되지만 명시적 경로가 안전합니다.

### 3. vLLM 서버 연결

- vLLM 서버가 실행 중이고 네트워크 접근이 가능한지 확인하세요.
- 방화벽/보안 그룹 설정을 확인하세요.

### 4. Qdrant 데이터 위치

로컬 모드 사용 시 Qdrant 데이터는 다음 위치에 저장됩니다:

```
~/.hdsp_agent/qdrant/
```

디스크 용량을 확인하세요.

---

## 🐛 트러블슈팅

### 문제 1: "RAG system not ready"

**원인**: 환경변수가 설정되지 않았거나, vLLM 서버 연결 실패

**해결**:

1. 환경변수 확인:
   ```python
   import os
   print(os.environ.get('HDSP_EMBEDDING_BACKEND'))
   print(os.environ.get('HDSP_VLLM_ENDPOINT'))
   ```

2. vLLM 서버 연결 테스트:
   ```python
   import requests
   response = requests.get('http://<VLLM_SERVER_IP>:8000/v1/models')
   print(response.json())
   ```

### 문제 2: "Knowledge base path not found"

**원인**: Knowledge base 디렉토리가 존재하지 않음

**해결**:

```python
from pathlib import Path
knowledge_path = Path('/home/sagemaker-user/hdsp_knowledge/libraries')
knowledge_path.mkdir(parents=True, exist_ok=True)
```

### 문제 3: "indexed": 0 (문서가 인덱싱되지 않음)

**원인**: 지원되는 파일 형식이 아니거나, 파일이 없음

**해결**:

1. 파일 확인:
   ```bash
   ls -la /home/sagemaker-user/hdsp_knowledge/libraries/
   ```

2. 지원 파일 형식: `*.md`, `*.py`, `*.txt`, `*.json`

3. 수동 재인덱싱:
   ```python
   import requests
   response = requests.post(
       'http://localhost:8000/rag/reindex',
       json={"force": True}
   )
   print(response.json())
   ```

---

## 📚 참고 자료

- [DEPLOY.md](./DEPLOY.md) - Docker 환경 배포 가이드
- [README.md](./README.md) - Agent Server 개요
- [../extensions/jupyter/README.md](../extensions/jupyter/README.md) - Jupyter Extension 가이드