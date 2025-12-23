"""
HDSP Agent Prompts Module

Re-export from hdsp_agent_core.prompts for backward compatibility.
"""

# Auto-Agent Prompts
from hdsp_agent_core.prompts.auto_agent_prompts import (
    ADAPTIVE_REPLAN_PROMPT,
    CODE_GENERATION_PROMPT,
    ERROR_REFINEMENT_PROMPT,
    FINAL_ANSWER_PROMPT,
    PLAN_GENERATION_PROMPT,
    REFLECTION_PROMPT,
    STRUCTURED_PLAN_PROMPT,
    format_final_answer_prompt,
    format_plan_prompt,
    format_refine_prompt,
    format_reflection_prompt,
    format_replan_prompt,
    format_structured_plan_prompt,
)

# Cell Action Prompts
from hdsp_agent_core.prompts.cell_action_prompts import (
    CUSTOM_REQUEST_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    EXPLAIN_CODE_PROMPT,
    FIX_CODE_PROMPT,
    format_chat_prompt,
    format_custom_prompt,
    format_explain_prompt,
    format_fix_prompt,
)

__all__ = [
    # Auto-Agent Prompts
    "PLAN_GENERATION_PROMPT",
    "CODE_GENERATION_PROMPT",
    "ERROR_REFINEMENT_PROMPT",
    "ADAPTIVE_REPLAN_PROMPT",
    "FINAL_ANSWER_PROMPT",
    "STRUCTURED_PLAN_PROMPT",
    "REFLECTION_PROMPT",
    "format_plan_prompt",
    "format_refine_prompt",
    "format_final_answer_prompt",
    "format_replan_prompt",
    "format_structured_plan_prompt",
    "format_reflection_prompt",
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
