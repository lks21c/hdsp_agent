"""
LangChain Agent

Main agent creation module for tool-driven chat execution.
"""

import json
import logging
from functools import wraps
from typing import Any, Dict, Optional

from langchain_core.callbacks import BaseCallbackHandler

from agent_server.langchain.tools import (
    check_resource_tool,
    execute_command_tool,
    final_answer_tool,
    jupyter_cell_tool,
    list_files_tool,
    markdown_tool,
    read_file_tool,
    search_notebook_cells_tool,
    search_workspace_tool,
    write_file_tool,
)

logger = logging.getLogger(__name__)

LOG_SEPARATOR = "=" * 96
LOG_SUBSECTION = "-" * 96


def _format_system_prompt_for_log(messages) -> tuple[int, int, str]:
    from langchain_core.messages import SystemMessage

    system_contents = [
        str(getattr(msg, "content", ""))
        for msg in messages
        if isinstance(msg, SystemMessage)
    ]
    combined = "\n\n".join(system_contents)
    return len(system_contents), len(combined), combined


def _pretty_json(value: Any) -> str:
    try:
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return json.dumps(str(value), indent=2, ensure_ascii=False)


def _serialize_message(message) -> Dict[str, Any]:
    data: Dict[str, Any] = {"type": message.__class__.__name__}
    content = getattr(message, "content", None)
    if content is not None:
        data["content"] = content
    name = getattr(message, "name", None)
    if name:
        data["name"] = name
    tool_call_id = getattr(message, "tool_call_id", None)
    if tool_call_id:
        data["tool_call_id"] = tool_call_id
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        data["tool_calls"] = tool_calls
    additional_kwargs = getattr(message, "additional_kwargs", None)
    if additional_kwargs:
        data["additional_kwargs"] = additional_kwargs
    response_metadata = getattr(message, "response_metadata", None)
    if response_metadata:
        data["response_metadata"] = response_metadata
    return data


def _format_messages_block(title: str, messages) -> str:
    lines = [LOG_SEPARATOR, title, LOG_SEPARATOR]
    if not messages:
        lines.append("<empty>")
        lines.append(LOG_SEPARATOR)
        return "\n".join(lines)

    for idx, message in enumerate(messages):
        lines.append(f"[{idx}] {message.__class__.__name__}")
        lines.append(_pretty_json(_serialize_message(message)))
        if idx < len(messages) - 1:
            lines.append(LOG_SUBSECTION)
    lines.append(LOG_SEPARATOR)
    return "\n".join(lines)


def _format_json_block(title: str, payload: Any) -> str:
    return "\n".join(
        [
            LOG_SEPARATOR,
            title,
            LOG_SEPARATOR,
            _pretty_json(payload),
            LOG_SEPARATOR,
        ]
    )


def _format_middleware_marker(name: str, stage: str) -> str:
    return "\n".join([LOG_SEPARATOR, f"MIDDLEWARE {stage}: {name}", LOG_SEPARATOR])


def _with_middleware_logging(name: str):
    def decorator(func):
        @wraps(func)
        def wrapped(request, handler):
            logger.info("%s", _format_middleware_marker(name, "START"))
            response = func(request, handler)
            logger.info("%s", _format_middleware_marker(name, "END"))
            return response

        return wrapped

    return decorator


class LLMTraceLogger(BaseCallbackHandler):
    """Log prompts, responses, tool calls, and tool messages."""

    def _normalize_batches(self, messages):
        if not messages:
            return []
        if isinstance(messages[0], (list, tuple)):
            return messages
        return [messages]

    def _log_prompt_batches(self, title: str, messages) -> None:
        for batch_idx, batch in enumerate(self._normalize_batches(messages)):
            header = f"{title} (batch={batch_idx}, messages={len(batch)})"
            logger.info("%s", _format_messages_block(header, batch))

            tool_messages = [
                msg
                for msg in batch
                if getattr(msg, "type", "") == "tool"
                or msg.__class__.__name__ == "ToolMessage"
            ]
            if tool_messages:
                tool_header = f"{title} TOOL MESSAGES (batch={batch_idx})"
                logger.info("%s", _format_messages_block(tool_header, tool_messages))

    def on_chat_model_start(self, serialized, messages, **kwargs) -> None:
        if not messages:
            logger.info(
                "%s",
                _format_messages_block("AGENT -> LLM PROMPT (<none>)", []),
            )
            return
        self._log_prompt_batches("AGENT -> LLM PROMPT", messages)

    def on_chat_model_end(self, response, **kwargs) -> None:
        generations = getattr(response, "generations", None) or []
        if generations and isinstance(generations[0], list):
            batches = generations
        else:
            batches = [generations]

        for batch_idx, batch in enumerate(batches):
            for gen_idx, generation in enumerate(batch):
                message = getattr(generation, "message", None)
                if not message:
                    continue

                title = (
                    f"LLM -> AGENT RESPONSE (batch={batch_idx}, generation={gen_idx})"
                )
                logger.info("%s", _format_messages_block(title, [message]))

                tool_calls = getattr(message, "tool_calls", None)
                if tool_calls:
                    tool_title = (
                        "LLM -> AGENT TOOL CALLS "
                        f"(batch={batch_idx}, generation={gen_idx})"
                    )
                    logger.info("%s", _format_json_block(tool_title, tool_calls))

    def on_llm_start(self, serialized, prompts, **kwargs) -> None:
        if not prompts:
            logger.info("%s", _format_json_block("LLM PROMPT (<none>)", ""))
            return

        for idx, prompt in enumerate(prompts):
            title = f"LLM PROMPT (batch={idx}, length={len(prompt)})"
            logger.info("%s", _format_json_block(title, prompt))


DEFAULT_SYSTEM_PROMPT = """You are an expert Python data scientist and Jupyter notebook assistant.
Your role is to help users with data analysis, visualization, and Python coding tasks in Jupyter notebooks. You can use only Korean

## ⚠️ CRITICAL RULE: NEVER produce an empty response

You MUST ALWAYS call a tool in every response. After any tool result, you MUST:
1. Check your todo list - are there pending or in_progress items?
2. If YES → call the next appropriate tool (jupyter_cell_tool, markdown_tool, etc.)
3. If ALL todos are completed → call final_answer_tool with a summary

NEVER end your turn without calling a tool. NEVER produce an empty response.

## Available Tools
1. **write_todos**: Create and update task list for complex multi-step tasks
2. **jupyter_cell_tool**: Execute Python code in a new notebook cell
3. **markdown_tool**: Add a markdown explanation cell
4. **final_answer_tool**: Complete the task with a summary - REQUIRED when done
5. **read_file_tool**: Read file contents
6. **write_file_tool**: Write file contents
7. **list_files_tool**: List directory contents
8. **search_workspace_tool**: Search for patterns in workspace files
9. **search_notebook_cells_tool**: Search for patterns in notebook cells
10. **execute_command_tool**: Run shell commands via the client (approval required)
    - Interactive prompts are auto-answered with "y" by default
    - NEVER run long-running commands (servers, watch, dev) or endless processes
11. **check_resource_tool**: Check system RAM and file sizes BEFORE handling data

## 🔴 MANDATORY: Resource Check Before Data Hanlding
**ALWAYS call check_resource_tool FIRST** when the task involves:
- Loading files: .csv, .parquet, .json, .xlsx, .pickle, .h5, .feather
- Handling datasets(dataframe) with pandas, polars, dask, or similar libraries
- Training ML models on data files

## Mandatory Workflow
1. After EVERY tool result, immediately call the next tool
2. Continue until ALL todos show status: "completed"
3. ONLY THEN call final_answer_tool to summarize
4. Only use jupyter_cell_tool for Python code or when the user explicitly asks to run in a notebook cell
5. For plots and charts, use English text only.

## ❌ FORBIDDEN (will break the workflow)
- Producing an empty response (no tool call, no content)
- Stopping after any tool without calling the next tool
- Ending without calling final_answer_tool
- Leaving todos in "in_progress" or "pending" state without continuing
"""


def _get_hitl_interrupt_config() -> Dict[str, Any]:
    """Return HITL interrupt config for client-side tool execution."""
    return {
        # Require approval before executing code
        "jupyter_cell_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "🔍 Code execution requires approval",
        },
        # Safe operations - no approval needed
        "markdown_tool": False,
        "read_file_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📄 파일 읽기 실행 중",
        },
        "list_files_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📂 파일 목록 조회 중",
        },
        "write_todos": False,  # Todo updates don't need approval
        # Search tools need HITL for client-side execution (auto-approved by frontend)
        # Uses 'edit' decision to pass execution_result back
        "search_workspace_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "🔍 Searching workspace files",
        },
        "search_notebook_cells_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "🔍 Searching notebook cells",
        },
        # Resource check tool for client-side execution (auto-approved by frontend)
        "check_resource_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📊 Checking system resources",
        },
        "execute_command_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "🖥️ Shell command requires approval",
        },
        # File write requires approval
        "write_file_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "⚠️ File write requires approval",
        },
        # Final answer doesn't need approval
        "final_answer_tool": False,
    }


def _create_llm(llm_config: Dict[str, Any]):
    """Create LangChain LLM from config"""
    provider = llm_config.get("provider", "gemini")
    callbacks = [LLMTraceLogger()]

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        gemini_config = llm_config.get("gemini", {})
        api_key = gemini_config.get("apiKey")
        model = gemini_config.get("model", "gemini-2.5-pro")

        if not api_key:
            raise ValueError("Gemini API key not configured")

        logger.info(f"Creating Gemini LLM with model: {model}")

        # Gemini 2.5 Flash has issues with tool calling in LangChain
        # Use convert_system_message_to_human for better compatibility
        llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.0,
            max_output_tokens=8192,
            convert_system_message_to_human=True,  # Better tool calling support
            callbacks=callbacks,
        )
        return llm

    elif provider == "openai":
        from langchain_openai import ChatOpenAI

        openai_config = llm_config.get("openai", {})
        api_key = openai_config.get("apiKey")
        model = openai_config.get("model", "gpt-4")

        if not api_key:
            raise ValueError("OpenAI API key not configured")

        llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            temperature=0.0,
            max_tokens=4096,
            callbacks=callbacks,
        )
        return llm

    elif provider == "vllm":
        from langchain_openai import ChatOpenAI

        vllm_config = llm_config.get("vllm", {})
        endpoint = vllm_config.get("endpoint", "http://localhost:8000")
        model = vllm_config.get("model", "default")
        api_key = vllm_config.get("apiKey", "dummy")

        llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=f"{endpoint}/v1",
            temperature=0.0,
            max_tokens=4096,
            callbacks=callbacks,
        )
        return llm

    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def _get_all_tools():
    """Get all available tools for the agent."""
    return [
        jupyter_cell_tool,
        markdown_tool,
        final_answer_tool,
        read_file_tool,
        write_file_tool,
        list_files_tool,
        search_workspace_tool,
        search_notebook_cells_tool,
        execute_command_tool,
        check_resource_tool,
    ]


def create_simple_chat_agent(
    llm_config: Dict[str, Any],
    workspace_root: str = ".",
    enable_hitl: bool = True,
    enable_todo_list: bool = True,
    checkpointer: Optional[object] = None,
    system_prompt_override: Optional[str] = None,
):
    """
    Create a simple chat agent using LangChain's create_agent with Human-in-the-Loop.

    This is a simplified version for chat mode that uses LangChain's built-in
    HumanInTheLoopMiddleware and TodoListMiddleware.

    Args:
        llm_config: LLM configuration
        workspace_root: Root directory
        enable_hitl: Enable Human-in-the-Loop for code execution
        enable_todo_list: Enable TodoListMiddleware for task planning

    Returns:
        Configured agent with HITL and TodoList middleware
    """
    try:
        from langchain.agents import create_agent
        from langchain.agents.middleware import (
            AgentMiddleware,
            HumanInTheLoopMiddleware,
            ModelCallLimitMiddleware,
            ModelRequest,
            ModelResponse,
            SummarizationMiddleware,
            TodoListMiddleware,
            ToolCallLimitMiddleware,
            wrap_model_call,
        )
        from langchain_core.messages import AIMessage
        from langchain_core.messages import ToolMessage as LCToolMessage
        from langgraph.checkpoint.memory import InMemorySaver
        from langgraph.types import Overwrite
    except ImportError as e:
        logger.error(f"Failed to import LangChain agent components: {e}")
        raise ImportError(
            "LangChain agent components not available. "
            "Install with: pip install langchain langgraph"
        ) from e

    # Create LLM
    llm = _create_llm(llm_config)

    # Get tools
    tools = _get_all_tools()

    # Configure middleware
    middleware = []

    # JSON Schema for fallback tool calling
    JSON_TOOL_SCHEMA = """You MUST respond with ONLY valid JSON matching this schema:
{
  "tool": "<tool_name>",
  "arguments": {"arg1": "value1", ...}
}

Available tools:
- jupyter_cell_tool: Execute Python code. Arguments: {"code": "<python_code>"}
- markdown_tool: Add markdown cell. Arguments: {"content": "<markdown>"}
- final_answer_tool: Complete task. Arguments: {"answer": "<summary>"}
- write_todos: Update task list. Arguments: {"todos": [{"content": "...", "status": "pending|in_progress|completed"}]}
- read_file_tool: Read file. Arguments: {"path": "<file_path>"}
- write_file_tool: Write file. Arguments: {"path": "<path>", "content": "<content>", "overwrite": false}
- list_files_tool: List directory. Arguments: {"path": ".", "recursive": false}
- search_workspace_tool: Search files. Arguments: {"pattern": "<regex>", "file_types": ["py"], "path": "."}
- search_notebook_cells_tool: Search notebook cells. Arguments: {"pattern": "<regex>"}
- execute_command_tool: Execute shell command. Arguments: {"command": "<command>", "stdin": "<input_for_prompts>"}
- check_resource_tool: Check resources before data processing. Arguments: {"files": ["<path>"], "dataframes": ["<var_name>"]}

Output ONLY the JSON object, no markdown, no explanation."""

    def _parse_json_tool_call(text: str) -> Optional[Dict[str, Any]]:
        """Parse JSON tool call from text response."""
        import json
        import re

        if not text:
            return None

        # Clean up response
        text = text.strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        # Try direct JSON parse
        try:
            data = json.loads(text)
            if "tool" in data:
                return data
        except json.JSONDecodeError:
            pass

        # Try to find JSON object in response
        json_match = re.search(r"\{[\s\S]*\}", text)
        if json_match:
            try:
                data = json.loads(json_match.group())
                if "tool" in data:
                    return data
            except json.JSONDecodeError:
                pass

        return None

    def _create_tool_call_message(
        tool_name: str, arguments: Dict[str, Any]
    ) -> AIMessage:
        """Create AIMessage with tool_calls from parsed JSON."""
        import uuid

        # Normalize tool name
        if not tool_name.endswith("_tool"):
            tool_name = f"{tool_name}_tool"

        return AIMessage(
            content="",
            tool_calls=[
                {
                    "name": tool_name,
                    "args": arguments,
                    "id": str(uuid.uuid4()),
                    "type": "tool_call",
                }
            ],
        )

    # Middleware to detect and handle empty LLM responses with JSON fallback
    @wrap_model_call
    @_with_middleware_logging("handle_empty_response")
    def handle_empty_response(
        request: ModelRequest,
        handler,
    ) -> ModelResponse:
        """
        Detect empty/invalid AIMessage responses and retry with JSON schema fallback.

        For models that don't support native tool calling well (e.g., Gemini 2.5 Flash),
        this middleware:
        1. Detects empty or text-only responses (no tool_calls)
        2. Retries with JSON schema prompt to force structured output
        3. Parses JSON response and injects tool_calls into AIMessage
        4. Falls back to synthetic final_answer if all else fails
        """
        import uuid

        from langchain_core.messages import HumanMessage

        max_retries = 2  # Allow more retries for JSON fallback

        for attempt in range(max_retries + 1):
            response = handler(request)

            # Extract AIMessage from response
            response_message = None
            if hasattr(response, "result"):
                result = response.result
                if isinstance(result, list):
                    for msg in reversed(result):
                        if isinstance(msg, AIMessage):
                            response_message = msg
                            break
                elif isinstance(result, AIMessage):
                    response_message = result
            elif hasattr(response, "message"):
                response_message = response.message
            elif hasattr(response, "messages") and response.messages:
                response_message = response.messages[-1]
            elif isinstance(response, AIMessage):
                response_message = response

            has_content = (
                bool(getattr(response_message, "content", None))
                if response_message
                else False
            )
            has_tool_calls = (
                bool(getattr(response_message, "tool_calls", None))
                if response_message
                else False
            )

            logger.info(
                "handle_empty_response: attempt=%d, type=%s, content=%s, tool_calls=%s",
                attempt + 1,
                type(response_message).__name__ if response_message else None,
                has_content,
                has_tool_calls,
            )

            # Valid response with tool_calls
            if has_tool_calls:
                return response

            # Try to parse JSON from content (model might have output JSON without tool_calls)
            if has_content and response_message:
                parsed = _parse_json_tool_call(response_message.content)
                if parsed:
                    tool_name = parsed.get("tool", "")
                    arguments = parsed.get("arguments", {})
                    logger.info(
                        "Parsed JSON tool call from content: tool=%s",
                        tool_name,
                    )

                    # Create new AIMessage with tool_calls
                    new_message = _create_tool_call_message(tool_name, arguments)

                    # Replace in response
                    if hasattr(response, "result"):
                        if isinstance(response.result, list):
                            new_result = [
                                new_message if isinstance(m, AIMessage) else m
                                for m in response.result
                            ]
                            response.result = new_result
                        else:
                            response.result = new_message
                    return response

            # Invalid response - retry with JSON schema prompt
            if response_message and attempt < max_retries:
                reason = "text-only" if has_content else "empty"
                logger.warning(
                    "Invalid AIMessage (%s) detected (attempt %d/%d). "
                    "Retrying with JSON schema prompt...",
                    reason,
                    attempt + 1,
                    max_retries + 1,
                )

                # Get context for prompt
                todos = request.state.get("todos", [])
                pending_todos = [
                    t for t in todos if t.get("status") in ("pending", "in_progress")
                ]

                # Build JSON-forcing prompt
                if has_content:
                    # LLM wrote text - ask to wrap in final_answer
                    content_preview = response_message.content[:300]
                    json_prompt = (
                        f"{JSON_TOOL_SCHEMA}\n\n"
                        f"Your previous response was text, not JSON. "
                        f"Wrap your answer in final_answer_tool:\n"
                        f'{{"tool": "final_answer_tool", "arguments": {{"answer": "{content_preview}..."}}}}'
                    )
                elif pending_todos:
                    todo_list = ", ".join(
                        t.get("content", "")[:20] for t in pending_todos[:3]
                    )
                    example_json = '{"tool": "jupyter_cell_tool", "arguments": {"code": "import pandas as pd\\ndf = pd.read_csv(\'titanic.csv\')\\nprint(df.head())"}}'
                    json_prompt = (
                        f"{JSON_TOOL_SCHEMA}\n\n"
                        f"Pending tasks: {todo_list}\n"
                        f"Call jupyter_cell_tool with Python code to complete the next task.\n"
                        f"Example: {example_json}"
                    )
                else:
                    json_prompt = (
                        f"{JSON_TOOL_SCHEMA}\n\n"
                        f"All tasks completed. Call final_answer_tool:\n"
                        f'{{"tool": "final_answer_tool", "arguments": {{"answer": "작업이 완료되었습니다."}}}}'
                    )

                # Add JSON prompt and retry
                request = request.override(
                    messages=request.messages + [HumanMessage(content=json_prompt)]
                )
                continue

            # Max retries exhausted - synthesize final_answer
            if response_message:
                logger.warning(
                    "Max retries exhausted. Synthesizing final_answer response."
                )

                # Use LLM's text content if available
                if has_content and response_message.content:
                    summary = response_message.content
                    logger.info(
                        "Using LLM's text content as final answer (length=%d)",
                        len(summary),
                    )
                else:
                    todos = request.state.get("todos", [])
                    completed_todos = [
                        t.get("content", "")
                        for t in todos
                        if t.get("status") == "completed"
                    ]
                    summary = (
                        f"작업이 완료되었습니다. 완료된 항목: {', '.join(completed_todos[:5])}"
                        if completed_todos
                        else "작업이 완료되었습니다."
                    )

                # Create synthetic final_answer
                synthetic_message = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "final_answer_tool",
                            "args": {"answer": summary},
                            "id": str(uuid.uuid4()),
                            "type": "tool_call",
                        }
                    ],
                )

                # Replace in response
                if hasattr(response, "result"):
                    if isinstance(response.result, list):
                        new_result = []
                        replaced = False
                        for msg in response.result:
                            if isinstance(msg, AIMessage) and not replaced:
                                new_result.append(synthetic_message)
                                replaced = True
                            else:
                                new_result.append(msg)
                        if not replaced:
                            new_result.append(synthetic_message)
                        response.result = new_result
                    else:
                        response.result = synthetic_message

                    return response

            # Return response (either valid or after max retries)
            return response

        return response

    middleware.append(handle_empty_response)

    # Middleware to limit tool calls to one at a time
    # This prevents "Can receive only one value per step" errors with TodoListMiddleware
    @wrap_model_call
    @_with_middleware_logging("limit_tool_calls_to_one")
    def limit_tool_calls_to_one(
        request: ModelRequest,
        handler,
    ) -> ModelResponse:
        """
        Limit the model to one tool call at a time.

        Some models (like vLLM GPT) return multiple tool calls in a single response.
        This causes conflicts with TodoListMiddleware when processing multiple decisions.
        By limiting to one tool call, we ensure the agent processes actions sequentially.
        """
        response = handler(request)

        # Check if response has multiple tool calls
        if hasattr(response, "result"):
            result = response.result
            messages = result if isinstance(result, list) else [result]

            for msg in messages:
                if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls"):
                    tool_calls = msg.tool_calls
                    if tool_calls and len(tool_calls) > 1:
                        logger.info(
                            "Limiting tool calls from %d to 1 (keeping first: %s)",
                            len(tool_calls),
                            tool_calls[0].get("name", "unknown")
                            if tool_calls
                            else "none",
                        )
                        # Keep only the first tool call
                        msg.tool_calls = [tool_calls[0]]

        return response

    middleware.append(limit_tool_calls_to_one)

    # Non-HITL tools that execute immediately without user approval
    NON_HITL_TOOLS = {
        "markdown_tool",
        "markdown",
        "read_file_tool",
        "read_file",
        "list_files_tool",
        "list_files",
        "search_workspace_tool",
        "search_workspace",
        "search_notebook_cells_tool",
        "search_notebook_cells",
        "write_todos",
    }

    # Middleware to inject continuation prompt after non-HITL tool execution
    @wrap_model_call
    @_with_middleware_logging("inject_continuation_after_non_hitl_tool")
    def inject_continuation_after_non_hitl_tool(
        request: ModelRequest,
        handler,
    ) -> ModelResponse:
        """
        Inject a continuation prompt when the last message is from a non-HITL tool.

        Non-HITL tools execute immediately without user approval, which can cause
        Gemini to produce empty responses. This middleware injects a system message
        to remind the LLM to continue with the next action.
        """
        messages = request.messages
        if not messages:
            return handler(request)

        # Check if the last message is a ToolMessage from a non-HITL tool
        last_msg = messages[-1]
        if getattr(last_msg, "type", "") == "tool":
            tool_name = getattr(last_msg, "name", "") or ""

            # Also try to extract tool name from content
            if not tool_name:
                try:
                    import json

                    content_json = json.loads(last_msg.content)
                    tool_name = content_json.get("tool", "")
                except (json.JSONDecodeError, TypeError, AttributeError):
                    pass

            if tool_name in NON_HITL_TOOLS:
                logger.info(
                    "Injecting continuation prompt after non-HITL tool: %s",
                    tool_name,
                )

                # Get todos context
                todos = request.state.get("todos", [])
                pending_todos = [
                    t for t in todos if t.get("status") in ("pending", "in_progress")
                ]

                if pending_todos:
                    pending_list = ", ".join(
                        t.get("content", "")[:30] for t in pending_todos[:3]
                    )
                    continuation = (
                        f"Tool '{tool_name}' completed. "
                        f"Continue with pending tasks: {pending_list}. "
                        f"Call jupyter_cell_tool or the next appropriate tool."
                    )
                else:
                    continuation = (
                        f"Tool '{tool_name}' completed. All tasks done. "
                        f"Call final_answer_tool with a summary NOW."
                    )

                # Inject as a system-like user message
                from langchain_core.messages import HumanMessage

                new_messages = list(messages) + [
                    HumanMessage(content=f"[SYSTEM] {continuation}")
                ]
                request = request.override(messages=new_messages)

        return handler(request)

    middleware.append(inject_continuation_after_non_hitl_tool)

    class PatchToolCallsMiddleware(AgentMiddleware):
        """Patch dangling tool calls so the agent can continue."""

        def before_agent(self, state, runtime):
            logger.info(
                "%s",
                _format_middleware_marker(
                    "PatchToolCallsMiddleware.before_agent", "START"
                ),
            )
            messages = state.get("messages", [])
            if not messages:
                logger.info(
                    "%s",
                    _format_middleware_marker(
                        "PatchToolCallsMiddleware.before_agent", "NOOP"
                    ),
                )
                return None

            patched = []
            for i, msg in enumerate(messages):
                patched.append(msg)
                if getattr(msg, "type", "") == "ai" and getattr(
                    msg, "tool_calls", None
                ):
                    for tool_call in msg.tool_calls:
                        tool_call_id = tool_call.get("id")
                        if not tool_call_id:
                            continue
                        has_tool_msg = any(
                            (
                                getattr(m, "type", "") == "tool"
                                and getattr(m, "tool_call_id", None) == tool_call_id
                            )
                            for m in messages[i:]
                        )
                        if not has_tool_msg:
                            tool_msg = (
                                f"Tool call {tool_call.get('name', 'unknown')} with id {tool_call_id} "
                                "was cancelled - another message came in before it could be completed."
                            )
                            patched.append(
                                LCToolMessage(
                                    content=tool_msg,
                                    name=tool_call.get("name", "unknown"),
                                    tool_call_id=tool_call_id,
                                )
                            )

            if patched == messages:
                logger.info(
                    "%s",
                    _format_middleware_marker(
                        "PatchToolCallsMiddleware.before_agent", "NOOP"
                    ),
                )
                return None
            logger.info(
                "%s",
                _format_middleware_marker(
                    "PatchToolCallsMiddleware.before_agent", "PATCHED"
                ),
            )
            return {"messages": Overwrite(patched)}

    middleware.append(PatchToolCallsMiddleware())

    # Add TodoListMiddleware for task planning
    if enable_todo_list:
        todo_middleware = TodoListMiddleware(
            system_prompt="""
## CRITICAL WORKFLOW RULES - MUST FOLLOW:
1. NEVER stop after calling write_todos - ALWAYS make another tool call immediately
2. write_todos is ONLY for tracking progress - it does NOT complete any work
3. After EVERY write_todos call, you MUST call another tool (jupyter_cell_tool, markdown_tool, or final_answer_tool)

## Todo List Management:
- Before complex tasks, use write_todos to create a task list
- Update todos as you complete each step (mark 'in_progress' → 'completed')
- Each todo item should be specific and descriptive (10-50 characters)
- All todo items must be written in Korean
- ALWAYS include "다음 단계 제시" as the LAST item

## Task Completion Flow:
1. When current task is done → mark it 'completed' with write_todos
2. IMMEDIATELY call the next tool (jupyter_cell_tool for code, markdown_tool for text)
3. For "다음 단계 제시" → mark completed, then call final_answer_tool with suggestions
4. NEVER end your turn after write_todos - you MUST continue with actual work

## FORBIDDEN PATTERNS:
❌ Calling write_todos and then stopping
❌ Updating todo status without doing the actual work
❌ Ending turn without calling final_answer_tool when all tasks are done
""",
            tool_description="""Update the task list for tracking progress.
⚠️ CRITICAL: This tool is ONLY for tracking - it does NOT do any actual work.
After calling this tool, you MUST IMMEDIATELY call another tool (jupyter_cell_tool, markdown_tool, or final_answer_tool).
NEVER end your response after calling write_todos - always continue with the next action tool.""",
        )
        middleware.append(todo_middleware)

    if enable_hitl:
        # Add Human-in-the-Loop middleware for code execution
        hitl_middleware = HumanInTheLoopMiddleware(
            interrupt_on=_get_hitl_interrupt_config(),
            description_prefix="Tool execution pending approval",
        )
        middleware.append(hitl_middleware)

    # Add loop prevention middleware
    # ModelCallLimitMiddleware: Prevent infinite LLM calls
    model_limit_middleware = ModelCallLimitMiddleware(
        run_limit=30,  # Max 30 LLM calls per user message
        exit_behavior="end",  # Gracefully end when limit reached
    )
    middleware.append(model_limit_middleware)
    logger.info("Added ModelCallLimitMiddleware with run_limit=30")

    # ToolCallLimitMiddleware: Prevent specific tools from being called too many times
    # Limit write_todos to prevent the loop we observed
    write_todos_limit = ToolCallLimitMiddleware(
        tool_name="write_todos",
        run_limit=5,  # Max 5 write_todos calls per user message
        exit_behavior="continue",  # Let agent continue with other tools
    )
    middleware.append(write_todos_limit)

    # Limit list_files_tool to prevent excessive directory listing
    list_files_limit = ToolCallLimitMiddleware(
        tool_name="list_files_tool",
        run_limit=5,  # Max 5 list_files calls per user message
        exit_behavior="continue",
    )
    middleware.append(list_files_limit)
    logger.info("Added ToolCallLimitMiddleware for write_todos and list_files_tool")

    # Add SummarizationMiddleware to maintain context across cycles
    # This compresses older messages while preserving recent context
    try:
        # Create summarization LLM based on provider
        provider = llm_config.get("provider", "gemini")
        summary_llm = None

        if provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI

            gemini_config = llm_config.get("gemini", {})
            api_key = gemini_config.get("apiKey")
            if api_key:
                summary_llm = ChatGoogleGenerativeAI(
                    model="gemini-2.0-flash",
                    google_api_key=api_key,
                    temperature=0.0,
                )
        elif provider == "openai":
            from langchain_openai import ChatOpenAI

            openai_config = llm_config.get("openai", {})
            api_key = openai_config.get("apiKey")
            if api_key:
                summary_llm = ChatOpenAI(
                    model="gpt-4o-mini",
                    api_key=api_key,
                    temperature=0.0,
                )
        elif provider == "vllm":
            from langchain_openai import ChatOpenAI

            vllm_config = llm_config.get("vllm", {})
            endpoint = vllm_config.get("endpoint", "http://localhost:8000")
            model = vllm_config.get("model", "default")
            api_key = vllm_config.get("apiKey", "dummy")

            summary_llm = ChatOpenAI(
                model=model,
                api_key=api_key,
                base_url=f"{endpoint}/v1",
                temperature=0.0,
            )

        if summary_llm:
            summarization_middleware = SummarizationMiddleware(
                model=summary_llm,
                trigger={
                    "tokens": 8000,
                    "messages": 30,
                },  # Trigger when exceeding limits
                keep={"messages": 10},  # Keep last 10 messages intact
                summary_prefix="[이전 대화 요약]\n",  # Prefix for summary message
            )
            middleware.append(summarization_middleware)
            logger.info(
                "Added SummarizationMiddleware with model=%s, trigger=8000 tokens/30 msgs, keep=10 msgs",
                getattr(summary_llm, "model", str(summary_llm)),
            )
    except Exception as e:
        logger.warning("Failed to add SummarizationMiddleware: %s", e)

    # System prompt for the agent (override applies only to LangChain agent)
    if system_prompt_override and system_prompt_override.strip():
        system_prompt = system_prompt_override.strip()
        logger.info("SimpleChatAgent using custom system prompt override")
    else:
        system_prompt = DEFAULT_SYSTEM_PROMPT

    logger.info("SimpleChatAgent system_prompt: %s", system_prompt)

    # Create agent with checkpointer (required for HITL)
    agent = create_agent(
        model=llm,
        tools=tools,
        middleware=middleware,
        checkpointer=checkpointer or InMemorySaver(),  # Required for interrupt/resume
        system_prompt=system_prompt,  # Tell the agent to use tools
    )

    return agent
