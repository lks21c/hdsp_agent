"""
Prompt Builder - Construct prompts for different actions
"""

class PromptBuilder:
    """Build LLM prompts based on action types"""

    @staticmethod
    def build_explain_prompt(cell_content: str) -> str:
        """Build prompt for explaining code"""
        return f"""Explain what this code does in clear, concise language.

```python
{cell_content}
```

Focus on:
1. Overall purpose and what problem it solves
2. Key steps and logic flow
3. Important implementation details
4. Any notable patterns or techniques used

Provide a clear explanation suitable for someone learning this code."""

    @staticmethod
    def build_fix_prompt(cell_content: str) -> str:
        """Build prompt for fixing code errors"""
        return f"""Analyze this code for errors, bugs, or potential issues and provide fixes.

```python
{cell_content}
```

Please provide:
1. **Issues Identified**: List any errors, bugs, or potential problems
2. **Fixed Code**: The corrected version of the code
3. **Explanation**: What was wrong and how you fixed it
4. **Suggestions**: Any additional improvements that could be made

If the code looks correct, please confirm and suggest potential improvements."""

    @staticmethod
    def build_custom_prompt(custom_prompt: str, cell_content: str) -> str:
        """Build prompt for custom user request"""
        return f"""{custom_prompt}

Code:
```python
{cell_content}
```

Please provide a detailed and helpful response to the above request."""

    @staticmethod
    def build_chat_prompt(message: str, context: dict = None) -> str:
        """Build prompt for general chat"""
        prompt = message

        if context and context.get('selectedCells'):
            cells_text = '\n\n'.join([
                f"Cell {i+1}:\n```python\n{cell}\n```"
                for i, cell in enumerate(context['selectedCells'])
            ])
            prompt = f"{message}\n\nContext from notebook:\n{cells_text}"

        return prompt
