"""
Auto-Agent Handlers
Plan-and-Execute 패턴 기반 자동 실행 API 핸들러
"""

import json
import logging
import re
from tornado import web

from .base import BaseAgentHandler
from ..prompts.auto_agent_prompts import (
    format_plan_prompt,
    format_refine_prompt,
    format_final_answer_prompt,
)

logger = logging.getLogger(__name__)


class AutoAgentPlanHandler(BaseAgentHandler):
    """실행 계획 생성 핸들러"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/plan"""
        try:
            print("=== [AutoAgent] Plan Request Received ===", flush=True)
            body = self.get_json_body()
            request = body.get('request', '')
            notebook_context = body.get('notebookContext', {})
            print(f"[AutoAgent] Request: {request[:100]}...", flush=True)

            if not request:
                return self.write_error_json(400, 'request is required')

            # 프롬프트 생성
            prompt = format_plan_prompt(
                request=request,
                cell_count=notebook_context.get('cellCount', 0),
                imported_libraries=notebook_context.get('importedLibraries', []),
                defined_variables=notebook_context.get('definedVariables', []),
                recent_cells=notebook_context.get('recentCells', [])
            )

            # LLM 호출
            print("[AutoAgent] Calling LLM...", flush=True)
            try:
                response = await self._call_llm(prompt)
                print(f"[AutoAgent] LLM response length: {len(response)}", flush=True)
                print(f"[AutoAgent] LLM response preview: {response[:300]}...", flush=True)
            except Exception as llm_error:
                print(f"[AutoAgent] LLM call failed: {llm_error}", flush=True)
                raise

            # JSON 파싱
            print("[AutoAgent] Parsing JSON...", flush=True)
            plan_data = self._parse_json_response(response)
            print(f"[AutoAgent] Parse result: {plan_data is not None}, keys: {list(plan_data.keys()) if plan_data else 'None'}", flush=True)

            if not plan_data or 'plan' not in plan_data:
                error_msg = f"JSON 파싱 실패. Response preview: {response[:200]}"
                print(f"[AutoAgent] {error_msg}", flush=True)
                return self.write_error_json(500, error_msg)

            print(f"[AutoAgent] Success! Steps: {plan_data['plan'].get('totalSteps', 'N/A')}", flush=True)
            self.write_json({
                'plan': plan_data['plan'],
                'reasoning': plan_data.get('reasoning', '')
            })

        except Exception as e:
            print(f"[AutoAgent] Exception: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            self.write_error_json(500, str(e))

    async def _call_llm(self, prompt: str) -> str:
        """LLM 호출"""
        from ..llm_service import call_llm
        config = self.config_manager.get_config()
        return await call_llm(prompt, config)

    def _parse_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출"""
        # JSON 블록 추출 시도
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # 전체 응답이 JSON인지 시도
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # { } 사이 추출 시도
        brace_match = re.search(r'\{[\s\S]*\}', response)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        return None


class AutoAgentRefineHandler(BaseAgentHandler):
    """에러 기반 코드 수정 핸들러 (Self-Healing)"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/refine"""
        try:
            logger.info("=== Auto-Agent Refine Request ===")
            body = self.get_json_body()
            logger.info(f"Refine body keys: {body.keys()}")
            step = body.get('step', {})
            error = body.get('error', {})
            attempt = body.get('attempt', 1)
            previous_code = body.get('previousCode', '')
            logger.info(f"Error: {error}")

            if not error:
                return self.write_error_json(400, 'error is required')

            # 이전 코드가 없으면 step에서 추출
            if not previous_code and step.get('toolCalls'):
                for tc in step['toolCalls']:
                    if tc.get('tool') == 'jupyter_cell':
                        previous_code = tc.get('parameters', {}).get('code', '')
                        break

            # traceback 처리
            traceback_data = error.get('traceback', [])
            if isinstance(traceback_data, list):
                traceback_str = '\n'.join(traceback_data)
            else:
                traceback_str = str(traceback_data) if traceback_data else ''

            logger.info(f"Traceback type: {type(traceback_data)}, content: {traceback_str[:200]}")

            # 프롬프트 생성
            prompt = format_refine_prompt(
                original_code=previous_code,
                error_type=error.get('type', 'runtime'),
                error_message=error.get('message', 'Unknown error'),
                traceback=traceback_str,
                attempt=attempt,
                max_attempts=3,
                available_libraries=[],
                defined_variables=[]
            )

            logger.info(f"Auto-Agent refine request: attempt {attempt}")

            # LLM 호출
            logger.info("Calling LLM for refine...")
            try:
                response = await self._call_llm(prompt)
                logger.info(f"LLM refine response length: {len(response)}")
            except Exception as e:
                logger.error(f"LLM refine call failed: {e}", exc_info=True)
                raise

            # JSON 파싱
            refine_data = self._parse_json_response(response)

            if not refine_data or 'toolCalls' not in refine_data:
                # 응답이 순수 코드인 경우 처리
                code = self._extract_code(response)
                if code:
                    refine_data = {
                        'toolCalls': [{
                            'tool': 'jupyter_cell',
                            'parameters': {'code': code}
                        }],
                        'reasoning': ''
                    }
                else:
                    return self.write_error_json(500, 'Failed to generate refined code')

            self.write_json({
                'toolCalls': refine_data['toolCalls'],
                'reasoning': refine_data.get('reasoning', '')
            })

        except Exception as e:
            logger.error(f"Auto-Agent refine error: {str(e)}", exc_info=True)
            self.write_error_json(500, str(e))

    async def _call_llm(self, prompt: str) -> str:
        """LLM 호출"""
        from ..llm_service import call_llm
        config = self.config_manager.get_config()
        return await call_llm(prompt, config)

    def _parse_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출"""
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        brace_match = re.search(r'\{[\s\S]*\}', response)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    def _extract_code(self, response: str) -> str:
        """응답에서 Python 코드 추출"""
        # python 코드 블록 추출
        code_match = re.search(r'```python\s*([\s\S]*?)\s*```', response)
        if code_match:
            return code_match.group(1).strip()

        # 일반 코드 블록 추출
        code_match = re.search(r'```\s*([\s\S]*?)\s*```', response)
        if code_match:
            return code_match.group(1).strip()

        return None


class AutoAgentPlanStreamHandler(BaseAgentHandler):
    """실행 계획 생성 스트리밍 핸들러"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/plan/stream"""
        self.set_header('Content-Type', 'text/event-stream')
        self.set_header('Cache-Control', 'no-cache')
        self.set_header('Connection', 'keep-alive')

        try:
            body = self.get_json_body()
            request = body.get('request', '')
            notebook_context = body.get('notebookContext', {})

            if not request:
                await self._write_sse({'error': 'request is required'})
                return

            # 프롬프트 생성
            prompt = format_plan_prompt(
                request=request,
                cell_count=notebook_context.get('cellCount', 0),
                imported_libraries=notebook_context.get('importedLibraries', []),
                defined_variables=notebook_context.get('definedVariables', []),
                recent_cells=notebook_context.get('recentCells', [])
            )

            # 진행 상태 전송
            await self._write_sse({
                'phase': 'planning',
                'message': '실행 계획 생성 중...'
            })

            # LLM 호출 (스트리밍)
            full_response = ''
            async for chunk in self._call_llm_stream(prompt):
                full_response += chunk
                await self._write_sse({'reasoning': chunk})

            # JSON 파싱
            plan_data = self._parse_json_response(full_response)

            if plan_data and 'plan' in plan_data:
                await self._write_sse({
                    'plan': plan_data['plan'],
                    'done': True
                })
            else:
                await self._write_sse({
                    'error': 'Failed to generate valid plan',
                    'done': True
                })

        except Exception as e:
            logger.error(f"Auto-Agent plan stream error: {str(e)}", exc_info=True)
            await self._write_sse({'error': str(e), 'done': True})

        finally:
            self.finish()

    async def _write_sse(self, data: dict):
        """SSE 메시지 전송"""
        self.write(f"data: {json.dumps(data)}\n\n")
        await self.flush()

    async def _call_llm_stream(self, prompt: str):
        """LLM 스트리밍 호출"""
        from ..llm_service import call_llm_stream
        config = self.config_manager.get_config()
        async for chunk in call_llm_stream(prompt, config):
            yield chunk

    def _parse_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출"""
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        brace_match = re.search(r'\{[\s\S]*\}', response)
        if brace_match:
            try:
                return json.loads(brace_match.group(0))
            except json.JSONDecodeError:
                pass

        return None
