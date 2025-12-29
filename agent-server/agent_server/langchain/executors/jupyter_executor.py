"""
Jupyter Executor (Embedded Mode)

Provides direct access to Jupyter kernel for code execution
when running inside JupyterLab server.

This executor uses the Jupyter server's kernel manager to:
- Execute code in the current notebook's kernel
- Add cells to the notebook
- Retrieve execution results
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    """Result of code execution in Jupyter kernel"""
    success: bool
    output: str = ""
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    traceback: Optional[List[str]] = None
    execution_count: int = 0
    cell_index: int = -1
    display_data: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "output": self.output,
            "error_type": self.error_type,
            "error_message": self.error_message,
            "traceback": self.traceback,
            "execution_count": self.execution_count,
            "cell_index": self.cell_index,
            "display_data": self.display_data,
        }


class JupyterExecutor:
    """
    Executes code in Jupyter kernel (Embedded Mode).
    
    In Embedded Mode, this class directly accesses the Jupyter server's
    kernel manager and contents manager to execute code and modify notebooks.
    
    Usage:
        executor = JupyterExecutor()
        await executor.initialize(kernel_id, notebook_path)
        result = await executor.execute_code("print('hello')")
    """

    def __init__(self):
        self._kernel_manager = None
        self._contents_manager = None
        self._kernel_id: Optional[str] = None
        self._notebook_path: Optional[str] = None
        self._kernel_client = None
        self._initialized = False

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    async def initialize(
        self,
        kernel_id: str,
        notebook_path: str,
        kernel_manager: Any = None,
        contents_manager: Any = None,
    ) -> bool:
        """
        Initialize the executor with kernel and notebook information.
        
        Args:
            kernel_id: ID of the kernel to use
            notebook_path: Path to the notebook file
            kernel_manager: Jupyter's MappingKernelManager (optional, auto-detect)
            contents_manager: Jupyter's ContentsManager (optional, auto-detect)
            
        Returns:
            True if initialization successful
        """
        self._kernel_id = kernel_id
        self._notebook_path = notebook_path

        # Try to get kernel manager from Jupyter server if not provided
        if kernel_manager is None:
            kernel_manager = self._get_kernel_manager()

        if contents_manager is None:
            contents_manager = self._get_contents_manager()

        self._kernel_manager = kernel_manager
        self._contents_manager = contents_manager

        if self._kernel_manager is None:
            logger.warning("Kernel manager not available. Running in mock mode.")
            self._initialized = True
            return True

        # Get kernel client
        try:
            self._kernel_client = self._kernel_manager.get_kernel(kernel_id)
            self._initialized = True
            logger.info(f"JupyterExecutor initialized with kernel {kernel_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to get kernel client: {e}")
            self._initialized = False
            return False

    def _get_kernel_manager(self) -> Optional[Any]:
        """Try to get kernel manager from Jupyter server app"""
        try:
            from jupyter_server.serverapp import ServerApp
            app = ServerApp.instance()
            return app.kernel_manager
        except Exception:
            try:
                # Fallback for older versions
                from notebook.notebookapp import NotebookApp
                app = NotebookApp.instance()
                return app.kernel_manager
            except Exception:
                return None

    def _get_contents_manager(self) -> Optional[Any]:
        """Try to get contents manager from Jupyter server app"""
        try:
            from jupyter_server.serverapp import ServerApp
            app = ServerApp.instance()
            return app.contents_manager
        except Exception:
            try:
                from notebook.notebookapp import NotebookApp
                app = NotebookApp.instance()
                return app.contents_manager
            except Exception:
                return None

    async def execute_code(
        self,
        code: str,
        timeout: float = 60.0,
        add_to_notebook: bool = True,
    ) -> ExecutionResult:
        """
        Execute Python code in the Jupyter kernel.
        
        Args:
            code: Python code to execute
            timeout: Execution timeout in seconds
            add_to_notebook: Whether to add the code as a new cell
            
        Returns:
            ExecutionResult with output or error
        """
        if not self._initialized:
            return ExecutionResult(
                success=False,
                error_type="NotInitialized",
                error_message="Executor not initialized. Call initialize() first."
            )

        # If no kernel manager, use mock execution
        if self._kernel_manager is None:
            return await self._mock_execute(code)

        try:
            # Add cell to notebook if requested
            cell_index = -1
            if add_to_notebook and self._contents_manager:
                cell_index = await self._add_cell_to_notebook(code)

            # Execute code in kernel
            result = await self._execute_in_kernel(code, timeout)
            result.cell_index = cell_index

            return result

        except asyncio.TimeoutError:
            return ExecutionResult(
                success=False,
                error_type="TimeoutError",
                error_message=f"Execution timed out after {timeout} seconds"
            )
        except Exception as e:
            logger.error(f"Execution failed: {e}")
            return ExecutionResult(
                success=False,
                error_type=type(e).__name__,
                error_message=str(e)
            )

    async def _execute_in_kernel(
        self,
        code: str,
        timeout: float
    ) -> ExecutionResult:
        """Execute code using kernel client"""
        # This is a simplified implementation
        # In production, you would use jupyter_client's async API

        try:
            from jupyter_client import KernelClient

            # Get connection info from kernel manager
            km = self._kernel_manager
            kernel = km.get_kernel(self._kernel_id)

            # Create a client and execute
            client = kernel.client()
            client.start_channels()

            try:
                # Send execute request
                msg_id = client.execute(code)

                # Wait for results
                output_parts = []
                error_info = None
                execution_count = 0
                display_data = []

                deadline = asyncio.get_event_loop().time() + timeout

                while True:
                    remaining = deadline - asyncio.get_event_loop().time()
                    if remaining <= 0:
                        raise asyncio.TimeoutError()

                    try:
                        msg = client.get_iopub_msg(timeout=min(remaining, 1.0))
                    except Exception:
                        continue

                    if msg["parent_header"].get("msg_id") != msg_id:
                        continue

                    msg_type = msg["msg_type"]
                    content = msg["content"]

                    if msg_type == "stream":
                        output_parts.append(content.get("text", ""))
                    elif msg_type == "execute_result":
                        output_parts.append(str(content.get("data", {}).get("text/plain", "")))
                        execution_count = content.get("execution_count", 0)
                    elif msg_type == "display_data":
                        display_data.append(content.get("data", {}))
                    elif msg_type == "error":
                        error_info = {
                            "ename": content.get("ename", "Error"),
                            "evalue": content.get("evalue", ""),
                            "traceback": content.get("traceback", []),
                        }
                    elif msg_type == "status" and content.get("execution_state") == "idle":
                        break

                if error_info:
                    return ExecutionResult(
                        success=False,
                        output="".join(output_parts),
                        error_type=error_info["ename"],
                        error_message=error_info["evalue"],
                        traceback=error_info["traceback"],
                        execution_count=execution_count,
                        display_data=display_data,
                    )

                return ExecutionResult(
                    success=True,
                    output="".join(output_parts),
                    execution_count=execution_count,
                    display_data=display_data,
                )

            finally:
                client.stop_channels()

        except ImportError:
            logger.warning("jupyter_client not available, using mock execution")
            return await self._mock_execute(code)
        except Exception as e:
            return ExecutionResult(
                success=False,
                error_type=type(e).__name__,
                error_message=str(e),
            )

    async def _add_cell_to_notebook(self, code: str) -> int:
        """Add a new code cell to the notebook"""
        if not self._contents_manager or not self._notebook_path:
            return -1

        try:
            # Read current notebook
            model = self._contents_manager.get(self._notebook_path, content=True)
            notebook = model["content"]

            # Create new cell
            new_cell = {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": code,
            }

            # Add cell
            notebook["cells"].append(new_cell)
            cell_index = len(notebook["cells"]) - 1

            # Save notebook
            self._contents_manager.save(model, self._notebook_path)

            return cell_index

        except Exception as e:
            logger.error(f"Failed to add cell to notebook: {e}")
            return -1

    async def add_markdown_cell(self, content: str) -> int:
        """Add a markdown cell to the notebook"""
        if not self._contents_manager or not self._notebook_path:
            return -1

        try:
            model = self._contents_manager.get(self._notebook_path, content=True)
            notebook = model["content"]

            new_cell = {
                "cell_type": "markdown",
                "metadata": {},
                "source": content,
            }

            notebook["cells"].append(new_cell)
            cell_index = len(notebook["cells"]) - 1

            self._contents_manager.save(model, self._notebook_path)

            return cell_index

        except Exception as e:
            logger.error(f"Failed to add markdown cell: {e}")
            return -1

    async def _mock_execute(self, code: str) -> ExecutionResult:
        """Mock execution for testing or when kernel is not available"""
        logger.info(f"Mock executing code: {code[:100]}...")

        # Simple mock that just returns success
        return ExecutionResult(
            success=True,
            output=f"[Mock] Code executed successfully:\n{code[:200]}",
            execution_count=1,
        )

    async def get_notebook_state(self) -> Dict[str, Any]:
        """Get current notebook state"""
        if not self._contents_manager or not self._notebook_path:
            return {
                "cell_count": 0,
                "imported_libraries": [],
                "defined_variables": [],
            }

        try:
            model = self._contents_manager.get(self._notebook_path, content=True)
            notebook = model["content"]
            cells = notebook.get("cells", [])

            # Extract imports and variables from code cells
            imported_libraries = set()
            defined_variables = set()

            import re
            import_pattern = re.compile(r'^(?:import|from)\s+([\w.]+)', re.MULTILINE)
            var_pattern = re.compile(r'^(\w+)\s*=', re.MULTILINE)

            for cell in cells:
                if cell.get("cell_type") != "code":
                    continue

                source = cell.get("source", "")
                if isinstance(source, list):
                    source = "".join(source)

                # Find imports
                for match in import_pattern.finditer(source):
                    lib = match.group(1).split(".")[0]
                    imported_libraries.add(lib)

                # Find variable definitions
                for match in var_pattern.finditer(source):
                    defined_variables.add(match.group(1))

            return {
                "cell_count": len(cells),
                "imported_libraries": list(imported_libraries),
                "defined_variables": list(defined_variables),
            }

        except Exception as e:
            logger.error(f"Failed to get notebook state: {e}")
            return {
                "cell_count": 0,
                "imported_libraries": [],
                "defined_variables": [],
            }


# Singleton instance
_executor_instance: Optional[JupyterExecutor] = None


def get_jupyter_executor() -> JupyterExecutor:
    """Get or create the JupyterExecutor singleton"""
    global _executor_instance
    if _executor_instance is None:
        _executor_instance = JupyterExecutor()
    return _executor_instance
