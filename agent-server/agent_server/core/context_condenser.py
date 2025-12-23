"""
Context Condenser for intelligent context compression.

Provides token-aware context management with multiple compression strategies
to optimize LLM input while preserving important information.
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class CompressionStrategy(Enum):
    """Available compression strategies."""

    TRUNCATE = "truncate"  # Keep only recent messages
    SUMMARIZE = "summarize"  # Summarize old messages, keep recent
    ADAPTIVE = "adaptive"  # Auto-select based on context size


@dataclass
class CompressionStats:
    """Statistics from a compression operation."""

    original_tokens: int
    compressed_tokens: int
    compression_ratio: float
    strategy_used: str
    messages_kept: int
    messages_removed: int


class ContextCondenser:
    """
    Context compressor - optimizes conversation context within token budget.

    Supports multiple LLM providers with different token limits.
    Uses rule-based compression without additional LLM calls.
    """

    # Provider-specific token limits for context
    TOKEN_LIMITS = {
        "gemini": 30000,
        "openai": 4000,
        "vllm": 8000,
        "default": 4000,
    }

    # Token estimation: average tokens per word (conservative)
    TOKENS_PER_WORD = 1.3

    def __init__(self, provider: str = "default"):
        """Initialize condenser with provider-specific settings.

        Args:
            provider: LLM provider name for token limit selection
        """
        self._provider = provider
        self._stats_history: List[CompressionStats] = []

    @property
    def provider(self) -> str:
        """Current LLM provider."""
        return self._provider

    @provider.setter
    def provider(self, value: str) -> None:
        """Update LLM provider."""
        self._provider = value

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for text.

        Uses word count with a conservative multiplier.
        More accurate than character count for most text.

        Args:
            text: Input text to estimate

        Returns:
            Estimated token count
        """
        if not text:
            return 0
        words = len(text.split())
        return int(words * self.TOKENS_PER_WORD)

    def get_token_limit(self) -> int:
        """Get token limit for current provider.

        Returns:
            Maximum tokens for context
        """
        return self.TOKEN_LIMITS.get(self._provider, self.TOKEN_LIMITS["default"])

    def condense(
        self,
        messages: List[Dict[str, str]],
        target_tokens: Optional[int] = None,
        strategy: CompressionStrategy = CompressionStrategy.ADAPTIVE,
    ) -> Tuple[List[Dict[str, str]], CompressionStats]:
        """Compress message list to fit within token budget.

        Args:
            messages: List of message dicts with 'role' and 'content' keys
            target_tokens: Target token count (default: 50% of provider limit)
            strategy: Compression strategy to use

        Returns:
            Tuple of (compressed_messages, compression_stats)
        """
        if not messages:
            return [], CompressionStats(0, 0, 1.0, "none", 0, 0)

        target = target_tokens or (self.get_token_limit() // 2)
        original_tokens = sum(
            self.estimate_tokens(m.get("content", "")) for m in messages
        )

        # Already within budget - no compression needed
        if original_tokens <= target:
            stats = CompressionStats(
                original_tokens=original_tokens,
                compressed_tokens=original_tokens,
                compression_ratio=1.0,
                strategy_used="none",
                messages_kept=len(messages),
                messages_removed=0,
            )
            return messages, stats

        # Select strategy if adaptive
        if strategy == CompressionStrategy.ADAPTIVE:
            strategy = self._select_strategy(original_tokens, target)

        # Apply selected strategy
        if strategy == CompressionStrategy.TRUNCATE:
            compressed, stats = self._truncate(messages, target)
        elif strategy == CompressionStrategy.SUMMARIZE:
            compressed, stats = self._summarize(messages, target)
        else:
            compressed, stats = self._truncate(messages, target)

        self._stats_history.append(stats)
        logger.info(
            f"Context compressed: {stats.original_tokens} → {stats.compressed_tokens} "
            f"tokens ({stats.compression_ratio:.1%}), strategy={stats.strategy_used}"
        )
        return compressed, stats

    def _select_strategy(self, original: int, target: int) -> CompressionStrategy:
        """Select best compression strategy based on reduction needed.

        Args:
            original: Original token count
            target: Target token count

        Returns:
            Selected compression strategy
        """
        ratio = target / original
        # If we need to keep more than 50%, simple truncation works
        if ratio >= 0.5:
            return CompressionStrategy.TRUNCATE
        # For more aggressive compression, use summarization
        return CompressionStrategy.SUMMARIZE

    def _truncate(
        self, messages: List[Dict[str, str]], target: int
    ) -> Tuple[List[Dict[str, str]], CompressionStats]:
        """Keep only recent messages within token budget.

        Preserves most recent messages, dropping oldest first.

        Args:
            messages: Original messages
            target: Target token count

        Returns:
            Tuple of (truncated_messages, stats)
        """
        original_tokens = sum(
            self.estimate_tokens(m.get("content", "")) for m in messages
        )

        # Keep messages from the end (most recent)
        kept: List[Dict[str, str]] = []
        current_tokens = 0

        for msg in reversed(messages):
            msg_tokens = self.estimate_tokens(msg.get("content", ""))
            if current_tokens + msg_tokens <= target:
                kept.insert(0, msg)
                current_tokens += msg_tokens
            else:
                break

        return kept, CompressionStats(
            original_tokens=original_tokens,
            compressed_tokens=current_tokens,
            compression_ratio=(
                current_tokens / original_tokens if original_tokens else 1.0
            ),
            strategy_used="truncate",
            messages_kept=len(kept),
            messages_removed=len(messages) - len(kept),
        )

    def _summarize(
        self, messages: List[Dict[str, str]], target: int
    ) -> Tuple[List[Dict[str, str]], CompressionStats]:
        """Summarize old messages, keep recent ones intact.

        Rule-based summarization without LLM calls.
        Extracts first sentence from each old message.

        Args:
            messages: Original messages
            target: Target token count

        Returns:
            Tuple of (summary + recent_messages, stats)
        """
        original_tokens = sum(
            self.estimate_tokens(m.get("content", "")) for m in messages
        )

        # Keep last 3 messages intact
        recent_count = min(3, len(messages))
        recent = messages[-recent_count:]
        old = messages[:-recent_count] if len(messages) > recent_count else []

        recent_tokens = sum(self.estimate_tokens(m.get("content", "")) for m in recent)
        remaining = target - recent_tokens

        # If recent messages already exceed budget, fallback to truncate
        if remaining <= 0 or not old:
            return self._truncate(messages, target)

        # Summarize old messages (extract first sentence, max 100 chars)
        summary_parts = []
        for msg in old:
            content = msg.get("content", "")
            # Get first sentence or first 100 chars
            first_sentence = content.split(".")[0][:100]
            if first_sentence:
                role = "User" if msg.get("role") == "user" else "Assistant"
                summary_parts.append(f"[{role}]: {first_sentence}...")

        summary_text = "\n".join(summary_parts)
        summary_tokens = self.estimate_tokens(summary_text)

        # If summary exceeds remaining budget, fallback to truncate
        if summary_tokens > remaining:
            return self._truncate(messages, target)

        # Combine summary with recent messages
        summary_msg = {
            "role": "system",
            "content": f"[Previous conversation summary]\n{summary_text}",
        }
        result = [summary_msg] + recent

        total_tokens = summary_tokens + recent_tokens
        return result, CompressionStats(
            original_tokens=original_tokens,
            compressed_tokens=total_tokens,
            compression_ratio=total_tokens / original_tokens
            if original_tokens
            else 1.0,
            strategy_used="summarize",
            messages_kept=len(recent),
            messages_removed=len(old),
        )

    def get_stats_history(self) -> List[CompressionStats]:
        """Get history of compression operations.

        Returns:
            List of CompressionStats from previous operations
        """
        return self._stats_history.copy()

    def clear_stats_history(self) -> None:
        """Clear compression statistics history."""
        self._stats_history.clear()


# Singleton accessor
_context_condenser: Optional[ContextCondenser] = None


def get_context_condenser(provider: str = "default") -> ContextCondenser:
    """Get or create singleton ContextCondenser instance.

    Args:
        provider: LLM provider name (only used on first call)

    Returns:
        Singleton ContextCondenser instance
    """
    global _context_condenser
    if _context_condenser is None:
        _context_condenser = ContextCondenser(provider)
    return _context_condenser
