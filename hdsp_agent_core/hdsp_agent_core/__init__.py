"""
HDSP Agent Core - Shared Core Library

Embedded Agent Server Architecture를 위한 공유 코어 라이브러리.
Development(embedded)와 Production(proxy) 모드 모두에서 사용되는 공통 컴포넌트.

Modules:
- models: Pydantic data models (agent, chat, common, rag)
- managers: Singleton managers (config, session, rag)
- llm: LLM service abstraction (multi-provider support)
- knowledge: Knowledge base and document chunking
- prompts: Prompt templates for Auto-Agent
"""

__version__ = "1.0.0"

# Models
from hdsp_agent_core.models import (
    # Common
    APIResponse,
    ErrorInfo,
    GeminiConfig,
    LLMConfig,
    NotebookContext,
    OpenAIConfig,
    ToolCall,
    VLLMConfig,
    # Agent
    ExecutionPlan,
    PlanRequest,
    PlanResponse,
    PlanStep,
    RefineRequest,
    RefineResponse,
    ReplanRequest,
    ReplanResponse,
    ValidationIssue,
    # Chat
    ChatRequest,
    ChatResponse,
    StreamChunk,
    # RAG
    ChunkingConfig,
    EmbeddingConfig,
    IndexStatusResponse,
    QdrantConfig,
    RAGConfig,
    ReindexRequest,
    ReindexResponse,
    SearchRequest,
    SearchResponse,
    WatchdogConfig,
)

# Managers
from hdsp_agent_core.managers import (
    ConfigManager,
    SessionManager,
    get_config_manager,
    get_session_manager,
)

# LLM
from hdsp_agent_core.llm import (
    LLMService,
    call_llm,
    call_llm_stream,
)

# Knowledge
from hdsp_agent_core.knowledge import (
    DocumentChunker,
    KnowledgeBase,
    KnowledgeLoader,
    LibraryDetector,
    chunk_file,
    get_knowledge_base,
    get_knowledge_loader,
    get_library_detector,
    LIBRARY_DESCRIPTIONS,
)

# Prompts
from hdsp_agent_core.prompts import (
    PLAN_GENERATION_PROMPT,
    CODE_GENERATION_PROMPT,
    ERROR_REFINEMENT_PROMPT,
    ADAPTIVE_REPLAN_PROMPT,
    format_plan_prompt,
    format_refine_prompt,
    format_replan_prompt,
)

__all__ = [
    # Version
    "__version__",
    # Models - Common
    "APIResponse",
    "ErrorInfo",
    "GeminiConfig",
    "LLMConfig",
    "NotebookContext",
    "OpenAIConfig",
    "ToolCall",
    "VLLMConfig",
    # Models - Agent
    "ExecutionPlan",
    "PlanRequest",
    "PlanResponse",
    "PlanStep",
    "RefineRequest",
    "RefineResponse",
    "ReplanRequest",
    "ReplanResponse",
    "ValidationIssue",
    # Models - Chat
    "ChatRequest",
    "ChatResponse",
    "StreamChunk",
    # Models - RAG
    "ChunkingConfig",
    "EmbeddingConfig",
    "IndexStatusResponse",
    "QdrantConfig",
    "RAGConfig",
    "ReindexRequest",
    "ReindexResponse",
    "SearchRequest",
    "SearchResponse",
    "WatchdogConfig",
    # Managers
    "ConfigManager",
    "SessionManager",
    "get_config_manager",
    "get_session_manager",
    # LLM
    "LLMService",
    "call_llm",
    "call_llm_stream",
    # Knowledge
    "DocumentChunker",
    "KnowledgeBase",
    "KnowledgeLoader",
    "LibraryDetector",
    "chunk_file",
    "get_knowledge_base",
    "get_knowledge_loader",
    "get_library_detector",
    "LIBRARY_DESCRIPTIONS",
    # Prompts
    "PLAN_GENERATION_PROMPT",
    "CODE_GENERATION_PROMPT",
    "ERROR_REFINEMENT_PROMPT",
    "ADAPTIVE_REPLAN_PROMPT",
    "format_plan_prompt",
    "format_refine_prompt",
    "format_replan_prompt",
]
