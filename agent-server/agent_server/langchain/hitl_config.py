"""
Human-in-the-Loop (HITL) configuration for LangChain agent.

Defines which tools require user approval and their approval settings.
"""

from typing import Any, Dict


def get_hitl_interrupt_config() -> Dict[str, Any]:
    """Return HITL interrupt config for client-side tool execution.

    Returns:
        Dictionary mapping tool names to their HITL configuration:
        - False: No approval needed, execute immediately
        - Dict with allowed_decisions and description: Require approval

    The allowed_decisions can include:
        - "approve": Execute the tool as requested
        - "edit": Modify the tool arguments before execution
        - "reject": Cancel the tool execution
    """
    return {
        # Require approval before executing code
        "jupyter_cell_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "🔍 Code execution requires approval",
        },
        # Safe operations - no approval needed
        "markdown_tool": False,
        "read_file_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📄 파일 읽기 실행 중",
        },
        "list_files_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📂 파일 목록 조회 중",
        },
        "write_todos": False,  # Todo updates don't need approval
        # Search tools need HITL for client-side execution (auto-approved by frontend)
        # Uses 'edit' decision to pass execution_result back
        "search_workspace_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "🔍 Searching workspace files",
        },
        "search_notebook_cells_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "🔍 Searching notebook cells",
        },
        # Resource check tool for client-side execution (auto-approved by frontend)
        "check_resource_tool": {
            "allowed_decisions": ["approve", "edit"],
            "description": "📊 Checking system resources",
        },
        "execute_command_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "🖥️ Shell command requires approval",
        },
        # File write requires approval
        "write_file_tool": {
            "allowed_decisions": ["approve", "edit", "reject"],
            "description": "⚠️ File write requires approval",
        },
        # Final answer doesn't need approval
        "final_answer_tool": False,
    }
