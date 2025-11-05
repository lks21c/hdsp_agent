"""
Configuration Handler - Manage extension settings
"""

from tornado import web
from .base import BaseAgentHandler

class ConfigHandler(BaseAgentHandler):
    """Handle configuration operations"""

    @web.authenticated
    async def get(self):
        """Get current configuration"""
        try:
            config = self.config_manager.get_config()

            # Don't expose full API keys, only last 4 chars
            if 'gemini' in config and config['gemini'].get('apiKey'):
                key = config['gemini']['apiKey']
                config['gemini']['apiKey'] = f"****{key[-4:]}" if len(key) > 4 else "****"

            if 'vllm' in config and config['vllm'].get('apiKey'):
                key = config['vllm']['apiKey']
                config['vllm']['apiKey'] = f"****{key[-4:]}" if len(key) > 4 else "****"

            if 'openai' in config and config['openai'].get('apiKey'):
                key = config['openai']['apiKey']
                config['openai']['apiKey'] = f"****{key[-4:]}" if len(key) > 4 else "****"

            self.write_json(config)

        except Exception as e:
            self.log.error(f"Get config failed: {e}")
            self.write_error_json(500, "Failed to load configuration")

    @web.authenticated
    async def post(self):
        """Save configuration - accepts any values"""
        try:
            # Parse request
            data = self.get_json_body()
            self.log.info(f"Received config data: {data}")

            # Load existing config to preserve masked keys
            existing_config = self.config_manager.get_config()

            # Helper to check if key is masked
            def is_masked(key):
                return key and key.startswith('****')

            # Only restore masked keys from existing config
            # No validation - accept any values the user provides
            if 'gemini' in data:
                gemini_key = data.get('gemini', {}).get('apiKey', '')
                if is_masked(gemini_key) and 'gemini' in existing_config:
                    data['gemini']['apiKey'] = existing_config['gemini'].get('apiKey', '')
                    self.log.info("Restored masked Gemini API key")

            if 'openai' in data:
                openai_key = data.get('openai', {}).get('apiKey', '')
                if is_masked(openai_key) and 'openai' in existing_config:
                    data['openai']['apiKey'] = existing_config['openai'].get('apiKey', '')
                    self.log.info("Restored masked OpenAI API key")

            if 'vllm' in data:
                vllm_key = data.get('vllm', {}).get('apiKey', '')
                if is_masked(vllm_key) and 'vllm' in existing_config:
                    data['vllm']['apiKey'] = existing_config['vllm'].get('apiKey', '')
                    self.log.info("Restored masked vLLM API key")

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
