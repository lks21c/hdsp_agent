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

def _ensure_config_files():
    """자동으로 필요한 설정 파일들을 생성합니다 (pip install 후 최초 실행 시)"""
    import json
    import shutil
    from pathlib import Path

    try:
        jupyter_config_dir = Path.home() / '.jupyter'
        jupyter_server_config_d = jupyter_config_dir / 'jupyter_server_config.d'

        # 1. jupyter_server_config.d 디렉토리 생성
        jupyter_server_config_d.mkdir(parents=True, exist_ok=True)

        # 2. hdsp_agent.json 복사 (server extension 등록)
        dest_server_config = jupyter_server_config_d / 'hdsp_agent.json'
        if not dest_server_config.exists():
            source_server_config = Path(__file__).parent / 'etc' / 'jupyter' / 'jupyter_server_config.d' / 'hdsp_agent.json'
            if source_server_config.exists():
                shutil.copy(source_server_config, dest_server_config)

        # 3. hdsp_agent_config.json 생성 (vLLM 설정 - 기본값)
        config_file = jupyter_config_dir / 'hdsp_agent_config.json'
        if not config_file.exists():
            default_config = {
                "provider": "gemini",
                "gemini": {
                    "apiKey": "",
                    "model": "gemini-2.5-pro"
                },
                "vllm": {
                    "endpoint": "http://localhost:8000",
                    "apiKey": "",
                    "model": "meta-llama/Llama-2-7b-chat-hf"
                },
                "openai": {
                    "apiKey": "",
                    "model": "gpt-4"
                }
            }
            with open(config_file, 'w') as f:
                json.dump(default_config, f, indent=2)

    except Exception:
        # 설정 파일 생성 실패는 치명적이지 않으므로 조용히 무시
        pass


def load_jupyter_server_extension(server_app):
    """Load the Jupyter Server extension"""

    # [자동 설정] 설정 파일이 없으면 자동 생성
    _ensure_config_files()

    # [디버깅 1] 함수 진입 여부 확인
    try:
        with open("./hdsp_entry.txt", "w") as f:
            f.write("1. load_jupyter_server_extension Entered\n")
            f.write(f"Base URL: {server_app.web_app.settings.get('base_url', 'Not Found')}\n")

        from .handlers import setup_handlers  # 여기서 import 에러가 날 수도 있음

        web_app = server_app.web_app
        setup_handlers(web_app)

        server_app.log.info('HDSP Agent extension loaded')

        # [디버깅 2] 성공 여부 확인
        with open("./hdsp_success.txt", "w") as f:
            f.write("2. Setup Handlers Completed Successfully\n")

    except Exception as e:
        # [디버깅 3] 에러 발생 시 로그 파일로 남기기 (가장 중요)
        with open("./hdsp_error.txt", "w") as f:
            f.write(f"Error Occurred:\n{str(e)}\n\nTraceback:\n{traceback.format_exc()}")
        server_app.log.error(f"Failed to load HDSP extension: {e}")
        raise e
