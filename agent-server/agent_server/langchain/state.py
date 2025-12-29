"""
Agent State Management

Defines the state schema for the LangChain agent using TypedDict.
This state is passed through the agent execution and updated by middleware.
"""

from dataclasses import dataclass
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class NotebookContext(TypedDict, total=False):
    """Current notebook context"""
    notebook_path: str
    cell_count: int
    imported_libraries: List[str]
    defined_variables: List[str]
    recent_cells: List[Dict[str, Any]]
    kernel_id: Optional[str]


class ExecutionResult(TypedDict, total=False):
    """Result of code execution"""
    success: bool
    output: str
    error_type: Optional[str]
    error_message: Optional[str]
    traceback: Optional[List[str]]
    execution_count: int
    cell_index: int


class SearchResult(TypedDict, total=False):
    """Result of code search"""
    file_path: str
    cell_index: Optional[int]
    line_number: Optional[int]
    content: str
    match_type: str  # "file", "cell", "line"


class AgentState(TypedDict, total=False):
    """
    Main agent state schema for LangGraph.

    This state flows through the agent execution and is updated by:
    - Middleware (RAG context, validation results, etc.)
    - Tool executions (execution results, search results)
    - Agent decisions (current step, plan updates)
    """
    # Message history - uses add_messages reducer to accumulate messages
    messages: Annotated[List[BaseMessage], add_messages]

    # User request
    user_request: str

    # Notebook context
    notebook_context: NotebookContext

    # RAG context (injected by RAGMiddleware)
    rag_context: Optional[str]

    # Code search results (injected by CodeSearchMiddleware)
    search_results: List[SearchResult]

    # Current execution plan
    plan: Optional[Dict[str, Any]]
    current_step_index: int

    # Execution history
    execution_history: List[ExecutionResult]

    # Validation results
    validation_result: Optional[Dict[str, Any]]

    # Error handling state
    error_count: int
    last_error: Optional[Dict[str, Any]]
    recovery_strategy: Optional[str]

    # LLM configuration
    llm_config: Dict[str, Any]

    # Detected libraries for knowledge injection
    detected_libraries: List[str]

    # Final answer
    final_answer: Optional[str]
    is_complete: bool


@dataclass
class AgentRuntime:
    """
    Runtime context passed to middleware.
    
    Contains references to executors and services needed by middleware.
    """
    jupyter_executor: Any = None
    notebook_searcher: Any = None
    rag_manager: Any = None
    code_validator: Any = None
    error_classifier: Any = None
    workspace_root: str = "."

    # Execution mode
    embedded_mode: bool = True

    # Configuration
    max_retries: int = 3
    max_model_calls: int = 20
    enable_rag: bool = True
    enable_validation: bool = True


def create_initial_state(
    user_request: str,
    notebook_context: Optional[Dict[str, Any]] = None,
    llm_config: Optional[Dict[str, Any]] = None,
) -> AgentState:
    """
    Create initial agent state from user request.
    
    Args:
        user_request: Natural language request from user
        notebook_context: Current notebook state
        llm_config: LLM configuration
        
    Returns:
        Initialized AgentState
    """
    return AgentState(
        messages=[],
        user_request=user_request,
        notebook_context=notebook_context or NotebookContext(
            notebook_path="",
            cell_count=0,
            imported_libraries=[],
            defined_variables=[],
            recent_cells=[],
            kernel_id=None,
        ),
        rag_context=None,
        search_results=[],
        plan=None,
        current_step_index=0,
        execution_history=[],
        validation_result=None,
        error_count=0,
        last_error=None,
        recovery_strategy=None,
        llm_config=llm_config or {},
        detected_libraries=[],
        final_answer=None,
        is_complete=False,
    )
