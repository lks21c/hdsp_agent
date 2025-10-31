"""
Status Handler - Health check and system status
"""

from tornado import web
from .base import BaseAgentHandler
from .._version import __version__

class StatusHandler(BaseAgentHandler):
    """Handle status requests"""

    @web.authenticated
    async def get(self):
        """Get system status"""
        try:
            config = self.config_manager.get_config()

            # Check if API key is configured
            api_connected = bool(config.get('apiKey'))

            # Check if model is configured
            model_available = bool(config.get('modelId'))

            # Determine overall status
            if api_connected and model_available:
                status = 'healthy'
            elif api_connected or model_available:
                status = 'degraded'
            else:
                status = 'unhealthy'

            result = {
                'status': status,
                'version': __version__,
                'apiConnected': api_connected,
                'modelAvailable': model_available
            }

            self.write_json(result)

        except Exception as e:
            self.log.error(f"Status check failed: {e}")
            self.write_error_json(500, "Failed to get status")
