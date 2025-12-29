"""
Error Handling Middleware

Classifies errors and decides on recovery strategies after tool execution.
Implements self-healing and adaptive replanning logic.
"""

import logging
from typing import Any, Dict, List, Optional

from agent_server.langchain.state import AgentRuntime, AgentState

logger = logging.getLogger(__name__)


class ErrorHandlingMiddleware:
    """
    Middleware that handles errors after tool execution.
    
    This middleware:
    1. Classifies errors using ErrorClassifier
    2. Decides on recovery strategy (refine, insert_steps, replan)
    3. Updates state with recovery information
    4. Tracks retry attempts
    
    Uses @after_tool_call hook pattern from LangChain middleware.
    """

    def __init__(
        self,
        error_classifier: Any = None,
        max_retries: int = 3,
        use_llm_fallback: bool = True,
        enabled: bool = True,
    ):
        """
        Initialize error handling middleware.
        
        Args:
            error_classifier: ErrorClassifier instance
            max_retries: Maximum retry attempts per error
            use_llm_fallback: Use LLM for complex error analysis
            enabled: Whether error handling is enabled
        """
        self._classifier = error_classifier
        self._max_retries = max_retries
        self._use_llm_fallback = use_llm_fallback
        self._enabled = enabled

    @property
    def name(self) -> str:
        return "ErrorHandlingMiddleware"

    def _get_classifier(self):
        """Lazy load error classifier"""
        if self._classifier is None:
            try:
                from agent_server.core.error_classifier import get_error_classifier
                self._classifier = get_error_classifier()
            except ImportError:
                logger.warning("ErrorClassifier not available")
                return None
        return self._classifier

    def _classify_error(
        self,
        error_type: str,
        error_message: str,
        traceback: Optional[List[str]] = None,
        previous_attempts: int = 0,
    ) -> Dict[str, Any]:
        """Classify error using ErrorClassifier"""
        classifier = self._get_classifier()

        if classifier is None:
            # Fallback classification
            return self._fallback_classify(error_type, error_message)

        try:
            traceback_str = "\n".join(traceback) if traceback else ""

            # Check if LLM fallback should be used
            should_use_llm, reason = classifier.should_use_llm_fallback(
                error_type=error_type,
                traceback=traceback_str,
                previous_attempts=previous_attempts,
            )

            # Classify using pattern matching
            analysis = classifier.classify(
                error_type=error_type,
                error_message=error_message,
                traceback=traceback_str,
            )

            result = analysis.to_dict()
            result["should_use_llm"] = should_use_llm
            result["llm_reason"] = reason

            return result

        except Exception as e:
            logger.error(f"Error classification failed: {e}")
            return self._fallback_classify(error_type, error_message)

    def _fallback_classify(
        self,
        error_type: str,
        error_message: str,
    ) -> Dict[str, Any]:
        """Fallback error classification without ErrorClassifier"""
        # Simple heuristic-based classification

        # Module not found -> need to install
        if error_type in ("ModuleNotFoundError", "ImportError"):
            module_name = self._extract_module_name(error_message)
            return {
                "decision": "insert_steps",
                "analysis": {
                    "root_cause": f"Missing module: {module_name}",
                    "is_approach_problem": False,
                },
                "reasoning": "Package installation required",
                "changes": {
                    "new_steps": [{
                        "description": f"Install {module_name}",
                        "toolCalls": [{
                            "tool": "jupyter_cell",
                            "parameters": {
                                "code": f"!pip install {module_name}"
                            }
                        }]
                    }]
                },
                "confidence": 0.9,
            }

        # Syntax/Type/Value errors -> refine code
        if error_type in ("SyntaxError", "TypeError", "ValueError", "KeyError", "IndexError"):
            return {
                "decision": "refine",
                "analysis": {
                    "root_cause": f"{error_type}: {error_message}",
                    "is_approach_problem": False,
                },
                "reasoning": "Code can be fixed with refinement",
                "changes": {},
                "confidence": 0.8,
            }

        # Name errors -> might be missing definition
        if error_type == "NameError":
            return {
                "decision": "refine",
                "analysis": {
                    "root_cause": f"Undefined variable: {error_message}",
                    "is_approach_problem": False,
                },
                "reasoning": "Variable not defined, need to fix code",
                "changes": {},
                "confidence": 0.7,
            }

        # Default -> try refinement first
        return {
            "decision": "refine",
            "analysis": {
                "root_cause": f"{error_type}: {error_message}",
                "is_approach_problem": False,
            },
            "reasoning": "Attempting code refinement",
            "changes": {},
            "confidence": 0.5,
        }

    def _extract_module_name(self, error_message: str) -> str:
        """Extract module name from import error message"""
        import re

        # Match "No module named 'xxx'" or "No module named 'xxx.yyy'"
        match = re.search(r"No module named ['\"]([^'\"]+)['\"]", error_message)
        if match:
            module = match.group(1).split(".")[0]

            # Handle common aliases
            aliases = {
                "sklearn": "scikit-learn",
                "cv2": "opencv-python",
                "PIL": "pillow",
            }
            return aliases.get(module, module)

        return "unknown-package"

    async def after_tool_call(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        tool_result: Dict[str, Any],
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Optional[Dict[str, Any]]:
        """
        Hook called after each tool execution.
        
        Handles errors and updates recovery strategy.
        
        Args:
            tool_name: Name of the tool that was called
            tool_input: Tool input parameters
            tool_result: Result from tool execution
            state: Current agent state
            runtime: Agent runtime context
            
        Returns:
            Modified result or None
        """
        if not self._enabled:
            return None

        # Only handle jupyter_cell errors
        if tool_name != "jupyter_cell_tool":
            return None

        # Check if execution succeeded
        if tool_result.get("success", True):
            # Reset error count on success
            state["error_count"] = 0
            state["last_error"] = None
            state["recovery_strategy"] = None
            return None

        # Handle execution error
        error_type = tool_result.get("error_type", "UnknownError")
        error_message = tool_result.get("error", "Unknown error")
        traceback = tool_result.get("traceback", [])

        error_count = state.get("error_count", 0)

        logger.info(f"Handling error: {error_type} (attempt {error_count})")

        # Classify error and get recovery strategy
        classification = self._classify_error(
            error_type=error_type,
            error_message=error_message,
            traceback=traceback,
            previous_attempts=error_count,
        )

        # Check retry limit
        if error_count >= self._max_retries:
            classification["decision"] = "replan_remaining"
            classification["reasoning"] = f"Max retries ({self._max_retries}) exceeded"

        # Update state with recovery information
        state["recovery_strategy"] = classification["decision"]
        state["last_error"] = {
            "error_type": error_type,
            "error_message": error_message,
            "traceback": traceback,
            "classification": classification,
        }

        # Enrich tool result with classification
        tool_result["error_classification"] = classification
        tool_result["recovery_strategy"] = classification["decision"]
        tool_result["recovery_changes"] = classification.get("changes", {})

        logger.info(
            f"Error classified: decision={classification['decision']}, "
            f"confidence={classification.get('confidence', 0)}"
        )

        return tool_result

    def format_error_feedback(
        self,
        last_error: Dict[str, Any],
    ) -> str:
        """
        Format error information for feedback to the model.
        
        Args:
            last_error: Last error information from state
            
        Returns:
            Formatted feedback string
        """
        if not last_error:
            return ""

        lines = ["## Execution Error"]

        error_type = last_error.get("error_type", "UnknownError")
        error_message = last_error.get("error_message", "")

        lines.append(f"**Type**: {error_type}")
        lines.append(f"**Message**: {error_message}")

        classification = last_error.get("classification", {})
        if classification:
            decision = classification.get("decision", "unknown")
            reasoning = classification.get("reasoning", "")

            lines.append(f"\n**Recovery Strategy**: {decision}")
            lines.append(f"**Reasoning**: {reasoning}")

            changes = classification.get("changes", {})
            if changes:
                lines.append("\n**Suggested Changes**:")
                if "new_steps" in changes:
                    for step in changes["new_steps"]:
                        lines.append(f"- {step.get('description', 'New step')}")

        return "\n".join(lines)


def create_error_handling_middleware(
    max_retries: int = 3,
    use_llm_fallback: bool = True,
    enabled: bool = True,
) -> ErrorHandlingMiddleware:
    """
    Factory function to create error handling middleware.
    
    Args:
        max_retries: Maximum retry attempts
        use_llm_fallback: Use LLM for complex errors
        enabled: Whether to enable error handling
        
    Returns:
        Configured ErrorHandlingMiddleware instance
    """
    return ErrorHandlingMiddleware(
        max_retries=max_retries,
        use_llm_fallback=use_llm_fallback,
        enabled=enabled,
    )
