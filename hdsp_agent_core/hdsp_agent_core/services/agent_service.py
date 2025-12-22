"""
Agent Service Implementations

Embedded and Proxy implementations of IAgentService.
"""

import json
import logging
import re
import subprocess
from typing import Any, Dict, List, Optional

import httpx

from hdsp_agent_core.interfaces import IAgentService
from hdsp_agent_core.llm import LLMService
from hdsp_agent_core.managers import get_config_manager
from hdsp_agent_core.models.agent import (
    PlanRequest,
    PlanResponse,
    RefineRequest,
    RefineResponse,
    ReplanRequest,
    ReplanResponse,
)
from hdsp_agent_core.prompts import format_plan_prompt, format_refine_prompt

logger = logging.getLogger(__name__)


class EmbeddedAgentService(IAgentService):
    """
    Embedded implementation of Agent Service.

    Executes agent logic directly in-process without HTTP calls.
    Used in development mode (HDSP_AGENT_MODE=embedded).
    """

    def __init__(self):
        """Initialize embedded agent service"""
        self._config_manager = get_config_manager()
        logger.info("EmbeddedAgentService initialized")

    def _get_config(self) -> Dict[str, Any]:
        """Get current LLM configuration"""
        return self._config_manager.get_config()

    def _build_llm_config(self, llm_config) -> Dict[str, Any]:
        """Build LLM config dict from client-provided config"""
        if llm_config is None:
            return self._get_config()

        config = {"provider": llm_config.provider}

        if llm_config.gemini:
            config["gemini"] = {
                "apiKey": llm_config.gemini.apiKey,
                "model": llm_config.gemini.model,
            }

        if llm_config.openai:
            config["openai"] = {
                "apiKey": llm_config.openai.apiKey,
                "model": llm_config.openai.model,
            }

        if llm_config.vllm:
            config["vllm"] = {
                "endpoint": llm_config.vllm.endpoint,
                "apiKey": llm_config.vllm.apiKey,
                "model": llm_config.vllm.model,
            }

        return config

    async def _call_llm(self, prompt: str, llm_config=None) -> str:
        """Call LLM with prompt"""
        config = self._build_llm_config(llm_config)
        llm_service = LLMService(config)
        return await llm_service.generate_response(prompt)

    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """Extract JSON from LLM response"""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        json_patterns = [
            r"```json\s*([\s\S]*?)\s*```",
            r"```\s*([\s\S]*?)\s*```",
            r"\{[\s\S]*\}",
        ]

        for pattern in json_patterns:
            matches = re.findall(pattern, response)
            for match in matches:
                try:
                    return json.loads(match)
                except json.JSONDecodeError:
                    continue

        return {}

    def _sanitize_tool_calls(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Remove markdown code blocks from tool call code parameters"""

        def clean_code(code: str) -> str:
            if not code:
                return code
            code = re.sub(r"^```(?:python)?\s*\n?", "", code)
            code = re.sub(r"\n?```\s*$", "", code)
            return code.strip()

        if "plan" in data and "steps" in data["plan"]:
            for step in data["plan"]["steps"]:
                for tc in step.get("toolCalls", []):
                    if tc.get("tool") == "jupyter_cell":
                        params = tc.get("parameters", {})
                        if "code" in params:
                            params["code"] = clean_code(params["code"])

        if "toolCalls" in data:
            for tc in data["toolCalls"]:
                if tc.get("tool") == "jupyter_cell":
                    params = tc.get("parameters", {})
                    if "code" in params:
                        params["code"] = clean_code(params["code"])

        return data

    def _detect_required_libraries(
        self, request: str, imported_libraries: List[str]
    ) -> List[str]:
        """Deterministic library detection"""
        from hdsp_agent_core.knowledge import get_knowledge_base, get_library_detector

        knowledge_base = get_knowledge_base()
        library_detector = get_library_detector()

        available = knowledge_base.list_available_libraries()
        if not available:
            return []

        return library_detector.detect(
            request=request,
            available_libraries=available,
            imported_libraries=imported_libraries,
        )

    def _get_installed_packages(self) -> List[str]:
        """Get list of installed Python packages"""
        try:
            result = subprocess.run(
                ["pip", "list", "--format=freeze"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            packages = []
            for line in result.stdout.strip().split("\n"):
                if "==" in line:
                    packages.append(line.split("==")[0].lower())
            return packages[:100]
        except Exception:
            return []

    async def generate_plan(self, request: PlanRequest) -> PlanResponse:
        """Generate an execution plan"""
        logger.info(f"[Embedded] Generate plan: {request.request[:100]}...")

        imported_libs = request.notebookContext.importedLibraries
        detected_libraries = self._detect_required_libraries(
            request.request, imported_libs
        )
        logger.info(f"Detected libraries: {detected_libraries}")

        # Get RAG context if available
        rag_context = None
        try:
            from hdsp_agent_core.factory import get_service_factory
            rag_service = get_service_factory().get_rag_service()
            if rag_service.is_ready():
                rag_context = await rag_service.get_context_for_query(
                    query=request.request,
                    detected_libraries=detected_libraries
                )
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")

        # Build prompt
        prompt = format_plan_prompt(
            request=request.request,
            cell_count=request.notebookContext.cellCount,
            imported_libraries=imported_libs,
            defined_variables=request.notebookContext.definedVariables,
            recent_cells=request.notebookContext.recentCells,
            available_libraries=self._get_installed_packages(),
            detected_libraries=detected_libraries,
            rag_context=rag_context,
        )

        # Call LLM
        response = await self._call_llm(prompt, request.llmConfig)
        logger.info(f"LLM response length: {len(response)}")

        # Parse response
        plan_data = self._parse_json_response(response)

        if not plan_data or "plan" not in plan_data:
            raise ValueError(f"Failed to parse plan from LLM response: {response[:200]}")

        # Sanitize and ensure goal
        plan_data = self._sanitize_tool_calls(plan_data)
        if "goal" not in plan_data["plan"]:
            plan_data["plan"]["goal"] = request.request

        return PlanResponse(
            plan=plan_data["plan"],
            reasoning=plan_data.get("reasoning", ""),
        )

    async def refine_code(self, request: RefineRequest) -> RefineResponse:
        """Refine code after an error"""
        logger.info(f"[Embedded] Refine code: attempt {request.attempt}")

        # Extract previous code
        previous_code = request.previousCode or ""
        if not previous_code and request.step.get("toolCalls"):
            for tc in request.step["toolCalls"]:
                if tc.get("tool") == "jupyter_cell":
                    previous_code = tc.get("parameters", {}).get("code", "")
                    break

        # Process traceback
        traceback_data = request.error.traceback or []
        traceback_str = (
            "\n".join(traceback_data)
            if isinstance(traceback_data, list)
            else str(traceback_data)
        )

        # Build prompt
        prompt = format_refine_prompt(
            original_code=previous_code,
            error_type=request.error.type,
            error_message=request.error.message,
            traceback=traceback_str,
            attempt=request.attempt,
            max_attempts=3,
            available_libraries=self._get_installed_packages(),
            defined_variables=[],
        )

        # Call LLM
        response = await self._call_llm(prompt, request.llmConfig)

        # Parse response
        refine_data = self._parse_json_response(response)

        if not refine_data or "toolCalls" not in refine_data:
            # Try extracting code directly
            code_match = re.search(r"```(?:python)?\s*([\s\S]*?)\s*```", response)
            if code_match:
                refine_data = {
                    "toolCalls": [
                        {
                            "tool": "jupyter_cell",
                            "parameters": {"code": code_match.group(1).strip()},
                        }
                    ],
                    "reasoning": "",
                }
            else:
                raise ValueError("Failed to generate refined code")

        refine_data = self._sanitize_tool_calls(refine_data)

        return RefineResponse(
            toolCalls=refine_data["toolCalls"],
            reasoning=refine_data.get("reasoning", ""),
        )

    async def replan(self, request: ReplanRequest) -> ReplanResponse:
        """Determine how to handle a failed step"""
        logger.info(
            f"[Embedded] Replan for step {request.currentStepIndex} "
            f"(attempts: {request.previousAttempts})"
        )

        # Use error classifier for deterministic classification
        try:
            from hdsp_agent_core.managers.error_classifier import get_error_classifier
            classifier = get_error_classifier()
        except ImportError:
            # Fallback if error_classifier not yet migrated
            logger.warning("Error classifier not available, using simple heuristic")
            return ReplanResponse(
                decision="refine",
                analysis={
                    "root_cause": "Error occurred",
                    "is_approach_problem": False,
                    "missing_prerequisites": [],
                },
                reasoning="Error classifier not available",
                changes={},
                usedLlm=False,
                confidence=0.5,
            )

        traceback_data = request.error.traceback or []
        traceback_str = (
            "\n".join(traceback_data)
            if isinstance(traceback_data, list)
            else str(traceback_data)
        )

        analysis = classifier.classify(
            error_type=request.error.type,
            error_message=request.error.message,
            traceback=traceback_str,
        )

        return ReplanResponse(
            decision=analysis.decision.value,
            analysis=analysis.to_dict()["analysis"],
            reasoning=analysis.reasoning,
            changes=analysis.changes,
            usedLlm=analysis.used_llm,
            confidence=analysis.confidence,
        )

    async def validate_code(
        self, code: str, notebook_context: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Validate code before execution"""
        logger.info(f"[Embedded] Validate code: {len(code)} chars")

        try:
            from hdsp_agent_core.managers.code_validator import CodeValidator

            notebook_ctx = notebook_context or {}
            validator = CodeValidator(notebook_context=notebook_ctx)
            result = validator.full_validation(code)

            return {
                "valid": result.is_valid,
                "issues": [issue.to_dict() for issue in result.issues],
                "dependencies": result.dependencies.to_dict() if result.dependencies else None,
                "hasErrors": result.has_errors,
                "hasWarnings": result.has_warnings,
                "summary": result.summary,
            }
        except ImportError:
            # Fallback if code_validator not yet migrated
            logger.warning("Code validator not available")
            return {
                "valid": True,
                "issues": [],
                "dependencies": None,
                "hasErrors": False,
                "hasWarnings": False,
                "summary": "Validation skipped (validator not available)",
            }


class ProxyAgentService(IAgentService):
    """
    Proxy implementation of Agent Service.

    Forwards requests to external agent server via HTTP.
    Used in production mode (HDSP_AGENT_MODE=proxy).
    """

    def __init__(self, base_url: str, timeout: float = 120.0):
        """Initialize proxy agent service"""
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        logger.info(f"ProxyAgentService initialized (server: {self._base_url})")

    async def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to agent server"""
        url = f"{self._base_url}{path}"

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            if method == "POST":
                response = await client.post(url, json=data)
            elif method == "GET":
                response = await client.get(url)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response.raise_for_status()
            return response.json()

    async def generate_plan(self, request: PlanRequest) -> PlanResponse:
        """Generate plan via proxy"""
        logger.info(f"[Proxy] Generate plan: {request.request[:100]}...")

        data = request.model_dump(mode="json")
        result = await self._request("POST", "/agent/plan", data)

        return PlanResponse(**result)

    async def refine_code(self, request: RefineRequest) -> RefineResponse:
        """Refine code via proxy"""
        logger.info(f"[Proxy] Refine code: attempt {request.attempt}")

        data = request.model_dump(mode="json")
        result = await self._request("POST", "/agent/refine", data)

        return RefineResponse(**result)

    async def replan(self, request: ReplanRequest) -> ReplanResponse:
        """Replan via proxy"""
        logger.info(f"[Proxy] Replan for step {request.currentStepIndex}")

        data = request.model_dump(mode="json")
        result = await self._request("POST", "/agent/replan", data)

        return ReplanResponse(**result)

    async def validate_code(
        self, code: str, notebook_context: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Validate code via proxy"""
        logger.info(f"[Proxy] Validate code: {len(code)} chars")

        data = {
            "code": code,
            "notebookContext": notebook_context,
        }
        return await self._request("POST", "/agent/validate", data)
