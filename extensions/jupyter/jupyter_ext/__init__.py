"""
HDSP Jupyter Extension - Thin client for HDSP Agent Server.

This extension proxies requests from JupyterLab frontend to the HDSP Agent Server.
All AI logic and processing happens in the Agent Server.
"""

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


def load_jupyter_server_extension(server_app):
    """Load the Jupyter Server extension."""
    # [Auto-config] Create config files if they don't exist
    _ensure_config_files()

    try:
        from .handlers import setup_handlers

        web_app = server_app.web_app
        setup_handlers(web_app)

        server_app.log.info("HDSP Jupyter Extension loaded (v%s)", __version__)
        server_app.log.info(
            "Proxying requests to Agent Server at: %s",
            os.environ.get("AGENT_SERVER_URL", "http://localhost:8000"),
        )

    except Exception as e:
        server_app.log.error(f"Failed to load HDSP Jupyter Extension: {e}")
        server_app.log.error(traceback.format_exc())
        raise e
