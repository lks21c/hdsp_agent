"""
Watchdog Service - File system monitoring for automatic RAG re-indexing.

Features:
- Monitors knowledge base directory for changes
- Debounces rapid file changes
- Triggers incremental re-indexing
- Pattern-based file filtering
"""

import asyncio
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Optional, Set

if TYPE_CHECKING:
    from hdsp_agent_core.models.rag import WatchdogConfig

logger = logging.getLogger(__name__)


class WatchdogService:
    """
    File system monitoring service for RAG knowledge base.

    Features:
    - Asynchronous file change detection
    - Debouncing to prevent excessive re-indexing
    - Pattern-based filtering (*.md, *.py, etc.)
    - Ignore patterns for cache/build directories
    - Callback-based notification

    Usage:
        service = WatchdogService(config, on_change_callback)
        service.start("/path/to/knowledge")
        # ... later
        service.stop()
    """

    def __init__(
        self,
        config: "WatchdogConfig",
        on_change_callback: Optional[Callable[[Set[Path]], None]] = None,
    ):
        self._config = config
        self._on_change = on_change_callback
        self._observer = None
        self._running = False
        self._pending_changes: Set[Path] = set()
        self._last_change_time: Optional[datetime] = None
        self._debounce_task: Optional[asyncio.Task] = None
        self._lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self, watch_path: Path) -> bool:
        """
        Start monitoring the specified directory.

        Args:
            watch_path: Directory to monitor

        Returns:
            True if monitoring started successfully
        """
        if not self._config.enabled:
            logger.info("Watchdog disabled by configuration")
            return False

        if self._running:
            logger.warning("Watchdog already running")
            return True

        try:
            from watchdog.events import FileSystemEvent, FileSystemEventHandler
            from watchdog.observers import Observer
        except ImportError:
            logger.warning(
                "watchdog not installed, file monitoring disabled. "
                "Install with: pip install watchdog"
            )
            return False

        if not watch_path.exists():
            logger.warning(f"Watch path does not exist: {watch_path}")
            return False

        # Store event loop for async callbacks
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        # Create event handler
        handler = self._create_event_handler(FileSystemEventHandler)

        # Start observer
        self._observer = Observer()
        self._observer.schedule(handler, str(watch_path), recursive=True)
        self._observer.start()
        self._running = True

        logger.info(f"Watchdog started monitoring: {watch_path}")
        return True

    def _create_event_handler(self, base_class):
        """Create a watchdog event handler class."""
        service = self

        class RAGEventHandler(base_class):
            def on_any_event(self, event):
                if event.is_directory:
                    return

                # Get file path
                file_path = Path(event.src_path)

                # Check if file matches patterns
                if not service._should_process(file_path):
                    return

                # Queue the change
                service._queue_change(file_path)

        return RAGEventHandler()

    def _should_process(self, file_path: Path) -> bool:
        """Check if file should trigger re-indexing."""
        file_name = file_path.name

        # Check ignore patterns
        for pattern in self._config.ignore_patterns:
            if file_name.startswith(pattern.replace("*", "")):
                return False
            if pattern.startswith("*") and file_name.endswith(pattern[1:]):
                return False

        # Check include patterns
        for pattern in self._config.patterns:
            if pattern.startswith("*"):
                suffix = pattern[1:]
                if file_name.endswith(suffix):
                    return True
            elif file_name == pattern:
                return True

        return False

    def _queue_change(self, file_path: Path) -> None:
        """Queue a file change for processing."""
        with self._lock:
            self._pending_changes.add(file_path)
            self._last_change_time = datetime.now()

        logger.debug(f"Queued change: {file_path}")

        # Schedule debounced processing
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._schedule_debounce)

    def _schedule_debounce(self) -> None:
        """Schedule the debounced callback."""
        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()

        self._debounce_task = asyncio.create_task(self._debounced_callback())

    async def _debounced_callback(self) -> None:
        """Wait for debounce period then trigger callback."""
        try:
            await asyncio.sleep(self._config.debounce_seconds)

            # Get pending changes
            with self._lock:
                if not self._pending_changes:
                    return

                changes = self._pending_changes.copy()
                self._pending_changes.clear()

            logger.info(f"Processing {len(changes)} file changes")

            # Trigger callback
            if self._on_change:
                try:
                    self._on_change(changes)
                except Exception as e:
                    logger.error(f"Error in change callback: {e}")

        except asyncio.CancelledError:
            # Debounce was reset, ignore
            pass
        except Exception as e:
            logger.error(f"Error in debounced callback: {e}")

    def stop(self) -> None:
        """Stop file monitoring."""
        if not self._running:
            return

        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None

        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()

        self._running = False
        self._pending_changes.clear()

        logger.info("Watchdog stopped")

    @property
    def is_running(self) -> bool:
        """Check if watchdog is currently running."""
        return self._running

    @property
    def pending_count(self) -> int:
        """Get number of pending changes."""
        with self._lock:
            return len(self._pending_changes)


class SimpleWatchdog:
    """
    Simplified watchdog for polling-based monitoring.

    Use this when the watchdog library is not available
    or for environments where filesystem events are unreliable.
    """

    def __init__(
        self,
        patterns: list[str] = None,
        check_interval: float = 10.0,
        on_change_callback: Optional[Callable[[Set[Path]], None]] = None,
    ):
        self._patterns = patterns or ["*.md", "*.py", "*.txt"]
        self._check_interval = check_interval
        self._on_change = on_change_callback
        self._running = False
        self._file_mtimes: dict[Path, float] = {}
        self._check_task: Optional[asyncio.Task] = None

    async def start(self, watch_path: Path) -> bool:
        """Start polling-based monitoring."""
        if self._running:
            return True

        if not watch_path.exists():
            logger.warning(f"Watch path does not exist: {watch_path}")
            return False

        self._running = True
        self._check_task = asyncio.create_task(self._poll_loop(watch_path))

        logger.info(f"SimpleWatchdog started polling: {watch_path}")
        return True

    async def _poll_loop(self, watch_path: Path) -> None:
        """Main polling loop."""
        # Initial scan
        self._scan_directory(watch_path)

        while self._running:
            try:
                await asyncio.sleep(self._check_interval)

                if not self._running:
                    break

                # Check for changes
                changes = self._check_changes(watch_path)

                if changes and self._on_change:
                    try:
                        self._on_change(changes)
                    except Exception as e:
                        logger.error(f"Error in change callback: {e}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in poll loop: {e}")

    def _scan_directory(self, watch_path: Path) -> None:
        """Scan directory and record file mtimes."""
        for pattern in self._patterns:
            for file_path in watch_path.rglob(pattern.lstrip("*")):
                if file_path.is_file():
                    try:
                        self._file_mtimes[file_path] = file_path.stat().st_mtime
                    except OSError:
                        pass

    def _check_changes(self, watch_path: Path) -> Set[Path]:
        """Check for file changes since last scan."""
        changes = set()
        current_files: Set[Path] = set()

        # Check existing files
        for pattern in self._patterns:
            suffix = pattern.lstrip("*")
            for file_path in watch_path.rglob(f"*{suffix}"):
                if not file_path.is_file():
                    continue

                current_files.add(file_path)

                try:
                    mtime = file_path.stat().st_mtime
                except OSError:
                    continue

                # Check if new or modified
                if file_path not in self._file_mtimes:
                    changes.add(file_path)
                    self._file_mtimes[file_path] = mtime
                elif self._file_mtimes[file_path] != mtime:
                    changes.add(file_path)
                    self._file_mtimes[file_path] = mtime

        # Check for deleted files
        deleted = set(self._file_mtimes.keys()) - current_files
        for file_path in deleted:
            del self._file_mtimes[file_path]
            # Note: We don't add deleted files to changes
            # The RAG system should handle missing files gracefully

        return changes

    async def stop(self) -> None:
        """Stop polling."""
        self._running = False

        if self._check_task and not self._check_task.done():
            self._check_task.cancel()
            try:
                await self._check_task
            except asyncio.CancelledError:
                pass

        self._file_mtimes.clear()
        logger.info("SimpleWatchdog stopped")

    @property
    def is_running(self) -> bool:
        """Check if watchdog is currently running."""
        return self._running
