"""
Knowledge Base for HDSP Agent

Re-export from hdsp_agent_core for backward compatibility.
"""

from hdsp_agent_core.knowledge.loader import KnowledgeBase, get_knowledge_base

__all__ = ["KnowledgeBase", "get_knowledge_base"]
