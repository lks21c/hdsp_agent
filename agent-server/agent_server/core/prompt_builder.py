"""
Prompt Builder - Construct prompts for different actions
프롬프트 템플릿은 prompts 모듈에서 관리됨
"""

from hdsp_agent_core.prompts.cell_action_prompts import (
    format_chat_prompt,
    format_custom_prompt,
    format_explain_prompt,
    format_fix_prompt,
)


class PromptBuilder:
    """Build LLM prompts based on action types"""

    @staticmethod
    def build_explain_prompt(cell_content: str) -> str:
        """Build prompt for explaining code"""
        return format_explain_prompt(cell_content)

    @staticmethod
    def build_fix_prompt(cell_content: str) -> str:
        """Build prompt for fixing code errors"""
        return format_fix_prompt(cell_content)

    @staticmethod
    def build_custom_prompt(custom_prompt: str, cell_content: str) -> str:
        """Build prompt for custom user request"""
        return format_custom_prompt(custom_prompt, cell_content)

    @staticmethod
    def build_chat_prompt(message: str, context: dict = None) -> str:
        """Build prompt for general chat"""
        return format_chat_prompt(message, context)
