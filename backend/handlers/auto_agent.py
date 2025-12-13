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
    format_replan_prompt,
)
from ..services.code_validator import CodeValidator, get_api_pattern_checker
from ..services.reflection_engine import ReflectionEngine
from ..knowledge.loader import get_knowledge_base, get_library_detector
from ..services.error_classifier import get_error_classifier, ReplanDecision
from ..services.summary_generator import get_summary_generator
from ..services.state_verifier import get_state_verifier

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

            imported_libraries = notebook_context.get('importedLibraries', [])

            # Step 1: 결정론적 라이브러리 감지 (LLM 호출 없음)
            detected_libraries = self._detect_required_libraries(
                request, imported_libraries
            )
            print(f"[AutoAgent] Detected libraries: {detected_libraries}", flush=True)

            # 프롬프트 생성 (감지된 라이브러리 knowledge 포함)
            prompt = format_plan_prompt(
                request=request,
                cell_count=notebook_context.get('cellCount', 0),
                imported_libraries=imported_libraries,
                defined_variables=notebook_context.get('definedVariables', []),
                recent_cells=notebook_context.get('recentCells', []),
                available_libraries=self._get_installed_packages(),
                detected_libraries=detected_libraries  # 새 파라미터
            )

            # Step 2: Plan 생성 LLM 호출
            print("[AutoAgent] Calling LLM for plan generation...", flush=True)
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

            # markdown 코드 블록 제거
            print("[AutoAgent] Sanitizing code in toolCalls...", flush=True)
            plan_data = self._sanitize_tool_calls(plan_data)

            print(f"[AutoAgent] Success! Steps: {plan_data['plan'].get('totalSteps', 'N/A')}", flush=True)
            # DEBUG: 전체 plan 구조 출력
            import json
            print("[AutoAgent] DEBUG Full plan structure:", flush=True)
            print(json.dumps(plan_data['plan'], indent=2, ensure_ascii=False), flush=True)

            # 각 step의 toolCalls 검증
            for step in plan_data['plan'].get('steps', []):
                print(f"[AutoAgent] DEBUG Step {step.get('stepNumber')}: {step.get('description', 'N/A')[:50]}", flush=True)
                for tc in step.get('toolCalls', []):
                    tool = tc.get('tool')
                    params = tc.get('parameters', {})
                    code = params.get('code', '')
                    print(f"[AutoAgent] DEBUG   Tool: {tool}, code length: {len(code) if code else 0}", flush=True)
                    if tool == 'jupyter_cell' and not code:
                        print(f"[AutoAgent] WARNING: jupyter_cell tool has empty code!", flush=True)

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

    def _detect_required_libraries(
        self, request: str, imported_libraries: list
    ) -> list:
        """
        결정론적 라이브러리 감지 (LLM 호출 없음)
        키워드 매칭 + 정규식으로 필요한 라이브러리 판단
        토큰 절약: ~600-800 토큰/세션
        """
        knowledge_base = get_knowledge_base()
        library_detector = get_library_detector()

        # 사용 가능한 라이브러리 가이드가 없으면 빈 리스트 반환
        available = knowledge_base.list_available_libraries()
        if not available:
            print("[AutoAgent] No library guides available", flush=True)
            return []

        # 결정론적 감지 (LLM 호출 없음)
        print("[AutoAgent] Using deterministic library detection...", flush=True)
        detected = library_detector.detect(
            request=request,
            available_libraries=available,
            imported_libraries=imported_libraries
        )

        if detected:
            print(f"[AutoAgent] Detected libraries: {detected}", flush=True)
        else:
            print("[AutoAgent] No libraries detected", flush=True)

        return detected

    def _parse_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출 - 부모 클래스의 공통 메서드 사용"""
        print(f"[AutoAgent] Parsing response, total length: {len(response)}", flush=True)
        result = self.parse_llm_json_response(response)
        if result:
            print(f"[AutoAgent] JSON parse SUCCESS", flush=True)
        else:
            print("[AutoAgent] All JSON parsing attempts failed", flush=True)
        return result


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
                available_libraries=self._get_installed_packages(),
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

            # markdown 코드 블록 제거
            refine_data = self._sanitize_tool_calls(refine_data)

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
        """LLM 응답에서 JSON 추출 - 부모 클래스의 공통 메서드 사용"""
        return self.parse_llm_json_response(response)

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
                recent_cells=notebook_context.get('recentCells', []),
                available_libraries=self._get_installed_packages()
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
                # markdown 코드 블록 제거
                plan_data = self._sanitize_tool_calls(plan_data)

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
        return self.parse_llm_json_response(response)


class AutoAgentReplanHandler(BaseAgentHandler):
    """
    Adaptive Replanning 핸들러 - 에러 발생 시 계획 재수립

    하이브리드 접근 (토큰 절약):
    - INSERT_STEPS (ModuleNotFoundError): Python이 완전 처리 (LLM 호출 없음)
    - REFINE (기타 에러): Python이 결정 확정, LLM이 코드 수정
    """

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/replan"""
        try:
            print("=== [AutoAgent] Replan Request Received ===", flush=True)
            body = self.get_json_body()

            original_request = body.get('originalRequest', '')
            executed_steps = body.get('executedSteps', [])
            failed_step = body.get('failedStep', {})
            error_info = body.get('error', {})
            execution_output = body.get('executionOutput', '')

            print(f"[AutoAgent] Original request: {original_request[:50]}...", flush=True)
            print(f"[AutoAgent] Executed steps: {len(executed_steps)}", flush=True)
            print(f"[AutoAgent] Failed step: {failed_step.get('stepNumber', '?')}", flush=True)
            print(f"[AutoAgent] Error: {error_info.get('message', 'Unknown')[:100]}", flush=True)

            if not failed_step or not error_info:
                return self.write_error_json(400, 'failedStep and error are required')

            # Step 1: 결정론적 에러 분류 (토큰 절약)
            error_classifier = get_error_classifier()
            traceback_data = error_info.get('traceback', [])
            traceback_str = '\n'.join(traceback_data) if isinstance(traceback_data, list) else str(traceback_data)

            analysis = error_classifier.classify(
                error_type=error_info.get('errorName', error_info.get('type', 'RuntimeError')),
                error_message=error_info.get('message', ''),
                traceback=traceback_str,
                installed_packages=self._get_installed_packages()
            )

            print(f"[AutoAgent] Error classified: decision={analysis.decision.value}", flush=True)

            # Step 2: INSERT_STEPS는 Python이 완전 처리 (LLM 호출 없음!)
            if analysis.decision == ReplanDecision.INSERT_STEPS:
                print("[AutoAgent] INSERT_STEPS: Python handles completely (no LLM call)", flush=True)
                result = analysis.to_dict()
                self.write_json(result)
                return

            # Step 3: REFINE 등 다른 결정은 LLM이 코드 수정
            # 단, decision은 이미 확정되어 있으므로 LLM은 코드만 생성
            print("[AutoAgent] Calling LLM for code refinement...", flush=True)
            prompt = format_replan_prompt(
                original_request=original_request,
                executed_steps=executed_steps,
                failed_step=failed_step,
                error_info=error_info,
                execution_output=execution_output,
                available_libraries=self._get_installed_packages()
            )

            try:
                response = await self._call_llm(prompt)
                print(f"[AutoAgent] LLM replan response length: {len(response)}", flush=True)
            except Exception as llm_error:
                print(f"[AutoAgent] LLM replan call failed: {llm_error}", flush=True)
                raise

            # JSON 파싱
            replan_data = self._parse_json_response(response)

            if not replan_data:
                error_msg = f"Replan JSON 파싱 실패. Response preview: {response[:200]}"
                print(f"[AutoAgent] {error_msg}", flush=True)
                return self.write_error_json(500, error_msg)

            # markdown 코드 블록 제거
            replan_data = self._sanitize_tool_calls(replan_data)

            # LLM 결과에서 decision 강제 오버라이드 (Python 분류 결과 우선)
            # ModuleNotFoundError인데 LLM이 replace_step을 반환하는 경우 방지
            llm_decision = replan_data.get('decision')
            if llm_decision != analysis.decision.value:
                print(f"[AutoAgent] Decision override: LLM={llm_decision} -> Python={analysis.decision.value}", flush=True)
                replan_data['decision'] = analysis.decision.value
                replan_data['reasoning'] = f"[Python 분류] {analysis.reasoning}"

            decision = replan_data.get('decision')
            if decision not in ['refine', 'insert_steps', 'replace_step', 'replan_remaining']:
                print(f"[AutoAgent] Invalid decision: {decision}", flush=True)
                return self.write_error_json(500, f"Invalid decision: {decision}")

            print(f"[AutoAgent] Replan success! Decision: {decision}", flush=True)
            self.write_json({
                'analysis': replan_data.get('analysis', {}),
                'decision': decision,
                'reasoning': replan_data.get('reasoning', ''),
                'changes': replan_data.get('changes', {})
            })

        except Exception as e:
            print(f"[AutoAgent] Replan Exception: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            self.write_error_json(500, str(e))

    async def _call_llm(self, prompt: str) -> str:
        """LLM 호출"""
        from ..llm_service import call_llm
        config = self.config_manager.get_config()
        return await call_llm(prompt, config)

    def _parse_json_response(self, response: str) -> dict:
        """LLM 응답에서 JSON 추출 - 부모 클래스의 공통 메서드 사용"""
        return self.parse_llm_json_response(response)


class AutoAgentValidateHandler(BaseAgentHandler):
    """코드 검증 핸들러 - 실행 전 코드 품질 검사 (Pyflakes/AST 기반)"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/validate"""
        try:
            logger.info("=== Auto-Agent Validate Request ===")
            body = self.get_json_body()

            code = body.get('code', '')
            notebook_context = body.get('notebookContext', {})

            if not code:
                return self.write_error_json(400, 'code is required')

            logger.info(f"Validating code (length: {len(code)})")

            # CodeValidator 인스턴스 생성 (노트북 컨텍스트 포함)
            validator = CodeValidator(notebook_context)

            # 전체 검증 수행
            result = validator.full_validation(code)

            # API 패턴 검증 추가 (라이브러리별 안티패턴 검사)
            api_checker = get_api_pattern_checker()
            detected_libraries = notebook_context.get('importedLibraries', [])
            api_issues = api_checker.check(code, detected_libraries)

            # API 이슈를 결과에 추가
            all_issues = [issue.to_dict() for issue in result.issues]
            api_issue_count = 0
            for api_issue in api_issues:
                all_issues.append(api_issue.to_dict())
                api_issue_count += 1
                if api_issue.severity == 'error':
                    result.has_errors = True
                elif api_issue.severity == 'warning':
                    result.has_warnings = True

            if api_issue_count > 0:
                logger.info(f"API pattern check found {api_issue_count} issues")

            logger.info(f"Validation result: valid={result.is_valid}, "
                       f"errors={result.has_errors}, warnings={result.has_warnings}")

            self.write_json({
                'valid': result.is_valid and not any(i.severity == 'error' for i in api_issues),
                'issues': all_issues,
                'dependencies': result.dependencies.to_dict() if result.dependencies else None,
                'hasErrors': result.has_errors,
                'hasWarnings': result.has_warnings,
                'summary': result.summary
            })

        except Exception as e:
            logger.error(f"Auto-Agent validate error: {str(e)}", exc_info=True)
            self.write_error_json(500, str(e))


class AutoAgentReflectHandler(BaseAgentHandler):
    """Reflection 핸들러 - 실행 결과 분석 및 적응적 조정"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/reflect"""
        try:
            logger.info("=== Auto-Agent Reflect Request ===")
            body = self.get_json_body()

            step_number = body.get('stepNumber', 0)
            step_description = body.get('stepDescription', '')
            executed_code = body.get('executedCode', '')
            execution_status = body.get('executionStatus', 'ok')
            execution_output = body.get('executionOutput', '')
            error_message = body.get('errorMessage')
            expected_outcome = body.get('expectedOutcome')
            validation_criteria = body.get('validationCriteria', [])
            remaining_steps = body.get('remainingSteps', [])

            logger.info(f"Reflecting on step {step_number}: {step_description[:50]}...")

            # ReflectionEngine 인스턴스 생성
            engine = ReflectionEngine()

            # Reflection 수행
            result = engine.reflect(
                step_number=step_number,
                step_description=step_description,
                executed_code=executed_code,
                execution_status=execution_status,
                execution_output=execution_output,
                error_message=error_message,
                expected_outcome=expected_outcome,
                validation_criteria=validation_criteria,
                remaining_steps=remaining_steps
            )

            logger.info(f"Reflection result: checkpoint_passed={result.evaluation.checkpoint_passed}, "
                       f"action={result.recommendations.action.value}")

            self.write_json({
                'reflection': result.to_dict()
            })

        except Exception as e:
            logger.error(f"Auto-Agent reflect error: {str(e)}", exc_info=True)
            self.write_error_json(500, str(e))


class AutoAgentVerifyStateHandler(BaseAgentHandler):
    """
    상태 검증 핸들러 (Phase 1: 상태 검증 레이어)
    각 단계 실행 후 예상 상태와 실제 상태 비교, 신뢰도 계산
    """

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/auto-agent/verify-state"""
        try:
            logger.info("=== Auto-Agent Verify State Request ===")
            body = self.get_json_body()

            step_number = body.get('stepNumber', 0)
            executed_code = body.get('executedCode', '')
            execution_output = body.get('executionOutput', '')
            execution_status = body.get('executionStatus', 'ok')
            error_message = body.get('errorMessage')
            expected_variables = body.get('expectedVariables', [])
            expected_output_patterns = body.get('expectedOutputPatterns', [])
            previous_variables = body.get('previousVariables', [])
            current_variables = body.get('currentVariables', [])

            logger.info(f"Verifying state for step {step_number}, status={execution_status}")

            # StateVerifier로 검증 수행
            verifier = get_state_verifier()
            result = verifier.verify(
                step_number=step_number,
                executed_code=executed_code,
                execution_output=execution_output,
                execution_status=execution_status,
                error_message=error_message,
                expected_variables=expected_variables if expected_variables else None,
                expected_output_patterns=expected_output_patterns if expected_output_patterns else None,
                previous_variables=previous_variables,
                current_variables=current_variables,
            )

            logger.info(f"Verification result: is_valid={result.is_valid}, "
                       f"confidence={result.confidence:.2f}, "
                       f"recommendation={result.recommendation.value}")

            self.write_json({
                'verification': result.to_dict()
            })

        except Exception as e:
            logger.error(f"Auto-Agent verify-state error: {str(e)}", exc_info=True)
            self.write_error_json(500, str(e))
