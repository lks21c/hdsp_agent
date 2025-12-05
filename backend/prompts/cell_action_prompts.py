"""
Cell Action Prompts
셀 액션(설명, 수정, 커스텀 요청, 채팅)을 위한 프롬프트 템플릿
"""

# ═══════════════════════════════════════════════════════════════════════════
# 코드 설명 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

EXPLAIN_CODE_PROMPT = """Explain what this code does in clear, concise language.

```python
{cell_content}
```

Focus on:
1. Overall purpose and what problem it solves
2. Key steps and logic flow
3. Important implementation details
4. Any notable patterns or techniques used

Provide a clear explanation suitable for someone learning this code."""


# ═══════════════════════════════════════════════════════════════════════════
# 코드 수정 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

FIX_CODE_PROMPT = """Analyze this code for errors, bugs, or potential issues and provide fixes.

```python
{cell_content}
```

Please provide:
1. **Issues Identified**: List any errors, bugs, or potential problems
2. **Fixed Code**: The corrected version of the code
3. **Explanation**: What was wrong and how you fixed it
4. **Suggestions**: Any additional improvements that could be made

If the code looks correct, please confirm and suggest potential improvements."""


# ═══════════════════════════════════════════════════════════════════════════
# 커스텀 요청 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

CUSTOM_REQUEST_PROMPT = """{custom_prompt}

Code:
```python
{cell_content}
```

Please provide a detailed and helpful response to the above request."""


# ═══════════════════════════════════════════════════════════════════════════
# 기본 시스템 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant."


# ═══════════════════════════════════════════════════════════════════════════
# 유틸리티 함수
# ═══════════════════════════════════════════════════════════════════════════

def format_explain_prompt(cell_content: str) -> str:
    """코드 설명 프롬프트 포맷팅"""
    return EXPLAIN_CODE_PROMPT.format(cell_content=cell_content)


def format_fix_prompt(cell_content: str) -> str:
    """코드 수정 프롬프트 포맷팅"""
    return FIX_CODE_PROMPT.format(cell_content=cell_content)


def format_custom_prompt(custom_prompt: str, cell_content: str) -> str:
    """커스텀 요청 프롬프트 포맷팅"""
    return CUSTOM_REQUEST_PROMPT.format(
        custom_prompt=custom_prompt,
        cell_content=cell_content
    )


def format_chat_prompt(message: str, context: dict = None) -> str:
    """채팅 프롬프트 포맷팅"""
    prompt = message

    if context and context.get('selectedCells'):
        cells_text = '\n\n'.join([
            f"Cell {i+1}:\n```python\n{cell}\n```"
            for i, cell in enumerate(context['selectedCells'])
        ])
        prompt = f"{message}\n\nContext from notebook:\n{cells_text}"

    return prompt
