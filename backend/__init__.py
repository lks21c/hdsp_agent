"""
HDSP Agent - AI-powered code assistance for JupyterLab
"""

import os
import sys
import traceback  # 에러 추적용
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

    # [디버깅 1] 함수 진입 여부 확인
    try:
        with open("/home/sagemaker-user/hdsp_entry.txt", "w") as f:
            f.write("1. load_jupyter_server_extension Entered\n")
            f.write(f"Base URL: {server_app.web_app.settings.get('base_url', 'Not Found')}\n")

        from .handlers import setup_handlers  # 여기서 import 에러가 날 수도 있음

        web_app = server_app.web_app
        setup_handlers(web_app)

        server_app.log.info('HDSP Agent extension loaded')

        # [디버깅 2] 성공 여부 확인
        with open("/home/sagemaker-user/hdsp_success.txt", "w") as f:
            f.write("2. Setup Handlers Completed Successfully\n")

    except Exception as e:
        # [디버깅 3] 에러 발생 시 로그 파일로 남기기 (가장 중요)
        with open("/home/sagemaker-user/hdsp_error.txt", "w") as f:
            f.write(f"Error Occurred:\n{str(e)}\n\nTraceback:\n{traceback.format_exc()}")
        server_app.log.error(f"Failed to load HDSP extension: {e}")
        raise e
