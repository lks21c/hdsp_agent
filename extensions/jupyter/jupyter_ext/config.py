"""
Configuration for HDSP Jupyter Extension.

This module manages the connection settings for the Agent Server.
"""

import json
import os
from pathlib import Path
from typing import Any, Optional


def _load_config_file() -> dict[str, Any]:
    """Load hdsp_agent_config.json from ~/.jupyter/"""
    config_file = Path.home() / ".jupyter" / "hdsp_agent_config.json"
    if config_file.exists():
        try:
            with open(config_file) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


class AgentServerConfig:
    """Configuration for Agent Server connection."""

    _instance: Optional["AgentServerConfig"] = None

    def __init__(self):
        # Load from config file first, then environment variables override
        config = _load_config_file()

        self._base_url = os.environ.get(
            "AGENT_SERVER_URL",
            config.get("agent_server_url", "http://localhost:8000"),
        )
        self._timeout = float(
            os.environ.get(
                "AGENT_SERVER_TIMEOUT",
                config.get("agent_server_timeout", 120.0),
            )
        )
        self._embed_agent_server = self._parse_bool(
            os.environ.get("HDSP_EMBED_AGENT_SERVER"),
            config.get("embed_agent_server", False),
        )
        self._agent_server_port = int(
            os.environ.get(
                "AGENT_SERVER_PORT",
                config.get("agent_server_port", 8000),
            )
        )

    @staticmethod
    def _parse_bool(env_value: Optional[str], default: bool) -> bool:
        """Parse boolean from environment variable or use default."""
        if env_value is not None:
            return env_value.lower() in ("1", "true", "yes")
        return default

    @classmethod
    def get_instance(cls) -> "AgentServerConfig":
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton instance (useful for testing)."""
        cls._instance = None

    @property
    def base_url(self) -> str:
        """Get Agent Server base URL."""
        return self._base_url

    @base_url.setter
    def base_url(self, value: str):
        """Set Agent Server base URL."""
        self._base_url = value.rstrip("/")

    @property
    def timeout(self) -> float:
        """Get request timeout in seconds."""
        return self._timeout

    @timeout.setter
    def timeout(self, value: float):
        """Set request timeout in seconds."""
        self._timeout = value

    @property
    def embed_agent_server(self) -> bool:
        """Whether to run Agent Server in embedded mode."""
        return self._embed_agent_server

    @property
    def agent_server_port(self) -> int:
        """Get Agent Server port for embedded mode."""
        return self._agent_server_port

    def get_endpoint(self, path: str) -> str:
        """Get full URL for an endpoint path."""
        return f"{self._base_url}{path}"


def get_agent_server_config() -> AgentServerConfig:
    """Get the Agent Server configuration singleton."""
    return AgentServerConfig.get_instance()
