"""
Configuration Manager - Handle extension settings persistence
"""

import json
import os
from pathlib import Path
from typing import Dict, Any

class ConfigManager:
    """Manage configuration persistence"""

    _instance = None
    _config_file = None

    def __init__(self):
        # Default config file location
        jupyter_config_dir = os.environ.get('JUPYTER_CONFIG_DIR')
        if not jupyter_config_dir:
            jupyter_config_dir = os.path.expanduser('~/.jupyter')

        self._config_file = Path(jupyter_config_dir) / 'hdsp_agent_config.json'
        self._config = self._load_config()

    @classmethod
    def get_instance(cls):
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = ConfigManager()
        return cls._instance

    def _load_config(self) -> Dict[str, Any]:
        """Load configuration from file"""
        if not self._config_file.exists():
            return self._default_config()

        try:
            with open(self._config_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error loading config: {e}")
            return self._default_config()

    def _default_config(self) -> Dict[str, Any]:
        """Get default configuration"""
        return {
            'apiKey': '',
            'modelId': 'gpt-4',
            'baseUrl': 'https://api.openai.com/v1',
            'temperature': 0.7,
            'maxTokens': 2000,
            'systemPrompt': 'You are a helpful AI assistant for code analysis and generation.'
        }

    def get_config(self) -> Dict[str, Any]:
        """Get current configuration"""
        return self._config.copy()

    def save_config(self, config: Dict[str, Any]):
        """Save configuration to file - no validation"""
        # Merge with existing config
        self._config.update(config)

        # Ensure config directory exists
        self._config_file.parent.mkdir(parents=True, exist_ok=True)

        # Write to file
        try:
            with open(self._config_file, 'w') as f:
                json.dump(self._config, f, indent=2)
        except IOError as e:
            raise RuntimeError(f"Failed to save config: {e}")

    def get(self, key: str, default=None):
        """Get specific config value"""
        return self._config.get(key, default)

    def set(self, key: str, value: Any):
        """Set specific config value"""
        self._config[key] = value
        self.save_config(self._config)
