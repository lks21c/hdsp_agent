"""
Logging utilities for LangChain agent.

Provides helper functions for structured logging of LLM interactions,
messages, and middleware execution.
"""

import json
import logging
from functools import wraps
from typing import Any, Dict

from langchain_core.callbacks import BaseCallbackHandler

logger = logging.getLogger(__name__)

LOG_SEPARATOR = "=" * 96
LOG_SUBSECTION = "-" * 96


def _format_system_prompt_for_log(messages) -> tuple[int, int, str]:
    """Extract and format system messages for logging."""
    from langchain_core.messages import SystemMessage

    system_contents = [
        str(getattr(msg, "content", ""))
        for msg in messages
        if isinstance(msg, SystemMessage)
    ]
    combined = "\n\n".join(system_contents)
    return len(system_contents), len(combined), combined


def _pretty_json(value: Any) -> str:
    """Format value as pretty-printed JSON."""
    try:
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return json.dumps(str(value), indent=2, ensure_ascii=False)


def _serialize_message(message) -> Dict[str, Any]:
    """Serialize a LangChain message to a dictionary."""
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
    """Format a list of messages as a log block."""
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
    """Format a JSON payload as a log block."""
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
    """Format a middleware execution marker."""
    return "\n".join([LOG_SEPARATOR, f"MIDDLEWARE {stage}: {name}", LOG_SEPARATOR])


def _with_middleware_logging(name: str):
    """Decorator to add logging around middleware execution."""

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
