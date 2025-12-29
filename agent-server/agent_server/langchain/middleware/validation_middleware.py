"""
Validation Middleware

Validates code before execution in Jupyter cells.
Uses static analysis (AST, Ruff, Pyflakes) to detect issues.
"""

import logging
from typing import Any, Dict, Optional

from agent_server.langchain.state import AgentRuntime, AgentState

logger = logging.getLogger(__name__)


class ValidationMiddleware:
    """
    Middleware that validates code before tool execution.
    
    This middleware:
    1. Intercepts jupyter_cell tool calls
    2. Validates the code using CodeValidator
    3. Blocks execution if critical errors found
    4. Provides fix suggestions when possible
    
    Uses @before_tool_call hook pattern from LangChain middleware.
    """

    def __init__(
        self,
        code_validator: Any = None,
        block_on_errors: bool = True,
        auto_fix: bool = False,
        enabled: bool = True,
    ):
        """
        Initialize validation middleware.
        
        Args:
            code_validator: CodeValidator instance
            block_on_errors: Block execution if errors found
            auto_fix: Attempt auto-fix for fixable issues
            enabled: Whether validation is enabled
        """
        self._validator = code_validator
        self._block_on_errors = block_on_errors
        self._auto_fix = auto_fix
        self._enabled = enabled

    @property
    def name(self) -> str:
        return "ValidationMiddleware"

    def _get_validator(self):
        """Lazy load code validator"""
        if self._validator is None:
            try:
                from agent_server.core.code_validator import CodeValidator
                self._validator = CodeValidator()
            except ImportError:
                logger.warning("CodeValidator not available")
                return None
        return self._validator

    def _extract_code_from_tool_call(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
    ) -> Optional[str]:
        """Extract code from tool call if applicable"""
        if tool_name != "jupyter_cell_tool":
            return None

        code = tool_input.get("code", "")
        if not code:
            return None

        return code

    def _validate_code(
        self,
        code: str,
        notebook_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Validate code using CodeValidator"""
        validator = self._get_validator()
        if validator is None:
            return {
                "valid": True,
                "issues": [],
                "summary": "Validation skipped (validator not available)",
            }

        try:
            # Build context for validator
            ctx = {
                "definedVariables": notebook_context.get("defined_variables", []),
                "importedLibraries": notebook_context.get("imported_libraries", []),
            }

            # Reinitialize validator with context
            validator_with_ctx = type(validator)(notebook_context=ctx)
            result = validator_with_ctx.full_validation(code)

            return {
                "valid": result.is_valid,
                "issues": [issue.to_dict() for issue in result.issues],
                "has_errors": result.has_errors,
                "has_warnings": result.has_warnings,
                "summary": result.summary,
                "dependencies": result.dependencies.to_dict() if result.dependencies else None,
            }
        except Exception as e:
            logger.error(f"Validation failed: {e}")
            return {
                "valid": True,  # Don't block on validation errors
                "issues": [],
                "summary": f"Validation error: {str(e)}",
            }

    async def before_tool_call(
        self,
        tool_name: str,
        tool_input: Dict[str, Any],
        state: AgentState,
        runtime: AgentRuntime,
    ) -> Optional[Dict[str, Any]]:
        """
        Hook called before each tool execution.
        
        Validates code for jupyter_cell tool calls.
        
        Args:
            tool_name: Name of the tool being called
            tool_input: Tool input parameters
            state: Current agent state
            runtime: Agent runtime context
            
        Returns:
            Modified tool input, or raises exception to block
        """
        if not self._enabled:
            return None

        code = self._extract_code_from_tool_call(tool_name, tool_input)
        if code is None:
            return None

        notebook_context = state.get("notebook_context", {})
        validation_result = self._validate_code(code, notebook_context)

        # Store validation result in state
        state["validation_result"] = validation_result

        if not validation_result.get("valid", True) and self._block_on_errors:
            # Get error details
            errors = [
                issue for issue in validation_result.get("issues", [])
                if issue.get("severity") == "error"
            ]

            if errors:
                error_messages = [
                    f"- {e.get('category', 'error')}: {e.get('message', 'Unknown error')}"
                    for e in errors[:5]  # Limit to 5 errors
                ]

                logger.warning(f"Code validation failed: {len(errors)} errors")

                # Return modified result that includes validation feedback
                return {
                    "code": code,
                    "validation_failed": True,
                    "validation_errors": error_messages,
                    "original_input": tool_input,
                }

        # Log warnings but allow execution
        warnings = [
            issue for issue in validation_result.get("issues", [])
            if issue.get("severity") == "warning"
        ]
        if warnings:
            logger.info(f"Code validation: {len(warnings)} warnings")

        return None

    def format_validation_feedback(
        self,
        validation_result: Dict[str, Any],
    ) -> str:
        """
        Format validation result for feedback to the model.
        
        Args:
            validation_result: Validation result dict
            
        Returns:
            Formatted feedback string
        """
        if validation_result.get("valid", True):
            return ""

        lines = ["## Code Validation Issues"]

        for issue in validation_result.get("issues", [])[:10]:
            severity = issue.get("severity", "info")
            category = issue.get("category", "unknown")
            message = issue.get("message", "")
            line = issue.get("line")

            location = f"L{line}" if line else ""
            lines.append(f"- [{severity.upper()}] {category}{location}: {message}")

        lines.append("\nPlease fix these issues before execution.")

        return "\n".join(lines)


def create_validation_middleware(
    block_on_errors: bool = True,
    auto_fix: bool = False,
    enabled: bool = True,
) -> ValidationMiddleware:
    """
    Factory function to create validation middleware.
    
    Args:
        block_on_errors: Block execution on validation errors
        auto_fix: Attempt auto-fix for issues
        enabled: Whether to enable validation
        
    Returns:
        Configured ValidationMiddleware instance
    """
    return ValidationMiddleware(
        block_on_errors=block_on_errors,
        auto_fix=auto_fix,
        enabled=enabled,
    )
