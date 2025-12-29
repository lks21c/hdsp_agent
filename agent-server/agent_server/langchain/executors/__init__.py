"""
Jupyter Executors (Embedded Mode)

Provides direct access to Jupyter kernel for code execution
when running inside JupyterLab server.

Components:
- JupyterExecutor: Execute code in Jupyter kernel
- NotebookSearcher: Search notebooks and cells
"""

from agent_server.langchain.executors.jupyter_executor import JupyterExecutor
from agent_server.langchain.executors.notebook_searcher import NotebookSearcher

__all__ = ["JupyterExecutor", "NotebookSearcher"]
