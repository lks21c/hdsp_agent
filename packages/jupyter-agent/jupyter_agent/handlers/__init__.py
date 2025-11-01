"""
API Handlers for Jupyter Agent
"""

from .base import BaseAgentHandler
from .config import ConfigHandler
from .cell_action import CellActionHandler
from .status import StatusHandler
from .chat import ChatHandler
from .test_llm import TestLLMHandler

from jupyter_server.utils import url_path_join
from ..services.config_manager import ConfigManager

def setup_handlers(web_app):
    """Register all API handlers"""
    host_pattern = '.*$'
    base_url = web_app.settings['base_url']

    # Initialize config manager and store in settings
    config_manager = ConfigManager()
    web_app.settings['config_manager'] = config_manager

    # API routes
    handlers = [
        (url_path_join(base_url, 'jupyter-agent', 'config'), ConfigHandler),
        (url_path_join(base_url, 'jupyter-agent', 'cell', 'action'), CellActionHandler),
        (url_path_join(base_url, 'jupyter-agent', 'status'), StatusHandler),
        (url_path_join(base_url, 'jupyter-agent', 'chat', 'message'), ChatHandler),
        (url_path_join(base_url, 'jupyter-agent', 'test-llm'), TestLLMHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
