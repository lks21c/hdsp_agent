"""
File Action Prompts
Python 파일 분석 및 에러 수정용 LLM 프롬프트
"""


def format_file_fix_prompt(
    main_file: dict, error_output: str, related_files: list = None
) -> str:
    """Python 파일 에러 수정용 프롬프트 생성

    Args:
        main_file: { 'path': str, 'content': str }
        error_output: 에러 메시지/트레이스백
        related_files: [{ 'path': str, 'content': str }]
    """
    related_context = ""
    if related_files:
        related_context = "\n## 관련 파일들\n"
        for rf in related_files:
            if rf.get("content"):
                related_context += f"""
### {rf['path']}
```python
{rf['content']}
```
"""

    return f"""Python 파일에서 에러가 발생했습니다. 에러를 분석하고 수정된 코드를 제공하세요.

## 에러 메시지
```
{error_output}
```

## 메인 파일: {main_file['path']}
```python
{main_file['content']}
```
{related_context}

## 지침
1. 에러의 근본 원인을 분석하세요
2. 수정이 필요한 파일의 **전체 코드**를 제공하세요 (부분 수정 아님)
3. 여러 파일 수정이 필요하면 각각 제공하세요
4. 수정 사항을 간단히 설명하세요
5. **코드 내 주석과 문자열은 한글 또는 영어로만 작성하세요 (한자 사용 절대 금지)**

## 출력 형식
### 에러 원인
(에러가 발생한 원인 설명)

### 수정 파일: [파일경로]
```python
[전체 수정된 코드]
```

### 추가 수정 파일: [파일경로] (필요한 경우)
```python
[전체 수정된 코드]
```
"""


def format_file_explain_prompt(file_path: str, file_content: str) -> str:
    """Python 파일 설명용 프롬프트 생성"""
    return f"""다음 Python 파일의 코드를 자세히 설명해주세요.

## 파일: {file_path}
```python
{file_content}
```

## 다음 형식으로 응답해주세요

### 파일 개요
(이 파일의 전체적인 목적과 기능)

### 주요 구성 요소
(클래스, 함수, 변수 등의 설명)

### 코드 흐름
(코드의 실행 흐름 설명)

### 의존성
(import하는 모듈과 그 용도)
"""


def format_file_custom_prompt(
    main_file: dict, custom_prompt: str, related_files: list = None
) -> str:
    """커스텀 질문용 프롬프트 생성"""
    related_context = ""
    if related_files:
        related_context = "\n## 관련 파일들\n"
        for rf in related_files:
            if rf.get("content"):
                related_context += f"""
### {rf['path']}
```python
{rf['content']}
```
"""

    return f"""{custom_prompt}

## 메인 파일: {main_file['path']}
```python
{main_file['content']}
```
{related_context}
"""
