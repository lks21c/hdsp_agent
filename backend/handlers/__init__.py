"""
API Handlers for Jupyter Agent
"""

from .base import BaseAgentHandler
from .config import ConfigHandler
from .cell_action import CellActionHandler
from .status import StatusHandler
from .chat import ChatHandler, ChatStreamHandler
from .test_llm import TestLLMHandler
from .notebook_generation import (
    NotebookGenerationHandler,
    TaskStatusHandler,
    TaskStatusStreamHandler,
    TaskCancelHandler
)
from .auto_agent import (
    AutoAgentPlanHandler,
    AutoAgentRefineHandler,
    AutoAgentPlanStreamHandler,
    AutoAgentReplanHandler,
    AutoAgentValidateHandler,
    AutoAgentReflectHandler,
    AutoAgentVerifyStateHandler
)
from .file_action import FileActionHandler
from .api_keys import GeminiKeysHandler, GeminiKeyToggleHandler, GeminiKeysTestHandler

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
        (url_path_join(base_url, 'hdsp-agent', 'config'), ConfigHandler),
        (url_path_join(base_url, 'hdsp-agent', 'cell', 'action'), CellActionHandler),
        (url_path_join(base_url, 'hdsp-agent', 'status'), StatusHandler),
        (url_path_join(base_url, 'hdsp-agent', 'chat', 'message'), ChatHandler),
        (url_path_join(base_url, 'hdsp-agent', 'chat', 'stream'), ChatStreamHandler),
        (url_path_join(base_url, 'hdsp-agent', 'test-llm'), TestLLMHandler),
        (url_path_join(base_url, 'hdsp-agent', 'notebook', 'generate'), NotebookGenerationHandler),
        (url_path_join(base_url, 'hdsp-agent', 'task', r'([^/]+)', 'status'), TaskStatusHandler),
        (url_path_join(base_url, 'hdsp-agent', 'task', r'([^/]+)', 'stream'), TaskStatusStreamHandler),
        (url_path_join(base_url, 'hdsp-agent', 'task', r'([^/]+)', 'cancel'), TaskCancelHandler),
        # Auto-Agent routes
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'plan'), AutoAgentPlanHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'refine'), AutoAgentRefineHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'replan'), AutoAgentReplanHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'validate'), AutoAgentValidateHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'reflect'), AutoAgentReflectHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'plan', 'stream'), AutoAgentPlanStreamHandler),
        (url_path_join(base_url, 'hdsp-agent', 'auto-agent', 'verify-state'), AutoAgentVerifyStateHandler),
        # File action routes
        (url_path_join(base_url, 'hdsp-agent', 'file', 'action'), FileActionHandler),
        # API Key management routes
        (url_path_join(base_url, 'hdsp-agent', 'gemini-keys'), GeminiKeysHandler),
        (url_path_join(base_url, 'hdsp-agent', 'gemini-keys', 'toggle'), GeminiKeyToggleHandler),
        (url_path_join(base_url, 'hdsp-agent', 'gemini-keys', 'test'), GeminiKeysTestHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
