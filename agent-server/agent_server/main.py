"""
HDSP Agent Server - FastAPI Entry Point

AI Agent Server for IDE integrations (JupyterLab, VS Code, PyCharm)

This server always runs in embedded mode (HDSP_AGENT_MODE=embedded)
since it's the actual implementation server that executes agent logic.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent_server.routers import agent, chat, config, file_resolver, health, rag

# Optional LangChain router (requires langchain dependencies)
try:
    from agent_server.routers import langchain_agent
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    langchain_agent = None

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

    # Force embedded mode for the server (it IS the implementation)
    os.environ.setdefault("HDSP_AGENT_MODE", "embedded")

    try:
        from hdsp_agent_core.factory import get_service_factory

        factory = get_service_factory()
        await factory.initialize()

        logger.info(f"ServiceFactory initialized in {factory.mode.value} mode")

        # Log service status
        rag_service = factory.get_rag_service()
        if rag_service.is_ready():
            logger.info("RAG service ready")
        else:
            logger.info("RAG service not ready (will start without RAG)")

    except ImportError as e:
        logger.warning(f"hdsp_agent_core not available: {e}")
        # Fallback to legacy initialization
        await _legacy_startup()
    except Exception as e:
        logger.warning(f"Failed to initialize ServiceFactory: {e}")
        # Fallback to legacy initialization
        await _legacy_startup()

    yield

    # Shutdown
    logger.info("Shutting down HDSP Agent Server...")

    try:
        from hdsp_agent_core.factory import get_service_factory

        factory = get_service_factory()
        await factory.shutdown()
        logger.info("ServiceFactory shutdown complete")
    except Exception as e:
        logger.warning(f"Error during ServiceFactory shutdown: {e}")
        # Fallback to legacy shutdown
        await _legacy_shutdown()


async def _legacy_startup():
    """Legacy startup for backward compatibility (when hdsp_agent_core not available)"""
    logger.info("Using legacy startup (hdsp_agent_core not available)")

    try:
        from hdsp_agent_core.managers.config_manager import ConfigManager

        ConfigManager.get_instance()
        logger.info("Configuration loaded successfully")
    except Exception as e:
        logger.warning(f"Failed to load configuration: {e}")

    # Initialize RAG system
    try:
        from hdsp_agent_core.models.rag import get_default_rag_config

        from agent_server.core.rag_manager import get_rag_manager

        rag_config = get_default_rag_config()
        if rag_config.is_enabled():
            rag_manager = get_rag_manager(rag_config)
            await rag_manager.initialize()
            logger.info("RAG system initialized successfully")
        else:
            logger.info("RAG system disabled by configuration")
    except Exception as e:
        logger.warning(f"Failed to initialize RAG system: {e}")


async def _legacy_shutdown():
    """Legacy shutdown for backward compatibility"""
    logger.info("Using legacy shutdown")

    try:
        from agent_server.core.rag_manager import get_rag_manager, reset_rag_manager

        rag_manager = get_rag_manager()
        if rag_manager.is_ready:
            await rag_manager.shutdown()
            logger.info("RAG system shut down successfully")
        reset_rag_manager()
    except Exception as e:
        logger.warning(f"Error during legacy RAG shutdown: {e}")


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
app.include_router(rag.router, prefix="/rag", tags=["RAG"])
app.include_router(file_resolver.router, prefix="/file", tags=["File Resolution"])

# Register LangChain agent router if available
if LANGCHAIN_AVAILABLE:
    app.include_router(langchain_agent.router, prefix="/agent", tags=["LangChain Agent"])
    logger.info("LangChain agent router registered")


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
