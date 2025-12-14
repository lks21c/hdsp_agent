# HDSP Jupyter Extension

JupyterLab extension that connects to the HDSP Agent Server for AI-powered code assistance.

## Architecture

This extension is a thin client that:
- Proxies all AI requests to the HDSP Agent Server (FastAPI)
- Provides the JupyterLab frontend UI
- Handles Jupyter-specific integration (kernel communication, notebook manipulation)

```
[JupyterLab Frontend] → [Jupyter Extension (Proxy)] → [Agent Server :8000]
```

## Prerequisites

- **Agent Server**: Must be running on `http://localhost:8000` (or configured via `AGENT_SERVER_URL`)
- **JupyterLab**: Version 4.0 or higher

## Installation

### Development Installation

```bash
# Install dependencies
yarn install

# Build extension
yarn build

# Install in JupyterLab (development mode)
pip install -e .
jupyter labextension develop . --overwrite
```

### Starting the Development Environment

```bash
# Terminal 1: Start Agent Server
cd ../../agent-server
poetry install
poetry run uvicorn agent_server.main:app --reload --port 8000

# Terminal 2: Start Jupyter with extension
cd extensions/jupyter
jupyter lab
```

## Configuration

Set the Agent Server URL via environment variable:

```bash
export AGENT_SERVER_URL=http://localhost:8000
jupyter lab
```

Or in `~/.jupyter/hdsp_agent_config.json`:

```json
{
  "agent_server_url": "http://localhost:8000",
  "provider": "gemini"
}
```

## Development

### Watch Mode

```bash
# Terminal 1: Watch TypeScript
yarn watch:src

# Terminal 2: Watch labextension
yarn watch:labextension
```

### Testing

```bash
# Run UI tests (requires Agent Server)
yarn test:ui

# Run UI tests with browser visible
yarn test:ui:headed
```

## API Endpoints (Proxied to Agent Server)

| Jupyter Endpoint | Agent Server Endpoint |
|------------------|----------------------|
| `/hdsp-agent/config` | `/config` |
| `/hdsp-agent/auto-agent/plan` | `/agent/plan` |
| `/hdsp-agent/auto-agent/refine` | `/agent/refine` |
| `/hdsp-agent/auto-agent/replan` | `/agent/replan` |
| `/hdsp-agent/chat/message` | `/chat/message` |
| `/hdsp-agent/chat/stream` | `/chat/stream` |

## License

MIT
