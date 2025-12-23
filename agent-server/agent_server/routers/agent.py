"""
Agent Router - Core agent functionality endpoints

Handles plan generation, refinement, replanning, and state verification.
"""

import json
import logging
import re
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from hdsp_agent_core.knowledge.loader import get_knowledge_base, get_library_detector
from hdsp_agent_core.managers.config_manager import ConfigManager
from hdsp_agent_core.models.agent import (
    PlanRequest,
    PlanResponse,
    RefineRequest,
    RefineResponse,
    ReflectRequest,
    ReflectResponse,
    ReplanRequest,
    ReplanResponse,
    ReportExecutionRequest,
    ReportExecutionResponse,
    ValidateRequest,
    ValidateResponse,
    VerifyStateRequest,
    VerifyStateResponse,
)
from hdsp_agent_core.prompts.auto_agent_prompts import (
    format_plan_prompt,
    format_refine_prompt,
    format_reflection_prompt,
)

from agent_server.core.code_validator import CodeValidator
from agent_server.core.error_classifier import get_error_classifier
from agent_server.core.llm_service import LLMService
from agent_server.core.rag_manager import get_rag_manager
from agent_server.core.state_verifier import get_state_verifier

router = APIRouter()
logger = logging.getLogger(__name__)


# ============ Helper Functions ============


def _get_config() -> Dict[str, Any]:
    """Get current configuration (fallback only)"""
    return ConfigManager.get_instance().get_config()


def _build_llm_config(llm_config) -> Dict[str, Any]:
    """
    Build LLM config dict from client-provided LLMConfig.
    Falls back to server config if not provided.
    """
    if llm_config is None:
        # Fallback to server config (backward compatibility)
        return _get_config()

    # Build config from client-provided data
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


async def _call_llm(prompt: str, llm_config=None) -> str:
    """Call LLM with prompt using client-provided config"""
    config = _build_llm_config(llm_config)
    llm_service = LLMService(config)
    return await llm_service.generate_response(prompt)


def _parse_json_response(response: str) -> Dict[str, Any]:
    """Extract JSON from LLM response"""
    # Try direct JSON parsing first
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code blocks
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


def _sanitize_tool_calls(data: Dict[str, Any]) -> Dict[str, Any]:
    """Remove markdown code blocks from tool call code parameters"""

    def clean_code(code: str) -> str:
        if not code:
            return code
        # Remove ```python ... ``` wrapper
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
    request: str, imported_libraries: List[str]
) -> List[str]:
    """
    Deterministic library detection (no LLM call).
    Detects libraries needed based on keywords and patterns.
    """
    knowledge_base = get_knowledge_base()
    library_detector = get_library_detector()

    available = knowledge_base.list_available_libraries()
    if not available:
        return []

    detected = library_detector.detect(
        request=request,
        available_libraries=available,
        imported_libraries=imported_libraries,
    )

    return detected


def _get_installed_packages() -> List[str]:
    """Get list of installed Python packages"""
    import subprocess

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
        return packages[:100]  # Limit to prevent token explosion
    except Exception:
        return []


# ============ Endpoints ============


@router.post("/plan", response_model=PlanResponse)
async def generate_plan(request: PlanRequest) -> Dict[str, Any]:
    """
    Generate an execution plan from a natural language request.

    Takes a user request and notebook context, returns a structured plan
    with steps and tool calls.

    RAG context is automatically injected if available.
    """
    logger.info(f"Plan request received: {request.request[:100]}...")

    if not request.request:
        raise HTTPException(status_code=400, detail="request is required")

    try:
        # Deterministic library detection
        imported_libs = request.notebookContext.importedLibraries
        detected_libraries = _detect_required_libraries(request.request, imported_libs)
        logger.info(f"Detected libraries: {detected_libraries}")

        # Get RAG context if available (with library prioritization)
        rag_context = None
        try:
            rag_manager = get_rag_manager()
            if rag_manager.is_ready:
                # Pass detected_libraries to prioritize relevant API guides
                rag_context = await rag_manager.get_context_for_query(
                    query=request.request, detected_libraries=detected_libraries
                )
                if rag_context:
                    logger.info(
                        f"RAG context injected: {len(rag_context)} chars (libs: {detected_libraries})"
                    )
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")
            # Continue without RAG context

        # Build prompt
        prompt = format_plan_prompt(
            request=request.request,
            cell_count=request.notebookContext.cellCount,
            imported_libraries=imported_libs,
            defined_variables=request.notebookContext.definedVariables,
            recent_cells=request.notebookContext.recentCells,
            available_libraries=_get_installed_packages(),
            detected_libraries=detected_libraries,
            rag_context=rag_context,
        )

        # Call LLM with client-provided config
        response = await _call_llm(prompt, request.llmConfig)
        logger.info(f"LLM response length: {len(response)}")

        # Parse response
        plan_data = _parse_json_response(response)

        if not plan_data or "plan" not in plan_data:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse plan from LLM response: {response[:200]}",
            )

        # Sanitize code blocks
        plan_data = _sanitize_tool_calls(plan_data)

        # Ensure goal field exists (use user request if not provided by LLM)
        if "goal" not in plan_data["plan"]:
            plan_data["plan"]["goal"] = request.request

        return {
            "plan": plan_data["plan"],
            "reasoning": plan_data.get("reasoning", ""),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Plan generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refine", response_model=RefineResponse)
async def refine_code(request: RefineRequest) -> Dict[str, Any]:
    """
    Refine code after an execution error.

    Takes the failed step and error information, returns refined tool calls.
    """
    logger.info(f"Refine request: attempt {request.attempt}")

    if not request.error:
        raise HTTPException(status_code=400, detail="error is required")

    try:
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
            available_libraries=_get_installed_packages(),
            defined_variables=[],
        )

        # Call LLM with client-provided config
        response = await _call_llm(prompt, request.llmConfig)

        # Parse response
        refine_data = _parse_json_response(response)

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
                raise HTTPException(
                    status_code=500, detail="Failed to generate refined code"
                )

        # Sanitize code blocks
        refine_data = _sanitize_tool_calls(refine_data)

        return {
            "toolCalls": refine_data["toolCalls"],
            "reasoning": refine_data.get("reasoning", ""),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refine failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/replan", response_model=ReplanResponse)
async def replan(request: ReplanRequest) -> Dict[str, Any]:
    """
    Determine how to handle a failed step.

    Uses deterministic error classification first.
    LLM fallback is triggered when:
    1. Same error fails 2+ times (previousAttempts >= 2)
    2. Unknown error type not in pattern mapping
    3. Complex error (2+ exceptions in traceback)
    """
    logger.info(
        f"Replan request for step {request.currentStepIndex} "
        f"(attempts: {request.previousAttempts}, useLlmFallback: {request.useLlmFallback})"
    )

    try:
        classifier = get_error_classifier()

        traceback_data = request.error.traceback or []
        traceback_str = (
            "\n".join(traceback_data)
            if isinstance(traceback_data, list)
            else str(traceback_data)
        )

        # Check if LLM fallback should be used
        should_use_llm, fallback_reason = classifier.should_use_llm_fallback(
            error_type=request.error.type,
            traceback=traceback_str,
            previous_attempts=request.previousAttempts,
        )

        if should_use_llm and request.useLlmFallback:
            logger.info(f"LLM fallback triggered: {fallback_reason}")
            # For now, still use pattern matching but log the fallback trigger
            # TODO: Enable LLM fallback when LLM client is configured
            analysis = classifier.classify(
                error_type=request.error.type,
                error_message=request.error.message,
                traceback=traceback_str,
            )
            # Mark that LLM fallback was triggered but not used (no client)
            analysis.reasoning += f" (LLM fallback 조건 충족: {fallback_reason})"
        else:
            # Use deterministic error classification
            analysis = classifier.classify(
                error_type=request.error.type,
                error_message=request.error.message,
                traceback=traceback_str,
            )

        return {
            "decision": analysis.decision.value,
            "analysis": analysis.to_dict()["analysis"],
            "reasoning": analysis.reasoning,
            "changes": analysis.changes,
            "usedLlm": analysis.used_llm,
            "confidence": analysis.confidence,
        }

    except Exception as e:
        logger.error(f"Replan failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-state", response_model=VerifyStateResponse)
async def verify_state(request: VerifyStateRequest) -> Dict[str, Any]:
    """
    Verify execution state after a step completes.

    Checks if the actual output matches expected changes.
    """
    logger.info(f"Verify state for step {request.stepIndex}")

    try:
        verifier = get_state_verifier()

        result = verifier.verify(
            step_index=request.stepIndex,
            expected_changes=request.expectedChanges,
            actual_output=request.actualOutput,
            execution_result=request.executionResult,
        )

        return {
            "verified": result.verified,
            "discrepancies": result.discrepancies,
            "confidence": result.confidence,
        }

    except Exception as e:
        logger.error(f"State verification failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/report-execution", response_model=ReportExecutionResponse)
async def report_execution(request: ReportExecutionRequest) -> Dict[str, Any]:
    """
    Report tool execution results from the client.

    The client (IDE extension) executes tools locally and reports
    results back to the agent server for processing.
    """
    logger.info(f"Execution report for step {request.stepId}")

    # Process the execution result
    # This could trigger state verification, update session state, etc.

    return {
        "acknowledged": True,
        "nextAction": None,  # Could return next suggested action
    }


@router.post("/validate", response_model=ValidateResponse)
async def validate_code(request: ValidateRequest) -> Dict[str, Any]:
    """
    Validate code before execution.

    Performs static analysis using AST, Ruff, and Pyflakes to detect:
    - Syntax errors
    - Undefined variables
    - Unused imports
    - Code style issues
    - Security vulnerabilities

    Returns validation results with automatic fixes when possible.
    """
    logger.info(f"Validate request for {len(request.code)} chars of code")

    try:
        # Build notebook context for validator
        notebook_ctx = {}
        if request.notebookContext:
            notebook_ctx = {
                "definedVariables": request.notebookContext.definedVariables,
                "importedLibraries": request.notebookContext.importedLibraries,
            }

        # Run full validation
        validator = CodeValidator(notebook_context=notebook_ctx)
        result = validator.full_validation(request.code)

        # Convert ValidationResult to ValidateResponse
        return {
            "valid": result.is_valid,
            "issues": [issue.to_dict() for issue in result.issues],
            "dependencies": result.dependencies.to_dict()
            if result.dependencies
            else None,
            "hasErrors": result.has_errors,
            "hasWarnings": result.has_warnings,
            "summary": result.summary,
        }

    except Exception as e:
        logger.error(f"Code validation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reflect", response_model=ReflectResponse)
async def reflect_on_step(request: ReflectRequest) -> Dict[str, Any]:
    """
    Reflect on step execution results.

    Analyzes the execution result of a single step to determine:
    - Whether the step succeeded and met checkpoint criteria
    - Impact on remaining steps
    - Recommended next actions (continue/adjust/retry/replan)

    This is called after each step execution to guide adaptive planning.
    """
    logger.info(
        f"Reflect request for step {request.stepNumber}: {request.stepDescription[:50]}..."
    )

    try:
        # Build reflection prompt
        prompt = format_reflection_prompt(
            step_number=request.stepNumber,
            step_description=request.stepDescription,
            executed_code=request.executedCode,
            execution_status=request.executionStatus,
            execution_output=request.executionOutput,
            error_message=request.errorMessage or "",
            expected_outcome=request.expectedOutcome or "",
            validation_criteria=request.validationCriteria or [],
            remaining_steps=request.remainingSteps or [],
        )

        # Call LLM (using server config since ReflectRequest doesn't have llmConfig)
        response = await _call_llm(prompt)

        # Parse JSON response
        reflection_data = _parse_json_response(response)

        if not reflection_data:
            # Fallback: Simple heuristic when LLM fails
            is_success = request.executionStatus == "success"
            return {
                "reflection": {
                    "evaluation": {
                        "checkpoint_passed": is_success,
                        "output_matches_expected": is_success,
                        "confidence_score": 0.5,
                    },
                    "analysis": {
                        "success_factors": ["실행 완료"] if is_success else [],
                        "failure_factors": [] if is_success else ["에러 발생"],
                        "unexpected_outcomes": [],
                    },
                    "impact_on_remaining": {
                        "affected_steps": [],
                        "severity": "none" if is_success else "minor",
                        "description": "영향 없음"
                        if is_success
                        else "다음 단계 확인 필요",
                    },
                    "recommendations": {
                        "action": "continue" if is_success else "retry",
                        "adjustments": [],
                        "reasoning": "기본 휴리스틱 기반 판단",
                    },
                }
            }

        # Return structured reflection result
        return {"reflection": reflection_data}

    except Exception as e:
        logger.error(f"Reflection failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
