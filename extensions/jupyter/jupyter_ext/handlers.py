"""
HDSP Jupyter Extension Handlers.

ServiceFactory-based handlers supporting both embedded and proxy modes:
- Embedded mode (HDSP_AGENT_MODE=embedded): Direct in-process execution
- Proxy mode (HDSP_AGENT_MODE=proxy): HTTP proxy to external Agent Server
"""

import json
import logging
import os
from typing import Any, Dict

import httpx
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.web import RequestHandler

logger = logging.getLogger(__name__)


def _resolve_workspace_root(server_root: str) -> str:
    """Resolve workspace root by walking up to the project root if needed."""
    current = os.path.abspath(server_root)
    while True:
        if (
            os.path.isdir(os.path.join(current, "extensions"))
            and os.path.isdir(os.path.join(current, "agent-server"))
        ):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return os.path.abspath(server_root)
        current = parent


def _get_service_factory():
    """Get ServiceFactory instance (lazy import to avoid circular imports)"""
    from hdsp_agent_core.factory import get_service_factory
    return get_service_factory()


def _is_embedded_mode() -> bool:
    """Check if running in embedded mode"""
    try:
        factory = _get_service_factory()
        return factory.is_embedded
    except Exception:
        return False


# ============ Service-Based Handlers ============


class AgentPlanHandler(APIHandler):
    """Handler for /agent/plan endpoint using ServiceFactory."""

    async def post(self):
        """Generate execution plan."""
        try:
            from hdsp_agent_core.models.agent import PlanRequest

            factory = _get_service_factory()
            agent_service = factory.get_agent_service()

            # Parse request
            body = json.loads(self.request.body.decode("utf-8"))
            request = PlanRequest(**body)

            # Call service
            response = await agent_service.generate_plan(request)

            self.set_header("Content-Type", "application/json")
            self.write(response.model_dump(mode="json"))

        except Exception as e:
            logger.error(f"Plan generation failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class AgentRefineHandler(APIHandler):
    """Handler for /agent/refine endpoint using ServiceFactory."""

    async def post(self):
        """Refine code after error."""
        try:
            from hdsp_agent_core.models.agent import RefineRequest

            factory = _get_service_factory()
            agent_service = factory.get_agent_service()

            body = json.loads(self.request.body.decode("utf-8"))
            request = RefineRequest(**body)

            response = await agent_service.refine_code(request)

            self.set_header("Content-Type", "application/json")
            self.write(response.model_dump(mode="json"))

        except Exception as e:
            logger.error(f"Refine failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class AgentReplanHandler(APIHandler):
    """Handler for /agent/replan endpoint using ServiceFactory."""

    async def post(self):
        """Determine how to handle failed step."""
        try:
            from hdsp_agent_core.models.agent import ReplanRequest

            factory = _get_service_factory()
            agent_service = factory.get_agent_service()

            body = json.loads(self.request.body.decode("utf-8"))
            request = ReplanRequest(**body)

            response = await agent_service.replan(request)

            self.set_header("Content-Type", "application/json")
            self.write(response.model_dump(mode="json"))

        except Exception as e:
            logger.error(f"Replan failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class AgentValidateHandler(APIHandler):
    """Handler for /agent/validate endpoint using ServiceFactory."""

    async def post(self):
        """Validate code before execution."""
        try:
            factory = _get_service_factory()
            agent_service = factory.get_agent_service()

            body = json.loads(self.request.body.decode("utf-8"))
            code = body.get("code", "")
            notebook_context = body.get("notebookContext")

            response = await agent_service.validate_code(code, notebook_context)

            self.set_header("Content-Type", "application/json")
            self.write(response)

        except Exception as e:
            logger.error(f"Validate failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class ChatMessageHandler(APIHandler):
    """Handler for /chat/message endpoint using ServiceFactory."""

    async def post(self):
        """Send chat message and get response."""
        try:
            from hdsp_agent_core.models.chat import ChatRequest

            factory = _get_service_factory()
            chat_service = factory.get_chat_service()

            body = json.loads(self.request.body.decode("utf-8"))
            request = ChatRequest(**body)

            response = await chat_service.send_message(request)

            self.set_header("Content-Type", "application/json")
            self.write(response.model_dump(mode="json"))

        except Exception as e:
            logger.error(f"Chat message failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class ChatStreamHandler(APIHandler):
    """Handler for /chat/stream endpoint using ServiceFactory."""

    async def post(self):
        """Send chat message and get streaming response."""
        try:
            from hdsp_agent_core.models.chat import ChatRequest

            factory = _get_service_factory()
            chat_service = factory.get_chat_service()

            body = json.loads(self.request.body.decode("utf-8"))
            request = ChatRequest(**body)

            # Set SSE headers
            self.set_header("Content-Type", "text/event-stream")
            self.set_header("Cache-Control", "no-cache")
            self.set_header("Connection", "keep-alive")
            self.set_header("X-Accel-Buffering", "no")

            async for chunk in chat_service.send_message_stream(request):
                self.write(f"data: {json.dumps(chunk)}\n\n")
                await self.flush()

            self.finish()

        except Exception as e:
            logger.error(f"Chat stream failed: {e}", exc_info=True)
            self.write(f'data: {json.dumps({"error": str(e)})}\n\n')
            self.finish()


class RAGSearchHandler(APIHandler):
    """Handler for /rag/search endpoint using ServiceFactory."""

    async def post(self):
        """Search knowledge base."""
        try:
            from hdsp_agent_core.models.rag import SearchRequest

            factory = _get_service_factory()
            rag_service = factory.get_rag_service()

            body = json.loads(self.request.body.decode("utf-8"))
            request = SearchRequest(**body)

            response = await rag_service.search(request)

            self.set_header("Content-Type", "application/json")
            self.write(response.model_dump(mode="json"))

        except Exception as e:
            logger.error(f"RAG search failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class RAGStatusHandler(APIHandler):
    """Handler for /rag/status endpoint using ServiceFactory."""

    async def get(self):
        """Get RAG system status."""
        try:
            factory = _get_service_factory()
            rag_service = factory.get_rag_service()

            status = await rag_service.get_index_status()

            self.set_header("Content-Type", "application/json")
            self.write(status)

        except Exception as e:
            logger.error(f"RAG status failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


# ============ Proxy-Only Handlers (for endpoints not yet migrated) ============


class BaseProxyHandler(APIHandler):
    """Base handler that proxies requests to Agent Server."""

    @property
    def agent_server_url(self) -> str:
        """Get the Agent Server base URL."""
        from .config import get_agent_server_config
        config = get_agent_server_config()
        return config.base_url

    @property
    def timeout(self) -> float:
        """Get request timeout."""
        from .config import get_agent_server_config
        config = get_agent_server_config()
        return config.timeout

    def get_proxy_path(self) -> str:
        """Get the path to proxy to (override in subclasses if needed)."""
        request_path = self.request.path
        base_url = self.settings.get("base_url", "/")
        prefix = url_path_join(base_url, "hdsp-agent")
        if request_path.startswith(prefix):
            return request_path[len(prefix):]
        return request_path

    async def proxy_request(self, method: str = "GET", body: bytes = None):
        """Proxy the request to Agent Server."""
        target_path = self.get_proxy_path()
        target_url = f"{self.agent_server_url}{target_path}"

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
                    response = await client.post(target_url, headers=headers, content=body)
                elif method == "PUT":
                    response = await client.put(target_url, headers=headers, content=body)
                elif method == "DELETE":
                    response = await client.delete(target_url, headers=headers)
                else:
                    self.set_status(405)
                    self.write({"error": f"Method {method} not supported"})
                    return

                self.set_status(response.status_code)
                for name, value in response.headers.items():
                    if name.lower() not in ("content-encoding", "transfer-encoding", "content-length"):
                        self.set_header(name, value)
                self.write(response.content)

        except httpx.ConnectError:
            self.set_status(503)
            self.write({
                "error": "Agent Server is not available",
                "detail": f"Could not connect to {self.agent_server_url}",
            })
        except httpx.TimeoutException:
            self.set_status(504)
            self.write({
                "error": "Agent Server timeout",
                "detail": f"Request to {target_url} timed out after {self.timeout}s",
            })
        except Exception as e:
            self.set_status(500)
            self.write({"error": "Proxy error", "detail": str(e)})

    async def get(self, *args, **kwargs):
        await self.proxy_request("GET")

    async def post(self, *args, **kwargs):
        await self.proxy_request("POST", self.request.body)

    async def put(self, *args, **kwargs):
        await self.proxy_request("PUT", self.request.body)

    async def delete(self, *args, **kwargs):
        await self.proxy_request("DELETE")


class StreamProxyHandler(APIHandler):
    """Handler for streaming proxy requests (SSE)."""

    @property
    def agent_server_url(self) -> str:
        from .config import get_agent_server_config
        config = get_agent_server_config()
        return config.base_url

    @property
    def timeout(self) -> float:
        from .config import get_agent_server_config
        config = get_agent_server_config()
        return config.timeout

    def get_proxy_path(self) -> str:
        request_path = self.request.path
        base_url = self.settings.get("base_url", "/")
        prefix = url_path_join(base_url, "hdsp-agent")
        if request_path.startswith(prefix):
            return request_path[len(prefix):]
        return request_path

    async def post(self, *args, **kwargs):
        """Handle streaming POST requests (SSE)."""
        target_path = self.get_proxy_path()
        target_url = f"{self.agent_server_url}{target_path}"

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
            self.write(f'data: {json.dumps({"error": "Agent Server is not available"})}\n\n')
        except httpx.TimeoutException:
            self.write(f'data: {json.dumps({"error": "Agent Server timeout"})}\n\n')
        except Exception as e:
            self.write(f'data: {json.dumps({"error": str(e)})}\n\n')
        finally:
            self.finish()


# ============ Health & Config Handlers ============


class HealthHandler(APIHandler):
    """Health check handler."""

    async def get(self):
        """Return extension health status."""
        try:
            factory = _get_service_factory()
            mode = factory.mode.value if factory.is_initialized else "not_initialized"

            status = {
                "status": "healthy",
                "extension_version": "2.0.2",
                "mode": mode,
            }

            if factory.is_embedded:
                # In embedded mode, check RAG service directly
                rag_service = factory.get_rag_service()
                status["rag"] = {
                    "ready": rag_service.is_ready(),
                }
            else:
                # In proxy mode, check agent server connectivity
                from .config import get_agent_server_config
                config = get_agent_server_config()

                agent_server_healthy = False
                agent_server_error = None

                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        response = await client.get(f"{config.base_url}/health")
                        agent_server_healthy = response.status_code == 200
                except Exception as e:
                    agent_server_error = str(e)

                status["agent_server"] = {
                    "url": config.base_url,
                    "healthy": agent_server_healthy,
                    "error": agent_server_error,
                }

            self.write(status)

        except Exception as e:
            logger.error(f"Health check failed: {e}")
            self.write({
                "status": "degraded",
                "error": str(e),
            })


class ConfigProxyHandler(BaseProxyHandler):
    """Proxy handler for /config endpoint."""

    def get_proxy_path(self) -> str:
        return "/config"


# ============ Remaining Proxy Handlers (for endpoints not yet in ServiceFactory) ============


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


class CellActionProxyHandler(BaseProxyHandler):
    """Proxy handler for /cell/action endpoint."""

    def get_proxy_path(self) -> str:
        return "/cell/action"


class FileActionProxyHandler(BaseProxyHandler):
    """Proxy handler for /file/action endpoint."""

    def get_proxy_path(self) -> str:
        return "/file/action"


class FileResolveProxyHandler(BaseProxyHandler):
    """Proxy handler for /file/resolve endpoint."""

    def get_proxy_path(self) -> str:
        return "/file/resolve"

    async def post(self, *args, **kwargs):
        """Handle POST with notebookDir path conversion."""
        try:
            body = json.loads(self.request.body.decode("utf-8"))

            if "notebookDir" in body and body["notebookDir"]:
                server_root = self.settings.get("server_root_dir", os.getcwd())
                server_root = os.path.expanduser(server_root)
                notebook_dir = body["notebookDir"]

                if not os.path.isabs(notebook_dir):
                    body["notebookDir"] = os.path.join(server_root, notebook_dir)

            modified_body = json.dumps(body).encode("utf-8")
            await self.proxy_request("POST", modified_body)

        except Exception as e:
            logger.error(f"FileResolveProxy error: {e}")
            self.set_status(500)
            self.write({"error": f"Failed to process request: {str(e)}"})


class FileSelectProxyHandler(BaseProxyHandler):
    """Proxy handler for /file/select endpoint."""

    def get_proxy_path(self) -> str:
        return "/file/select"


class TaskStatusProxyHandler(BaseProxyHandler):
    """Proxy handler for /task/{id}/status endpoint."""

    def get_proxy_path(self) -> str:
        request_path = self.request.path
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


class LangChainStreamProxyHandler(StreamProxyHandler):
    """Proxy handler for /agent/langchain/stream endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/langchain/stream"

    async def post(self, *args, **kwargs):
        """Inject workspaceRoot based on Jupyter server root."""
        try:
            body = json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            resolved_root = _resolve_workspace_root(server_root)
            workspace_root = body.get("workspaceRoot")

            if not workspace_root or workspace_root == ".":
                body["workspaceRoot"] = resolved_root
            elif not os.path.isabs(workspace_root):
                body["workspaceRoot"] = os.path.join(resolved_root, workspace_root)

            modified_body = json.dumps(body).encode("utf-8")
            target_url = f"{self.agent_server_url}{self.get_proxy_path()}"

            self.set_header("Content-Type", "text/event-stream")
            self.set_header("Cache-Control", "no-cache")
            self.set_header("Connection", "keep-alive")
            self.set_header("X-Accel-Buffering", "no")

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    target_url,
                    content=modified_body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    async for chunk in response.aiter_bytes():
                        self.write(chunk)
                        await self.flush()
        except httpx.ConnectError:
            self.write(f'data: {json.dumps({"error": "Agent Server is not available"})}\n\n')
        except httpx.TimeoutException:
            self.write(f'data: {json.dumps({"error": "Agent Server timeout"})}\n\n')
        except Exception as e:
            logger.error(f"LangChainStreamProxy error: {e}", exc_info=True)
            self.write(f'data: {json.dumps({"error": str(e)})}\n\n')
        finally:
            self.finish()


class LangChainResumeProxyHandler(StreamProxyHandler):
    """Proxy handler for /agent/langchain/resume endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/langchain/resume"

    async def post(self, *args, **kwargs):
        """Inject workspaceRoot based on Jupyter server root."""
        try:
            body = json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            resolved_root = _resolve_workspace_root(server_root)
            workspace_root = body.get("workspaceRoot")

            if not workspace_root or workspace_root == ".":
                body["workspaceRoot"] = resolved_root
            elif not os.path.isabs(workspace_root):
                body["workspaceRoot"] = os.path.join(resolved_root, workspace_root)

            modified_body = json.dumps(body).encode("utf-8")
            target_url = f"{self.agent_server_url}{self.get_proxy_path()}"

            self.set_header("Content-Type", "text/event-stream")
            self.set_header("Cache-Control", "no-cache")
            self.set_header("Connection", "keep-alive")
            self.set_header("X-Accel-Buffering", "no")

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST",
                    target_url,
                    content=modified_body,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    async for chunk in response.aiter_bytes():
                        self.write(chunk)
                        await self.flush()
        except httpx.ConnectError:
            self.write(f'data: {json.dumps({"error": "Agent Server is not available"})}\n\n')
        except httpx.TimeoutException:
            self.write(f'data: {json.dumps({"error": "Agent Server timeout"})}\n\n')
        except Exception as e:
            logger.error(f"LangChainResumeProxy error: {e}", exc_info=True)
            self.write(f'data: {json.dumps({"error": str(e)})}\n\n')
        finally:
            self.finish()


class LangChainHealthProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/langchain/health endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/langchain/health"


class RAGReindexHandler(APIHandler):
    """Handler for /rag/reindex endpoint using ServiceFactory."""

    async def post(self):
        """Trigger reindex operation."""
        try:
            factory = _get_service_factory()
            rag_service = factory.get_rag_service()

            body = json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
            force = body.get("force", False)

            response = await rag_service.trigger_reindex(force=force)

            self.set_header("Content-Type", "application/json")
            self.write(response)

        except Exception as e:
            logger.error(f"RAG reindex failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


# ============ Handler Setup ============


def setup_handlers(web_app):
    """Register all handlers based on execution mode."""
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        # Health check
        (url_path_join(base_url, "hdsp-agent", "health"), HealthHandler),
        # Config endpoint (still proxied)
        (url_path_join(base_url, "hdsp-agent", "config"), ConfigProxyHandler),

        # ===== ServiceFactory-based handlers =====
        # Agent endpoints
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "plan"), AgentPlanHandler),
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "refine"), AgentRefineHandler),
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "replan"), AgentReplanHandler),
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "validate"), AgentValidateHandler),

        # Chat endpoints
        (url_path_join(base_url, "hdsp-agent", "chat", "message"), ChatMessageHandler),
        (url_path_join(base_url, "hdsp-agent", "chat", "stream"), ChatStreamHandler),

        # LangChain agent endpoints (proxy to agent-server)
        (url_path_join(base_url, "hdsp-agent", "agent", "langchain", "stream"), LangChainStreamProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "agent", "langchain", "resume"), LangChainResumeProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "agent", "langchain", "health"), LangChainHealthProxyHandler),

        # RAG endpoints
        (url_path_join(base_url, "hdsp-agent", "rag", "search"), RAGSearchHandler),
        (url_path_join(base_url, "hdsp-agent", "rag", "status"), RAGStatusHandler),
        (url_path_join(base_url, "hdsp-agent", "rag", "reindex"), RAGReindexHandler),

        # ===== Proxy-only handlers (not yet migrated to ServiceFactory) =====
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "reflect"), AgentReflectProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "verify-state"), AgentVerifyStateProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "auto-agent", "plan", "stream"), AgentPlanStreamProxyHandler),

        # Cell/File action endpoints
        (url_path_join(base_url, "hdsp-agent", "cell", "action"), CellActionProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "file", "action"), FileActionProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "file", "resolve"), FileResolveProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "file", "select"), FileSelectProxyHandler),

        # Task endpoints
        (url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "status"), TaskStatusProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "stream"), TaskStreamProxyHandler),
        (url_path_join(base_url, "hdsp-agent", "task", r"([^/]+)", "cancel"), TaskCancelProxyHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
