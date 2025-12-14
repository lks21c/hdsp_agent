"""
Configuration for HDSP Jupyter Extension.

This module manages the connection settings for the Agent Server.
"""

import os
from typing import Optional


class AgentServerConfig:
    """Configuration for Agent Server connection."""

    _instance: Optional["AgentServerConfig"] = None

    def __init__(self):
        self._base_url = os.environ.get("AGENT_SERVER_URL", "http://localhost:8000")
        self._timeout = float(os.environ.get("AGENT_SERVER_TIMEOUT", "120.0"))

    @classmethod
    def get_instance(cls) -> "AgentServerConfig":
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

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

    def get_endpoint(self, path: str) -> str:
        """Get full URL for an endpoint path."""
        return f"{self._base_url}{path}"


def get_agent_server_config() -> AgentServerConfig:
    """Get the Agent Server configuration singleton."""
    return AgentServerConfig.get_instance()
