"""
Configuration Manager - Handle extension settings persistence

Singleton manager for configuration persistence across sessions.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Dict, Any


class ConfigManager:
    """Manage configuration persistence"""

    _instance = None
    _config_file = None

    def __init__(self):
        try:
            # 1순위: 환경변수
            jupyter_config_dir = os.environ.get('JUPYTER_CONFIG_DIR')

            # 2순위: 홈 디렉토리 ~/.jupyter
            if not jupyter_config_dir:
                # expanduser가 실패할 경우를 대비
                try:
                    jupyter_config_dir = os.path.expanduser('~/.jupyter')
                except Exception:
                    jupyter_config_dir = None

            # 경로가 유효한지 체크하고, 없으면 생성 시도
            if jupyter_config_dir:
                config_path = Path(jupyter_config_dir)
                try:
                    config_path.mkdir(parents=True, exist_ok=True)
                    self._config_file = config_path / 'hdsp_agent_config.json'
                except Exception as e:
                    print(f"Warning: Cannot write to {jupyter_config_dir}: {e}")
                    self._config_file = None

            # 3순위 (비상용): 쓰기 실패했거나 경로가 없으면 /tmp 사용
            if not self._config_file:
                tmp_dir = Path(tempfile.gettempdir()) / 'jupyter_hdsp_agent'
                tmp_dir.mkdir(parents=True, exist_ok=True)
                self._config_file = tmp_dir / 'hdsp_agent_config.json'
                print(f"Using temporary config path: {self._config_file}")

        except Exception as e:
            # 최악의 경우: 메모리에서만 동작하도록 가짜 경로 설정 (서버 다운 방지)
            print(f"Critical Error in ConfigManager init: {e}")
            self._config_file = Path('/tmp/hdsp_agent_config_fallback.json')

        self._config = self._load_config()

    @classmethod
    def get_instance(cls):
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = ConfigManager()
        return cls._instance

    @classmethod
    def reset_instance(cls):
        """Reset singleton instance (for testing)"""
        cls._instance = None

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
            'provider': 'gemini',
            'gemini': {
                'apiKey': '',
                'model': 'gemini-2.5-pro'
            },
            'vllm': {
                'endpoint': 'http://localhost:8000',
                'apiKey': '',
                'model': 'meta-llama/Llama-2-7b-chat-hf'
            },
            'openai': {
                'apiKey': '',
                'model': 'gpt-4'
            }
        }

    def get_config(self) -> Dict[str, Any]:
        """Get current configuration"""
        # Reload config from file to ensure we have the latest
        self._config = self._load_config()
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


def get_config_manager() -> ConfigManager:
    """Get the singleton ConfigManager instance"""
    return ConfigManager.get_instance()
