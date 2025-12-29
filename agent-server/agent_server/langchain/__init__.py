"""
LangChain-based Agent Module

This module provides a LangChain middleware-based agent implementation
for Jupyter notebook code assistance.

Architecture:
- agent.py: Main agent creation with middleware stack
- tools/: LangChain tools (jupyter_cell, file operations, search)
- middleware/: Custom middleware (RAG, validation, execution, search)
- executors/: Jupyter kernel execution (Embedded mode)
- state.py: Agent state management
"""

from agent_server.langchain.agent import create_simple_chat_agent
from agent_server.langchain.state import AgentState

__all__ = ["create_simple_chat_agent", "AgentState"]
