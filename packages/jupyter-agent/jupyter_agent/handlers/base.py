"""
Base handler for Jupyter Agent API
"""

from jupyter_server.base.handlers import APIHandler
import json

class BaseAgentHandler(APIHandler):
    """Base handler with common functionality"""

    @property
    def config_manager(self):
        """Get config manager from app settings"""
        from ..services.config_manager import ConfigManager
        return ConfigManager.get_instance()

    @property
    def llm_client(self):
        """Get LLM client from app settings"""
        from ..services.llm_client import LLMClient
        return LLMClient.get_instance(self.config_manager.get_config())

    def get_json_body(self):
        """Parse JSON request body"""
        try:
            return json.loads(self.request.body.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {str(e)}")

    def write_json(self, data):
        """Write JSON response"""
        self.set_header('Content-Type', 'application/json')
        self.finish(json.dumps(data))

    def write_error_json(self, status_code, message):
        """Write error response"""
        self.set_status(status_code)
        self.write_json({
            'error': message,
            'status': status_code
        })
