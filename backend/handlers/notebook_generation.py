"""
Notebook Generation Handler - Handles notebook generation requests
"""

import asyncio
import json
from tornado import web
from tornado.iostream import StreamClosedError
from .base import BaseAgentHandler
from ..services.task_manager import TaskManager
from ..services.notebook_generator import NotebookGenerator


class NotebookGenerationHandler(BaseAgentHandler):
    """Handle notebook generation requests"""

    @web.authenticated
    async def post(self):
        """Start a new notebook generation task"""
        try:
            # Parse request
            data = self.get_json_body()

            # Validate required fields
            if 'prompt' not in data:
                self.write_error_json(400, "Missing required field: prompt")
                return

            prompt = data['prompt']
            output_dir = data.get('outputDir')

            # Create task
            task_manager = await TaskManager.get_instance()
            task_id = task_manager.create_task(prompt)

            # Get LLM service and config before background task (same as ChatHandler)
            from ..llm_service import LLMService
            config_manager = self.settings.get('config_manager')

            if not config_manager:
                self.write_error_json(500, 'Configuration manager not available')
                return

            config = config_manager.get_config()

            if not config or 'provider' not in config:
                self.write_error_json(400, 'LLM not configured. Please configure your LLM provider in settings.')
                return

            llm_service = LLMService(config)

            # Start generation in background
            asyncio.create_task(self._generate_notebook_async(task_id, prompt, output_dir, llm_service))

            # Return task ID immediately
            self.write_json({
                'taskId': task_id,
                'status': 'accepted',
                'message': '노트북 생성을 시작했습니다'
            })

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Notebook generation request failed: {e}")
            self.write_error_json(500, "Internal server error")

    async def _generate_notebook_async(self, task_id: str, prompt: str, output_dir: str, llm_service):
        """Generate notebook asynchronously"""
        try:
            task_manager = await TaskManager.get_instance()
            generator = NotebookGenerator(llm_service, task_manager)

            # Generate notebook
            notebook_path = await generator.generate_notebook(task_id, prompt, output_dir)

            self.log.info(f"Notebook generated successfully: {notebook_path}")

        except Exception as e:
            self.log.error(f"Notebook generation failed for task {task_id}: {e}")
            task_manager = await TaskManager.get_instance()
            task_manager.fail_task(task_id, str(e))


class TaskHandlerMixin:
    """Mixin providing common task operations"""

    async def _get_task_or_error(self, task_id: str):
        """Get task by ID, returns (task_manager, task) or writes error and returns (None, None)"""
        task_manager = await TaskManager.get_instance()
        task = task_manager.get_task(task_id)

        if not task:
            self.write_error_json(404, f"Task not found: {task_id}")
            return None, None

        return task_manager, task


class TaskStatusHandler(TaskHandlerMixin, BaseAgentHandler):
    """Handle task status queries"""

    @web.authenticated
    async def get(self, task_id: str):
        """Get task status"""
        try:
            task_manager, task = await self._get_task_or_error(task_id)
            if not task:
                return

            self.write_json(task.to_dict())

        except Exception as e:
            self.log.error(f"Failed to get task status: {e}")
            self.write_error_json(500, "Internal server error")


class TaskStatusStreamHandler(TaskHandlerMixin, BaseAgentHandler):
    """Handle Server-Sent Events for task progress"""

    @web.authenticated
    async def get(self, task_id: str):
        """Stream task progress updates via SSE"""
        try:
            task_manager, task = await self._get_task_or_error(task_id)
            if not task:
                return

            # Set SSE headers
            self.set_header('Content-Type', 'text/event-stream')
            self.set_header('Cache-Control', 'no-cache')
            self.set_header('Connection', 'keep-alive')
            self.set_header('X-Accel-Buffering', 'no')

            # Send initial state
            await self._send_sse_message(task.to_dict())

            # Create callback for progress updates
            callback_queue = asyncio.Queue()

            def progress_callback(data):
                asyncio.create_task(callback_queue.put(data))

            # Register callback
            task_manager.add_progress_callback(task_id, progress_callback)

            try:
                # Stream updates
                while True:
                    # Wait for update with timeout
                    try:
                        data = await asyncio.wait_for(callback_queue.get(), timeout=30.0)
                        await self._send_sse_message(data)

                        # Stop if task is complete
                        if data['status'] in ['completed', 'failed', 'cancelled']:
                            break

                    except asyncio.TimeoutError:
                        # Send heartbeat
                        await self._send_sse_comment("heartbeat")

            finally:
                # Cleanup
                task_manager.remove_progress_callback(task_id, progress_callback)

        except StreamClosedError:
            self.log.info(f"Client disconnected from task stream: {task_id}")
        except Exception as e:
            self.log.error(f"Task status stream failed: {e}")

    async def _send_sse_message(self, data: dict):
        """Send SSE message"""
        message = f"data: {json.dumps(data)}\n\n"
        self.write(message)
        await self.flush()

    async def _send_sse_comment(self, comment: str):
        """Send SSE comment (for heartbeat)"""
        message = f": {comment}\n\n"
        self.write(message)
        await self.flush()


class TaskCancelHandler(TaskHandlerMixin, BaseAgentHandler):
    """Handle task cancellation"""

    @web.authenticated
    async def post(self, task_id: str):
        """Cancel a task"""
        try:
            task_manager, task = await self._get_task_or_error(task_id)
            if not task:
                return

            task_manager.cancel_task(task_id)

            self.write_json({
                'taskId': task_id,
                'status': 'cancelled',
                'message': '작업이 취소되었습니다'
            })

        except Exception as e:
            self.log.error(f"Failed to cancel task: {e}")
            self.write_error_json(500, "Internal server error")
