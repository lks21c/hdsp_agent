"""
Cell Action Prompts
셀 액션(설명, 수정, 커스텀 요청, 채팅)을 위한 프롬프트 템플릿
"""

# ═══════════════════════════════════════════════════════════════════════════
# 코드 설명 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

EXPLAIN_CODE_PROMPT = """이 코드가 무엇을 하는지 명확하고 간결하게 설명해주세요.

```python
{cell_content}
```

다음 사항에 초점을 맞춰주세요:
1. 전체적인 목적과 해결하는 문제
2. 주요 단계와 로직 흐름
3. 중요한 구현 세부사항
4. 사용된 주목할 만한 패턴이나 기법

코드를 학습하는 사람에게 적합한 명확한 설명을 제공해주세요."""


# ═══════════════════════════════════════════════════════════════════════════
# 코드 수정 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

FIX_CODE_PROMPT = """이 코드에서 오류, 버그 또는 잠재적인 문제를 분석하고 수정사항을 제공해주세요.

```python
{cell_content}
```

다음 형식으로 제공해주세요:
1. **발견된 문제점**: 오류, 버그 또는 잠재적 문제 목록
2. **수정된 코드**: 수정된 버전의 코드
3. **설명**: 무엇이 잘못되었고 어떻게 수정했는지
4. **추가 제안**: 추가로 개선할 수 있는 사항

코드가 정상적으로 보인다면, 확인하고 잠재적인 개선사항을 제안해주세요."""


# ═══════════════════════════════════════════════════════════════════════════
# 커스텀 요청 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

CUSTOM_REQUEST_PROMPT = """{custom_prompt}

코드:
```python
{cell_content}
```

위의 요청에 대해 상세하고 도움이 되는 응답을 제공해주세요."""


# ═══════════════════════════════════════════════════════════════════════════
# 기본 시스템 프롬프트
# ═══════════════════════════════════════════════════════════════════════════

DEFAULT_SYSTEM_PROMPT = "당신은 도움이 되는 AI 어시스턴트입니다."


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
            f"셀 {i+1}:\n```python\n{cell}\n```"
            for i, cell in enumerate(context['selectedCells'])
        ])
        prompt = f"{message}\n\n노트북 컨텍스트:\n{cells_text}"

    return prompt
