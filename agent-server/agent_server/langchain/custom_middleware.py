"""
Custom middleware for LangChain agent.

Provides middleware for handling empty responses, limiting tool calls,
injecting continuation prompts, and patching dangling tool calls.
"""

import json
import logging
import re
import uuid
from typing import Any, Dict, Optional

from langchain_core.messages import AIMessage, HumanMessage

from agent_server.langchain.logging_utils import (
    _format_middleware_marker,
    _with_middleware_logging,
)
from agent_server.langchain.prompts import JSON_TOOL_SCHEMA, NON_HITL_TOOLS

logger = logging.getLogger(__name__)


def parse_json_tool_call(text: str) -> Optional[Dict[str, Any]]:
    """Parse JSON tool call from text response.

    Args:
        text: Raw text that may contain a JSON tool call

    Returns:
        Parsed dictionary with 'tool' and 'arguments' keys, or None
    """
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


def create_tool_call_message(tool_name: str, arguments: Dict[str, Any]) -> AIMessage:
    """Create AIMessage with tool_calls from parsed JSON.

    Args:
        tool_name: Name of the tool to call
        arguments: Tool arguments dictionary

    Returns:
        AIMessage with properly formatted tool_calls
    """
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


def create_handle_empty_response_middleware(wrap_model_call):
    """Create middleware to detect and handle empty LLM responses with JSON fallback.

    For models that don't support native tool calling well (e.g., Gemini 2.5 Flash),
    this middleware:
    1. Detects empty or text-only responses (no tool_calls)
    2. Retries with JSON schema prompt to force structured output
    3. Parses JSON response and injects tool_calls into AIMessage
    4. Falls back to synthetic final_answer if all else fails

    Args:
        wrap_model_call: LangChain's wrap_model_call decorator

    Returns:
        Middleware function
    """

    @wrap_model_call
    @_with_middleware_logging("handle_empty_response")
    def handle_empty_response(request, handler):
        max_retries = 2

        for attempt in range(max_retries + 1):
            response = handler(request)

            # Extract AIMessage from response
            response_message = _extract_ai_message(response)

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

            # Try to parse JSON from content
            if has_content and response_message:
                parsed = parse_json_tool_call(response_message.content)
                if parsed:
                    tool_name = parsed.get("tool", "")
                    arguments = parsed.get("arguments", {})
                    logger.info(
                        "Parsed JSON tool call from content: tool=%s",
                        tool_name,
                    )

                    new_message = create_tool_call_message(tool_name, arguments)
                    response = _replace_ai_message_in_response(response, new_message)
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

                json_prompt = _build_json_prompt(request, response_message, has_content)
                request = request.override(
                    messages=request.messages + [HumanMessage(content=json_prompt)]
                )
                continue

            # Max retries exhausted - synthesize final_answer
            if response_message:
                logger.warning(
                    "Max retries exhausted. Synthesizing final_answer response."
                )
                synthetic_message = _create_synthetic_final_answer(
                    request, response_message, has_content
                )
                response = _replace_ai_message_in_response(response, synthetic_message)
                return response

            return response

        return response

    return handle_empty_response


def _extract_ai_message(response):
    """Extract AIMessage from various response formats."""
    if hasattr(response, "result"):
        result = response.result
        if isinstance(result, list):
            for msg in reversed(result):
                if isinstance(msg, AIMessage):
                    return msg
        elif isinstance(result, AIMessage):
            return result
    elif hasattr(response, "message"):
        return response.message
    elif hasattr(response, "messages") and response.messages:
        return response.messages[-1]
    elif isinstance(response, AIMessage):
        return response
    return None


def _replace_ai_message_in_response(response, new_message):
    """Replace AIMessage in response with a new one."""
    if hasattr(response, "result"):
        if isinstance(response.result, list):
            new_result = [
                new_message if isinstance(m, AIMessage) else m for m in response.result
            ]
            response.result = new_result
        else:
            response.result = new_message
    return response


def _build_json_prompt(request, response_message, has_content):
    """Build JSON-forcing prompt based on context."""
    todos = request.state.get("todos", [])
    pending_todos = [t for t in todos if t.get("status") in ("pending", "in_progress")]

    if has_content:
        content_preview = response_message.content[:300]
        return (
            f"{JSON_TOOL_SCHEMA}\n\n"
            f"Your previous response was text, not JSON. "
            f"Wrap your answer in final_answer_tool:\n"
            f'{{"tool": "final_answer_tool", "arguments": {{"answer": "{content_preview}..."}}}}'
        )
    elif pending_todos:
        todo_list = ", ".join(t.get("content", "")[:20] for t in pending_todos[:3])
        example_json = '{"tool": "jupyter_cell_tool", "arguments": {"code": "import pandas as pd\\ndf = pd.read_csv(\'titanic.csv\')\\nprint(df.head())"}}'
        return (
            f"{JSON_TOOL_SCHEMA}\n\n"
            f"Pending tasks: {todo_list}\n"
            f"Call jupyter_cell_tool with Python code to complete the next task.\n"
            f"Example: {example_json}"
        )
    else:
        return (
            f"{JSON_TOOL_SCHEMA}\n\n"
            f"All tasks completed. Call final_answer_tool:\n"
            f'{{"tool": "final_answer_tool", "arguments": {{"answer": "작업이 완료되었습니다."}}}}'
        )


def _create_synthetic_final_answer(request, response_message, has_content):
    """Create synthetic final_answer message."""
    if has_content and response_message.content:
        summary = response_message.content
        logger.info(
            "Using LLM's text content as final answer (length=%d)",
            len(summary),
        )
    else:
        todos = request.state.get("todos", [])
        completed_todos = [
            t.get("content", "") for t in todos if t.get("status") == "completed"
        ]
        summary = (
            f"작업이 완료되었습니다. 완료된 항목: {', '.join(completed_todos[:5])}"
            if completed_todos
            else "작업이 완료되었습니다."
        )

    return AIMessage(
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


def create_limit_tool_calls_middleware(wrap_model_call):
    """Create middleware to limit model to one tool call at a time.

    Some models (like vLLM GPT) return multiple tool calls in a single response.
    This causes conflicts with TodoListMiddleware when processing multiple decisions.
    By limiting to one tool call, we ensure the agent processes actions sequentially.

    Args:
        wrap_model_call: LangChain's wrap_model_call decorator

    Returns:
        Middleware function
    """

    @wrap_model_call
    @_with_middleware_logging("limit_tool_calls_to_one")
    def limit_tool_calls_to_one(request, handler):
        response = handler(request)

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
                        msg.tool_calls = [tool_calls[0]]

        return response

    return limit_tool_calls_to_one


def create_inject_continuation_middleware(wrap_model_call):
    """Create middleware to inject continuation prompt after non-HITL tool execution.

    Non-HITL tools execute immediately without user approval, which can cause
    Gemini to produce empty responses. This middleware injects a system message
    to remind the LLM to continue with the next action.

    Args:
        wrap_model_call: LangChain's wrap_model_call decorator

    Returns:
        Middleware function
    """

    @wrap_model_call
    @_with_middleware_logging("inject_continuation_after_non_hitl_tool")
    def inject_continuation_after_non_hitl_tool(request, handler):
        messages = request.messages
        if not messages:
            return handler(request)

        last_msg = messages[-1]
        if getattr(last_msg, "type", "") == "tool":
            tool_name = getattr(last_msg, "name", "") or ""

            # Try to extract tool name from content
            if not tool_name:
                try:
                    content_json = json.loads(last_msg.content)
                    tool_name = content_json.get("tool", "")
                except (json.JSONDecodeError, TypeError, AttributeError):
                    pass

            if tool_name in NON_HITL_TOOLS:
                logger.info(
                    "Injecting continuation prompt after non-HITL tool: %s",
                    tool_name,
                )

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

                new_messages = list(messages) + [
                    HumanMessage(content=f"[SYSTEM] {continuation}")
                ]
                request = request.override(messages=new_messages)

        return handler(request)

    return inject_continuation_after_non_hitl_tool


def create_patch_tool_calls_middleware(AgentMiddleware, ToolMessage, Overwrite):
    """Create middleware to patch dangling tool calls.

    When a new user message arrives before a tool call completes, we need to
    add synthetic ToolMessage responses for those dangling calls so the
    conversation can continue properly.

    Args:
        AgentMiddleware: LangChain's AgentMiddleware base class
        ToolMessage: LangChain's ToolMessage class
        Overwrite: LangGraph's Overwrite type

    Returns:
        PatchToolCallsMiddleware class instance
    """

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
                                ToolMessage(
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

    return PatchToolCallsMiddleware()
