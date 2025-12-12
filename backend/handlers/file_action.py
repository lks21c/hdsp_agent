"""
File Action Handler
Python 파일 분석 및 에러 수정 API 핸들러
"""

import json
import logging
import re
from tornado import web

from .base import BaseAgentHandler
from ..prompts.file_action_prompts import (
    format_file_fix_prompt,
    format_file_explain_prompt,
    format_file_custom_prompt,
)

logger = logging.getLogger(__name__)


class FileActionHandler(BaseAgentHandler):
    """Python 파일 액션 핸들러 - 분석, 설명, 수정"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/file/action

        Request body:
        {
            "action": "fix" | "explain" | "custom",
            "mainFile": { "path": str, "content": str },
            "errorOutput": str (optional, required for "fix"),
            "relatedFiles": [{ "path": str, "content": str }] (optional),
            "customPrompt": str (optional, for "custom" action)
        }

        Response:
        {
            "response": str,
            "fixedFiles": [{ "path": str, "content": str }] (for "fix" action)
        }
        """
        try:
            body = self.get_json_body()
            action = body.get('action', '')
            main_file = body.get('mainFile', {})
            error_output = body.get('errorOutput', '')
            related_files = body.get('relatedFiles', [])
            custom_prompt = body.get('customPrompt', '')

            # Validation
            if not main_file.get('path') or not main_file.get('content'):
                return self.write_error_json(400, 'mainFile with path and content is required')

            if action == 'fix' and not error_output:
                return self.write_error_json(400, 'errorOutput is required for fix action')

            # Build prompt based on action
            if action == 'explain':
                prompt = format_file_explain_prompt(
                    file_path=main_file['path'],
                    file_content=main_file['content']
                )
            elif action == 'fix':
                prompt = format_file_fix_prompt(
                    main_file=main_file,
                    error_output=error_output,
                    related_files=related_files
                )
            elif action == 'custom':
                prompt = format_file_custom_prompt(
                    main_file=main_file,
                    custom_prompt=custom_prompt,
                    related_files=related_files
                )
            else:
                return self.write_error_json(400, f'Unknown action: {action}')

            print(f"[FileAction] Action: {action}, File: {main_file['path']}", flush=True)

            # Call LLM
            response = await self._call_llm(prompt)

            # Extract fixed code if action is 'fix'
            fixed_files = []
            if action == 'fix':
                fixed_files = self._extract_fixed_files(response, main_file['path'])

            self.write_json({
                'response': response,
                'fixedFiles': fixed_files
            })

        except Exception as e:
            logger.error(f"File action error: {str(e)}", exc_info=True)
            self.write_error_json(500, str(e))

    async def _call_llm(self, prompt: str) -> str:
        """LLM 호출 - 기존 인프라 재사용"""
        from ..llm_service import call_llm
        config = self.config_manager.get_config()
        return await call_llm(prompt, config)

    def _extract_fixed_files(self, response: str, default_path: str) -> list:
        """LLM 응답에서 수정된 파일들 추출

        패턴:
        ### 수정 파일: path/to/file.py
        ```python
        code here
        ```
        """
        fixed_files = []

        # 패턴 1: ### 수정 파일: path
        # 패턴 2: ### 추가 수정 파일: path
        file_pattern = r'###\s*(?:수정|추가\s*수정)\s*파일:\s*([^\n]+)\s*\n```python\s*([\s\S]*?)```'

        matches = re.findall(file_pattern, response)

        if matches:
            for path, content in matches:
                path = path.strip()
                content = content.strip()
                if path and content:
                    fixed_files.append({
                        'path': path,
                        'content': content
                    })
        else:
            # 폴백: 단순 python 코드 블록 추출
            simple_pattern = r'```python\s*([\s\S]*?)```'
            code_matches = re.findall(simple_pattern, response)
            if code_matches:
                # 첫 번째 코드 블록을 기본 파일로
                fixed_files.append({
                    'path': default_path,
                    'content': code_matches[0].strip()
                })

        return fixed_files
