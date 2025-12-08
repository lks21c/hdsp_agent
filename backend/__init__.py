"""
HDSP Agent - AI-powered code assistance for JupyterLab
"""

import os
import sys
from ._version import __version__


if sys.platform == 'darwin':
    try:
        import certifi
        os.environ['SSL_CERT_FILE'] = certifi.where()
        os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()
    except ImportError:
        pass

def _jupyter_labextension_paths():
    """Called by JupyterLab to find extension"""
    return [{
        'src': 'labextension',
        'dest': '@hdsp-agent/extension'
    }]

def _jupyter_server_extension_points():
    """Called by Jupyter Server to enable extension"""
    return [{
        'module': 'backend'
    }]

def load_jupyter_server_extension(server_app):
    """Load the Jupyter Server extension"""
    from .handlers import setup_handlers

    web_app = server_app.web_app
    host_pattern = '.*$'

    setup_handlers(web_app)

    server_app.log.info('HDSP Agent extension loaded')
