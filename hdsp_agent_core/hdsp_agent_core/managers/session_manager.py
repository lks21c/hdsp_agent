"""
Session Manager for persistent conversation storage.

Provides file-based persistence for chat sessions, allowing conversation
history to survive server restarts.
"""

import json
import uuid
from pathlib import Path
from dataclasses import dataclass, asdict, field
from typing import List, Dict, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    """Individual chat message in a session."""

    role: str  # 'user' | 'assistant'
    content: str
    timestamp: float = field(default_factory=lambda: datetime.now().timestamp())


@dataclass
class Session:
    """Chat session with message history."""

    id: str
    messages: List[ChatMessage] = field(default_factory=list)
    created_at: float = field(default_factory=lambda: datetime.now().timestamp())
    updated_at: float = field(default_factory=lambda: datetime.now().timestamp())
    metadata: Optional[Dict] = None


class SessionManager:
    """
    Manages chat session persistence.

    Singleton pattern ensures consistent state across handlers.
    Sessions are stored as JSON in ~/.jupyter/hdsp_agent_sessions.json.
    """

    _instance: Optional["SessionManager"] = None

    def __new__(cls) -> "SessionManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, "_initialized") and self._initialized:
            return
        self._initialized = True
        self._sessions: Dict[str, Session] = {}
        self._storage_path = Path.home() / ".jupyter" / "hdsp_agent_sessions.json"
        self._load_sessions()

    @classmethod
    def reset_instance(cls):
        """Reset singleton instance (for testing)"""
        cls._instance = None

    def _load_sessions(self) -> None:
        """Load sessions from persistent storage."""
        try:
            if self._storage_path.exists():
                data = json.loads(self._storage_path.read_text(encoding="utf-8"))
                for sid, sdata in data.items():
                    self._sessions[sid] = Session(
                        id=sdata["id"],
                        messages=[ChatMessage(**m) for m in sdata.get("messages", [])],
                        created_at=sdata.get("created_at", datetime.now().timestamp()),
                        updated_at=sdata.get("updated_at", datetime.now().timestamp()),
                        metadata=sdata.get("metadata"),
                    )
                logger.info(
                    f"Loaded {len(self._sessions)} sessions from {self._storage_path}"
                )
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse sessions file: {e}. Starting fresh.")
            self._sessions = {}
        except Exception as e:
            logger.error(f"Failed to load sessions: {e}")
            self._sessions = {}

    def _save_sessions(self) -> None:
        """Persist sessions to storage."""
        try:
            data = {}
            for sid, session in self._sessions.items():
                data[sid] = {
                    "id": session.id,
                    "messages": [asdict(m) for m in session.messages],
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                    "metadata": session.metadata,
                }
            self._storage_path.parent.mkdir(parents=True, exist_ok=True)
            self._storage_path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as e:
            logger.error(f"Failed to save sessions: {e}")

    def get_session(self, session_id: str) -> Optional[Session]:
        """Get session by ID."""
        return self._sessions.get(session_id)

    def create_session(self, session_id: Optional[str] = None) -> Session:
        """Create a new session with optional custom ID."""
        sid = session_id or str(uuid.uuid4())
        now = datetime.now().timestamp()
        session = Session(id=sid, messages=[], created_at=now, updated_at=now)
        self._sessions[sid] = session
        self._save_sessions()
        logger.debug(f"Created new session: {sid}")
        return session

    def get_or_create_session(self, session_id: Optional[str] = None) -> Session:
        """Get existing session or create new one."""
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        return self.create_session(session_id)

    def add_message(self, session_id: str, role: str, content: str) -> ChatMessage:
        """Add a message to a session. Creates session if needed."""
        session = self._sessions.get(session_id)
        if not session:
            session = self.create_session(session_id)

        msg = ChatMessage(role=role, content=content)
        session.messages.append(msg)
        session.updated_at = msg.timestamp
        self._save_sessions()
        return msg

    def store_messages(
        self, session_id: str, user_message: str, assistant_response: str
    ) -> None:
        """Store user and assistant message pair. Creates session if needed."""
        session = self._sessions.get(session_id)
        if not session:
            session = self.create_session(session_id)

        now = datetime.now().timestamp()
        session.messages.append(
            ChatMessage(role="user", content=user_message, timestamp=now)
        )
        session.messages.append(
            ChatMessage(role="assistant", content=assistant_response, timestamp=now)
        )
        session.updated_at = now
        self._save_sessions()

    def get_recent_messages(
        self, session_id: str, limit: int = 10
    ) -> List[ChatMessage]:
        """Get most recent messages from a session."""
        session = self._sessions.get(session_id)
        if not session:
            return []
        return session.messages[-limit:]

    def build_context(
        self,
        session_id: str,
        max_messages: int = 5,
        compress: bool = False,
        target_tokens: Optional[int] = None,
    ) -> Optional[str]:
        """Build conversation context string from recent history.

        Args:
            session_id: Session ID to get context from
            max_messages: Maximum messages to include (before compression)
            compress: Enable context compression for token efficiency
            target_tokens: Target token count for compression (default: auto)

        Returns:
            Formatted context string or None if session empty
        """
        session = self._sessions.get(session_id)
        if not session or not session.messages:
            return None

        messages = session.messages[-max_messages:]

        if compress:
            # Lazy import to avoid circular dependency
            try:
                from hdsp_agent_core.core.context_condenser import get_context_condenser
                condenser = get_context_condenser()
                msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
                compressed, _stats = condenser.condense(msg_dicts, target_tokens)
                messages_to_format = compressed
            except ImportError:
                # Fallback if context_condenser not available
                messages_to_format = [
                    {"role": m.role, "content": m.content} for m in messages
                ]
        else:
            messages_to_format = [
                {"role": m.role, "content": m.content} for m in messages
            ]

        return "\n".join(
            [
                f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
                for msg in messages_to_format
            ]
        )

    def list_sessions(self, limit: int = 50) -> List[Session]:
        """List sessions sorted by most recently updated."""
        sessions = sorted(
            self._sessions.values(), key=lambda s: s.updated_at, reverse=True
        )
        return sessions[:limit]

    def delete_session(self, session_id: str) -> bool:
        """Delete a session by ID."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            self._save_sessions()
            logger.debug(f"Deleted session: {session_id}")
            return True
        return False

    def clear_all_sessions(self) -> int:
        """Delete all sessions. Returns count of deleted sessions."""
        count = len(self._sessions)
        self._sessions = {}
        self._save_sessions()
        logger.info(f"Cleared {count} sessions")
        return count


# Singleton accessor
_session_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    """Get the singleton SessionManager instance."""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager
