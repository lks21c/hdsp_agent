"""
Configuration Handler - Manage extension settings
"""

from tornado import web
from .base import BaseAgentHandler

class ConfigHandler(BaseAgentHandler):
    """Handle configuration operations"""

    def _mask_api_key(self, key: str) -> str:
        """Mask API key, showing only last 4 characters"""
        return f"****{key[-4:]}" if len(key) > 4 else "****"

    def _mask_provider_keys(self, config: dict, providers: list) -> dict:
        """Mask API keys for specified providers in config"""
        for provider in providers:
            if provider in config and config[provider].get('apiKey'):
                config[provider]['apiKey'] = self._mask_api_key(config[provider]['apiKey'])
        return config

    @web.authenticated
    async def get(self):
        """Get current configuration"""
        try:
            config = self.config_manager.get_config()
            config = self._mask_provider_keys(config, ['gemini', 'vllm', 'openai'])
            self.write_json(config)

        except Exception as e:
            self.log.error(f"Get config failed: {e}")
            self.write_error_json(500, "Failed to load configuration")

    def _is_masked_key(self, key: str) -> bool:
        """Check if API key is masked"""
        return key and key.startswith('****')

    def _restore_masked_keys(self, data: dict, existing_config: dict, providers: list) -> dict:
        """Restore masked API keys from existing config for specified providers"""
        for provider in providers:
            if provider in data:
                api_key = data.get(provider, {}).get('apiKey', '')
                if self._is_masked_key(api_key) and provider in existing_config:
                    data[provider]['apiKey'] = existing_config[provider].get('apiKey', '')
                    self.log.info(f"Restored masked {provider.capitalize()} API key")
        return data

    @web.authenticated
    async def post(self):
        """Save configuration - accepts any values"""
        try:
            # Parse request
            data = self.get_json_body()
            self.log.info(f"Received config data: {data}")

            # Load existing config to preserve masked keys
            existing_config = self.config_manager.get_config()

            # Restore masked keys for all providers
            data = self._restore_masked_keys(data, existing_config, ['gemini', 'openai', 'vllm'])

            # Save configuration without any validation
            self.log.info(f"About to save config: {data}")
            self.config_manager.save_config(data)
            self.log.info("Config saved successfully")

            # Verify save by reading back
            saved_config = self.config_manager.get_config()
            self.log.info(f"Config after save: {saved_config}")

            self.write_json({
                'success': True,
                'message': 'Configuration saved successfully'
            })

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Save config failed: {e}")
            self.write_error_json(500, "Failed to save configuration")
