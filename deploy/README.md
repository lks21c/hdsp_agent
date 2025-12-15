# HDSP Agent Deployment

Kubernetes deployment resources for HDSP Agent Server with Local RAG System.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   HDSP Agent Pod                     │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │           Agent Server Container               │  │   │
│  │  │  - FastAPI (port 8000)                        │  │   │
│  │  │  - RAG Manager                                │  │   │
│  │  │  - Embedding Service (multilingual-e5-small) │  │   │
│  │  │  - LLM Service (Gemini/OpenAI)               │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Qdrant Pod                        │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │          Qdrant Container                      │  │   │
│  │  │  - HTTP API (port 6333)                       │  │   │
│  │  │  - gRPC API (port 6334)                       │  │   │
│  │  │  - Vector Storage (PVC)                       │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Kubernetes 1.24+
- Helm 3.0+
- Docker for building images

## Quick Start

### 1. Build Docker Image

```bash
# From project root
docker build -f deploy/docker/Dockerfile.agent-server -t hdsp-agent-server:1.0.0 .
```

### 2. Push to Registry (if using remote cluster)

```bash
docker tag hdsp-agent-server:1.0.0 your-registry/hdsp-agent-server:1.0.0
docker push your-registry/hdsp-agent-server:1.0.0
```

### 3. Create values-override.yaml

```yaml
# values-override.yaml
agentServer:
  image:
    repository: your-registry/hdsp-agent-server
    tag: "1.0.0"
  secrets:
    geminiApiKey: "your-gemini-api-key"
    # or
    openaiApiKey: "your-openai-api-key"
  env:
    LLM_PROVIDER: "gemini"  # or "openai"

qdrant:
  persistence:
    enabled: true
    size: 20Gi
```

### 4. Deploy with Helm

```bash
# Install
helm install hdsp-agent ./deploy/helm/hdsp-agent \
  -f values-override.yaml \
  -n hdsp --create-namespace

# Upgrade
helm upgrade hdsp-agent ./deploy/helm/hdsp-agent \
  -f values-override.yaml \
  -n hdsp
```

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n hdsp

# Check services
kubectl get svc -n hdsp

# Port forward for testing
kubectl port-forward svc/hdsp-agent-agent-server 8000:8000 -n hdsp

# Test health endpoint
curl http://localhost:8000/health

# Check RAG status
curl http://localhost:8000/rag/status
```

## Configuration

### Agent Server

| Parameter | Description | Default |
|-----------|-------------|---------|
| `agentServer.replicaCount` | Number of replicas | `1` |
| `agentServer.image.repository` | Image repository | `hdsp-agent-server` |
| `agentServer.image.tag` | Image tag | `1.0.0` |
| `agentServer.resources.requests.memory` | Memory request | `512Mi` |
| `agentServer.resources.limits.memory` | Memory limit | `2Gi` |
| `agentServer.env.LLM_PROVIDER` | LLM provider (gemini/openai) | `gemini` |
| `agentServer.secrets.geminiApiKey` | Gemini API key | `""` |
| `agentServer.secrets.openaiApiKey` | OpenAI API key | `""` |

### Qdrant

| Parameter | Description | Default |
|-----------|-------------|---------|
| `qdrant.enabled` | Enable Qdrant deployment | `true` |
| `qdrant.image.tag` | Qdrant version | `v1.12.4` |
| `qdrant.persistence.enabled` | Enable persistence | `true` |
| `qdrant.persistence.size` | PVC size | `10Gi` |
| `qdrant.resources.requests.memory` | Memory request | `512Mi` |
| `qdrant.resources.limits.memory` | Memory limit | `2Gi` |

### RAG System

| Parameter | Description | Default |
|-----------|-------------|---------|
| `rag.enabled` | Enable RAG system | `true` |
| `rag.embedding.modelName` | Embedding model | `intfloat/multilingual-e5-small` |
| `rag.embedding.device` | Compute device | `cpu` |
| `rag.search.topK` | Top K results | `5` |
| `rag.search.scoreThreshold` | Score threshold | `0.5` |
| `rag.search.useHybridSearch` | Use hybrid search | `true` |

## Production Considerations

### High Availability

For production, consider:

```yaml
agentServer:
  replicaCount: 3
  resources:
    requests:
      memory: "1Gi"
      cpu: "500m"
    limits:
      memory: "4Gi"
      cpu: "2000m"

qdrant:
  # Use Qdrant Cloud or clustered deployment for HA
  # See: https://qdrant.tech/documentation/guides/distributed_deployment/
```

### GPU Support (for faster embeddings)

```yaml
rag:
  embedding:
    device: "cuda"

agentServer:
  resources:
    limits:
      nvidia.com/gpu: 1
```

### External Qdrant

To use external Qdrant (Cloud or separate cluster):

```yaml
qdrant:
  enabled: false  # Don't deploy Qdrant pod

# Set environment variables in agent server
agentServer:
  env:
    HDSP_QDRANT_MODE: "cloud"
    HDSP_QDRANT_URL: "https://your-cluster.qdrant.io:6333"
    HDSP_QDRANT_API_KEY: "your-api-key"
```

## Troubleshooting

### Check logs

```bash
# Agent server logs
kubectl logs -l app.kubernetes.io/component=agent-server -n hdsp -f

# Qdrant logs
kubectl logs -l app.kubernetes.io/component=qdrant -n hdsp -f
```

### Common Issues

1. **OOM Killed**: Increase memory limits, especially for embedding model loading
2. **Slow startup**: Embedding model download takes time on first start
3. **Connection refused to Qdrant**: Check if Qdrant pod is ready before agent server starts

## Uninstall

```bash
helm uninstall hdsp-agent -n hdsp
kubectl delete pvc -l app.kubernetes.io/name=hdsp-agent -n hdsp
```
