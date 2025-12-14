"""
Unit tests for SessionManager - persistent session storage.
"""

import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import tempfile

from backend.services.session_manager import (
    SessionManager,
    Session,
    ChatMessage,
    get_session_manager,
)


@pytest.fixture
def temp_storage_path(tmp_path):
    """Create a temporary storage path for testing."""
    return tmp_path / "test_sessions.json"


@pytest.fixture
def session_manager(temp_storage_path):
    """Create a fresh SessionManager instance with temp storage."""
    # Reset singleton
    SessionManager._instance = None

    # Create instance and manually set storage path
    manager = object.__new__(SessionManager)
    manager._initialized = False
    manager._sessions = {}
    manager._storage_path = temp_storage_path
    manager._initialized = True
    return manager


class TestChatMessage:
    """Tests for ChatMessage dataclass."""

    def test_create_with_defaults(self):
        """ChatMessage creates with role and content, auto-timestamps."""
        msg = ChatMessage(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"
        assert msg.timestamp > 0

    def test_create_with_timestamp(self):
        """ChatMessage accepts explicit timestamp."""
        msg = ChatMessage(role="assistant", content="Hi", timestamp=1234567890.0)
        assert msg.timestamp == 1234567890.0


class TestSession:
    """Tests for Session dataclass."""

    def test_create_with_defaults(self):
        """Session creates with ID and default values."""
        session = Session(id="test-123")
        assert session.id == "test-123"
        assert session.messages == []
        assert session.created_at > 0
        assert session.updated_at > 0
        assert session.metadata is None

    def test_create_with_messages(self):
        """Session accepts messages list."""
        msgs = [ChatMessage(role="user", content="Hello")]
        session = Session(id="test-456", messages=msgs)
        assert len(session.messages) == 1
        assert session.messages[0].content == "Hello"


class TestSessionManager:
    """Tests for SessionManager class."""

    def test_create_session_generates_uuid(self, session_manager):
        """create_session generates UUID if not provided."""
        session = session_manager.create_session()
        assert session.id is not None
        assert len(session.id) == 36  # UUID format

    def test_create_session_with_custom_id(self, session_manager):
        """create_session uses provided ID."""
        session = session_manager.create_session("custom-id")
        assert session.id == "custom-id"

    def test_get_session_existing(self, session_manager):
        """get_session returns existing session."""
        session_manager.create_session("test-id")
        retrieved = session_manager.get_session("test-id")
        assert retrieved is not None
        assert retrieved.id == "test-id"

    def test_get_session_nonexistent(self, session_manager):
        """get_session returns None for nonexistent session."""
        result = session_manager.get_session("nonexistent")
        assert result is None

    def test_get_or_create_session_new(self, session_manager):
        """get_or_create_session creates new if not exists."""
        session = session_manager.get_or_create_session("new-session")
        assert session.id == "new-session"

    def test_get_or_create_session_existing(self, session_manager):
        """get_or_create_session returns existing session."""
        session_manager.create_session("existing")
        session_manager._sessions["existing"].messages.append(
            ChatMessage(role="user", content="Test")
        )
        retrieved = session_manager.get_or_create_session("existing")
        assert len(retrieved.messages) == 1

    def test_add_message(self, session_manager):
        """add_message appends message to session."""
        session_manager.create_session("msg-test")
        msg = session_manager.add_message("msg-test", "user", "Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"

        session = session_manager.get_session("msg-test")
        assert len(session.messages) == 1

    def test_add_message_creates_session(self, session_manager):
        """add_message creates session if not exists."""
        session_manager.add_message("auto-create", "user", "Test")
        session = session_manager.get_session("auto-create")
        assert session is not None
        assert len(session.messages) == 1

    def test_store_messages(self, session_manager):
        """store_messages adds user and assistant messages."""
        session_manager.store_messages("store-test", "User msg", "Assistant msg")
        session = session_manager.get_session("store-test")
        assert len(session.messages) == 2
        assert session.messages[0].role == "user"
        assert session.messages[0].content == "User msg"
        assert session.messages[1].role == "assistant"
        assert session.messages[1].content == "Assistant msg"

    def test_get_recent_messages(self, session_manager):
        """get_recent_messages returns limited recent messages."""
        session_manager.create_session("recent-test")
        for i in range(10):
            session_manager.add_message("recent-test", "user", f"Message {i}")

        recent = session_manager.get_recent_messages("recent-test", limit=3)
        assert len(recent) == 3
        assert recent[0].content == "Message 7"
        assert recent[2].content == "Message 9"

    def test_get_recent_messages_empty_session(self, session_manager):
        """get_recent_messages returns empty list for nonexistent session."""
        result = session_manager.get_recent_messages("nonexistent")
        assert result == []

    def test_build_context(self, session_manager):
        """build_context returns formatted context string."""
        session_manager.store_messages("ctx-test", "Hello", "Hi there")
        context = session_manager.build_context("ctx-test")
        assert "User: Hello" in context
        assert "Assistant: Hi there" in context

    def test_build_context_empty(self, session_manager):
        """build_context returns None for empty/nonexistent session."""
        result = session_manager.build_context("nonexistent")
        assert result is None

    def test_list_sessions(self, session_manager):
        """list_sessions returns sessions sorted by updated_at."""
        import time

        session_manager.create_session("session-1")
        time.sleep(0.01)
        session_manager.create_session("session-2")
        time.sleep(0.01)
        session_manager.add_message("session-1", "user", "Update")  # Updates session-1

        sessions = session_manager.list_sessions()
        assert len(sessions) == 2
        assert sessions[0].id == "session-1"  # Most recently updated

    def test_delete_session(self, session_manager):
        """delete_session removes session."""
        session_manager.create_session("to-delete")
        assert session_manager.get_session("to-delete") is not None

        result = session_manager.delete_session("to-delete")
        assert result is True
        assert session_manager.get_session("to-delete") is None

    def test_delete_session_nonexistent(self, session_manager):
        """delete_session returns False for nonexistent session."""
        result = session_manager.delete_session("nonexistent")
        assert result is False

    def test_clear_all_sessions(self, session_manager):
        """clear_all_sessions removes all sessions."""
        session_manager.create_session("s1")
        session_manager.create_session("s2")
        session_manager.create_session("s3")

        count = session_manager.clear_all_sessions()
        assert count == 3
        assert len(session_manager.list_sessions()) == 0


class TestSessionPersistence:
    """Tests for file-based persistence."""

    def test_save_and_load(self, temp_storage_path):
        """Sessions are saved to and loaded from file."""
        # Reset singleton
        SessionManager._instance = None

        # Create manager and add data
        manager1 = SessionManager.__new__(SessionManager)
        manager1._initialized = False
        manager1._sessions = {}
        manager1._storage_path = temp_storage_path
        manager1._initialized = True

        manager1.create_session("persist-test")
        manager1.store_messages("persist-test", "Hello", "World")
        manager1._save_sessions()

        # Verify file exists
        assert temp_storage_path.exists()

        # Create new manager instance and load
        manager2 = SessionManager.__new__(SessionManager)
        manager2._initialized = False
        manager2._sessions = {}
        manager2._storage_path = temp_storage_path
        manager2._load_sessions()
        manager2._initialized = True

        session = manager2.get_session("persist-test")
        assert session is not None
        assert len(session.messages) == 2

    def test_load_corrupted_file(self, temp_storage_path):
        """load_sessions handles corrupted JSON gracefully."""
        temp_storage_path.write_text("invalid json {{{", encoding="utf-8")

        # Reset singleton
        SessionManager._instance = None

        manager = SessionManager.__new__(SessionManager)
        manager._initialized = False
        manager._sessions = {}
        manager._storage_path = temp_storage_path
        manager._load_sessions()

        # Should start fresh after corrupted file
        assert manager._sessions == {}

    def test_load_nonexistent_file(self, temp_storage_path):
        """load_sessions handles missing file gracefully."""
        # Reset singleton
        SessionManager._instance = None

        manager = SessionManager.__new__(SessionManager)
        manager._initialized = False
        manager._sessions = {}
        manager._storage_path = temp_storage_path  # Doesn't exist
        manager._load_sessions()

        assert manager._sessions == {}


class TestSingletonAccessor:
    """Tests for get_session_manager singleton accessor."""

    def test_get_session_manager_returns_singleton(self, temp_storage_path, monkeypatch):
        """get_session_manager returns same instance."""
        # Reset singleton and global accessor
        SessionManager._instance = None

        import backend.services.session_manager as sm

        sm._session_manager = None

        # Patch the storage path in the class's __init__
        original_init = SessionManager.__init__

        def patched_init(self):
            if hasattr(self, "_initialized") and self._initialized:
                return
            self._initialized = True
            self._sessions = {}
            self._storage_path = temp_storage_path
            # Don't load sessions from file in test

        monkeypatch.setattr(SessionManager, "__init__", patched_init)

        manager1 = get_session_manager()
        manager2 = get_session_manager()
        assert manager1 is manager2

        # Restore
        monkeypatch.setattr(SessionManager, "__init__", original_init)
