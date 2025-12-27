"""
HDSP Jupyter Extension - Dual-mode client for HDSP Agent.

Supports two execution modes:
- Embedded mode (embed_agent_server=true): Direct in-process execution via uvicorn thread
- Proxy mode (embed_agent_server=false): HTTP proxy to external Agent Server

Configuration: ~/.jupyter/hdsp_agent_config.json
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
                "agent_server_port": 8000,
                "agent_server_timeout": 120.0,
                "embed_agent_server": True,
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


def _start_embedded_agent_server(server_app, port: int):
    """Start agent server in embedded mode (same process via uvicorn thread)."""
    import threading

    import uvicorn

    # Try to import from installed package first, then fallback to dev path
    try:
        from agent_server.main import app as agent_app
    except ImportError:
        # Development mode: add agent-server to path
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        agent_server_path = os.path.join(project_root, "agent-server")
        if os.path.exists(agent_server_path) and agent_server_path not in sys.path:
            sys.path.insert(0, agent_server_path)
        from agent_server.main import app as agent_app

    def run_uvicorn():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        config = uvicorn.Config(
            agent_app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            access_log=False,
        )
        server = uvicorn.Server(config)
        loop.run_until_complete(server.serve())

    thread = threading.Thread(target=run_uvicorn, daemon=True, name="EmbeddedAgentServer")
    thread.start()

    # Wait for agent server to be ready
    import time
    ready = False
    for i in range(50):  # 5 seconds timeout
        try:
            import httpx
            response = httpx.get(f"http://127.0.0.1:{port}/health", timeout=0.2)
            if response.status_code == 200:
                ready = True
                break
        except Exception:
            pass
        time.sleep(0.1)

    if ready:
        server_app.log.info(f"Embedded Agent Server ready on http://127.0.0.1:{port}")
    else:
        server_app.log.warning(f"Embedded Agent Server started on http://127.0.0.1:{port} (may still be initializing)")


async def _initialize_service_factory(server_app):
    """Initialize ServiceFactory if hdsp_agent_core is available."""
    try:
        from hdsp_agent_core.factory import get_service_factory

        factory = get_service_factory()
        await factory.initialize()

        mode = factory.mode.value
        server_app.log.info(f"HDSP Agent ServiceFactory initialized in {mode} mode")

        if factory.is_embedded:
            rag_service = factory.get_rag_service()
            rag_ready = rag_service.is_ready()
            server_app.log.info(f"  RAG service ready: {rag_ready}")
        else:
            server_app.log.info(f"  Agent Server URL: {factory.server_url}")

    except ImportError:
        # hdsp_agent_core not available, skip ServiceFactory initialization
        pass
    except Exception as e:
        server_app.log.warning(f"ServiceFactory initialization failed: {e}")


def _schedule_initialization(server_app):
    """Schedule async initialization in the event loop."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_initialize_service_factory(server_app))
        else:
            loop.run_until_complete(_initialize_service_factory(server_app))
    except RuntimeError:
        asyncio.run(_initialize_service_factory(server_app))


def load_jupyter_server_extension(server_app):
    """Load the Jupyter Server extension."""
    # [Auto-config] Create config files if they don't exist
    _ensure_config_files()

    # Load configuration (from hdsp_agent_config.json + env overrides)
    from .config import get_agent_server_config

    config = get_agent_server_config()
    embed_agent_server = config.embed_agent_server

    # Set HDSP_AGENT_MODE environment variable based on embed_agent_server config
    if embed_agent_server:
        os.environ["HDSP_AGENT_MODE"] = "embedded"
        server_app.log.info("Setting HDSP_AGENT_MODE=embedded")
    else:
        os.environ["HDSP_AGENT_MODE"] = "proxy"
        server_app.log.info("Setting HDSP_AGENT_MODE=proxy")

    if embed_agent_server:
        try:
            _start_embedded_agent_server(server_app, config.agent_server_port)
        except Exception as e:
            server_app.log.warning(f"Failed to start embedded agent server: {e}")
            server_app.log.warning(traceback.format_exc())
            server_app.log.warning("Falling back to proxy mode")
            embed_agent_server = False
            # Update env var to match fallback
            os.environ["HDSP_AGENT_MODE"] = "proxy"

    try:
        from .handlers import setup_handlers

        web_app = server_app.web_app
        setup_handlers(web_app)

        server_app.log.info("HDSP Jupyter Extension loaded (v%s)", __version__)
        if embed_agent_server:
            server_app.log.info("Running in EMBEDDED mode (single process)")
            # Initialize ServiceFactory in embedded mode
            _schedule_initialization(server_app)
        else:
            server_app.log.info(
                "Proxying requests to Agent Server at: %s",
                config.base_url,
            )
            # In proxy mode, initialize ServiceFactory for client-side services
            _schedule_initialization(server_app)

    except Exception as e:
        server_app.log.error(f"Failed to load HDSP Jupyter Extension: {e}")
        server_app.log.error(traceback.format_exc())
        raise e
