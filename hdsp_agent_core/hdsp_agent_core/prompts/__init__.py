"""
HDSP Agent Core - Prompts

Prompt templates for Auto-Agent and Cell Actions.
"""

from .auto_agent_prompts import (
    PLAN_GENERATION_PROMPT,
    CODE_GENERATION_PROMPT,
    ERROR_REFINEMENT_PROMPT,
    ADAPTIVE_REPLAN_PROMPT,
    STRUCTURED_PLAN_PROMPT,
    REFLECTION_PROMPT,
    FINAL_ANSWER_PROMPT,
    ERROR_ANALYSIS_PROMPT,
    PIP_INDEX_OPTION,
    format_plan_prompt,
    format_refine_prompt,
    format_final_answer_prompt,
    format_replan_prompt,
    format_structured_plan_prompt,
    format_reflection_prompt,
    format_error_analysis_prompt,
)
from .cell_action_prompts import (
    EXPLAIN_CODE_PROMPT,
    FIX_CODE_PROMPT,
    CUSTOM_REQUEST_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    format_explain_prompt,
    format_fix_prompt,
    format_custom_prompt,
    format_chat_prompt,
)

__all__ = [
    # Auto-Agent Prompts
    "PLAN_GENERATION_PROMPT",
    "CODE_GENERATION_PROMPT",
    "ERROR_REFINEMENT_PROMPT",
    "ADAPTIVE_REPLAN_PROMPT",
    "STRUCTURED_PLAN_PROMPT",
    "REFLECTION_PROMPT",
    "FINAL_ANSWER_PROMPT",
    "ERROR_ANALYSIS_PROMPT",
    "PIP_INDEX_OPTION",
    "format_plan_prompt",
    "format_refine_prompt",
    "format_final_answer_prompt",
    "format_replan_prompt",
    "format_structured_plan_prompt",
    "format_reflection_prompt",
    "format_error_analysis_prompt",
    # Cell Action Prompts
    "EXPLAIN_CODE_PROMPT",
    "FIX_CODE_PROMPT",
    "CUSTOM_REQUEST_PROMPT",
    "DEFAULT_SYSTEM_PROMPT",
    "format_explain_prompt",
    "format_fix_prompt",
    "format_custom_prompt",
    "format_chat_prompt",
]
