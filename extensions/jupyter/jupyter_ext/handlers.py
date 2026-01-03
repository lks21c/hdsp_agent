"""
HDSP Jupyter Extension Handlers.

ServiceFactory-based handlers supporting both embedded and proxy modes:
- Embedded mode (HDSP_AGENT_MODE=embedded): Direct in-process execution
- Proxy mode (HDSP_AGENT_MODE=proxy): HTTP proxy to external Agent Server
"""

import asyncio
import json
import logging
import os
import subprocess
import time
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

from .resource_usage import get_integrated_resources

logger = logging.getLogger(__name__)

DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS = 600_000
MAX_EXECUTE_COMMAND_STREAM_BYTES = 1_000_000


def _resolve_timeout_ms(
    value: Any, default: int = DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
) -> int:
    """Resolve timeout in milliseconds with a safe default."""
    try:
        timeout_ms = int(value)
    except (TypeError, ValueError):
        return default
    if timeout_ms <= 0:
        return default
    return timeout_ms


def _resolve_stream_timeout_ms(
    value: Any, default: int = DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
) -> Optional[int]:
    """Resolve timeout in milliseconds; non-positive disables timeout."""
    try:
        timeout_ms = int(value)
    except (TypeError, ValueError):
        return default
    if timeout_ms <= 0:
        return None
    return timeout_ms


def _resolve_workspace_root(server_root: str) -> str:
    """Resolve workspace root by walking up to the project root if needed."""
    current = os.path.abspath(server_root)
    while True:
        if os.path.isdir(os.path.join(current, "extensions")) and os.path.isdir(
            os.path.join(current, "agent-server")
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


def _run_shell_command(
    command: str, timeout_ms: int, cwd: str, stdin_input: Optional[str] = None
) -> Dict[str, Any]:
    """Run a shell command with timeout and capture output.

    Args:
        command: Shell command to execute
        timeout_ms: Timeout in milliseconds
        cwd: Working directory
        stdin_input: Optional input to provide to the command (for interactive prompts)
    """
    timeout_sec = max(0.1, timeout_ms / 1000)
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            cwd=cwd,
            input=stdin_input,  # Provide stdin if specified
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
            "cwd": cwd,
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": f"Command timed out after {timeout_sec}s. If the command requires user input, use stdin parameter or non-interactive flags.",
            "cwd": cwd,
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "cwd": cwd}


def _append_stream_output(
    current: str,
    chunk: str,
    max_bytes: int = MAX_EXECUTE_COMMAND_STREAM_BYTES,
) -> tuple[str, bool]:
    """Append output chunk, truncating when max_bytes is reached."""
    if not chunk:
        return current, False
    current_bytes = current.encode("utf-8")
    if len(current_bytes) >= max_bytes:
        return current, True
    chunk_bytes = chunk.encode("utf-8")
    remaining = max_bytes - len(current_bytes)
    if len(chunk_bytes) <= remaining:
        return current + chunk, False
    truncated_chunk = chunk_bytes[:remaining].decode("utf-8", errors="ignore")
    return current + truncated_chunk, True


async def _stream_subprocess_output(
    stream: Optional[asyncio.StreamReader],
    stream_name: str,
    emit: Callable[[str, Dict[str, Any]], Awaitable[None]],
    append: Callable[[str], None],
) -> None:
    """Stream subprocess output lines and collect them."""
    if stream is None:
        return
    while True:
        chunk = await stream.readline()
        if not chunk:
            break
        text = chunk.decode("utf-8", errors="replace")
        await emit("output", {"stream": stream_name, "text": text})
        append(text)


def _resolve_path_in_workspace(
    path: str, workspace_root: str, requested_cwd: Optional[str] = None
) -> str:
    """Resolve a relative path within the workspace root."""
    if os.path.isabs(path):
        raise ValueError("absolute paths are not allowed")
    if ".." in path:
        raise ValueError("parent directory traversal is not allowed")

    normalized_path = os.path.normpath(path)
    base_dir = workspace_root
    if requested_cwd:
        if os.path.isabs(requested_cwd):
            resolved_cwd = os.path.abspath(requested_cwd)
        else:
            resolved_cwd = os.path.abspath(os.path.join(workspace_root, requested_cwd))
        if os.path.commonpath([workspace_root, resolved_cwd]) != workspace_root:
            raise ValueError("cwd escapes workspace root")
        base_dir = resolved_cwd

        rel_cwd = os.path.normpath(os.path.relpath(resolved_cwd, workspace_root))
        if rel_cwd != ".":
            prefix = rel_cwd + os.sep
            if normalized_path == rel_cwd:
                normalized_path = "."
            elif normalized_path.startswith(prefix):
                normalized_path = normalized_path[len(prefix) :]

    resolved_path = os.path.abspath(os.path.join(base_dir, normalized_path))
    if os.path.commonpath([workspace_root, resolved_path]) != workspace_root:
        raise ValueError("path escapes workspace root")
    return resolved_path


def _resolve_command_cwd(
    server_root: str, workspace_root: str, requested_cwd: Optional[str] = None
) -> str:
    """Resolve command cwd within workspace root."""
    default_cwd = os.path.abspath(server_root)
    if os.path.commonpath([workspace_root, default_cwd]) != workspace_root:
        default_cwd = workspace_root

    if not requested_cwd:
        return default_cwd

    if os.path.isabs(requested_cwd):
        resolved_cwd = os.path.abspath(requested_cwd)
    else:
        resolved_cwd = os.path.abspath(os.path.join(default_cwd, requested_cwd))

    if os.path.commonpath([workspace_root, resolved_cwd]) != workspace_root:
        raise ValueError("cwd escapes workspace root")

    return resolved_cwd


def _write_file(
    resolved_path: str, content: str, encoding: str, overwrite: bool
) -> Dict[str, Any]:
    """Write content to a file on disk."""
    print(
        f"[WRITE DEBUG] resolved_path={resolved_path}, overwrite={overwrite}, type={type(overwrite)}",
        flush=True,
    )
    try:
        dir_path = os.path.dirname(resolved_path)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)
        mode = "w" if overwrite else "x"
        print(f"[WRITE DEBUG] mode={mode}", flush=True)
        with open(resolved_path, mode, encoding=encoding) as f:
            f.write(content)
        return {
            "success": True,
            "size": len(content),
        }
    except FileExistsError:
        return {
            "success": False,
            "error": "File already exists. Set overwrite=true to overwrite.",
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def _is_ripgrep_available() -> bool:
    """Check if ripgrep (rg) is installed."""
    import shutil

    return shutil.which("rg") is not None


def _build_search_command(
    pattern: str,
    file_types: list,
    path: str,
    case_sensitive: bool,
    max_results: int,
) -> tuple:
    """Build grep/ripgrep command for searching files."""
    use_ripgrep = _is_ripgrep_available()

    if use_ripgrep:
        cmd_parts = ["rg", "--line-number", "--with-filename"]
        if not case_sensitive:
            cmd_parts.append("--ignore-case")
        for ft in file_types:
            cmd_parts.extend(["--glob", ft])
        cmd_parts.extend(["--max-count", str(max_results)])
        escaped_pattern = pattern.replace("'", "'\\''")
        cmd_parts.append(f"'{escaped_pattern}'")
        cmd_parts.append(path)
        return " ".join(cmd_parts), "rg"
    else:
        find_parts = ["find", path, "-type", "f", "\\("]
        for i, ft in enumerate(file_types):
            if i > 0:
                find_parts.append("-o")
            find_parts.extend(["-name", f"'{ft}'"])
        find_parts.append("\\)")
        grep_flags = "n" + ("" if case_sensitive else "i")
        escaped_pattern = pattern.replace("'", "'\\''")
        cmd = f"{' '.join(find_parts)} 2>/dev/null | xargs grep -{grep_flags} '{escaped_pattern}' 2>/dev/null | head -n {max_results}"
        return cmd, "grep"


def _parse_grep_output(output: str, workspace_root: str) -> list:
    """Parse grep/ripgrep output into structured results."""
    results = []
    for line in output.strip().split("\n"):
        if not line:
            continue
        parts = line.split(":", 2)
        if len(parts) >= 2:
            file_path = parts[0]
            try:
                line_num = int(parts[1])
                content = parts[2] if len(parts) > 2 else ""
            except ValueError:
                line_num = 0
                content = line
            try:
                rel_path = os.path.relpath(file_path, workspace_root)
            except ValueError:
                rel_path = file_path
            results.append(
                {
                    "file_path": rel_path,
                    "line_number": line_num,
                    "content": content.strip()[:200],
                    "match_type": "line",
                }
            )
    return results


def _search_in_notebook(
    notebook_path: str, pattern: str, cell_type: Optional[str], case_sensitive: bool
) -> list:
    """Search for pattern in notebook cells."""
    import re

    results = []
    flags = 0 if case_sensitive else re.IGNORECASE

    try:
        compiled = re.compile(pattern, flags)
    except re.error:
        compiled = re.compile(re.escape(pattern), flags)

    try:
        with open(notebook_path, "r", encoding="utf-8") as f:
            notebook = json.load(f)
        cells = notebook.get("cells", [])
        for idx, cell in enumerate(cells):
            current_type = cell.get("cell_type", "code")
            if cell_type and current_type != cell_type:
                continue
            source = cell.get("source", [])
            if isinstance(source, list):
                source = "".join(source)
            if compiled.search(source):
                matching_lines = []
                for line_num, line in enumerate(source.split("\n"), 1):
                    if compiled.search(line):
                        matching_lines.append(
                            {"line": line_num, "content": line.strip()[:150]}
                        )
                results.append(
                    {
                        "cell_index": idx,
                        "cell_type": current_type,
                        "content": source[:300] + "..."
                        if len(source) > 300
                        else source,
                        "matching_lines": matching_lines[:5],
                        "match_type": "cell",
                    }
                )
    except Exception as e:
        logger.warning(f"Error searching notebook {notebook_path}: {e}")
    return results


def _execute_search_workspace(
    pattern: str,
    file_types: list,
    path: str,
    max_results: int,
    case_sensitive: bool,
    workspace_root: str,
) -> Dict[str, Any]:
    """Execute workspace search using subprocess."""
    search_path = os.path.normpath(os.path.join(workspace_root, path))
    if not os.path.exists(search_path):
        return {
            "success": False,
            "error": f"Path does not exist: {path}",
            "results": [],
            "total_results": 0,
        }

    command, tool_used = _build_search_command(
        pattern, file_types, search_path, case_sensitive, max_results
    )
    print(f"[SEARCH DEBUG] Executing search: {command}", flush=True)
    print(
        f"[SEARCH DEBUG] cwd: {workspace_root}, search_path: {search_path}", flush=True
    )

    # Debug: test find command separately
    find_only = f"find {search_path} -type f -name '*.py' | head -5"
    find_result = subprocess.run(
        find_only,
        shell=True,
        capture_output=True,
        text=True,
        timeout=10,
        cwd=workspace_root,
    )
    print(
        f"[SEARCH DEBUG] find only stdout: {find_result.stdout[:300] if find_result.stdout else 'EMPTY'}",
        flush=True,
    )

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=workspace_root,
        )
        print(
            f"[SEARCH DEBUG] stdout: {result.stdout[:500] if result.stdout else 'EMPTY'}",
            flush=True,
        )
        print(
            f"[SEARCH DEBUG] stderr: {result.stderr[:500] if result.stderr else 'EMPTY'}",
            flush=True,
        )
        print(f"[SEARCH DEBUG] returncode: {result.returncode}", flush=True)
        results = _parse_grep_output(result.stdout, workspace_root)

        # Also search in notebook cell contents
        notebook_results = []
        if any("ipynb" in ft for ft in file_types):
            find_cmd = f"find {search_path} -name '*.ipynb' -type f 2>/dev/null"
            nb_result = subprocess.run(
                find_cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=10,
                cwd=workspace_root,
            )
            if nb_result.returncode == 0 and nb_result.stdout:
                notebooks = nb_result.stdout.strip().split("\n")
                for nb_path in notebooks[:20]:
                    if nb_path and os.path.exists(nb_path):
                        nb_matches = _search_in_notebook(
                            nb_path, pattern, None, case_sensitive
                        )
                        for m in nb_matches:
                            try:
                                m["file_path"] = os.path.relpath(
                                    nb_path, workspace_root
                                )
                            except ValueError:
                                m["file_path"] = nb_path
                        notebook_results.extend(nb_matches)
                        if len(notebook_results) >= max_results:
                            break

        all_results = results + notebook_results
        return {
            "success": True,
            "command": command,
            "tool_used": tool_used,
            "results": all_results[:max_results],
            "total_results": len(all_results),
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Search timed out",
            "results": [],
            "total_results": 0,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "results": [], "total_results": 0}


def _execute_search_notebook_cells(
    pattern: str,
    notebook_path: Optional[str],
    cell_type: Optional[str],
    max_results: int,
    case_sensitive: bool,
    workspace_root: str,
) -> Dict[str, Any]:
    """Execute notebook cell search."""
    results = []
    notebooks_searched = 0

    try:
        if notebook_path:
            full_path = os.path.normpath(os.path.join(workspace_root, notebook_path))
            if os.path.exists(full_path) and full_path.endswith(".ipynb"):
                matches = _search_in_notebook(
                    full_path, pattern, cell_type, case_sensitive
                )
                for m in matches:
                    m["file_path"] = notebook_path
                results.extend(matches)
                notebooks_searched = 1
            else:
                return {
                    "success": False,
                    "error": f"Notebook not found: {notebook_path}",
                    "results": [],
                    "total_results": 0,
                    "notebooks_searched": 0,
                }
        else:
            find_cmd = f"find {workspace_root} -name '*.ipynb' -type f 2>/dev/null"
            find_result = subprocess.run(
                find_cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=10,
                cwd=workspace_root,
            )
            if find_result.returncode == 0 and find_result.stdout:
                notebooks = find_result.stdout.strip().split("\n")
                for nb_full_path in notebooks:
                    if not nb_full_path or not os.path.exists(nb_full_path):
                        continue
                    notebooks_searched += 1
                    matches = _search_in_notebook(
                        nb_full_path, pattern, cell_type, case_sensitive
                    )
                    try:
                        rel_path = os.path.relpath(nb_full_path, workspace_root)
                    except ValueError:
                        rel_path = nb_full_path
                    for m in matches:
                        m["file_path"] = rel_path
                    results.extend(matches)
                    if len(results) >= max_results:
                        break

        return {
            "success": True,
            "results": results[:max_results],
            "total_results": len(results),
            "notebooks_searched": notebooks_searched,
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "results": [],
            "total_results": 0,
            "notebooks_searched": 0,
        }


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
            self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
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


class ExecuteCommandHandler(APIHandler):
    """Handler for /execute-command endpoint (runs on Jupyter server)."""

    async def post(self):
        """Execute shell command after user approval."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            command = (body.get("command") or "").strip()
            timeout_ms = _resolve_timeout_ms(body.get("timeout"))
            requested_cwd = (body.get("cwd") or "").strip()
            stdin_input = body.get("stdin")  # Optional stdin for interactive commands

            if not command:
                self.set_status(400)
                self.write({"error": "command is required"})
                return

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            try:
                cwd = _resolve_command_cwd(server_root, workspace_root, requested_cwd)
            except ValueError as exc:
                self.set_status(400)
                self.write({"error": str(exc)})
                return

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: _run_shell_command(command, timeout_ms, cwd, stdin_input),
            )

            self.set_header("Content-Type", "application/json")
            self.write(result)

        except Exception as e:
            logger.error(f"Execute command failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class ExecuteCommandStreamHandler(APIHandler):
    """Handler for /execute-command/stream endpoint (runs on Jupyter server)."""

    async def post(self):
        """Execute shell command and stream output."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            command = (body.get("command") or "").strip()
            timeout_ms = _resolve_stream_timeout_ms(body.get("timeout"))
            requested_cwd = (body.get("cwd") or "").strip()
            stdin_input = body.get("stdin")  # Optional stdin for interactive commands

            if not command:
                self.set_status(400)
                self.write({"error": "command is required"})
                return

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            try:
                cwd = _resolve_command_cwd(server_root, workspace_root, requested_cwd)
            except ValueError as exc:
                self.set_status(400)
                self.write({"error": str(exc)})
                return

            self.set_header("Content-Type", "text/event-stream")
            self.set_header("Cache-Control", "no-cache")
            self.set_header("Connection", "keep-alive")
            self.set_header("X-Accel-Buffering", "no")

            async def emit(event: str, payload: Dict[str, Any]) -> None:
                self.write(f"event: {event}\n")
                self.write(f"data: {json.dumps(payload)}\n\n")
                await self.flush()

            start_time = time.monotonic()
            await emit("start", {"command": command, "cwd": cwd})

            # Use PIPE for stdin if input is provided
            stdin_pipe = asyncio.subprocess.PIPE if stdin_input else None
            process = await asyncio.create_subprocess_shell(
                command,
                stdin=stdin_pipe,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )

            # Write stdin if provided
            if stdin_input and process.stdin:
                process.stdin.write(stdin_input.encode())
                await process.stdin.drain()
                process.stdin.close()
                await process.stdin.wait_closed()

            stdout_text = ""
            stderr_text = ""
            stdout_truncated = False
            stderr_truncated = False

            def append_stdout(text: str) -> None:
                nonlocal stdout_text, stdout_truncated
                stdout_text, truncated = _append_stream_output(stdout_text, text)
                stdout_truncated = stdout_truncated or truncated

            def append_stderr(text: str) -> None:
                nonlocal stderr_text, stderr_truncated
                stderr_text, truncated = _append_stream_output(stderr_text, text)
                stderr_truncated = stderr_truncated or truncated

            stdout_task = asyncio.create_task(
                _stream_subprocess_output(process.stdout, "stdout", emit, append_stdout)
            )
            stderr_task = asyncio.create_task(
                _stream_subprocess_output(process.stderr, "stderr", emit, append_stderr)
            )

            timed_out = False
            timeout_sec = None if timeout_ms is None else max(0.1, timeout_ms / 1000)
            try:
                if timeout_sec is None:
                    await process.wait()
                else:
                    await asyncio.wait_for(process.wait(), timeout=timeout_sec)
            except asyncio.TimeoutError:
                timed_out = True
                process.kill()
                await process.wait()

            try:
                await asyncio.wait_for(
                    asyncio.gather(stdout_task, stderr_task),
                    timeout=0.5,
                )
            except asyncio.TimeoutError:
                stdout_task.cancel()
                stderr_task.cancel()
                await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)

            duration_ms = int((time.monotonic() - start_time) * 1000)
            truncated = stdout_truncated or stderr_truncated
            if timed_out:
                result = {
                    "success": False,
                    "stdout": stdout_text,
                    "stderr": stderr_text,
                    "returncode": process.returncode,
                    "error": f"Command timed out after {timeout_sec}s",
                    "truncated": truncated,
                    "cwd": cwd,
                    "duration_ms": duration_ms,
                }
            else:
                result = {
                    "success": process.returncode == 0,
                    "stdout": stdout_text,
                    "stderr": stderr_text,
                    "returncode": process.returncode,
                    "truncated": truncated,
                    "cwd": cwd,
                    "duration_ms": duration_ms,
                }

            await emit("result", result)
            self.finish()

        except Exception as e:
            logger.error(f"Execute command stream failed: {e}", exc_info=True)
            self.set_header("Content-Type", "text/event-stream")
            self.write(f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n")
            self.finish()


class ResourceUsageHandler(APIHandler):
    """Handler for /resource-usage endpoint (runs on Jupyter server)."""

    async def get(self):
        """Return resource usage summary for the client host."""
        try:
            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            resource = get_integrated_resources(workspace_root=workspace_root)

            self.set_header("Content-Type", "application/json")
            self.write({"resource": resource})

        except Exception as e:
            logger.error(f"Resource usage collection failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class CheckResourceHandler(APIHandler):
    """Handler for /check-resource endpoint (runs on Jupyter server).
    
    Checks system resources, file sizes, and DataFrame shapes for resource-aware
    code generation.
    """

    async def post(self):
        """Check resources for the requested files and dataframes."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            files = body.get("files", [])
            dataframes = body.get("dataframes", [])
            file_size_command = body.get("file_size_command", "")
            dataframe_check_code = body.get("dataframe_check_code", "")

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            result: Dict[str, Any] = {"success": True}

            # 1. Get system resources
            resource = get_integrated_resources(workspace_root=workspace_root)
            memory = resource.get("memory", {})
            result["system"] = {
                "ram_available_mb": round(
                    (memory.get("available_gb") or 0) * 1024, 2
                ),
                "ram_total_mb": round((memory.get("total_gb") or 0) * 1024, 2),
                "cpu_cores": resource.get("cpu", {}).get("cores"),
                "environment": resource.get("environment"),
            }

            # 2. Get file sizes
            file_info = []
            for file_path in files:
                # Resolve path relative to server_root (Jupyter's working directory)
                # NOT workspace_root (project root) to match list_files_tool behavior
                if os.path.isabs(file_path):
                    abs_path = file_path
                else:
                    abs_path = os.path.join(server_root, file_path)
                
                try:
                    stat = os.stat(abs_path)
                    file_info.append({
                        "name": os.path.basename(file_path),
                        "path": file_path,
                        "size_bytes": stat.st_size,
                        "size_mb": round(stat.st_size / (1024 * 1024), 2),
                        "exists": True,
                    })
                except (OSError, IOError) as e:
                    file_info.append({
                        "name": os.path.basename(file_path),
                        "path": file_path,
                        "exists": False,
                        "error": str(e),
                    })
            result["files"] = file_info

            # 3. Get DataFrame info (if dataframe_check_code provided)
            df_info = []
            if dataframe_check_code and dataframes:
                try:
                    # Execute the code in the active kernel
                    kernel_manager = self.settings.get("kernel_manager")
                    if kernel_manager:
                        # Try to get the active kernel
                        kernel_ids = list(kernel_manager.list_kernel_ids())
                        if kernel_ids:
                            kernel_id = kernel_ids[0]
                            kernel = kernel_manager.get_kernel(kernel_id)
                            if kernel and hasattr(kernel, "client"):
                                client = kernel.client()
                                # Execute code and get result
                                msg_id = client.execute(dataframe_check_code, silent=True)
                                # Wait for result (with timeout)
                                import asyncio
                                try:
                                    reply = await asyncio.wait_for(
                                        asyncio.to_thread(
                                            client.get_shell_msg, msg_id, timeout=5
                                        ),
                                        timeout=10,
                                    )
                                    # Parse output
                                    if reply.get("content", {}).get("status") == "ok":
                                        # Get stdout from iopub
                                        while True:
                                            try:
                                                iopub_msg = client.get_iopub_msg(timeout=1)
                                                if iopub_msg.get("msg_type") == "stream":
                                                    text = iopub_msg.get("content", {}).get("text", "")
                                                    if text:
                                                        df_info = json.loads(text)
                                                        break
                                            except Exception:
                                                break
                                except asyncio.TimeoutError:
                                    logger.warning("DataFrame check timed out")
                except Exception as e:
                    logger.warning(f"DataFrame check failed: {e}")
                    # Return placeholder for requested dataframes
                    for df_name in dataframes:
                        df_info.append({
                            "name": df_name,
                            "exists": False,
                            "error": "Kernel execution failed",
                        })
            result["dataframes"] = df_info

            self.set_header("Content-Type", "application/json")
            self.write(result)

        except Exception as e:
            logger.error(f"Resource check failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"success": False, "error": str(e)})


class WriteFileHandler(APIHandler):
    """Handler for /write-file endpoint (runs on Jupyter server)."""

    async def post(self):
        """Write file content after user approval."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            path = (body.get("path") or "").strip()
            content = body.get("content") or ""
            encoding = body.get("encoding") or "utf-8"
            overwrite = bool(body.get("overwrite", False))
            requested_cwd = (body.get("cwd") or "").strip()

            if not path:
                self.set_status(400)
                self.write({"error": "path is required"})
                return

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            # If no cwd requested, use server_root as default (notebook directory)
            # This ensures files are saved relative to where Jupyter was started
            effective_cwd = requested_cwd
            if not effective_cwd:
                abs_server_root = os.path.abspath(server_root)
                # Use server_root if it's within workspace_root, otherwise use workspace_root
                if (
                    os.path.commonpath([workspace_root, abs_server_root])
                    == workspace_root
                ):
                    effective_cwd = abs_server_root
                else:
                    effective_cwd = workspace_root

            try:
                resolved_path = _resolve_path_in_workspace(
                    path, workspace_root, effective_cwd
                )
            except ValueError as exc:
                self.set_status(400)
                self.write({"error": str(exc)})
                return

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None, _write_file, resolved_path, content, encoding, overwrite
            )

            result.update(
                {
                    "path": path,
                    "resolved_path": resolved_path,
                    "overwrite": overwrite,
                }
            )
            self.set_header("Content-Type", "application/json")
            self.write(result)

        except Exception as e:
            logger.error(f"Write file failed: {e}", exc_info=True)
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
            return request_path[len(prefix) :]
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
            return request_path[len(prefix) :]
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
            self.write(
                f"data: {json.dumps({'error': 'Agent Server is not available'})}\n\n"
            )
        except httpx.TimeoutException:
            self.write(f"data: {json.dumps({'error': 'Agent Server timeout'})}\n\n")
        except Exception as e:
            self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
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
            self.write(
                {
                    "status": "degraded",
                    "error": str(e),
                }
            )


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
            # Log request info for debugging
            body_len = len(self.request.body) if self.request.body else 0
            logger.info(
                "LangChainStreamProxy: Received request, body size=%d bytes",
                body_len,
            )

            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            
            # Log parsed request info
            request_text = body.get("request", "")
            logger.info(
                "LangChainStreamProxy: Parsed request, message length=%d chars",
                len(request_text),
            )
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
            self.write(
                f"data: {json.dumps({'error': 'Agent Server is not available'})}\n\n"
            )
        except httpx.TimeoutException:
            self.write(f"data: {json.dumps({'error': 'Agent Server timeout'})}\n\n")
        except Exception as e:
            logger.error(f"LangChainStreamProxy error: {e}", exc_info=True)
            self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
        finally:
            self.finish()


class LangChainResumeProxyHandler(StreamProxyHandler):
    """Proxy handler for /agent/langchain/resume endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/langchain/resume"

    async def post(self, *args, **kwargs):
        """Inject workspaceRoot based on Jupyter server root."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
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
            self.write(
                f"data: {json.dumps({'error': 'Agent Server is not available'})}\n\n"
            )
        except httpx.TimeoutException:
            self.write(f"data: {json.dumps({'error': 'Agent Server timeout'})}\n\n")
        except Exception as e:
            logger.error(f"LangChainResumeProxy error: {e}", exc_info=True)
            self.write(f"data: {json.dumps({'error': str(e)})}\n\n")
        finally:
            self.finish()


class LangChainHealthProxyHandler(BaseProxyHandler):
    """Proxy handler for /agent/langchain/health endpoint."""

    def get_proxy_path(self) -> str:
        return "/agent/langchain/health"


class SearchWorkspaceHandler(APIHandler):
    """Handler for /search-workspace endpoint (runs on Jupyter server)."""

    async def post(self):
        """Execute workspace search."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            pattern = (body.get("pattern") or "").strip()
            file_types = body.get("file_types") or ["*.py", "*.ipynb"]
            path = body.get("path") or "."
            max_results = body.get("max_results", 50)
            case_sensitive = bool(body.get("case_sensitive", False))

            if not pattern:
                self.set_status(400)
                self.write({"error": "pattern is required"})
                return

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                _execute_search_workspace,
                pattern,
                file_types,
                path,
                max_results,
                case_sensitive,
                workspace_root,
            )

            self.set_header("Content-Type", "application/json")
            self.write(result)

        except Exception as e:
            logger.error(f"Search workspace failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class SearchNotebookCellsHandler(APIHandler):
    """Handler for /search-notebook-cells endpoint (runs on Jupyter server)."""

    async def post(self):
        """Execute notebook cells search."""
        try:
            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
            pattern = (body.get("pattern") or "").strip()
            notebook_path = body.get("notebook_path")
            cell_type = body.get("cell_type")
            max_results = body.get("max_results", 30)
            case_sensitive = bool(body.get("case_sensitive", False))

            if not pattern:
                self.set_status(400)
                self.write({"error": "pattern is required"})
                return

            server_root = self.settings.get("server_root_dir", os.getcwd())
            server_root = os.path.expanduser(server_root)
            workspace_root = _resolve_workspace_root(server_root)

            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                _execute_search_notebook_cells,
                pattern,
                notebook_path,
                cell_type,
                max_results,
                case_sensitive,
                workspace_root,
            )

            self.set_header("Content-Type", "application/json")
            self.write(result)

        except Exception as e:
            logger.error(f"Search notebook cells failed: {e}", exc_info=True)
            self.set_status(500)
            self.write({"error": str(e)})


class RAGReindexHandler(APIHandler):
    """Handler for /rag/reindex endpoint using ServiceFactory."""

    async def post(self):
        """Trigger reindex operation."""
        try:
            factory = _get_service_factory()
            rag_service = factory.get_rag_service()

            body = (
                json.loads(self.request.body.decode("utf-8"))
                if self.request.body
                else {}
            )
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
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "refine"),
            AgentRefineHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "replan"),
            AgentReplanHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "auto-agent", "validate"),
            AgentValidateHandler,
        ),
        # Chat endpoints
        (url_path_join(base_url, "hdsp-agent", "chat", "message"), ChatMessageHandler),
        (url_path_join(base_url, "hdsp-agent", "chat", "stream"), ChatStreamHandler),
        # LangChain agent endpoints (proxy to agent-server)
        (
            url_path_join(base_url, "hdsp-agent", "agent", "langchain", "stream"),
            LangChainStreamProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "agent", "langchain", "resume"),
            LangChainResumeProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "agent", "langchain", "health"),
            LangChainHealthProxyHandler,
        ),
        # Shell command execution (server-side, approval required)
        (
            url_path_join(base_url, "hdsp-agent", "execute-command"),
            ExecuteCommandHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "execute-command", "stream"),
            ExecuteCommandStreamHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "resource-usage"),
            ResourceUsageHandler,
        ),
        # Resource check for data processing (server-side, auto-approved)
        (
            url_path_join(base_url, "hdsp-agent", "check-resource"),
            CheckResourceHandler,
        ),
        # File write execution (server-side, approval required)
        (url_path_join(base_url, "hdsp-agent", "write-file"), WriteFileHandler),
        # Search endpoints (server-side, no approval required)
        (
            url_path_join(base_url, "hdsp-agent", "search-workspace"),
            SearchWorkspaceHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "search-notebook-cells"),
            SearchNotebookCellsHandler,
        ),
        # RAG endpoints
        (url_path_join(base_url, "hdsp-agent", "rag", "search"), RAGSearchHandler),
        (url_path_join(base_url, "hdsp-agent", "rag", "status"), RAGStatusHandler),
        (url_path_join(base_url, "hdsp-agent", "rag", "reindex"), RAGReindexHandler),
        # ===== Proxy-only handlers (not yet migrated to ServiceFactory) =====
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
        # Cell/File action endpoints
        (
            url_path_join(base_url, "hdsp-agent", "cell", "action"),
            CellActionProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "file", "action"),
            FileActionProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "file", "resolve"),
            FileResolveProxyHandler,
        ),
        (
            url_path_join(base_url, "hdsp-agent", "file", "select"),
            FileSelectProxyHandler,
        ),
        # Task endpoints
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
