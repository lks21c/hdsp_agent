"""
API Handlers for Jupyter Agent
"""

from .base import BaseAgentHandler
from .config import ConfigHandler
from .cell_action import CellActionHandler
from .status import StatusHandler

from jupyter_server.utils import url_path_join

def setup_handlers(web_app):
    """Register all API handlers"""
    host_pattern = '.*$'
    base_url = web_app.settings['base_url']

    # API routes
    handlers = [
        (url_path_join(base_url, 'jupyter-agent', 'config'), ConfigHandler),
        (url_path_join(base_url, 'jupyter-agent', 'cell', 'action'), CellActionHandler),
        (url_path_join(base_url, 'jupyter-agent', 'status'), StatusHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
