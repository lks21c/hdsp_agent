"""
Proxy handlers for HDSP Jupyter Extension.

All requests are forwarded to the HDSP Agent Server.
"""

import json
import httpx
from tornado.web import RequestHandler
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.httputil import HTTPHeaders
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from .config import get_agent_server_config


class BaseProxyHandler(APIHandler):
    """Base handler that proxies requests to Agent Server."""

    @property
    def agent_server_url(self) -> str:
        """Get the Agent Server base URL."""
        config = get_agent_server_config()
        return config.base_url

    @property
    def timeout(self) -> float:
        """Get request timeout."""
        config = get_agent_server_config()
        return config.timeout

    def get_proxy_path(self) -> str:
        """Get the path to proxy to (override in subclasses if needed)."""
        # Extract path after /hdsp-agent/
        request_path = self.request.path
        base_url = self.settings.get("base_url", "/")

        # Remove base URL and hdsp-agent prefix to get the target path
        prefix = url_path_join(base_url, "hdsp-agent")
        if request_path.startswith(prefix):
            return request_path[len(prefix) :]
        return request_path

    async def proxy_request(self, method: str = "GET", body: bytes = None):
        """Proxy the request to Agent Server."""
        target_path = self.get_proxy_path()
        target_url = f"{self.agent_server_url}{target_path}"

        # Forward headers (excluding host)
        headers = {}
        for name, value in self.request.headers.items():
            if name.lower() not in ("host", "content-length"):
                headers[name] = value

        headers["Content-Type"] = "application/json"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if method == "GET":
                    response = await client.get(target_url, headers=headers)
                elif method == "POST":
                    response = await client.post(
                        target_url, headers=headers, content=body
                    )
                elif method == "PUT":
                    response = await client.put(
                        target_url, headers=headers, content=body
                    )
                elif method == "DELETE":
                    response = await client.delete(target_url, headers=headers)
                else:
                    self.set_status(405)
                    self.write({"error": f"Method {method} not supported"})
                    return

                # Forward response
                self.set_status(response.status_code)
                for name, value in response.headers.items():
                    if name.lower() not in (
                        "content-encoding",
                        "transfer-encoding",
                        "content-length",
                    ):
                        self.set_header(name, value)

                self.write(response.content)

        except httpx.ConnectError:
            self.set_status(503)
            self.write(
                {
                    "error": "Agent Server is not available",
                    "detail": f"Could not connect to {self.agent_server_url}",
                }
            )
        except httpx.TimeoutException:
            self.set_status(504)
            self.write(
                {
                    "error": "Agent Server timeout",
                    "detail": f"Request to {target_url} timed out after {self.timeout}s",
                }
            )
        except Exception as e:
            self.set_status(500)
            self.write({"error": "Proxy error", "detail": str(e)})

    async def get(self, *args, **kwargs):
        """Handle GET requests."""
        await self.proxy_request("GET")

    async def post(self, *args, **kwargs):
        """Handle POST requests."""
        await self.proxy_request("POST", self.request.body)

    async def put(self, *args, **kwargs):
        """Handle PUT requests."""
        await self.proxy_request("PUT", self.request.body)

    async def delete(self, *args, **kwargs):
        """Handle DELETE requests."""
        await self.proxy_request("DELETE")


class StreamProxyHandler(APIHandler):
    """Handler for streaming proxy requests (SSE)."""

    @property
    def agent_server_url(self) -> str:
        """Get the Agent Server base URL."""
        config = get_agent_server_config()
        return config.base_url

    @property
    def timeout(self) -> float:
        """Get request timeout."""
        config = get_agent_server_config()
        return config.timeout

    def get_proxy_path(self) -> str:
        """Get the path to proxy to."""
        request_path = self.request.path
        base_url = self.settings.get("base_url", "/")
        prefix = url_path_join(base_url, "hdsp-agent")
        if request_path.startswith(prefix):
            return request_path[len(prefix) :]
        return request_path

    async def post(self, *args, **kwargs):
        """Handle streaming POST requests (SSE)."""
        target_path = self.get_proxy_path()
        target_url = f"{self.agent_server_url}{target_path}"

        # Set SSE headers
        self.set_header("Content-Type", "text/event-stream")
        self.set_header("Cache-Control", "no-cache")
        self.set_header("Connection", "keep-alive")
        self.set_header("X-Accel-Buffering", "no")

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    target_url,
                    content=self.request.body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    async for chunk in response.aiter_bytes():
                        self.write(chunk)
                        await self.flush()

        except httpx.ConnectError:
            self.write(
                f'data: {json.dumps({"error": "Agent Server is not available"})}\n\n'
            )
        except httpx.TimeoutException:
            self.write(f'data: {json.dumps({"error": "Agent Server timeout"})}\n\n')
        except Exception as e:
            self.write(f'data: {json.dumps({"error": str(e)})}\n\n')
        finally:
            self.finish()


class HealthHandler(APIHandler):
    """Local health check for Jupyter extension."""

    async def get(self):
        """Return extension health status."""
        config = get_agent_server_config()

        # Check Agent Server connectivity
        agent_server_healthy = False
        agent_server_error = None

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{config.base_url}/health")
                agent_server_healthy = response.status_code == 200
        except Exception as e:
            agent_server_error = str(e)

        self.write(
            {
                "status": "healthy" if agent_server_healthy else "degraded",
                "extension_version": "2.0.0",
                "agent_server": {
                    "url": config.base_url,
                    "healthy": agent_server_healthy,
                    "error": agent_server_error,
                },
            }
        )


# Path-specific handlers for better routing
class ConfigProxyHandler(BaseProxyHandler):
    """Proxy handler for /config endpoint."""

    def get_proxy_path(self) -> str:
        return "/config"


class AgentPlanProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/plan endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/plan"


class AgentRefineProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/refine endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/refine"


class AgentReplanProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/replan endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/replan"


class AgentValidateProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/validate endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/validate"


class AgentReflectProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/reflect endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/reflect"


class AgentVerifyStateProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/verify-state endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/verify-state"


class AgentPlanStreamProxyHandler(StreamProxyHandler):
    """Proxy handler for /agent/plan/stream endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/plan/stream"


class ChatMessageProxyHandler(BaseProxyHandler):
    """Proxy handler for /chat/message endpoint."""

    def get_proxy_path(self) -> str:
        return "/chat/message"


class ChatStreamProxyHandler(StreamProxyHandler):
    """Proxy handler for /chat/stream endpoint."""

    def get_proxy_path(self) -> str:
        return "/chat/stream"


class CellActionProxyHandler(BaseProxyHandler):
    """Proxy handler for /cell/action endpoint."""

    def get_proxy_path(self) -> str:
        return "/cell/action"


class FileActionProxyHandler(BaseProxyHandler):
    """Proxy handler for /file/action endpoint."""

    def get_proxy_path(self) -> str:
        return "/file/action"


class TaskStatusProxyHandler(BaseProxyHandler):
    """Proxy handler for /task/{id}/status endpoint."""

    def get_proxy_path(self) -> str:
        # Extract task_id from URL
        request_path = self.request.path
        # Pattern: /hdsp-agent/task/{id}/status
        parts = request_path.split("/")
        task_idx = parts.index("task") if "task" in parts else -1
        if task_idx >= 0 and task_idx + 1 < len(parts):
            task_id = parts[task_idx + 1]
            return f"/task/{task_id}/status"
        return "/task/unknown/status"


class TaskStreamProxyHandler(StreamProxyHandler):
    """Proxy handler for /task/{id}/stream endpoint."""

    def get_proxy_path(self) -> str:
        request_path = self.request.path
        parts = request_path.split("/")
        task_idx = parts.index("task") if "task" in parts else -1
        if task_idx >= 0 and task_idx + 1 < len(parts):
            task_id = parts[task_idx + 1]
            return f"/task/{task_id}/stream"
        return "/task/unknown/stream"


class TaskCancelProxyHandler(BaseProxyHandler):
    """Proxy handler for /task/{id}/cancel endpoint."""

    def get_proxy_path(self) -> str:
        request_path = self.request.path
        parts = request_path.split("/")
        task_idx = parts.index("task") if "task" in parts else -1
        if task_idx >= 0 and task_idx + 1 < len(parts):
            task_id = parts[task_idx + 1]
            return f"/task/{task_id}/cancel"
        return "/task/unknown/cancel"


def setup_handlers(web_app):
    """Register all proxy handlers."""
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        # Health check (local)
        (url_path_join(base_url, "hdsp-agent", "health"), HealthHandler),
        # Config endpoints
        (url_path_join(base_url, "hdsp-agent", "config"), ConfigProxyHandler),
        # Agent endpoints
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "plan"),
            AgentPlanProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "refine"),
            AgentRefineProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "replan"),
            AgentReplanProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "validate"),
            AgentValidateProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "reflect"),
            AgentReflectProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "verify-state"),
            AgentVerifyStateProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "plan", "stream"),
            AgentPlanStreamProxyHandler,
        ),
        # Chat endpoints
        (
            url_path_join(base_url, "hdsp-agent", "chat", "message"),
            ChatMessageProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "chat", "stream"),
            ChatStreamProxyHandler,
        ),
        # Cell/File action endpoints
        (
            url_path_join(base_url, "hdsp-agent", "cell", "action"),
            CellActionProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "file", "action"),
            FileActionProxyHandler,
        ),
        # Task endpoints (with regex for task_id)
        (
            url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "status"),
            TaskStatusProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "stream"),
            TaskStreamProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "cancel"),
            TaskCancelProxyHandler,
        ),
    ]

    web_app.add_handlers(host_pattern, handlers)
