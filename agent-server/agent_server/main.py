"""
HDSP Agent Server - FastAPI Entry Point

AI Agent Server for IDE integrations (JupyterLab, VS Code, PyCharm)
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent_server.routers import health, config, agent, chat
from agent_server.core.config_manager import ConfigManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events"""
    # Startup
    logger.info("Starting HDSP Agent Server...")
    try:
        ConfigManager.get_instance()
        logger.info("Configuration loaded successfully")
    except Exception as e:
        logger.warning(f"Failed to load configuration: {e}")

    yield

    # Shutdown
    logger.info("Shutting down HDSP Agent Server...")


app = FastAPI(
    title="HDSP Agent Server",
    description="AI Agent Server for IDE integrations - provides intelligent code assistance",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for cross-origin requests from IDE extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Development: allow all. Production: restrict
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health.router, tags=["Health"])
app.include_router(config.router, prefix="/config", tags=["Configuration"])
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])


def run():
    """Entry point for `hdsp-agent-server` CLI command"""
    import uvicorn

    uvicorn.run(
        "agent_server.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )


if __name__ == "__main__":
    run()
