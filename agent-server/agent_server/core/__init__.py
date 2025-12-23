"""
Core services for HDSP Agent Server
"""

from hdsp_agent_core.managers.config_manager import ConfigManager
from hdsp_agent_core.managers.session_manager import (
    ChatMessage,
    Session,
    SessionManager,
    get_session_manager,
)

from .api_key_manager import GeminiKeyManager, KeyStatus, get_key_manager
from .code_validator import (
    CodeValidator,
    ValidationIssue,
    ValidationResult,
    get_api_pattern_checker,
)
from .context_condenser import (
    CompressionStats,
    CompressionStrategy,
    ContextCondenser,
    get_context_condenser,
)
from .error_classifier import (
    ErrorAnalysis,
    ErrorClassifier,
    ReplanDecision,
    get_error_classifier,
)
from .llm_client import LLMClient
from .llm_service import LLMService
from .prompt_builder import PromptBuilder
from .reflection_engine import ReflectionEngine, ReflectionResult
from .state_verifier import (
    CONFIDENCE_THRESHOLDS,
    ConfidenceScore,
    MismatchType,
    Recommendation,
    Severity,
    StateMismatch,
    StateVerificationResult,
    StateVerifier,
    get_state_verifier,
)
from .summary_generator import SummaryGenerator, TaskType, get_summary_generator

__all__ = [
    "ConfigManager",
    "LLMClient",
    "LLMService",
    "PromptBuilder",
    "CodeValidator",
    "ValidationResult",
    "ValidationIssue",
    "ReflectionEngine",
    "ReflectionResult",
    # 신규 추가 (LLM 호출 대체)
    "ErrorClassifier",
    "get_error_classifier",
    "ReplanDecision",
    "ErrorAnalysis",
    "SummaryGenerator",
    "get_summary_generator",
    "TaskType",
    "get_api_pattern_checker",
    # API Key Manager (Multi-key rotation)
    "GeminiKeyManager",
    "get_key_manager",
    "KeyStatus",
    # State Verifier (Phase 1: 상태 검증 레이어)
    "StateVerifier",
    "get_state_verifier",
    "StateVerificationResult",
    "StateMismatch",
    "ConfidenceScore",
    "MismatchType",
    "Severity",
    "Recommendation",
    "CONFIDENCE_THRESHOLDS",
    # Session Manager (Persistence Layer)
    "SessionManager",
    "get_session_manager",
    "Session",
    "ChatMessage",
    # Context Condenser (Token Optimization)
    "ContextCondenser",
    "get_context_condenser",
    "CompressionStrategy",
    "CompressionStats",
]
