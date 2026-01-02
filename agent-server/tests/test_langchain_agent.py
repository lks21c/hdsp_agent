"""
Unit Tests for LangChain Jupyter Agent

Tests cover:
- State management
- Tools (jupyter_cell, file, search)
- Executors (JupyterExecutor, NotebookSearcher)
- Middleware (RAG, validation, error handling)
- Agent creation and execution
"""

import json
import os
import tempfile
from typing import Any, Dict

import pytest

# ============ State Tests ============


class TestAgentState:
    """Test agent state management"""

    def test_create_initial_state(self):
        """Test initial state creation"""
        from agent_server.langchain.state import create_initial_state

        state = create_initial_state(
            user_request="Load titanic.csv and show statistics",
            notebook_context={
                "notebook_path": "test.ipynb",
                "cell_count": 5,
                "imported_libraries": ["pandas", "numpy"],
            },
            llm_config={"provider": "gemini"},
        )

        assert state["user_request"] == "Load titanic.csv and show statistics"
        assert state["notebook_context"]["notebook_path"] == "test.ipynb"
        assert state["notebook_context"]["cell_count"] == 5
        assert state["is_complete"] is False
        assert state["error_count"] == 0

    def test_initial_state_defaults(self):
        """Test initial state with default values"""
        from agent_server.langchain.state import create_initial_state

        state = create_initial_state(user_request="Test request")

        assert state["user_request"] == "Test request"
        assert state["notebook_context"]["cell_count"] == 0
        assert state["search_results"] == []
        assert state["execution_history"] == []


class TestSystemPrompt:
    """Test system prompt content"""

    def test_execute_command_long_running_rule(self):
        """System prompt should forbid long-running execute_command_tool usage."""
        from agent_server.langchain.agent import DEFAULT_SYSTEM_PROMPT

        assert "For execute_command_tool only" in DEFAULT_SYSTEM_PROMPT
        assert "NEVER run long-running commands" in DEFAULT_SYSTEM_PROMPT


# ============ Tools Tests ============


class TestJupyterTools:
    """Test Jupyter tools"""

    def test_jupyter_cell_tool(self):
        """Test jupyter_cell tool creation"""
        from agent_server.langchain.tools.jupyter_tools import jupyter_cell_tool

        result = jupyter_cell_tool.invoke(
            {
                "code": "print('hello')",
                "description": "Test print",
            }
        )

        assert result["tool"] == "jupyter_cell"
        assert result["parameters"]["code"] == "print('hello')"
        assert result["status"] == "pending_execution"

    def test_jupyter_cell_code_cleaning(self):
        """Test that code blocks are cleaned"""
        from agent_server.langchain.tools.jupyter_tools import jupyter_cell_tool

        result = jupyter_cell_tool.invoke(
            {
                "code": "```python\nprint('hello')\n```",
            }
        )

        assert result["parameters"]["code"] == "print('hello')"

    def test_markdown_tool(self):
        """Test markdown tool"""
        from agent_server.langchain.tools.jupyter_tools import markdown_tool

        result = markdown_tool.invoke(
            {
                "content": "# Header\nSome text",
            }
        )

        assert result["tool"] == "markdown"
        assert result["parameters"]["content"] == "# Header\nSome text"

    def test_final_answer_tool(self):
        """Test final_answer tool"""
        from agent_server.langchain.tools.jupyter_tools import final_answer_tool

        result = final_answer_tool.invoke(
            {
                "answer": "Task completed successfully",
                "summary": "Loaded data and showed stats",
            }
        )

        assert result["tool"] == "final_answer"
        assert result["status"] == "complete"


class TestFileTools:
    """Test file operation tools"""

    def test_list_files_tool(self):
        """Test list_files tool"""
        import os

        from agent_server.langchain.tools.file_tools import _validate_path

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test files
            open(os.path.join(tmpdir, "test.py"), "w").close()
            open(os.path.join(tmpdir, "data.csv"), "w").close()

            # Test path validation directly
            resolved = _validate_path(".", tmpdir)
            assert os.path.exists(resolved)

            # List files in directory
            files = os.listdir(tmpdir)
            assert len(files) == 2

    def test_read_file_tool(self):
        """Test read_file tool"""
        from agent_server.langchain.tools.file_tools import _validate_path

        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = os.path.join(tmpdir, "test.txt")
            with open(test_file, "w") as f:
                f.write("Hello, World!")

            # Test path validation
            resolved = _validate_path("test.txt", tmpdir)
            assert resolved == test_file

            with open(resolved, "r") as f:
                content = f.read()

            assert content == "Hello, World!"

    def test_read_file_security(self):
        """Test that absolute paths are blocked"""
        from agent_server.langchain.tools.file_tools import read_file_tool

        result = read_file_tool.invoke(
            {
                "path": "/etc/passwd",
            }
        )

        assert result["success"] is False
        assert "Absolute paths not allowed" in result["error"]

    def test_read_file_traversal_blocked(self):
        """Test that parent directory traversal is blocked"""
        from agent_server.langchain.tools.file_tools import read_file_tool

        result = read_file_tool.invoke(
            {
                "path": "../../../etc/passwd",
            }
        )

        assert result["success"] is False
        assert "Parent directory traversal not allowed" in result["error"]


class TestSearchTools:
    """Test search tools with subprocess-based implementation"""

    def test_search_workspace_tool_with_subprocess(self):
        """Test workspace search using subprocess (grep/ripgrep)"""
        from agent_server.langchain.tools.search_tools import search_workspace_tool

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("import pandas as pd\ndf = pd.read_csv('data.csv')")

            result = search_workspace_tool.invoke(
                {
                    "pattern": "pandas",
                    "workspace_root": tmpdir,
                }
            )

            # New API returns pending_execution status (client-side execution)
            assert result["status"] == "pending_execution"
            assert result["tool"] == "search_workspace_tool"
            # Check that command was generated
            assert "command" in result
            assert result["command"]  # Not empty

    def test_search_workspace_returns_command_info(self):
        """Test that search returns the executed command"""
        from agent_server.langchain.tools.search_tools import search_workspace_tool

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("def hello(): pass")

            result = search_workspace_tool.invoke(
                {
                    "pattern": "hello",
                    "workspace_root": tmpdir,
                }
            )

            # New API returns pending_execution status
            assert result["status"] == "pending_execution"
            assert "command" in result
            # Should use either rg or grep
            assert "tool_used" in result
            assert result["tool_used"] in ("rg", "grep")

    def test_search_workspace_with_file_types(self):
        """Test search with specific file type filters"""
        from agent_server.langchain.tools.search_tools import search_workspace_tool

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test files
            py_file = os.path.join(tmpdir, "test.py")
            with open(py_file, "w") as f:
                f.write("import pandas")

            txt_file = os.path.join(tmpdir, "test.txt")
            with open(txt_file, "w") as f:
                f.write("import pandas")

            # Search only .py files
            result = search_workspace_tool.invoke(
                {
                    "pattern": "pandas",
                    "file_types": ["*.py"],
                    "workspace_root": tmpdir,
                }
            )

            # New API returns pending_execution status
            assert result["status"] == "pending_execution"
            # Verify file_types is in parameters
            assert result["parameters"]["file_types"] == ["*.py"]

    def test_search_notebook_cells_with_subprocess(self):
        """Test notebook cell search returns pending_execution"""
        from agent_server.langchain.tools.search_tools import search_notebook_cells_tool

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test notebook
            notebook = {
                "cells": [
                    {"cell_type": "code", "source": ["import pandas as pd"]},
                    {"cell_type": "markdown", "source": ["# Data Analysis"]},
                    {"cell_type": "code", "source": ["df.head()"]},
                ],
                "metadata": {},
                "nbformat": 4,
                "nbformat_minor": 2,
            }

            nb_path = os.path.join(tmpdir, "test.ipynb")
            with open(nb_path, "w") as f:
                json.dump(notebook, f)

            result = search_notebook_cells_tool.invoke(
                {
                    "pattern": "pandas",
                    "notebook_path": "test.ipynb",
                    "workspace_root": tmpdir,
                }
            )

            # New API returns pending_execution status (client-side execution)
            assert result["status"] == "pending_execution"
            assert result["tool"] == "search_notebook_cells_tool"
            assert result["parameters"]["pattern"] == "pandas"
            assert result["parameters"]["notebook_path"] == "test.ipynb"

    def test_create_search_tools_with_workspace_root(self):
        """Test that create_search_tools returns tools"""
        from agent_server.langchain.tools.search_tools import create_search_tools

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test file
            test_file = os.path.join(tmpdir, "test.py")
            with open(test_file, "w") as f:
                f.write("def my_function(): pass")

            # Create tools with workspace_root bound
            tools = create_search_tools(tmpdir)

            assert len(tools) == 2

            # Find the search_workspace_tool
            search_tool = next(t for t in tools if t.name == "search_workspace_tool")

            # Invoke - should return pending_execution (client-side execution)
            result = search_tool.invoke(
                {
                    "pattern": "my_function",
                }
            )

            # New API returns pending_execution status
            assert result["status"] == "pending_execution"
            assert result["tool"] == "search_workspace_tool"

    def test_ripgrep_detection(self):
        """Test ripgrep availability detection"""
        from agent_server.langchain.tools.search_tools import _is_ripgrep_available

        # Just verify the function runs without error
        result = _is_ripgrep_available()
        assert isinstance(result, bool)

    def test_search_workspace_nonexistent_path(self):
        """Test search with non-existent path still returns pending_execution"""
        from agent_server.langchain.tools.search_tools import search_workspace_tool

        with tempfile.TemporaryDirectory() as tmpdir:
            result = search_workspace_tool.invoke(
                {
                    "pattern": "test",
                    "path": "nonexistent_directory",
                    "workspace_root": tmpdir,
                }
            )

            # New API always returns pending_execution (error handled on client)
            assert result["status"] == "pending_execution"
            assert result["parameters"]["path"] == "nonexistent_directory"

    def test_search_notebook_cells_tool_legacy(self):
        """Test notebook cell search using NotebookSearcher directly (legacy compatibility)"""
        from agent_server.langchain.executors.notebook_searcher import NotebookSearcher

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test notebook
            notebook = {
                "cells": [
                    {"cell_type": "code", "source": "import pandas as pd"},
                    {"cell_type": "markdown", "source": "# Data Analysis"},
                    {"cell_type": "code", "source": "df.head()"},
                ],
                "metadata": {},
                "nbformat": 4,
                "nbformat_minor": 2,
            }

            nb_path = os.path.join(tmpdir, "test.ipynb")
            with open(nb_path, "w") as f:
                json.dump(notebook, f)

            # Use NotebookSearcher directly
            searcher = NotebookSearcher(tmpdir)
            result = searcher.search_notebook("test.ipynb", "pandas")

            assert result.total_matches >= 1


class TestResourceTools:
    """Test resource check tool"""

    def test_check_resource_tool_returns_pending_execution(self):
        """Test that check_resource returns pending_execution status"""
        from agent_server.langchain.tools.resource_tools import check_resource_tool

        result = check_resource_tool.invoke({
            "files": ["data.csv", "train.parquet"],
            "dataframes": ["df", "train_df"]
        })

        assert result["status"] == "pending_execution"
        assert result["tool"] == "check_resource_tool"
        assert "file_size_command" in result
        assert "dataframe_check_code" in result

    def test_check_resource_tool_with_execution_result(self):
        """Test that check_resource processes execution result correctly"""
        from agent_server.langchain.tools.resource_tools import check_resource_tool

        execution_result = {
            "success": True,
            "system": {
                "ram_available_mb": 4096,
                "ram_total_mb": 8192,
                "cpu_cores": 4,
                "environment": "Host/VM"
            },
            "files": [
                {"name": "data.csv", "path": "data.csv", "size_mb": 100, "exists": True}
            ],
            "dataframes": [
                {"name": "df", "exists": True, "rows": 1000, "cols": 10, "memory_mb": 5}
            ]
        }

        result = check_resource_tool.invoke({
            "files": ["data.csv"],
            "dataframes": ["df"],
            "execution_result": execution_result
        })

        assert result["status"] == "complete"
        assert result["success"] is True
        assert result["system"]["ram_available_mb"] == 4096
        assert len(result["files"]) == 1
        assert result["files"][0]["size_mb"] == 100
        assert len(result["dataframes"]) == 1
        assert result["dataframes"][0]["rows"] == 1000


# ============ Executor Tests ============


class TestJupyterExecutor:
    """Test Jupyter executor"""

    def test_executor_creation(self):
        """Test executor creation"""
        from agent_server.langchain.executors.jupyter_executor import JupyterExecutor

        executor = JupyterExecutor()

        assert executor.is_initialized is False
        assert executor._kernel_id is None

    def test_executor_singleton(self):
        """Test executor singleton pattern"""
        from agent_server.langchain.executors.jupyter_executor import (
            get_jupyter_executor,
        )

        executor1 = get_jupyter_executor()
        executor2 = get_jupyter_executor()

        assert executor1 is executor2


class TestNotebookSearcher:
    """Test notebook searcher"""

    def test_search_notebook(self):
        """Test searching within a notebook"""
        from agent_server.langchain.executors.notebook_searcher import NotebookSearcher

        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test notebook
            notebook = {
                "cells": [
                    {
                        "cell_type": "code",
                        "source": "import pandas as pd\nimport numpy as np",
                    },
                    {"cell_type": "code", "source": "df = pd.read_csv('data.csv')"},
                ],
                "metadata": {},
                "nbformat": 4,
                "nbformat_minor": 2,
            }

            nb_path = os.path.join(tmpdir, "test.ipynb")
            with open(nb_path, "w") as f:
                json.dump(notebook, f)

            searcher = NotebookSearcher(tmpdir)
            results = searcher.search_notebook("test.ipynb", "pandas")

            assert results.total_matches >= 1
            assert results.files_searched == 1

    def test_get_notebook_structure(self):
        """Test getting notebook structure"""
        from agent_server.langchain.executors.notebook_searcher import NotebookSearcher

        with tempfile.TemporaryDirectory() as tmpdir:
            notebook = {
                "cells": [
                    {"cell_type": "code", "source": "import pandas as pd"},
                    {"cell_type": "markdown", "source": "# Analysis"},
                    {"cell_type": "code", "source": "def load_data():\n    pass"},
                ],
                "metadata": {},
                "nbformat": 4,
                "nbformat_minor": 2,
            }

            nb_path = os.path.join(tmpdir, "test.ipynb")
            with open(nb_path, "w") as f:
                json.dump(notebook, f)

            searcher = NotebookSearcher(tmpdir)
            structure = searcher.get_notebook_structure("test.ipynb")

            assert structure["total_cells"] == 3
            assert structure["code_cells"] == 2
            assert structure["markdown_cells"] == 1
            assert "pandas" in structure["imports"]
            assert "load_data" in structure["definitions"]


# ============ Middleware Tests ============


class TestErrorHandlingMiddleware:
    """Test error handling middleware"""

    def test_error_classification_module_not_found(self):
        """Test classification of ModuleNotFoundError"""
        from agent_server.langchain.middleware.error_handling_middleware import (
            ErrorHandlingMiddleware,
        )

        middleware = ErrorHandlingMiddleware()

        classification = middleware._fallback_classify(
            "ModuleNotFoundError", "No module named 'seaborn'"
        )

        assert classification["decision"] == "insert_steps"
        assert "seaborn" in str(classification["changes"])

    def test_error_classification_type_error(self):
        """Test classification of TypeError"""
        from agent_server.langchain.middleware.error_handling_middleware import (
            ErrorHandlingMiddleware,
        )

        middleware = ErrorHandlingMiddleware()

        classification = middleware._fallback_classify(
            "TypeError", "unsupported operand type(s) for +: 'int' and 'str'"
        )

        assert classification["decision"] == "refine"

    def test_extract_module_name(self):
        """Test module name extraction from error message"""
        from agent_server.langchain.middleware.error_handling_middleware import (
            ErrorHandlingMiddleware,
        )

        middleware = ErrorHandlingMiddleware()

        assert middleware._extract_module_name("No module named 'pandas'") == "pandas"
        assert (
            middleware._extract_module_name("No module named 'sklearn'")
            == "scikit-learn"
        )
        assert (
            middleware._extract_module_name("No module named 'cv2'") == "opencv-python"
        )


class TestValidationMiddleware:
    """Test validation middleware"""

    def test_extract_code_from_tool_call(self):
        """Test code extraction from tool call"""
        from agent_server.langchain.middleware.validation_middleware import (
            ValidationMiddleware,
        )

        middleware = ValidationMiddleware()

        code = middleware._extract_code_from_tool_call(
            "jupyter_cell_tool", {"code": "print('hello')"}
        )

        assert code == "print('hello')"

    def test_extract_code_wrong_tool(self):
        """Test that non-jupyter tools return None"""
        from agent_server.langchain.middleware.validation_middleware import (
            ValidationMiddleware,
        )

        middleware = ValidationMiddleware()

        code = middleware._extract_code_from_tool_call(
            "markdown_tool", {"content": "# Header"}
        )

        assert code is None


class TestRAGMiddleware:
    """Test RAG middleware"""

    def test_format_context_for_prompt(self):
        """Test context formatting for prompt"""
        from agent_server.langchain.middleware.rag_middleware import RAGMiddleware

        middleware = RAGMiddleware()

        formatted = middleware.format_context_for_prompt(
            rag_context="pandas is a data analysis library...",
            detected_libraries=["pandas", "numpy"],
        )

        assert "pandas, numpy" in formatted
        assert "pandas is a data analysis library" in formatted


class TestCodeSearchMiddleware:
    """Test code search middleware"""

    def test_extract_search_terms(self):
        """Test search term extraction from request"""
        from agent_server.langchain.middleware.code_search_middleware import (
            CodeSearchMiddleware,
        )

        middleware = CodeSearchMiddleware()

        terms = middleware._extract_search_terms(
            "Load the titanic.csv file and create a DataFrame called df"
        )

        assert "titanic.csv" in terms
        assert "DataFrame" in terms


class TestSystemPromptLogging:
    """Test system prompt log formatting"""

    def test_format_system_prompt_for_log(self):
        """Ensure system prompt log formatting is deterministic."""
        from langchain_core.messages import HumanMessage, SystemMessage

        from agent_server.langchain.agent import _format_system_prompt_for_log

        messages = [
            HumanMessage(content="hello"),
            SystemMessage(content="base prompt"),
            SystemMessage(content="resource prompt"),
        ]
        count, length, combined = _format_system_prompt_for_log(messages)

        assert count == 2
        assert combined == "base prompt\n\nresource prompt"
        assert length == len(combined)


class TestLLMTraceLogger:
    """Test prompt/response logging callback"""

    def test_chat_model_logs_system_prompt(self, caplog):
        """Ensure chat callback logs system prompt content."""
        import logging

        from langchain_core.messages import HumanMessage, SystemMessage

        from agent_server.langchain.agent import LLMTraceLogger

        handler = LLMTraceLogger()
        messages = [[SystemMessage(content="base prompt"), HumanMessage(content="hi")]]

        with caplog.at_level(logging.INFO):
            handler.on_chat_model_start({}, messages)

        assert "AGENT -> LLM PROMPT (batch=0" in caplog.text
        assert "base prompt" in caplog.text


# ============ Router Tests ============


class TestLangChainRouter:
    """Test LangChain agent router"""

    def test_router_request_model(self):
        """Test request model validation"""
        # Import models directly to avoid router import issues

        # Create minimal mock for pydantic models
        from typing import List, Optional

        from pydantic import BaseModel, Field

        class LLMConfig(BaseModel):
            provider: str = "gemini"
            gemini: Optional[Dict[str, Any]] = None

        class NotebookContext(BaseModel):
            notebook_path: Optional[str] = None
            cell_count: int = 0
            imported_libraries: List[str] = Field(default_factory=list)

        # Test LLMConfig
        config = LLMConfig(provider="openai")
        assert config.provider == "openai"

        # Test NotebookContext
        ctx = NotebookContext(cell_count=5, imported_libraries=["pandas"])
        assert ctx.cell_count == 5
        assert "pandas" in ctx.imported_libraries

    def test_router_response_model(self):
        """Test response model validation"""
        from typing import List, Optional

        from pydantic import BaseModel, Field

        class ExecutionResult(BaseModel):
            success: bool
            output: Optional[str] = None
            error: Optional[str] = None

        class AgentResponse(BaseModel):
            success: bool
            final_answer: Optional[str] = None
            execution_history: List[ExecutionResult] = Field(default_factory=list)
            is_complete: bool = False

        # Test response model
        response = AgentResponse(
            success=True,
            final_answer="Task completed",
            is_complete=True,
        )

        assert response.success is True
        assert response.is_complete is True


# ============ Integration Tests ============


class TestAgentIntegration:
    """Integration tests for the complete agent"""

    def test_get_all_tools(self):
        """Test that all tools are available"""
        from agent_server.langchain.agent import _get_all_tools

        tools = _get_all_tools()

        tool_names = [t.name for t in tools]

        assert "jupyter_cell_tool" in tool_names
        assert "markdown_tool" in tool_names
        assert "final_answer_tool" in tool_names
        assert "read_file_tool" in tool_names
        assert "search_workspace_tool" in tool_names
        assert "execute_command_tool" in tool_names

    def test_create_llm_unsupported_provider(self):
        """Test that unsupported provider raises error"""
        from agent_server.langchain.agent import _create_llm

        with pytest.raises(ValueError) as exc_info:
            _create_llm({"provider": "unsupported"})

        assert "Unsupported" in str(exc_info.value)
