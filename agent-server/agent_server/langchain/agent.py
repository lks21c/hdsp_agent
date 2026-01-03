"""
LangChain Agent

Main agent creation module for tool-driven chat execution.
"""

import logging
from typing import Any, Dict, Optional

from agent_server.langchain.custom_middleware import (
    create_handle_empty_response_middleware,
    create_inject_continuation_middleware,
    create_limit_tool_calls_middleware,
    create_patch_tool_calls_middleware,
)
from agent_server.langchain.hitl_config import get_hitl_interrupt_config
from agent_server.langchain.llm_factory import create_llm, create_summarization_llm
from agent_server.langchain.prompts import (
    DEFAULT_SYSTEM_PROMPT,
    TODO_LIST_SYSTEM_PROMPT,
    TODO_LIST_TOOL_DESCRIPTION,
)
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
        checkpointer: Optional checkpointer for state persistence
        system_prompt_override: Optional custom system prompt

    Returns:
        Configured agent with HITL and TodoList middleware
    """
    try:
        from langchain.agents import create_agent
        from langchain.agents.middleware import (
            AgentMiddleware,
            HumanInTheLoopMiddleware,
            ModelCallLimitMiddleware,
            SummarizationMiddleware,
            TodoListMiddleware,
            ToolCallLimitMiddleware,
            wrap_model_call,
        )
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
    llm = create_llm(llm_config)

    # Get tools
    tools = _get_all_tools()

    # Configure middleware
    middleware = []

    # Add empty response handler middleware
    handle_empty_response = create_handle_empty_response_middleware(wrap_model_call)
    middleware.append(handle_empty_response)

    # Add tool call limiter middleware
    limit_tool_calls = create_limit_tool_calls_middleware(wrap_model_call)
    middleware.append(limit_tool_calls)

    # Add continuation prompt middleware
    inject_continuation = create_inject_continuation_middleware(wrap_model_call)
    middleware.append(inject_continuation)

    # Add patch tool calls middleware
    patch_tool_calls = create_patch_tool_calls_middleware(
        AgentMiddleware, LCToolMessage, Overwrite
    )
    middleware.append(patch_tool_calls)

    # Add TodoListMiddleware for task planning
    if enable_todo_list:
        todo_middleware = TodoListMiddleware(
            system_prompt=TODO_LIST_SYSTEM_PROMPT,
            tool_description=TODO_LIST_TOOL_DESCRIPTION,
        )
        middleware.append(todo_middleware)

    if enable_hitl:
        # Add Human-in-the-Loop middleware for code execution
        hitl_middleware = HumanInTheLoopMiddleware(
            interrupt_on=get_hitl_interrupt_config(),
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
    # Limit write_todos to prevent loops
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
    summary_llm = create_summarization_llm(llm_config)
    if summary_llm:
        try:
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
