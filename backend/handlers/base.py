"""
Base handler for Jupyter Agent API
"""

from jupyter_server.base.handlers import APIHandler
import json
import re

class BaseAgentHandler(APIHandler):
    """Base handler with common functionality"""

    # Class-level cache for installed packages (shared across all handlers)
    _installed_packages_cache = None

    def check_xsrf_cookie(self):
        """
        XSRF 토큰 검사를 강제로 생략합니다.
        운영계/개발계/JupyterHub 환경 차이로 인한 403 에러를 방지합니다.
        """
        return

    def check_origin(self, *args):
        return True

    @property
    def config_manager(self):
        """Get config manager from app settings"""
        from ..services.config_manager import ConfigManager
        return ConfigManager.get_instance()

    @property
    def llm_client(self):
        """Get LLM client from app settings"""
        from ..services.llm_client import LLMClient
        return LLMClient.get_instance(self.config_manager.get_config())

    def get_json_body(self):
        """Parse JSON request body"""
        try:
            return json.loads(self.request.body.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {str(e)}")

    def write_json(self, data):
        """Write JSON response"""
        self.set_header('Content-Type', 'application/json')
        self.finish(json.dumps(data))

    def write_error_json(self, status_code, message):
        """Write error response"""
        self.set_status(status_code)
        self.write_json({
            'error': message,
            'status': status_code
        })

    def _get_installed_packages(self) -> list:
        """현재 환경의 설치된 패키지 목록 반환 (캐싱)"""
        if BaseAgentHandler._installed_packages_cache is not None:
            return BaseAgentHandler._installed_packages_cache

        try:
            from importlib.metadata import distributions
            packages = [dist.name for dist in distributions()]
            BaseAgentHandler._installed_packages_cache = packages
            self.log.info(f"Loaded {len(packages)} installed packages")
            return packages
        except Exception as e:
            self.log.warning(f"Failed to get installed packages: {e}")
            return []

    def parse_llm_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출 - 잘린 응답도 복구 시도"""
        # 1. 완전한 JSON 코드 블록 시도 (```json ... ```)
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
        if json_match:
            json_str = json_match.group(1).strip()
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                # 파싱 실패 시 복구 시도
                recovered = self._recover_incomplete_json(json_str)
                if recovered:
                    return recovered

        # 2. 닫히지 않은 JSON 코드 블록 시도 (```json ... EOF)
        unclosed_match = re.search(r'```json\s*([\s\S]+)$', response)
        if unclosed_match and not json_match:
            json_str = unclosed_match.group(1).strip()
            recovered = self._recover_incomplete_json(json_str)
            if recovered:
                return recovered

        # 3. 전체 응답이 JSON인지 시도
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 4. 응답에서 첫 번째 { 부터 추출 시도
        first_brace = response.find('{')
        if first_brace >= 0:
            json_str = response[first_brace:]

            # 완전한 JSON인지 먼저 시도
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

            # 복구 시도
            recovered = self._recover_incomplete_json(json_str)
            if recovered:
                return recovered

        # 5. LLM이 { 없이 "key": 로 시작한 경우 보완 시도
        # 예: '\n  "analysis": {...}' → '{"analysis": {...}}'
        stripped = response.strip()
        if stripped.startswith('"') and ':' in stripped:
            # 중괄호가 있는지 확인
            if '{' in stripped:
                # "analysis": {...} 형태를 {analysis": {...}} 로 감싸기 시도
                wrapped = '{' + stripped
                # 마지막에 } 가 없으면 추가
                if not wrapped.rstrip().endswith('}'):
                    wrapped = wrapped.rstrip() + '}'
                try:
                    return json.loads(wrapped)
                except json.JSONDecodeError:
                    # 복구 시도
                    recovered = self._recover_incomplete_json(wrapped)
                    if recovered:
                        return recovered

        return None

    def _recover_incomplete_json(self, json_str: str) -> dict:
        """불완전한 JSON 복구 시도 - brace 카운팅으로 마지막 유효 위치 찾기"""
        # 문자열 내부의 중괄호는 무시해야 함
        brace_count = 0
        last_valid_pos = -1
        in_string = False
        escape_next = False

        for i, char in enumerate(json_str):
            if escape_next:
                escape_next = False
                continue

            if char == '\\' and in_string:
                escape_next = True
                continue

            if char == '"' and not escape_next:
                in_string = not in_string
                continue

            if not in_string:
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        last_valid_pos = i

        if last_valid_pos > 0:
            truncated_json = json_str[:last_valid_pos + 1]
            try:
                return json.loads(truncated_json)
            except json.JSONDecodeError:
                pass

        return None

    def _sanitize_code(self, code: str) -> str:
        """
        LLM이 반환한 코드에서 markdown 코드 블록 wrapper 제거
        예: "```python\\nprint('hello')\\n```" -> "print('hello')"
        """
        if not code or not isinstance(code, str):
            return code

        # 1. ```python ... ``` 형태 제거
        code_match = re.search(r'```python\s*([\s\S]*?)\s*```', code)
        if code_match:
            return code_match.group(1).strip()

        # 2. ``` ... ``` 형태 제거
        code_match = re.search(r'```\s*([\s\S]*?)\s*```', code)
        if code_match:
            return code_match.group(1).strip()

        # 3. wrapper 없으면 원본 반환
        return code

    def _sanitize_tool_calls(self, data: dict) -> dict:
        """
        LLM 응답 JSON에서 toolCalls의 code 필드에 있는 markdown wrapper 제거

        처리 대상:
        - plan['steps'][i]['toolCalls'][j]['parameters']['code']
        - toolCalls[i]['parameters']['code']
        """
        if not data:
            return data

        # Case 1: plan 구조 (AutoAgentPlanHandler, AutoAgentReplanHandler)
        if 'plan' in data and isinstance(data['plan'], dict):
            steps = data['plan'].get('steps', [])
            for step in steps:
                if isinstance(step, dict):
                    tool_calls = step.get('toolCalls', [])
                    for tc in tool_calls:
                        if isinstance(tc, dict) and tc.get('tool') == 'jupyter_cell':
                            params = tc.get('parameters', {})
                            if 'code' in params:
                                params['code'] = self._sanitize_code(params['code'])

        # Case 2: 직접 toolCalls (AutoAgentRefineHandler)
        if 'toolCalls' in data and isinstance(data['toolCalls'], list):
            for tc in data['toolCalls']:
                if isinstance(tc, dict) and tc.get('tool') == 'jupyter_cell':
                    params = tc.get('parameters', {})
                    if 'code' in params:
                        params['code'] = self._sanitize_code(params['code'])

        return data
