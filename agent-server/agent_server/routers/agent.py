"""
Agent Router - Core agent functionality endpoints

Handles plan generation, refinement, replanning, and state verification.
"""

import json
import logging
import re
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from agent_server.core.config_manager import ConfigManager
from agent_server.core.llm_service import LLMService
from agent_server.core.code_validator import CodeValidator
from agent_server.core.error_classifier import get_error_classifier, ReplanDecision
from agent_server.core.state_verifier import get_state_verifier
from agent_server.knowledge.loader import get_knowledge_base, get_library_detector
from agent_server.prompts.auto_agent_prompts import (
    format_plan_prompt,
    format_refine_prompt,
    format_replan_prompt,
)
from agent_server.schemas.agent import (
    PlanRequest,
    PlanResponse,
    RefineRequest,
    RefineResponse,
    ReplanRequest,
    ReplanResponse,
    VerifyStateRequest,
    VerifyStateResponse,
    ReportExecutionRequest,
    ReportExecutionResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ============ Helper Functions ============


def _get_config() -> Dict[str, Any]:
    """Get current configuration"""
    return ConfigManager.get_instance().get_config()


async def _call_llm(prompt: str) -> str:
    """Call LLM with prompt"""
    config = _get_config()
    llm_service = LLMService(config)
    return await llm_service.generate(prompt)


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


def _detect_required_libraries(request: str, imported_libraries: List[str]) -> List[str]:
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
    """
    logger.info(f"Plan request received: {request.request[:100]}...")

    if not request.request:
        raise HTTPException(status_code=400, detail="request is required")

    try:
        # Deterministic library detection
        imported_libs = request.notebookContext.importedLibraries
        detected_libraries = _detect_required_libraries(request.request, imported_libs)
        logger.info(f"Detected libraries: {detected_libraries}")

        # Build prompt
        prompt = format_plan_prompt(
            request=request.request,
            cell_count=request.notebookContext.cellCount,
            imported_libraries=imported_libs,
            defined_variables=request.notebookContext.definedVariables,
            recent_cells=request.notebookContext.recentCells,
            available_libraries=_get_installed_packages(),
            detected_libraries=detected_libraries,
        )

        # Call LLM
        response = await _call_llm(prompt)
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

        # Call LLM
        response = await _call_llm(prompt)

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

    Uses deterministic error classification to decide whether to
    refine, insert steps, replace step, or replan remaining.
    """
    logger.info(f"Replan request for step {request.currentStepIndex}")

    try:
        # Use error classifier (deterministic, no LLM call)
        classifier = get_error_classifier()

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
            code="",  # Could extract from current step
        )

        return {
            "decision": analysis.decision.value,
            "analysis": analysis.to_dict()["analysis"],
            "reasoning": analysis.reasoning,
            "changes": analysis.changes,
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
