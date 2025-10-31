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

            # Don't expose full API key, only last 4 chars
            if config.get('apiKey'):
                key = config['apiKey']
                config['apiKey'] = f"****{key[-4:]}" if len(key) > 4 else "****"

            self.write_json(config)

        except Exception as e:
            self.log.error(f"Get config failed: {e}")
            self.write_error_json(500, "Failed to load configuration")

    @web.authenticated
    async def post(self):
        """Save configuration"""
        try:
            # Parse request
            data = self.get_json_body()

            # Validate required fields
            if not data.get('apiKey'):
                self.write_error_json(400, "API key is required")
                return

            if not data.get('modelId'):
                self.write_error_json(400, "Model ID is required")
                return

            # Save configuration
            self.config_manager.save_config(data)

            self.write_json({
                'success': True,
                'message': 'Configuration saved successfully'
            })

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Save config failed: {e}")
            self.write_error_json(500, "Failed to save configuration")
