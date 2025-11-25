"""
Task Manager - Manages background notebook generation tasks
"""

import asyncio
import uuid
from typing import Dict, Any, Optional, Callable
from datetime import datetime
from enum import Enum


class TaskStatus(Enum):
    """Task status enumeration"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Task:
    """Represents a background task"""

    def __init__(self, task_id: str, prompt: str):
        self.task_id = task_id
        self.prompt = prompt
        self.status = TaskStatus.PENDING
        self.progress = 0
        self.message = "작업 대기 중..."
        self.result = None
        self.error = None
        self.created_at = datetime.now()
        self.started_at = None
        self.completed_at = None
        self.notebook_path = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert task to dictionary"""
        return {
            'taskId': self.task_id,
            'prompt': self.prompt,
            'status': self.status.value,
            'progress': self.progress,
            'message': self.message,
            'result': self.result,
            'error': self.error,
            'notebookPath': self.notebook_path,
            'createdAt': self.created_at.isoformat(),
            'startedAt': self.started_at.isoformat() if self.started_at else None,
            'completedAt': self.completed_at.isoformat() if self.completed_at else None
        }


class TaskManager:
    """Singleton task manager for background operations"""

    _instance = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.tasks: Dict[str, Task] = {}
        self.progress_callbacks: Dict[str, list] = {}

    @classmethod
    async def get_instance(cls):
        """Get singleton instance"""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = TaskManager()
        return cls._instance

    def create_task(self, prompt: str) -> str:
        """Create a new task and return task ID"""
        task_id = str(uuid.uuid4())
        task = Task(task_id, prompt)
        self.tasks[task_id] = task
        self.progress_callbacks[task_id] = []
        return task_id

    def get_task(self, task_id: str) -> Optional[Task]:
        """Get task by ID"""
        return self.tasks.get(task_id)

    def update_progress(self, task_id: str, progress: int, message: str):
        """Update task progress"""
        task = self.tasks.get(task_id)
        if task:
            task.progress = progress
            task.message = message
            # Notify all callbacks
            self._notify_progress(task_id, task)

    def start_task(self, task_id: str):
        """Mark task as started"""
        task = self.tasks.get(task_id)
        if task:
            task.status = TaskStatus.RUNNING
            task.started_at = datetime.now()
            task.progress = 5
            task.message = "작업 시작..."
            self._notify_progress(task_id, task)

    def complete_task(self, task_id: str, notebook_path: str, result: Any = None):
        """Mark task as completed"""
        task = self.tasks.get(task_id)
        if task:
            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now()
            task.progress = 100
            task.message = "완료!"
            task.notebook_path = notebook_path
            task.result = result
            self._notify_progress(task_id, task)

    def fail_task(self, task_id: str, error: str):
        """Mark task as failed"""
        task = self.tasks.get(task_id)
        if task:
            task.status = TaskStatus.FAILED
            task.completed_at = datetime.now()
            task.error = error
            task.message = f"실패: {error}"
            self._notify_progress(task_id, task)

    def cancel_task(self, task_id: str):
        """Cancel a task"""
        task = self.tasks.get(task_id)
        if task and task.status in [TaskStatus.PENDING, TaskStatus.RUNNING]:
            task.status = TaskStatus.CANCELLED
            task.completed_at = datetime.now()
            task.message = "취소됨"
            self._notify_progress(task_id, task)

    def add_progress_callback(self, task_id: str, callback: Callable):
        """Add a callback for progress updates"""
        if task_id in self.progress_callbacks:
            self.progress_callbacks[task_id].append(callback)

    def remove_progress_callback(self, task_id: str, callback: Callable):
        """Remove a progress callback"""
        if task_id in self.progress_callbacks:
            self.progress_callbacks[task_id].remove(callback)

    def _notify_progress(self, task_id: str, task: Task):
        """Notify all callbacks about progress"""
        if task_id in self.progress_callbacks:
            for callback in self.progress_callbacks[task_id]:
                try:
                    callback(task.to_dict())
                except Exception as e:
                    print(f"Error in progress callback: {e}")

    def cleanup_old_tasks(self, max_age_hours: int = 24):
        """Clean up old completed tasks"""
        now = datetime.now()
        to_remove = []

        for task_id, task in self.tasks.items():
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                if task.completed_at:
                    age = (now - task.completed_at).total_seconds() / 3600
                    if age > max_age_hours:
                        to_remove.append(task_id)

        for task_id in to_remove:
            del self.tasks[task_id]
            if task_id in self.progress_callbacks:
                del self.progress_callbacks[task_id]

        return len(to_remove)
