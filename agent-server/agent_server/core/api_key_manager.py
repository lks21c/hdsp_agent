"""
API Key Manager - Handles multi-key rotation with intelligent cooldown tracking for Gemini API

Features:
- Support up to 10 API keys
- Automatic key rotation on rate limits (429)
- Smart cooldown parsing from retry-after headers
- Auto re-enable after cooldown expires
- Persistent state across server restarts
"""

import asyncio
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class KeyStatus(Enum):
    """Status of an API key"""

    ACTIVE = "active"
    COOLDOWN = "cooldown"
    DISABLED = "disabled"


@dataclass
class KeyState:
    """Runtime state for an API key"""

    key: str
    id: str
    enabled: bool = True
    cooldown_until: Optional[datetime] = None
    last_used: Optional[datetime] = None
    failure_count: int = 0
    added_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def status(self) -> KeyStatus:
        """Get current status of the key"""
        if not self.enabled:
            return KeyStatus.DISABLED
        if self.cooldown_until and datetime.utcnow() < self.cooldown_until:
            return KeyStatus.COOLDOWN
        return KeyStatus.ACTIVE

    @property
    def cooldown_remaining_seconds(self) -> int:
        """Get remaining cooldown time in seconds"""
        if not self.cooldown_until:
            return 0
        remaining = (self.cooldown_until - datetime.utcnow()).total_seconds()
        return max(0, int(remaining))

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for config persistence"""
        return {
            "key": self.key,
            "id": self.id,
            "enabled": self.enabled,
            "cooldownUntil": self.cooldown_until.isoformat()
            if self.cooldown_until
            else None,
            "lastUsed": self.last_used.isoformat() if self.last_used else None,
            "failureCount": self.failure_count,
            "addedAt": self.added_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KeyState":
        """Deserialize from dictionary"""
        return cls(
            key=data["key"],
            id=data.get("id", f"key_{uuid.uuid4().hex[:8]}"),
            enabled=data.get("enabled", True),
            cooldown_until=datetime.fromisoformat(data["cooldownUntil"])
            if data.get("cooldownUntil")
            else None,
            last_used=datetime.fromisoformat(data["lastUsed"])
            if data.get("lastUsed")
            else None,
            failure_count=data.get("failureCount", 0),
            added_at=datetime.fromisoformat(data["addedAt"])
            if data.get("addedAt")
            else datetime.utcnow(),
        )


class GeminiKeyManager:
    """
    Manages multiple Gemini API keys with intelligent rotation and cooldown tracking.

    Features:
    - Round-robin rotation on rate limits
    - Automatic cooldown parsing from retry-after headers
    - Auto re-enable after cooldown expires
    - Persistence to config file
    """

    MAX_KEYS = 10
    DEFAULT_COOLDOWN_SECONDS = 60

    _instance: Optional["GeminiKeyManager"] = None
    _lock: asyncio.Lock = asyncio.Lock()

    def __init__(self, config_manager):
        self._config_manager = config_manager
        self._keys: List[KeyState] = []
        self._current_index: int = 0
        self._load_keys()

    @classmethod
    def get_instance(cls, config_manager) -> "GeminiKeyManager":
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = cls(config_manager)
        return cls._instance

    @classmethod
    def reset_instance(cls):
        """Reset singleton (for testing or config reload)"""
        cls._instance = None

    def _load_keys(self):
        """Load keys from config, handling migration from single-key format"""
        config = self._config_manager.get_config()
        gemini_config = config.get("gemini", {})

        # Check for new multi-key format
        if "keys" in gemini_config and isinstance(gemini_config["keys"], list):
            self._keys = [KeyState.from_dict(k) for k in gemini_config["keys"]]
            self._current_index = gemini_config.get("activeKeyIndex", 0)
            # Ensure index is valid
            if self._current_index >= len(self._keys):
                self._current_index = 0
        # Migration from single-key format
        elif "apiKey" in gemini_config and gemini_config["apiKey"]:
            single_key = gemini_config["apiKey"]
            # Don't migrate masked keys
            if not single_key.startswith("****"):
                self._keys = [
                    KeyState(key=single_key, id=f"key_{uuid.uuid4().hex[:8]}")
                ]
                self._current_index = 0
                # Migrate to new format
                self._save_keys()
            else:
                self._keys = []
                self._current_index = 0
        else:
            self._keys = []
            self._current_index = 0

    def _save_keys(self):
        """Persist keys to config file"""
        config = self._config_manager.get_config()

        # Preserve model setting
        model = config.get("gemini", {}).get("model", "gemini-2.5-pro")

        config["gemini"] = {
            "model": model,
            "keys": [k.to_dict() for k in self._keys],
            "activeKeyIndex": self._current_index,
            "rotationStrategy": "round-robin",
        }

        # Also set legacy apiKey for backward compatibility
        if self._keys:
            active_key = self._get_active_key_state()
            if active_key:
                config["gemini"]["apiKey"] = active_key.key

        self._config_manager.save_config(config)

    def _get_active_key_state(self) -> Optional[KeyState]:
        """Get current active key state"""
        if not self._keys:
            return None
        if 0 <= self._current_index < len(self._keys):
            return self._keys[self._current_index]
        return None

    def _get_key_by_id(self, key_id: str) -> Optional[str]:
        """Get actual API key string by key ID"""
        for key_state in self._keys:
            if key_state.id == key_id:
                return key_state.key
        return None

    async def get_available_key(self) -> Tuple[Optional[str], Optional[str]]:
        """
        Get an available API key for use.

        Returns:
            Tuple of (api_key, key_id) or (None, None) if no keys available
        """
        async with self._lock:
            # First pass: check current and rotate if needed
            self._auto_expire_cooldowns()

            if not self._keys:
                return None, None

            # Try to find an active key starting from current index
            attempts = 0
            while attempts < len(self._keys):
                key_state = self._keys[self._current_index]

                if key_state.status == KeyStatus.ACTIVE:
                    return key_state.key, key_state.id

                # Move to next key
                self._current_index = (self._current_index + 1) % len(self._keys)
                attempts += 1

            # All keys in cooldown - return the one with shortest wait
            return self._get_shortest_cooldown_key()

    def _get_shortest_cooldown_key(self) -> Tuple[Optional[str], Optional[str]]:
        """Get key with shortest remaining cooldown"""
        available_keys = [k for k in self._keys if k.enabled]
        if not available_keys:
            return None, None

        # Sort by cooldown expiry
        available_keys.sort(key=lambda k: k.cooldown_until or datetime.min)

        return available_keys[0].key, available_keys[0].id

    def _auto_expire_cooldowns(self):
        """Clear expired cooldowns"""
        now = datetime.utcnow()
        for key_state in self._keys:
            if key_state.cooldown_until and now >= key_state.cooldown_until:
                key_state.cooldown_until = None
                key_state.failure_count = 0

    async def mark_key_success(self, key_id: str):
        """Mark a key as successfully used"""
        async with self._lock:
            for key_state in self._keys:
                if key_state.id == key_id:
                    key_state.last_used = datetime.utcnow()
                    key_state.failure_count = 0
                    key_state.cooldown_until = None
                    self._save_keys()
                    break

    async def mark_key_rate_limited(
        self,
        key_id: str,
        retry_after: Optional[int] = None,
        error_message: Optional[str] = None,
    ):
        """
        Mark a key as rate limited and set cooldown.

        Args:
            key_id: The key identifier
            retry_after: Seconds from retry-after header (if available)
            error_message: Error message to parse for cooldown duration
        """
        async with self._lock:
            cooldown_seconds = self._parse_cooldown_duration(retry_after, error_message)

            for key_state in self._keys:
                if key_state.id == key_id:
                    key_state.cooldown_until = datetime.utcnow() + timedelta(
                        seconds=cooldown_seconds
                    )
                    key_state.failure_count += 1

                    # Rotate to next key
                    self._current_index = (self._current_index + 1) % len(self._keys)

                    self._save_keys()
                    print(
                        f"[KeyManager] Key {key_id} rate limited. Cooldown: {cooldown_seconds}s. Rotating to next key."
                    )
                    break

    def _parse_cooldown_duration(
        self, retry_after: Optional[int], error_message: Optional[str]
    ) -> int:
        """
        Parse cooldown duration from various sources.

        Priority:
        1. retry-after header value
        2. Parsed from error message
        3. Default value (60 seconds)
        """
        if retry_after and retry_after > 0:
            return retry_after

        if error_message:
            # Try to parse "retry after X seconds" patterns
            patterns = [
                r"retry.?after[:\s]+(\d+)\s*(?:second|sec|s)?",
                r"wait[:\s]+(\d+)\s*(?:second|sec|s)?",
                r"(\d+)\s*(?:second|sec)s?\s*(?:before|until)",
                r"try again in (\d+)",
            ]
            for pattern in patterns:
                match = re.search(pattern, error_message, re.IGNORECASE)
                if match:
                    return int(match.group(1))

        return self.DEFAULT_COOLDOWN_SECONDS

    # ========== Key Management API ==========

    def add_key(self, api_key: str) -> Tuple[bool, str]:
        """
        Add a new API key.

        Returns:
            Tuple of (success, message)
        """
        if len(self._keys) >= self.MAX_KEYS:
            return False, f"Maximum {self.MAX_KEYS} keys allowed"

        # Check for duplicate
        for k in self._keys:
            if k.key == api_key:
                return False, "Key already exists"

        new_key = KeyState(key=api_key, id=f"key_{uuid.uuid4().hex[:8]}")
        self._keys.append(new_key)
        self._save_keys()

        return True, f"Key added: {new_key.id}"

    def remove_key(self, key_id: str) -> Tuple[bool, str]:
        """Remove a key by ID"""
        for i, k in enumerate(self._keys):
            if k.id == key_id:
                self._keys.pop(i)
                # Adjust current index if needed
                if self._current_index >= len(self._keys):
                    self._current_index = max(0, len(self._keys) - 1)
                self._save_keys()
                return True, f"Key removed: {key_id}"

        return False, f"Key not found: {key_id}"

    def toggle_key(self, key_id: str, enabled: bool) -> Tuple[bool, str]:
        """Enable or disable a key"""
        for k in self._keys:
            if k.id == key_id:
                k.enabled = enabled
                self._save_keys()
                status = "enabled" if enabled else "disabled"
                return True, f"Key {key_id} {status}"

        return False, f"Key not found: {key_id}"

    def get_all_keys_status(self) -> List[Dict[str, Any]]:
        """
        Get status of all keys for UI display.
        Keys are masked for security.
        """
        self._auto_expire_cooldowns()

        result = []
        for i, k in enumerate(self._keys):
            masked_key = f"****{k.key[-4:]}" if len(k.key) > 4 else "****"
            result.append(
                {
                    "id": k.id,
                    "maskedKey": masked_key,
                    "status": k.status.value,
                    "cooldownRemaining": k.cooldown_remaining_seconds,
                    "lastUsed": k.last_used.isoformat() if k.last_used else None,
                    "failureCount": k.failure_count,
                    "isActive": i == self._current_index,
                    "enabled": k.enabled,
                }
            )

        return result

    def get_key_count(self) -> int:
        """Get total number of keys"""
        return len(self._keys)

    def has_available_key(self) -> bool:
        """Check if any key is available (not in cooldown)"""
        self._auto_expire_cooldowns()
        return any(k.status == KeyStatus.ACTIVE for k in self._keys)

    async def wait_for_available_key(self) -> Tuple[Optional[str], Optional[str]]:
        """
        Wait for a key to become available.
        Used as fallback when all keys are in cooldown.
        """
        self._auto_expire_cooldowns()

        # Find shortest cooldown
        cooldown_keys = [k for k in self._keys if k.enabled and k.cooldown_until]
        if not cooldown_keys:
            return await self.get_available_key()

        shortest = min(cooldown_keys, key=lambda k: k.cooldown_until)
        wait_seconds = shortest.cooldown_remaining_seconds

        if wait_seconds > 0:
            print(
                f"[KeyManager] All keys in cooldown. Waiting {wait_seconds}s for key {shortest.id}..."
            )
            await asyncio.sleep(wait_seconds + 1)  # +1 for safety margin

        return await self.get_available_key()

    def reload_keys(self):
        """Force reload keys from config (useful after external config changes)"""
        self._load_keys()


# Module-level singleton getter
def get_key_manager(config_manager) -> GeminiKeyManager:
    """Get the singleton key manager instance"""
    return GeminiKeyManager.get_instance(config_manager)
