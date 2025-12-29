"""
LangChain Agent

Main agent creation module for tool-driven chat execution.
"""

import logging
from typing import Any, Dict, Optional

from agent_server.langchain.tools import (
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


def _create_llm(llm_config: Dict[str, Any]):
    """Create LangChain LLM from config"""
    provider = llm_config.get("provider", "gemini")

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        gemini_config = llm_config.get("gemini", {})
        api_key = gemini_config.get("apiKey")
        model = gemini_config.get("model", "gemini-2.5-pro")

        if not api_key:
            raise ValueError("Gemini API key not configured")

        llm = ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=0.0,
            max_output_tokens=8192,
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
        )
        return llm

    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def _get_all_tools():
    """Get all available tools for the agent"""
    return [
        jupyter_cell_tool,
        markdown_tool,
        final_answer_tool,
        read_file_tool,
        write_file_tool,
        list_files_tool,
        search_workspace_tool,
        search_notebook_cells_tool,
    ]


def create_simple_chat_agent(
    llm_config: Dict[str, Any],
    workspace_root: str = ".",
    enable_hitl: bool = True,
    enable_todo_list: bool = True,
    checkpointer: Optional[object] = None,
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
            TodoListMiddleware,
            ToolCallLimitMiddleware,
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
    llm = _create_llm(llm_config)

    # Get tools
    tools = _get_all_tools()

    # Configure middleware
    middleware = []

    class PatchToolCallsMiddleware(AgentMiddleware):
        """Patch dangling tool calls so the agent can continue."""

        def before_agent(self, state, runtime):
            messages = state.get("messages", [])
            if not messages:
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
                return None
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
            interrupt_on={
                # Require approval before executing code
                "jupyter_cell_tool": {
                    "allowed_decisions": ["approve", "edit", "reject"],
                    "description": "🔍 Code execution requires approval",
                },
                # Safe operations - no approval needed
                "markdown_tool": False,
                "read_file_tool": False,
                "list_files_tool": False,
                "search_workspace_tool": False,
                "search_notebook_cells_tool": False,
                "write_todos": False,  # Todo updates don't need approval
                # File write requires approval
                "write_file_tool": {
                    "allowed_decisions": ["approve", "edit", "reject"],
                    "description": "⚠️ File write requires approval",
                },
                # Final answer doesn't need approval
                "final_answer_tool": False,
            },
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

    # System prompt for the agent
    system_prompt = """You are an expert Python data scientist and Jupyter notebook assistant.
Your role is to help users with data analysis, visualization, and Python coding tasks in Jupyter notebooks.

## CRITICAL: You MUST use tools to complete tasks - NEVER respond with only text

You have access to the following tools:
1. **jupyter_cell_tool**: Execute Python code in a new notebook cell - USE THIS for any code execution
2. **markdown_tool**: Add a markdown explanation cell
3. **final_answer_tool**: Complete the task with a summary - USE THIS when done
4. **read_file_tool**: Read file contents
5. **write_file_tool**: Write file contents
6. **list_files_tool**: List directory contents
7. **search_workspace_tool**: Search for patterns in workspace files
8. **search_notebook_cells_tool**: Search for patterns in notebook cells
9. **write_todos**: Create and update task list for complex multi-step tasks

## Mandatory Workflow
1. When ALL tasks are complete, USE final_answer_tool to summarize
2. If `!pip install` fails with "command not found", use `!pip3 install` instead (do not use micropip/piplite)
3. For plots and charts, use English text only. Never set or use Korean fonts.

## Correct Example Flow
User: "데이터 분석해줘"
1. write_todos(todos=[{content: "데이터 로드", status: "in_progress"}, ...])
2. jupyter_cell_tool(code="import pandas as pd...")  ← MUST follow write_todos
3. write_todos(todos=[{content: "데이터 로드", status: "completed"}, ...])
4. jupyter_cell_tool(code="df.describe()...")  ← MUST follow write_todos
5. ... continue until all tasks done ...
6. final_answer_tool(answer="분석 완료...")

## ❌ FORBIDDEN (will break the workflow)
- Calling write_todos and then stopping without another tool call
- Ending your response after updating todo status
"""

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
