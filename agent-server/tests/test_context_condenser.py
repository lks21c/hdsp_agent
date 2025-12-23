"""
Unit tests for ContextCondenser - intelligent context compression.
"""

import pytest
from agent_server.core.context_condenser import (
    ContextCondenser,
    CompressionStrategy,
    CompressionStats,
    get_context_condenser,
)


@pytest.fixture
def condenser():
    """Create a fresh ContextCondenser instance."""
    return ContextCondenser(provider="default")


@pytest.fixture
def sample_messages():
    """Create sample conversation messages."""
    return [
        {"role": "user", "content": "Hello, how are you today?"},
        {"role": "assistant", "content": "I'm doing well, thank you for asking!"},
        {"role": "user", "content": "Can you help me with Python programming?"},
        {"role": "assistant", "content": "Of course! I'd be happy to help with Python."},
        {"role": "user", "content": "How do I read a file in Python?"},
    ]


@pytest.fixture
def long_messages():
    """Create messages that exceed typical token limits."""
    long_content = "This is a long message. " * 100  # ~500 words
    return [
        {"role": "user", "content": long_content},
        {"role": "assistant", "content": long_content},
        {"role": "user", "content": long_content},
        {"role": "assistant", "content": long_content},
        {"role": "user", "content": "Final short message."},
    ]


class TestContextCondenser:
    """Tests for ContextCondenser class."""

    def test_init_default_provider(self):
        """ContextCondenser initializes with default provider."""
        condenser = ContextCondenser()
        assert condenser.provider == "default"
        assert condenser.get_token_limit() == 4000

    def test_init_with_provider(self):
        """ContextCondenser respects provider setting."""
        gemini_condenser = ContextCondenser(provider="gemini")
        assert gemini_condenser.provider == "gemini"
        assert gemini_condenser.get_token_limit() == 30000

        openai_condenser = ContextCondenser(provider="openai")
        assert openai_condenser.get_token_limit() == 4000

    def test_provider_setter(self, condenser):
        """Provider can be changed after init."""
        condenser.provider = "gemini"
        assert condenser.provider == "gemini"
        assert condenser.get_token_limit() == 30000


class TestTokenEstimation:
    """Tests for token estimation."""

    def test_estimate_tokens_empty(self, condenser):
        """Empty string returns 0 tokens."""
        assert condenser.estimate_tokens("") == 0
        assert condenser.estimate_tokens(None) == 0

    def test_estimate_tokens_short(self, condenser):
        """Short text estimation is reasonable."""
        # "Hello world" = 2 words * 1.3 = 2.6 → 2 tokens
        tokens = condenser.estimate_tokens("Hello world")
        assert tokens >= 2
        assert tokens <= 5

    def test_estimate_tokens_long(self, condenser):
        """Long text scales appropriately."""
        text = " ".join(["word"] * 100)  # 100 words
        tokens = condenser.estimate_tokens(text)
        # 100 words * 1.3 = 130 tokens
        assert tokens == 130


class TestCondenseUnderLimit:
    """Tests for messages already within token budget."""

    def test_short_messages_no_compression(self, condenser, sample_messages):
        """Short messages pass through unchanged."""
        compressed, stats = condenser.condense(sample_messages, target_tokens=1000)

        assert compressed == sample_messages
        assert stats.strategy_used == "none"
        assert stats.compression_ratio == 1.0
        assert stats.messages_kept == len(sample_messages)
        assert stats.messages_removed == 0

    def test_empty_messages(self, condenser):
        """Empty message list returns empty."""
        compressed, stats = condenser.condense([])

        assert compressed == []
        assert stats.original_tokens == 0
        assert stats.compressed_tokens == 0


class TestTruncateStrategy:
    """Tests for truncation compression."""

    def test_truncate_keeps_recent(self, condenser, long_messages):
        """Truncate strategy keeps most recent messages."""
        compressed, stats = condenser.condense(
            long_messages,
            target_tokens=100,
            strategy=CompressionStrategy.TRUNCATE,
        )

        assert stats.strategy_used == "truncate"
        assert stats.compressed_tokens <= 100
        # Most recent message should be kept
        assert any("Final short message" in m.get("content", "") for m in compressed)

    def test_truncate_removes_oldest(self, condenser, long_messages):
        """Truncate removes oldest messages first."""
        compressed, stats = condenser.condense(
            long_messages,
            target_tokens=50,
            strategy=CompressionStrategy.TRUNCATE,
        )

        assert stats.messages_removed > 0
        assert len(compressed) < len(long_messages)


class TestSummarizeStrategy:
    """Tests for summarization compression."""

    def test_summarize_creates_summary(self, condenser):
        """Summarize creates summary of old messages."""
        # Create messages where old ones are long but recent are short
        old_content = "This is old message content that should be summarized. " * 10
        messages = [
            {"role": "user", "content": old_content},
            {"role": "assistant", "content": old_content},
            {"role": "user", "content": old_content},
            {"role": "assistant", "content": old_content},
            {"role": "user", "content": "Short recent 1."},
            {"role": "assistant", "content": "Short recent 2."},
            {"role": "user", "content": "Short recent 3."},
        ]

        compressed, stats = condenser.condense(
            messages,
            target_tokens=150,  # Enough for summary + recent, but not all
            strategy=CompressionStrategy.SUMMARIZE,
        )

        assert stats.strategy_used == "summarize"
        # Should have a system message with summary
        system_msgs = [m for m in compressed if m.get("role") == "system"]
        assert len(system_msgs) == 1
        assert "[Previous conversation summary]" in system_msgs[0]["content"]

    def test_summarize_keeps_recent(self, condenser):
        """Summarize keeps recent messages intact."""
        # Old messages are long, recent are short
        old_content = "Old message with lots of content. " * 20
        messages = [
            {"role": "user", "content": old_content},
            {"role": "assistant", "content": old_content},
            {"role": "user", "content": "Recent message 1."},
            {"role": "assistant", "content": "Recent response 1."},
            {"role": "user", "content": "Most recent query."},
        ]

        compressed, stats = condenser.condense(
            messages,
            target_tokens=100,
            strategy=CompressionStrategy.SUMMARIZE,
        )

        # Should use summarize strategy and keep 3 recent
        assert stats.strategy_used == "summarize"
        assert stats.messages_kept == 3

    def test_summarize_fallback_to_truncate(self, condenser):
        """Summarize falls back to truncate when summary too large."""
        # Very long recent messages
        long_content = "Recent content. " * 200
        messages = [
            {"role": "user", "content": "Old 1"},
            {"role": "assistant", "content": "Old 2"},
            {"role": "user", "content": long_content},
            {"role": "assistant", "content": long_content},
            {"role": "user", "content": long_content},
        ]

        compressed, stats = condenser.condense(
            messages,
            target_tokens=50,
            strategy=CompressionStrategy.SUMMARIZE,
        )

        # Should fallback to truncate since recent messages exceed budget
        assert stats.strategy_used == "truncate"


class TestAdaptiveStrategy:
    """Tests for adaptive strategy selection."""

    def test_adaptive_selects_truncate_for_moderate(self, condenser):
        """Adaptive selects truncate when ratio >= 0.5."""
        # Internal method test
        strategy = condenser._select_strategy(original=1000, target=600)
        assert strategy == CompressionStrategy.TRUNCATE

    def test_adaptive_selects_summarize_for_aggressive(self, condenser):
        """Adaptive selects summarize when ratio < 0.5."""
        strategy = condenser._select_strategy(original=1000, target=300)
        assert strategy == CompressionStrategy.SUMMARIZE

    def test_adaptive_default_behavior(self, condenser, long_messages):
        """Adaptive strategy works with default settings."""
        compressed, stats = condenser.condense(
            long_messages,
            target_tokens=100,
            strategy=CompressionStrategy.ADAPTIVE,
        )

        assert stats.strategy_used in ["truncate", "summarize"]
        assert stats.compressed_tokens <= 100


class TestStatsTracking:
    """Tests for compression statistics."""

    def test_stats_history_accumulates(self, condenser, long_messages):
        """Stats history accumulates across calls."""
        assert len(condenser.get_stats_history()) == 0

        condenser.condense(long_messages, target_tokens=100)
        assert len(condenser.get_stats_history()) == 1

        condenser.condense(long_messages, target_tokens=50)
        assert len(condenser.get_stats_history()) == 2

    def test_stats_history_returns_copy(self, condenser, long_messages):
        """get_stats_history returns a copy."""
        condenser.condense(long_messages, target_tokens=100)

        history1 = condenser.get_stats_history()
        history2 = condenser.get_stats_history()

        assert history1 is not history2
        assert history1 == history2

    def test_clear_stats_history(self, condenser, long_messages):
        """clear_stats_history removes all entries."""
        condenser.condense(long_messages, target_tokens=100)
        assert len(condenser.get_stats_history()) > 0

        condenser.clear_stats_history()
        assert len(condenser.get_stats_history()) == 0

    def test_compression_ratio_calculation(self, condenser, long_messages):
        """Compression ratio is correctly calculated."""
        _, stats = condenser.condense(long_messages, target_tokens=100)

        expected_ratio = stats.compressed_tokens / stats.original_tokens
        assert abs(stats.compression_ratio - expected_ratio) < 0.01


class TestSingletonAccessor:
    """Tests for get_context_condenser singleton."""

    def test_returns_singleton(self):
        """get_context_condenser returns same instance."""
        # Reset singleton for test
        import agent_server.core.context_condenser as cc

        cc._context_condenser = None

        condenser1 = get_context_condenser("gemini")
        condenser2 = get_context_condenser("openai")  # Provider ignored

        assert condenser1 is condenser2
        assert condenser1.provider == "gemini"  # First call's provider used

        # Cleanup
        cc._context_condenser = None


class TestSessionManagerIntegration:
    """Tests for SessionManager integration."""

    def test_build_context_without_compress(self, tmp_path):
        """build_context works without compression (backward compat)."""
        from hdsp_agent_core.managers.session_manager import SessionManager

        # Reset singleton
        SessionManager._instance = None

        manager = object.__new__(SessionManager)
        manager._initialized = False
        manager._sessions = {}
        manager._storage_path = tmp_path / "test_sessions.json"
        manager._initialized = True

        manager.store_messages("test-session", "Hello", "Hi there")
        manager.store_messages("test-session", "How are you?", "I'm fine!")

        context = manager.build_context("test-session", compress=False)

        assert "User: Hello" in context
        assert "Assistant: Hi there" in context

    def test_build_context_with_compress(self, tmp_path):
        """build_context with compression enabled."""
        from hdsp_agent_core.managers.session_manager import SessionManager
        import agent_server.core.context_condenser as cc

        # Reset singletons
        SessionManager._instance = None
        cc._context_condenser = None

        manager = object.__new__(SessionManager)
        manager._initialized = False
        manager._sessions = {}
        manager._storage_path = tmp_path / "test_sessions.json"
        manager._initialized = True

        # Add many messages
        for i in range(10):
            manager.store_messages(
                "test-session",
                f"User message {i} with some content.",
                f"Assistant response {i} with detailed answer.",
            )

        # Build context with compression
        context = manager.build_context(
            "test-session",
            max_messages=20,
            compress=True,
            target_tokens=100,
        )

        # Context should be returned and smaller than original
        assert context is not None
        # Reset singleton
        cc._context_condenser = None
