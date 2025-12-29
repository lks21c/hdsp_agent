"""
LangChain Middleware for Jupyter Agent

Middleware stack (execution order):
1. RAGMiddleware: Inject RAG context before model calls
2. CodeSearchMiddleware: Search workspace/notebook for relevant code
3. ValidationMiddleware: Validate code before execution
4. JupyterExecutionMiddleware: Execute code in Jupyter kernel
5. ErrorHandlingMiddleware: Classify errors and decide recovery strategy

Built-in middleware used:
- SummarizationMiddleware: Compress long conversations
- ModelRetryMiddleware: Retry on rate limits
- ToolRetryMiddleware: Retry failed tool calls
- ModelCallLimitMiddleware: Prevent infinite loops
"""

from agent_server.langchain.middleware.code_search_middleware import (
    CodeSearchMiddleware,
)
from agent_server.langchain.middleware.error_handling_middleware import (
    ErrorHandlingMiddleware,
)
from agent_server.langchain.middleware.jupyter_execution_middleware import (
    JupyterExecutionMiddleware,
)
from agent_server.langchain.middleware.rag_middleware import RAGMiddleware
from agent_server.langchain.middleware.validation_middleware import ValidationMiddleware

__all__ = [
    "RAGMiddleware",
    "CodeSearchMiddleware",
    "ValidationMiddleware",
    "JupyterExecutionMiddleware",
    "ErrorHandlingMiddleware",
]
