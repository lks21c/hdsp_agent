"""
LangChain Agent Router

FastAPI router for the LangChain-based Jupyter agent.
Provides streaming and non-streaming endpoints for agent execution.
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

from agent_server.langchain.agent import (
    _create_llm,
    _get_all_tools,
    create_simple_chat_agent,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/langchain", tags=["langchain-agent"])


# ============ Request/Response Models ============


class LLMConfig(BaseModel):
    """LLM configuration"""

    provider: str = Field(default="gemini", description="LLM provider")
    gemini: Optional[Dict[str, Any]] = Field(default=None)
    openai: Optional[Dict[str, Any]] = Field(default=None)
    vllm: Optional[Dict[str, Any]] = Field(default=None)


class NotebookContext(BaseModel):
    """Current notebook context"""

    model_config = ConfigDict(populate_by_name=True)

    notebookPath: Optional[str] = Field(default=None, alias="notebook_path")
    kernelId: Optional[str] = Field(default=None, alias="kernel_id")
    cellCount: int = Field(default=0, alias="cell_count")
    importedLibraries: List[str] = Field(
        default_factory=list, alias="imported_libraries"
    )
    definedVariables: List[str] = Field(default_factory=list, alias="defined_variables")
    recentCells: List[Dict[str, Any]] = Field(
        default_factory=list, alias="recent_cells"
    )


class AgentRequest(BaseModel):
    """Request for agent execution"""

    request: str = Field(description="User's natural language request")
    notebookContext: Optional[NotebookContext] = Field(
        default=None, description="Current notebook state"
    )
    llmConfig: Optional[LLMConfig] = Field(
        default=None, description="LLM configuration"
    )
    stream: bool = Field(default=False, description="Enable streaming response")
    workspaceRoot: Optional[str] = Field(
        default=".", description="Workspace root directory"
    )
    threadId: Optional[str] = Field(
        default=None,
        description="Thread ID for conversation persistence (required for HITL)",
    )


class ResumeDecision(BaseModel):
    """Decision for resuming interrupted execution"""

    type: str = Field(description="Decision type: approve, edit, or reject")
    args: Optional[Dict[str, Any]] = Field(
        default=None, description="Modified tool arguments (for edit)"
    )
    feedback: Optional[str] = Field(
        default=None, description="Rejection feedback (for reject)"
    )


class ResumeRequest(BaseModel):
    """Request to resume interrupted execution"""

    threadId: str = Field(description="Thread ID of interrupted execution")
    decisions: List[ResumeDecision] = Field(
        description="List of decisions for each interrupted action"
    )
    llmConfig: Optional[LLMConfig] = Field(
        default=None, description="LLM configuration"
    )
    workspaceRoot: Optional[str] = Field(
        default=".", description="Workspace root directory"
    )


class ExecutionResult(BaseModel):
    """Single execution result"""

    model_config = ConfigDict(populate_by_name=True)

    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    errorType: Optional[str] = Field(default=None, alias="error_type")
    cellIndex: Optional[int] = Field(default=None, alias="cell_index")


class AgentResponse(BaseModel):
    """Response from agent execution"""

    model_config = ConfigDict(populate_by_name=True)

    success: bool
    finalAnswer: Optional[str] = Field(default=None, alias="final_answer")
    executionHistory: List[ExecutionResult] = Field(
        default_factory=list, alias="execution_history"
    )
    isComplete: bool = Field(default=False, alias="is_complete")
    error: Optional[str] = None
    errorType: Optional[str] = Field(default=None, alias="error_type")


# ============ Agent Instance Cache ============


_simple_agent_checkpointers: Dict[str, Any] = {}
_simple_agent_pending_actions: Dict[str, List[Dict[str, Any]]] = {}


def _normalize_action_request(action: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize HITL action request payload across LangChain versions."""
    name = (
        action.get("name")
        or action.get("tool")
        or action.get("tool_name")
        or action.get("action")
        or "unknown"
    )
    args = (
        action.get("arguments")
        or action.get("args")
        or action.get("tool_input")
        or action.get("input")
        or action.get("parameters")
        or {}
    )
    description = action.get("description", "")
    return {"name": name, "arguments": args, "description": description}


def _extract_todos(payload: Any) -> Optional[List[Dict[str, Any]]]:
    """Extract todos list from various payload shapes."""
    if isinstance(payload, str):
        if "Updated todo list to" in payload:
            try:
                import ast

                list_text = payload.split("Updated todo list to", 1)[1].strip()
                payload = {"todos": ast.literal_eval(list_text)}
            except Exception:
                payload = payload
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                try:
                    import ast

                    payload = ast.literal_eval(payload)
                except Exception:
                    return None
    if not isinstance(payload, dict):
        return None

    for key in ("todos", "todo_list", "todoList"):
        todos = payload.get(key)
        if isinstance(todos, list) and todos:
            return todos
    return None


def _emit_todos_from_tool_calls(
    tool_calls: List[Dict[str, Any]],
) -> Optional[List[Dict[str, Any]]]:
    """Extract todos from AIMessage tool calls if present."""
    for tool_call in tool_calls:
        name = tool_call.get("name") or tool_call.get("tool") or ""
        if name in ("write_todos", "write_todos_tool", "todos"):
            todos = _extract_todos(
                tool_call.get("args")
                or tool_call.get("arguments")
                or tool_call.get("input")
            )
            if todos:
                return todos
    return None


def _normalize_tool_calls(raw_tool_calls: Any) -> List[Dict[str, Any]]:
    """Normalize tool calls from provider-specific payloads."""
    if not raw_tool_calls:
        return []
    if isinstance(raw_tool_calls, dict):
        raw_tool_calls = [raw_tool_calls]
    if not isinstance(raw_tool_calls, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for call in raw_tool_calls:
        if not isinstance(call, dict):
            continue
        if "name" in call and "args" in call:
            normalized.append({"name": call.get("name"), "args": call.get("args")})
            continue
        if call.get("type") == "function" and "function" in call:
            fn = call.get("function", {})
            args = fn.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            normalized.append({"name": fn.get("name"), "args": args})
            continue
        if "function_call" in call:
            fn = call.get("function_call", {})
            args = fn.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            normalized.append({"name": fn.get("name"), "args": args})
            continue
    return normalized


def _message_signature(message: Any) -> str:
    """Create a stable signature to de-duplicate repeated streamed messages."""
    content = getattr(message, "content", "") or ""
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        try:
            tool_calls = json.dumps(tool_calls, ensure_ascii=False, sort_keys=True)
        except TypeError:
            tool_calls = str(tool_calls)
    else:
        tool_calls = ""
    return f"{type(message).__name__}:{content}:{tool_calls}"


def _complete_todos(todos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Mark all todos as completed to close out the run."""
    return [
        {**todo, "status": "completed"} if todo.get("status") != "completed" else todo
        for todo in todos
    ]


async def _generate_fallback_code(
    llm: Any,
    tool_name: str,
    tool_args: Dict[str, Any],
) -> str:
    """Generate Python code for a tool intent when tool calls are malformed."""
    system_prompt = (
        "You generate Python code to run in a Jupyter notebook. "
        "Return ONLY Python code with no markdown fences or extra text."
    )
    user_prompt = (
        "Tool intent:\n"
        f"- tool_name: {tool_name}\n"
        f"- tool_args: {json.dumps(tool_args, ensure_ascii=False)}\n\n"
        "Write minimal, safe Python code that accomplishes the intent. "
        "Use only standard library unless pandas is clearly required."
    )
    response = await llm.ainvoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
    )
    return (getattr(response, "content", "") or "").strip()


# ============ Endpoints ============


@router.post("/run", response_model=AgentResponse)
async def run_agent(request: AgentRequest) -> Dict[str, Any]:
    """
    Execute agent with user request (non-streaming).

    Takes a natural language request and notebook context,
    runs the LangChain agent, and returns the complete result.
    """
    logger.info(f"Agent run request: {request.request[:100]}...")

    if not request.request:
        raise HTTPException(status_code=400, detail="Request is required")

    raise HTTPException(
        status_code=400,
        detail="Non-streaming execution is not supported for the simple agent. Use /langchain/stream.",
    )


@router.post("/stream")
async def stream_agent(request: AgentRequest):
    """
    Execute agent with streaming response.

    Returns Server-Sent Events (SSE) with:
    - debug: Debug status (middleware, tool call, LLM call)
    - token: LLM response tokens
    - tool_call: Tool invocation events
    - tool_result: Tool execution results
    - interrupt: Human-in-the-loop approval required
    - complete: Final answer and completion
    - error: Error events
    """

    logger.info(f"Agent stream request: {request.request[:100]}...")

    if not request.request:
        raise HTTPException(status_code=400, detail="Request is required")

    # Generate thread_id if not provided
    thread_id = request.threadId or str(uuid.uuid4())

    async def event_generator():
        try:
            # Use simple agent with HITL
            provider = request.llmConfig.provider if request.llmConfig else "gemini"
            model_name = None
            if request.llmConfig:
                if request.llmConfig.gemini:
                    model_name = request.llmConfig.gemini.get("model")
                elif request.llmConfig.openai:
                    model_name = request.llmConfig.openai.get("model")
                elif request.llmConfig.vllm:
                    model_name = request.llmConfig.vllm.get("model")
            logger.info("SimpleAgent LLM provider=%s model=%s", provider, model_name)
            # Convert LLMConfig to dict
            config_dict = {
                "provider": request.llmConfig.provider
                if request.llmConfig
                else "gemini",
            }
            if request.llmConfig:
                if request.llmConfig.gemini:
                    config_dict["gemini"] = request.llmConfig.gemini
                if request.llmConfig.openai:
                    config_dict["openai"] = request.llmConfig.openai
                if request.llmConfig.vllm:
                    config_dict["vllm"] = request.llmConfig.vllm

            agent = create_simple_chat_agent(
                llm_config=config_dict,
                workspace_root=request.workspaceRoot or ".",
                enable_hitl=True,
                checkpointer=_simple_agent_checkpointers.setdefault(
                    thread_id, InMemorySaver()
                ),
            )

            # Prepare config with thread_id
            config = {"configurable": {"thread_id": thread_id}}

            # Prepare input
            agent_input = {"messages": [{"role": "user", "content": request.request}]}

            # Stream with interrupt handling
            logger.info(
                "SimpleAgent input: %s", json.dumps(agent_input, ensure_ascii=False)
            )
            produced_output = False
            last_finish_reason = None
            last_signature = None
            latest_todos: Optional[List[Dict[str, Any]]] = None

            # Initial status: waiting for LLM
            yield {
                "event": "debug",
                "data": json.dumps({"status": "🤔 LLM 응답 대기 중..."}),
            }

            for step in agent.stream(agent_input, config, stream_mode="values"):
                if isinstance(step, dict):
                    logger.info(
                        "SimpleAgent step keys: %s", ",".join(sorted(step.keys()))
                    )
                # Check for interrupt
                if isinstance(step, dict) and "__interrupt__" in step:
                    interrupts = step["__interrupt__"]

                    yield {
                        "event": "debug",
                        "data": json.dumps({"status": "⏸️ 사용자 승인 대기 중..."}),
                    }

                    # Process interrupts
                    for interrupt in interrupts:
                        interrupt_value = (
                            interrupt.value
                            if hasattr(interrupt, "value")
                            else interrupt
                        )

                        # Extract action requests
                        action_requests = interrupt_value.get("action_requests", [])
                        normalized_actions = [
                            _normalize_action_request(a) for a in action_requests
                        ]
                        if normalized_actions:
                            _simple_agent_pending_actions[thread_id] = (
                                normalized_actions
                            )

                        for action in normalized_actions:
                            yield {
                                "event": "interrupt",
                                "data": json.dumps(
                                    {
                                        "thread_id": thread_id,
                                        "action": action.get("name", "unknown"),
                                        "args": action.get("arguments", {}),
                                        "description": action.get("description", ""),
                                    }
                                ),
                            }

                    # Stop streaming - wait for resume
                    return

                # Check for todos in state and stream them
                if isinstance(step, dict) and "todos" in step:
                    todos = step["todos"]
                    if todos:
                        latest_todos = todos
                        yield {
                            "event": "todos",
                            "data": json.dumps({"todos": todos}),
                        }
                elif isinstance(step, dict):
                    todos = _extract_todos(step)
                    if todos:
                        latest_todos = todos
                        yield {
                            "event": "todos",
                            "data": json.dumps({"todos": todos}),
                        }

                # Process messages
                if isinstance(step, dict) and "messages" in step:
                    messages = step["messages"]
                    if messages:
                        last_message = messages[-1]
                        signature = _message_signature(last_message)
                        if signature == last_signature:
                            continue
                        last_signature = signature
                    logger.info(
                        "SimpleAgent last_message type=%s has_content=%s tool_calls=%s",
                        type(last_message).__name__,
                        bool(getattr(last_message, "content", None)),
                        bool(getattr(last_message, "tool_calls", None)),
                    )

                    # Skip HumanMessage - don't echo user's input back
                    if isinstance(last_message, HumanMessage):
                        continue

                    # Handle ToolMessage - extract final_answer result
                    if isinstance(last_message, ToolMessage):
                        logger.info(
                            "SimpleAgent ToolMessage content: %s",
                            last_message.content,
                        )
                        todos = _extract_todos(last_message.content)
                        if todos:
                            latest_todos = todos
                            yield {
                                "event": "todos",
                                "data": json.dumps({"todos": todos}),
                            }
                        tool_name = getattr(last_message, "name", "") or ""
                        logger.info(
                            "SimpleAgent ToolMessage name attribute: %s", tool_name
                        )

                        # Also check content for tool name if name attribute is empty
                        if not tool_name:
                            try:
                                content_json = json.loads(last_message.content)
                                tool_name = content_json.get("tool", "")
                                logger.info(
                                    "SimpleAgent ToolMessage tool from content: %s",
                                    tool_name,
                                )
                            except (json.JSONDecodeError, TypeError):
                                pass

                        if tool_name in ("final_answer_tool", "final_answer"):
                            # Extract the final answer from the tool result
                            try:
                                tool_result = json.loads(last_message.content)
                                # Check both direct "answer" and "parameters.answer"
                                final_answer = tool_result.get(
                                    "answer"
                                ) or tool_result.get("parameters", {}).get("answer")
                                if final_answer:
                                    yield {
                                        "event": "token",
                                        "data": json.dumps({"content": final_answer}),
                                    }
                                else:
                                    # Fallback to raw content if no answer found
                                    yield {
                                        "event": "token",
                                        "data": json.dumps(
                                            {"content": last_message.content}
                                        ),
                                    }
                            except json.JSONDecodeError:
                                # If not JSON, use content directly
                                if last_message.content:
                                    yield {
                                        "event": "token",
                                        "data": json.dumps(
                                            {"content": last_message.content}
                                        ),
                                    }
                            if latest_todos:
                                yield {
                                    "event": "todos",
                                    "data": json.dumps(
                                        {"todos": _complete_todos(latest_todos)}
                                    ),
                                }
                            # End stream after final answer
                            yield {"event": "debug_clear", "data": json.dumps({})}
                            yield {
                                "event": "complete",
                                "data": json.dumps(
                                    {"success": True, "thread_id": thread_id}
                                ),
                            }
                            return
                        # Skip other tool messages (jupyter_cell, markdown results)
                        continue

                        # Handle AIMessage
                        if isinstance(last_message, AIMessage):
                            logger.info(
                                "SimpleAgent AIMessage content: %s",
                                last_message.content or "",
                            )
                            logger.info(
                                "SimpleAgent AIMessage tool_calls: %s",
                                json.dumps(last_message.tool_calls, ensure_ascii=False)
                                if hasattr(last_message, "tool_calls")
                                else "[]",
                            )
                            logger.info(
                                "SimpleAgent AIMessage additional_kwargs: %s",
                                json.dumps(
                                    getattr(last_message, "additional_kwargs", {})
                                    or {},
                                    ensure_ascii=False,
                                ),
                            )
                            logger.info(
                                "SimpleAgent AIMessage response_metadata: %s",
                                json.dumps(
                                    getattr(last_message, "response_metadata", {})
                                    or {},
                                    ensure_ascii=False,
                                ),
                            )
                            logger.info(
                                "SimpleAgent AIMessage usage_metadata: %s",
                                json.dumps(
                                    getattr(last_message, "usage_metadata", {}) or {},
                                    ensure_ascii=False,
                                ),
                            )
                            last_finish_reason = (
                                getattr(last_message, "response_metadata", {}) or {}
                            ).get("finish_reason")
                            # Check for tool calls first (display debug)
                            tool_calls = []
                            if (
                                hasattr(last_message, "tool_calls")
                                and last_message.tool_calls
                            ):
                                tool_calls = last_message.tool_calls
                            else:
                                raw_tool_calls = (
                                    getattr(last_message, "additional_kwargs", {}) or {}
                                ).get("tool_calls")
                                if not raw_tool_calls:
                                    raw_tool_calls = (
                                        getattr(last_message, "additional_kwargs", {})
                                        or {}
                                    ).get("function_call")
                                tool_calls = _normalize_tool_calls(raw_tool_calls)

                            if tool_calls:
                                todos = _emit_todos_from_tool_calls(tool_calls)
                                if todos:
                                    latest_todos = todos
                                    yield {
                                        "event": "todos",
                                        "data": json.dumps({"todos": todos}),
                                    }
                                for tool_call in tool_calls:
                                    tool_name = tool_call.get("name", "unknown")
                                    tool_args = tool_call.get("args", {})

                                    yield {
                                        "event": "debug",
                                        "data": json.dumps(
                                            {"status": f"🔧 Tool 실행: {tool_name}"}
                                        ),
                                    }

                                    # Send tool_call event with details for frontend to execute
                                    if tool_name in (
                                        "jupyter_cell_tool",
                                        "jupyter_cell",
                                    ):
                                        produced_output = True
                                        yield {
                                            "event": "tool_call",
                                            "data": json.dumps(
                                                {
                                                    "tool": "jupyter_cell",
                                                    "code": tool_args.get("code", ""),
                                                    "description": tool_args.get(
                                                        "description", ""
                                                    ),
                                                }
                                            ),
                                        }
                                    elif tool_name in ("markdown_tool", "markdown"):
                                        produced_output = True
                                        yield {
                                            "event": "tool_call",
                                            "data": json.dumps(
                                                {
                                                    "tool": "markdown",
                                                    "content": tool_args.get(
                                                        "content", ""
                                                    ),
                                                }
                                            ),
                                        }

                            # Only display content if it's not empty and not a JSON tool response
                            if (
                                hasattr(last_message, "content")
                                and last_message.content
                            ):
                                content = last_message.content

                                # Filter out raw JSON tool responses
                                if not (
                                    content.strip().startswith('{"tool":')
                                    or content.strip().startswith('{"status":')
                                    or '"pending_execution"' in content
                                    or '"status": "complete"' in content
                                ):
                                    produced_output = True
                                    yield {
                                        "event": "token",
                                        "data": json.dumps({"content": content}),
                                    }

            if not produced_output and last_finish_reason == "MALFORMED_FUNCTION_CALL":
                logger.info(
                    "SimpleAgent fallback: retrying tool call generation after malformed function call"
                )
                try:
                    fallback_config = json.loads(json.dumps(config_dict))
                    if fallback_config.get(
                        "provider"
                    ) == "gemini" and fallback_config.get("gemini", {}).get(
                        "model", ""
                    ).endswith("flash"):
                        fallback_config.setdefault("gemini", {})["model"] = (
                            "gemini-2.5-pro"
                        )
                        logger.info(
                            "SimpleAgent fallback: switching model to gemini-2.5-pro"
                        )

                    llm = _create_llm(fallback_config)
                    tools = _get_all_tools()
                    # Force tool calling - use tool_config for Gemini, tool_choice for others
                    provider = config_dict.get("provider", "gemini")
                    if provider == "gemini":
                        # Gemini uses tool_config with function_calling_config
                        llm_with_tools = llm.bind_tools(
                            tools,
                            tool_config={"function_calling_config": {"mode": "ANY"}},
                        )
                    else:
                        # OpenAI and others use tool_choice
                        llm_with_tools = llm.bind_tools(tools, tool_choice="any")
                    fallback_messages = [
                        SystemMessage(
                            content=(
                                "You MUST respond with a valid tool call. "
                                "Available tools: jupyter_cell_tool (for Python code), markdown_tool (for text), "
                                "list_files_tool (to list files), read_file_tool (to read files). "
                                "Choose the most appropriate tool and provide valid JSON arguments."
                            )
                        ),
                        HumanMessage(content=request.request),
                    ]
                    logger.info(
                        "SimpleAgent fallback: calling LLM with tool_choice=any"
                    )
                    fallback_response = await asyncio.wait_for(
                        llm_with_tools.ainvoke(fallback_messages),
                        timeout=30,
                    )
                    logger.info("SimpleAgent fallback: LLM response received")
                    logger.info(
                        "SimpleAgent fallback response type: %s",
                        type(fallback_response).__name__,
                    )
                    if hasattr(fallback_response, "tool_calls"):
                        logger.info(
                            "SimpleAgent fallback tool_calls: %s",
                            json.dumps(
                                fallback_response.tool_calls or [],
                                ensure_ascii=False,
                            ),
                        )
                    if hasattr(fallback_response, "content"):
                        logger.info(
                            "SimpleAgent fallback content: %s",
                            fallback_response.content or "",
                        )
                except asyncio.TimeoutError:
                    logger.error("SimpleAgent fallback timed out after 30s")
                    yield {
                        "event": "token",
                        "data": json.dumps(
                            {
                                "content": "모델이 도구 호출을 생성하지 못했습니다. 다시 시도해주세요."
                            }
                        ),
                    }
                    produced_output = True
                    fallback_response = None
                except Exception as fallback_error:
                    logger.error(
                        "SimpleAgent fallback error: %s",
                        fallback_error,
                        exc_info=True,
                    )
                    yield {
                        "event": "token",
                        "data": json.dumps(
                            {"content": f"오류가 발생했습니다: {str(fallback_error)}"}
                        ),
                    }
                    produced_output = True
                    fallback_response = None
                if isinstance(fallback_response, AIMessage) and getattr(
                    fallback_response, "tool_calls", None
                ):
                    for tool_call in fallback_response.tool_calls:
                        tool_name = tool_call.get("name", "unknown")
                        tool_args = tool_call.get("args", {})

                        logger.info("Fallback processing tool: %s", tool_name)

                        if tool_name in ("jupyter_cell_tool", "jupyter_cell"):
                            produced_output = True
                            yield {
                                "event": "debug",
                                "data": json.dumps(
                                    {"status": f"🔧 Tool 실행: {tool_name}"}
                                ),
                            }
                            yield {
                                "event": "tool_call",
                                "data": json.dumps(
                                    {
                                        "tool": "jupyter_cell",
                                        "code": tool_args.get("code", ""),
                                        "description": tool_args.get("description", ""),
                                    }
                                ),
                            }
                        elif tool_name in ("markdown_tool", "markdown"):
                            produced_output = True
                            yield {
                                "event": "debug",
                                "data": json.dumps(
                                    {"status": f"🔧 Tool 실행: {tool_name}"}
                                ),
                            }
                            yield {
                                "event": "tool_call",
                                "data": json.dumps(
                                    {
                                        "tool": "markdown",
                                        "content": tool_args.get("content", ""),
                                    }
                                ),
                            }
                        elif tool_name in (
                            "read_file_tool",
                            "list_files_tool",
                            "search_workspace_tool",
                        ):
                            # For file operations, generate code with the LLM
                            logger.info(
                                "Fallback: Generating code for %s via LLM",
                                tool_name,
                            )
                            produced_output = True
                            try:
                                code = await asyncio.wait_for(
                                    _generate_fallback_code(
                                        llm=llm,
                                        tool_name=tool_name,
                                        tool_args=tool_args,
                                    ),
                                    timeout=30,
                                )
                            except asyncio.TimeoutError:
                                code = ""
                                logger.error(
                                    "Fallback code generation timed out for %s",
                                    tool_name,
                                )
                            except Exception as code_error:
                                code = ""
                                logger.error(
                                    "Fallback code generation error: %s",
                                    code_error,
                                    exc_info=True,
                                )

                            if not code:
                                yield {
                                    "event": "token",
                                    "data": json.dumps(
                                        {
                                            "content": "도구 실행을 위한 코드를 생성하지 못했습니다. 다시 시도해주세요."
                                        }
                                    ),
                                }
                                produced_output = True
                                continue

                            yield {
                                "event": "debug",
                                "data": json.dumps(
                                    {"status": "🔄 Jupyter Cell로 변환 중..."}
                                ),
                            }
                            yield {
                                "event": "tool_call",
                                "data": json.dumps(
                                    {
                                        "tool": "jupyter_cell",
                                        "code": code,
                                        "description": f"Converted from {tool_name}",
                                    }
                                ),
                            }
                        else:
                            # Unknown tool - skip and show message
                            logger.warning(
                                "Fallback: Unknown tool %s, skipping", tool_name
                            )
                            yield {
                                "event": "token",
                                "data": json.dumps(
                                    {
                                        "content": f"알 수 없는 도구 '{tool_name}'입니다. jupyter_cell_tool을 사용해주세요."
                                    }
                                ),
                            }
                            produced_output = True
                elif (
                    isinstance(fallback_response, AIMessage)
                    and fallback_response.content
                ):
                    produced_output = True
                    yield {
                        "event": "token",
                        "data": json.dumps({"content": fallback_response.content}),
                    }
                elif fallback_response is not None and not produced_output:
                    yield {
                        "event": "token",
                        "data": json.dumps(
                            {
                                "content": "모델이 도구 호출을 생성하지 못했습니다. 다시 시도해주세요."
                            }
                        ),
                    }
                    produced_output = True

            # Clear debug status before completion
            yield {"event": "debug_clear", "data": json.dumps({})}

            # No interrupt - execution completed
            yield {
                "event": "complete",
                "data": json.dumps({"success": True, "thread_id": thread_id}),
            }

        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": json.dumps(
                    {
                        "error": str(e),
                        "error_type": type(e).__name__,
                    }
                ),
            }

    return EventSourceResponse(event_generator())


@router.post("/resume")
async def resume_agent(request: ResumeRequest):
    """
    Resume interrupted agent execution with user decisions.

    Takes user decisions (approve/edit/reject) and resumes the agent
    execution from the interrupt point.

    Returns Server-Sent Events (SSE) with the same format as /stream.
    """
    from langgraph.types import Command

    logger.info(f"Resume request for thread: {request.threadId}")

    async def event_generator():
        try:
            # Convert LLMConfig to dict
            config_dict = {
                "provider": request.llmConfig.provider
                if request.llmConfig
                else "gemini",
            }
            if request.llmConfig:
                if request.llmConfig.gemini:
                    config_dict["gemini"] = request.llmConfig.gemini
                if request.llmConfig.openai:
                    config_dict["openai"] = request.llmConfig.openai
                if request.llmConfig.vllm:
                    config_dict["vllm"] = request.llmConfig.vllm

            # Create agent (will use same checkpointer)
            agent = create_simple_chat_agent(
                llm_config=config_dict,
                workspace_root=request.workspaceRoot or ".",
                enable_hitl=True,
                checkpointer=_simple_agent_checkpointers.setdefault(
                    request.threadId, InMemorySaver()
                ),
            )

            # Prepare config with thread_id
            config = {"configurable": {"thread_id": request.threadId}}

            pending_actions = _simple_agent_pending_actions.get(request.threadId, [])

            # Convert decisions to LangChain format
            langgraph_decisions = []
            for index, decision in enumerate(request.decisions):
                if decision.type == "approve":
                    langgraph_decisions.append({"type": "approve"})
                elif decision.type == "edit":
                    action = (
                        pending_actions[index] if index < len(pending_actions) else {}
                    )
                    edited_action = {
                        "name": action.get("name", "unknown"),
                        "args": decision.args or action.get("arguments", {}) or {},
                    }
                    langgraph_decisions.append(
                        {
                            "type": "edit",
                            "edited_action": edited_action,
                        }
                    )
                elif decision.type == "reject":
                    langgraph_decisions.append(
                        {
                            "type": "reject",
                            "feedback": decision.feedback
                            or "User rejected this action",
                        }
                    )

            # Resume execution
            yield {
                "event": "debug",
                "data": json.dumps({"status": "▶️ 실행 재개 중..."}),
            }

            _simple_agent_pending_actions.pop(request.threadId, None)

            # Track processed tool calls to avoid duplicates (middleware can yield same step multiple times)
            processed_tool_call_ids: set[str] = set()
            latest_todos: Optional[List[Dict[str, Any]]] = None

            # Resume with Command
            last_signature = None

            # Status: waiting for LLM response
            yield {
                "event": "debug",
                "data": json.dumps({"status": "🤔 LLM 응답 대기 중..."}),
            }

            for step in agent.stream(
                Command(resume={"decisions": langgraph_decisions}),
                config,
                stream_mode="values",
            ):
                # Check for another interrupt
                if isinstance(step, dict) and "__interrupt__" in step:
                    interrupts = step["__interrupt__"]

                    yield {
                        "event": "debug",
                        "data": json.dumps({"status": "⏸️ 사용자 승인 대기 중..."}),
                    }

                    for interrupt in interrupts:
                        interrupt_value = (
                            interrupt.value
                            if hasattr(interrupt, "value")
                            else interrupt
                        )
                        action_requests = interrupt_value.get("action_requests", [])
                        normalized_actions = [
                            _normalize_action_request(a) for a in action_requests
                        ]
                        if normalized_actions:
                            _simple_agent_pending_actions[request.threadId] = (
                                normalized_actions
                            )

                        for action in normalized_actions:
                            yield {
                                "event": "interrupt",
                                "data": json.dumps(
                                    {
                                        "thread_id": request.threadId,
                                        "action": action.get("name", "unknown"),
                                        "args": action.get("arguments", {}),
                                        "description": action.get("description", ""),
                                    }
                                ),
                            }

                    return

                # Check for todos in state and stream them
                if isinstance(step, dict) and "todos" in step:
                    todos = step["todos"]
                    if todos:
                        latest_todos = todos
                        yield {"event": "todos", "data": json.dumps({"todos": todos})}
                elif isinstance(step, dict):
                    todos = _extract_todos(step)
                    if todos:
                        latest_todos = todos
                        yield {"event": "todos", "data": json.dumps({"todos": todos})}

                # Process messages
                if isinstance(step, dict) and "messages" in step:
                    messages = step["messages"]
                    if messages:
                        last_message = messages[-1]
                        signature = _message_signature(last_message)
                        if signature == last_signature:
                            continue
                        last_signature = signature

                        if isinstance(last_message, ToolMessage):
                            logger.info(
                                "Resume ToolMessage content: %s", last_message.content
                            )
                            todos = _extract_todos(last_message.content)
                            if todos:
                                latest_todos = todos
                                yield {
                                    "event": "todos",
                                    "data": json.dumps({"todos": todos}),
                                }
                            tool_name = getattr(last_message, "name", "") or ""
                            logger.info(
                                "Resume ToolMessage name attribute: %s", tool_name
                            )

                            # Also check content for tool name if name attribute is empty
                            if not tool_name:
                                try:
                                    content_json = json.loads(last_message.content)
                                    tool_name = content_json.get("tool", "")
                                    logger.info(
                                        "Resume ToolMessage tool from content: %s",
                                        tool_name,
                                    )
                                except (json.JSONDecodeError, TypeError):
                                    pass

                            if tool_name in ("final_answer_tool", "final_answer"):
                                try:
                                    tool_result = json.loads(last_message.content)
                                    final_answer = tool_result.get(
                                        "answer"
                                    ) or tool_result.get("parameters", {}).get("answer")
                                    if final_answer:
                                        yield {
                                            "event": "token",
                                            "data": json.dumps(
                                                {"content": final_answer}
                                            ),
                                        }
                                    else:
                                        yield {
                                            "event": "token",
                                            "data": json.dumps(
                                                {"content": last_message.content}
                                            ),
                                        }
                                except json.JSONDecodeError:
                                    yield {
                                        "event": "token",
                                        "data": json.dumps(
                                            {"content": last_message.content}
                                        ),
                                    }
                                if latest_todos:
                                    yield {
                                        "event": "todos",
                                        "data": json.dumps(
                                            {"todos": _complete_todos(latest_todos)}
                                        ),
                                    }
                                yield {"event": "debug_clear", "data": json.dumps({})}
                                yield {
                                    "event": "complete",
                                    "data": json.dumps(
                                        {"success": True, "thread_id": request.threadId}
                                    ),
                                }
                                return
                            # Skip other ToolMessages (jupyter_cell, markdown, etc.) - don't emit their content
                            continue

                        if hasattr(last_message, "content") and last_message.content:
                            content = last_message.content

                            # Filter out raw JSON tool responses
                            if not (
                                content.strip().startswith('{"tool":')
                                or content.strip().startswith('{"status":')
                                or '"pending_execution"' in content
                                or '"status": "complete"' in content
                            ):
                                yield {
                                    "event": "token",
                                    "data": json.dumps({"content": content}),
                                }

                        if (
                            hasattr(last_message, "tool_calls")
                            and last_message.tool_calls
                        ):
                            # Filter out already processed tool calls (avoid duplicates from middleware)
                            new_tool_calls = [
                                tc
                                for tc in last_message.tool_calls
                                if tc.get("id") not in processed_tool_call_ids
                            ]

                            if not new_tool_calls:
                                # All tool calls already processed, skip
                                continue

                            # Mark these tool calls as processed
                            for tc in new_tool_calls:
                                if tc.get("id"):
                                    processed_tool_call_ids.add(tc["id"])

                            logger.info(
                                "Resume AIMessage tool_calls: %s",
                                json.dumps(new_tool_calls, ensure_ascii=False),
                            )
                            todos = _emit_todos_from_tool_calls(new_tool_calls)
                            if todos:
                                latest_todos = todos
                                yield {
                                    "event": "todos",
                                    "data": json.dumps({"todos": todos}),
                                }
                        for tool_call in new_tool_calls:
                            tool_name = tool_call.get("name", "unknown")
                            tool_args = tool_call.get("args", {})
                            if tool_args.get("execution_result"):
                                logger.info(
                                    "Resume tool_call includes execution_result; skipping client execution for %s",
                                    tool_name,
                                )
                                continue

                            yield {
                                "event": "debug",
                                "data": json.dumps(
                                    {"status": f"🔧 Tool 실행: {tool_name}"}
                                ),
                            }

                            if tool_name in ("jupyter_cell_tool", "jupyter_cell"):
                                yield {
                                    "event": "tool_call",
                                    "data": json.dumps(
                                        {
                                            "tool": "jupyter_cell",
                                            "code": tool_args.get("code", ""),
                                            "description": tool_args.get(
                                                "description", ""
                                            ),
                                        }
                                    ),
                                }
                            elif tool_name in ("markdown_tool", "markdown"):
                                yield {
                                    "event": "tool_call",
                                    "data": json.dumps(
                                        {
                                            "tool": "markdown",
                                            "content": tool_args.get("content", ""),
                                        }
                                    ),
                                }

            # Clear debug status before completion
            yield {"event": "debug_clear", "data": json.dumps({})}

            # Execution completed
            yield {
                "event": "complete",
                "data": json.dumps({"success": True, "thread_id": request.threadId}),
            }

        except Exception as e:
            logger.error(f"Resume error: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": json.dumps(
                    {
                        "error": str(e),
                        "error_type": type(e).__name__,
                    }
                ),
            }

    return EventSourceResponse(event_generator())


@router.post("/search")
async def search_workspace(
    pattern: str,
    path: str = ".",
    file_types: Optional[List[str]] = None,
    notebook_path: Optional[str] = None,
    workspace_root: str = ".",
) -> Dict[str, Any]:
    """
    Search for patterns in workspace files and notebooks.

    Args:
        pattern: Search pattern (text or regex)
        path: Directory to search
        file_types: File patterns to include
        notebook_path: Specific notebook to search
        workspace_root: Workspace root directory
    """
    from agent_server.langchain.executors.notebook_searcher import NotebookSearcher

    searcher = NotebookSearcher(workspace_root)

    if notebook_path:
        results = searcher.search_notebook(
            notebook_path,
            pattern,
            max_results=50,
        )
    else:
        results = searcher.search_workspace(
            pattern,
            file_patterns=file_types,
            path=path,
            max_results=100,
        )

    return results.to_dict()


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check for LangChain agent router"""
    return {
        "status": "ok",
        "router": "langchain-agent",
        "version": "1.0.0",
    }


@router.delete("/cache")
async def clear_agent_cache() -> Dict[str, Any]:
    """Clear the agent instance cache"""
    global _agent_cache
    count = len(_agent_cache)
    _agent_cache.clear()

    return {
        "status": "ok",
        "cleared": count,
        "message": f"Cleared {count} cached agent instances",
    }
