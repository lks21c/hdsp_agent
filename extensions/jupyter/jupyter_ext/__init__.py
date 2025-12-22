"""
HDSP Jupyter Extension - Dual-mode client for HDSP Agent.

Supports two execution modes:
- Embedded mode (HDSP_AGENT_MODE=embedded): Direct in-process execution
- Proxy mode (HDSP_AGENT_MODE=proxy): HTTP proxy to external Agent Server
"""

import asyncio
import os
import sys
import traceback

from ._version import __version__


# SSL certificate setup for macOS
if sys.platform == "darwin":
    try:
        import certifi

        os.environ["SSL_CERT_FILE"] = certifi.where()
        os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()
    except ImportError:
        pass


def _jupyter_labextension_paths():
    """Called by JupyterLab to find extension."""
    return [{"src": "labextension", "dest": "hdsp-agent"}]


def _jupyter_server_extension_points():
    """Called by Jupyter Server to enable extension."""
    return [{"module": "jupyter_ext"}]


def _ensure_config_files():
    """Automatically create necessary configuration files on first run."""
    import json
    import shutil
    from pathlib import Path

    try:
        jupyter_config_dir = Path.home() / ".jupyter"
        jupyter_server_config_d = jupyter_config_dir / "jupyter_server_config.d"

        # 1. Create jupyter_server_config.d directory
        jupyter_server_config_d.mkdir(parents=True, exist_ok=True)

        # 2. Copy hdsp_agent.json (server extension registration)
        dest_server_config = jupyter_server_config_d / "hdsp_jupyter_extension.json"
        if not dest_server_config.exists():
            source_server_config = (
                Path(__file__).parent
                / "etc"
                / "jupyter"
                / "jupyter_server_config.d"
                / "hdsp_jupyter_extension.json"
            )
            if source_server_config.exists():
                shutil.copy(source_server_config, dest_server_config)

        # 3. Create hdsp_agent_config.json (Agent settings - default values)
        config_file = jupyter_config_dir / "hdsp_agent_config.json"
        if not config_file.exists():
            default_config = {
                "provider": "gemini",
                "agent_server_url": "http://localhost:8000",
                "gemini": {"apiKey": "", "model": "gemini-2.5-pro"},
                "vllm": {
                    "endpoint": "http://localhost:8000",
                    "apiKey": "",
                    "model": "meta-llama/Llama-2-7b-chat-hf",
                },
                "openai": {"apiKey": "", "model": "gpt-4"},
            }
            with open(config_file, "w") as f:
                json.dump(default_config, f, indent=2)

    except Exception:
        # Configuration file creation failure is not fatal, ignore silently
        pass


async def _initialize_service_factory(server_app):
    """Initialize ServiceFactory based on HDSP_AGENT_MODE environment variable."""
    try:
        from hdsp_agent_core.factory import get_service_factory

        factory = get_service_factory()
        await factory.initialize()

        mode = factory.mode.value
        server_app.log.info(f"HDSP Agent ServiceFactory initialized in {mode} mode")

        if factory.is_embedded:
            # Log embedded mode specific info
            rag_service = factory.get_rag_service()
            rag_ready = rag_service.is_ready()
            server_app.log.info(f"  RAG service ready: {rag_ready}")
        else:
            # Log proxy mode specific info
            server_app.log.info(f"  Agent Server URL: {factory.server_url}")

    except ImportError as e:
        server_app.log.warning(f"hdsp_agent_core not available, falling back to proxy mode: {e}")
    except Exception as e:
        server_app.log.error(f"Failed to initialize ServiceFactory: {e}")
        server_app.log.error(traceback.format_exc())


def _schedule_initialization(server_app):
    """Schedule async initialization in the event loop."""
    try:
        # Get the current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If loop is already running, schedule the coroutine
            asyncio.ensure_future(_initialize_service_factory(server_app))
        else:
            # If loop is not running, run until complete
            loop.run_until_complete(_initialize_service_factory(server_app))
    except RuntimeError:
        # No event loop, create one
        asyncio.run(_initialize_service_factory(server_app))


def load_jupyter_server_extension(server_app):
    """Load the Jupyter Server extension."""
    # [Auto-config] Create config files if they don't exist
    _ensure_config_files()

    try:
        from .handlers import setup_handlers

        web_app = server_app.web_app
        setup_handlers(web_app)

        server_app.log.info("HDSP Jupyter Extension loaded (v%s)", __version__)

        # Determine mode from environment
        mode = os.environ.get("HDSP_AGENT_MODE", "proxy")
        server_app.log.info(f"HDSP_AGENT_MODE: {mode}")

        if mode == "embedded":
            server_app.log.info("Running in embedded mode (direct in-process execution)")
        else:
            server_app.log.info(
                "Running in proxy mode (proxying to Agent Server at: %s)",
                os.environ.get("AGENT_SERVER_URL", "http://localhost:8000"),
            )

        # Schedule ServiceFactory initialization
        _schedule_initialization(server_app)

    except Exception as e:
        server_app.log.error(f"Failed to load HDSP Jupyter Extension: {e}")
        server_app.log.error(traceback.format_exc())
        raise e
