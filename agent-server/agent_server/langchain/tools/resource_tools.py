"""
Resource Check Tools for LangChain Agent

Provides a tool for checking resource availability before data processing.
This tool is executed on the client (Jupyter) side to accurately measure:
- System resources (RAM, CPU)
- File sizes for target files
- In-memory DataFrame shapes

Key features:
- On-demand resource checking (only when LLM needs it)
- Returns actionable recommendations (in-memory vs DASK/Chunking)
- Supports both file paths and DataFrame variable names
"""

import logging
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class CheckResourceInput(BaseModel):
    """Input schema for check_resource tool"""

    files: List[str] = Field(
        default=[],
        description="List of file paths to check sizes for (e.g., ['data.csv', 'train.parquet'])",
    )
    dataframes: List[str] = Field(
        default=[],
        description="List of DataFrame variable names to check in memory (e.g., ['df', 'train_df'])",
    )
    execution_result: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Execution result payload from the client",
    )


def _build_file_size_command(files: List[str]) -> str:
    """
    Build a shell command to get file sizes.
    Uses stat for cross-platform compatibility.
    """
    if not files:
        return ""
    
    # Use stat with format that works on both macOS and Linux
    # macOS: stat -f "%z %N"
    # Linux: stat -c "%s %n"
    # We use a portable approach with ls -l
    file_list = " ".join(f"'{f}'" for f in files)
    return f"ls -l {file_list} 2>/dev/null | awk '{{print $5, $NF}}'"


def _build_dataframe_check_code(dataframes: List[str]) -> str:
    """
    Build Python code to check DataFrame shapes and memory usage.
    Returns a JSON-serializable result.
    """
    if not dataframes:
        return ""
    
    df_checks = []
    for df_name in dataframes:
        df_checks.append(f'''
try:
    _df = {df_name}
    _info = {{
        "name": "{df_name}",
        "exists": True,
        "rows": len(_df) if hasattr(_df, '__len__') else None,
        "cols": len(_df.columns) if hasattr(_df, 'columns') else None,
        "memory_mb": round(_df.memory_usage(deep=True).sum() / 1024 / 1024, 2) if hasattr(_df, 'memory_usage') else None,
        "type": type(_df).__name__
    }}
except NameError:
    _info = {{"name": "{df_name}", "exists": False}}
_results.append(_info)
''')
    
    code = f'''
import json
_results = []
{chr(10).join(df_checks)}
print(json.dumps(_results))
'''
    return code.strip()


@tool(args_schema=CheckResourceInput)
def check_resource_tool(
    files: List[str] = None,
    dataframes: List[str] = None,
    execution_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Check system resources, file sizes, and DataFrame shapes before data processing.

    IMPORTANT: Call this tool BEFORE writing any data analysis or ML code to ensure
    the generated code uses appropriate memory strategies (ex. in-memory vs DASK/Chunking).

    Args:
        files: List of file paths to check sizes for (e.g., ['data.csv', 'train.parquet'])
        dataframes: List of DataFrame variable names in memory (e.g., ['df', 'train_df'])

    Returns:
        Dict with:
        - system: Current RAM/CPU availability (ram_available_mb, ram_total_mb, cpu_cores)
        - files: File sizes in MB for each requested file
        - dataframes: DataFrame shapes and memory usage for each requested variable
    """
    if files is None:
        files = []
    if dataframes is None:
        dataframes = []

    # Build commands for client-side execution
    file_size_command = _build_file_size_command(files)
    dataframe_check_code = _build_dataframe_check_code(dataframes)

    response: Dict[str, Any] = {
        "tool": "check_resource_tool",
        "parameters": {
            "files": files,
            "dataframes": dataframes,
        },
        "file_size_command": file_size_command,
        "dataframe_check_code": dataframe_check_code,
        "status": "pending_execution",
        "message": "Resource check queued for execution by client",
    }

    if execution_result is not None:
        response["execution_result"] = execution_result
        response["status"] = "complete"
        response["message"] = "Resource check completed"
        
        # Parse the execution result
        if isinstance(execution_result, dict):
            response["success"] = execution_result.get("success", False)
            
            # System resources
            response["system"] = execution_result.get("system", {})
            
            # File sizes
            response["files"] = execution_result.get("files", [])
            
            # DataFrame info
            response["dataframes"] = execution_result.get("dataframes", [])
            
            if "error" in execution_result:
                response["error"] = execution_result["error"]

    return response


# Export
RESOURCE_TOOLS = [check_resource_tool]
