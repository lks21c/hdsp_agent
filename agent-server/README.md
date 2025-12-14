# HDSP Agent Server

AI Agent Server for IDE integrations - FastAPI-based backend for HDSP Agent.

## Features

- Plan generation and execution for code assistance
- Multi-provider LLM support (Gemini, OpenAI, vLLM)
- Real-time streaming responses via SSE
- Session management with conversation history
- Intelligent code validation and error handling

## Quick Start

```bash
# Install dependencies
poetry install

# Run the server
poetry run hdsp-agent-server

# Or using uvicorn directly
poetry run uvicorn agent_server.main:app --reload --port 8000
```

## API Endpoints

- `GET /health` - Health check
- `GET /config` - Get configuration
- `POST /config` - Update configuration
- `POST /agent/plan` - Generate execution plan
- `POST /agent/refine` - Refine code after error
- `POST /agent/replan` - Replan after failure
- `POST /chat/message` - Send chat message
- `POST /chat/stream` - Streaming chat (SSE)

## Development

```bash
# Run tests
poetry run pytest tests/ -v

# Format code
poetry run ruff format .

# Lint code
poetry run ruff check .
```

## License

MIT
