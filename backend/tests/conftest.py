"""
Pytest configuration and fixtures for hdsp_agent tests

VCR.py 설정: LLM API 응답 녹화/재생
- 최초 1회만 실제 API 호출 → cassettes/*.yaml 저장
- 이후 실행: 저장된 YAML 재생 (토큰 0)
"""

import pytest
from pathlib import Path

# VCR cassette 저장 경로
CASSETTES_DIR = Path(__file__).parent / "cassettes"


@pytest.fixture(scope="module")
def vcr_config():
    """VCR.py 기본 설정"""
    return {
        "cassette_library_dir": str(CASSETTES_DIR),
        "record_mode": "once",  # 최초 1회만 녹화
        "match_on": ["method", "scheme", "host", "port", "path"],
        "filter_headers": [
            "authorization",
            "x-api-key",
            "api-key",
            "anthropic-api-key",
            "openai-api-key",
        ],
        "filter_query_parameters": ["api_key", "key"],
        "decode_compressed_response": True,
    }


@pytest.fixture(scope="module")
def vcr_cassette_dir(request):
    """테스트 모듈별 cassette 디렉토리 자동 생성"""
    module_name = request.module.__name__.split(".")[-1]
    cassette_dir = CASSETTES_DIR / module_name
    cassette_dir.mkdir(parents=True, exist_ok=True)
    return str(cassette_dir)
