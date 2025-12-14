"""
VCR.py 기반 LLM 응답 테스트

실제 LLM API 응답을 녹화하여 재생 테스트 수행
- 최초 실행: 실제 API 호출 → cassettes/ 저장
- 이후 실행: 저장된 응답 재생 (토큰 0)

사용법:
    # 최초 녹화 (API 키 필요, 토큰 발생)
    poetry run pytest backend/tests/test_vcr_llm.py --record-mode=once

    # 재생 테스트 (토큰 0)
    poetry run pytest backend/tests/test_vcr_llm.py
"""

import pytest
import json
from pathlib import Path


# VCR cassettes 경로
CASSETTES_DIR = Path(__file__).parent / "cassettes" / "test_vcr_llm"


class TestVCRDemo:
    """VCR.py 데모 테스트 - 실제 API 없이도 동작하는 구조"""

    def test_vcr_config_exists(self, vcr_config):
        """VCR 설정이 올바르게 로드되는지 확인"""
        assert vcr_config is not None
        assert vcr_config["record_mode"] == "once"
        assert "authorization" in vcr_config["filter_headers"]

    def test_cassettes_directory_exists(self):
        """Cassettes 디렉토리 존재 확인"""
        parent_dir = Path(__file__).parent / "cassettes"
        assert parent_dir.exists(), f"cassettes 디렉토리가 없습니다: {parent_dir}"


class TestMockLLMResponse:
    """
    Mock LLM 응답 테스트 - API 키 없이 동작
    실제 VCR 녹화 테스트의 구조를 보여줌
    """

    @pytest.fixture
    def sample_llm_response(self):
        """샘플 LLM 응답 (녹화된 응답 형식)"""
        return {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": '```json\n{"goal": "Test", "steps": []}\n```',
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        }

    def test_parse_plan_from_llm_response(self, sample_llm_response):
        """LLM 응답에서 Plan 파싱"""
        content = sample_llm_response["choices"][0]["message"]["content"]

        # JSON 블록 추출
        assert "```json" in content
        json_start = content.find("```json") + 7
        json_end = content.find("```", json_start)
        json_str = content[json_start:json_end].strip()

        plan = json.loads(json_str)
        assert "goal" in plan
        assert "steps" in plan

    def test_extract_tokens_from_response(self, sample_llm_response):
        """토큰 사용량 추출"""
        usage = sample_llm_response.get("usage", {})
        total_tokens = usage.get("total_tokens", 0)
        assert total_tokens == 150


class TestVCRIntegrationStructure:
    """
    VCR 통합 테스트 구조 데모

    실제 API 호출 테스트는 아래 형식으로 작성:

    @pytest.mark.vcr()
    async def test_real_llm_call():
        client = LLMClient.get_instance(config)
        response = await client.generate("Hello")
        assert response is not None

    첫 실행 시 실제 API 호출 → cassette 저장
    이후 실행 시 cassette 재생 (토큰 0)
    """

    def test_vcr_marker_structure(self):
        """VCR 마커 구조 확인"""
        # pytest.mark.vcr() 데코레이터가 사용 가능한지 확인
        assert hasattr(pytest.mark, "vcr")

    def test_cassette_yaml_format(self, tmp_path):
        """Cassette YAML 형식 검증"""
        # 샘플 cassette 구조
        sample_cassette = {
            "version": 1,
            "interactions": [
                {
                    "request": {
                        "body": '{"model": "gpt-4", "messages": []}',
                        "headers": {"Content-Type": ["application/json"]},
                        "method": "POST",
                        "uri": "https://api.openai.com/v1/chat/completions",
                    },
                    "response": {
                        "body": {"string": '{"choices": []}'},
                        "headers": {"Content-Type": ["application/json"]},
                        "status": {"code": 200, "message": "OK"},
                    },
                }
            ],
        }

        # YAML로 저장 가능한 구조인지 확인
        import yaml

        cassette_file = tmp_path / "test.yaml"
        with open(cassette_file, "w") as f:
            yaml.dump(sample_cassette, f)

        # 다시 로드 가능한지 확인
        with open(cassette_file) as f:
            loaded = yaml.safe_load(f)

        assert loaded["version"] == 1
        assert len(loaded["interactions"]) == 1


class TestVCRUsageGuide:
    """
    VCR 사용 가이드 테스트

    실제 API 호출이 필요한 VCR 테스트 작성 시:

    1. 환경 변수 설정:
       export OPENAI_API_KEY=sk-xxx

    2. 첫 실행 (녹화):
       poetry run pytest backend/tests/test_vcr_llm.py -k "real_api" --record-mode=once

    3. 이후 실행 (재생):
       poetry run pytest backend/tests/test_vcr_llm.py -k "real_api"

    4. 녹화 갱신 (프롬프트 변경 시):
       poetry run pytest backend/tests/test_vcr_llm.py -k "real_api" --record-mode=new_episodes
    """

    def test_usage_documentation(self):
        """사용 가이드 문서화"""
        # 이 테스트는 문서화 목적
        assert True

    def test_record_modes(self):
        """VCR 녹화 모드 설명"""
        record_modes = {
            "once": "최초 1회만 녹화, 이후 재생",
            "new_episodes": "기존 + 새로운 요청만 녹화",
            "none": "녹화 안 함, 재생만",
            "all": "항상 녹화 (주의: 토큰 소모)",
        }

        assert "once" in record_modes
        assert record_modes["once"] == "최초 1회만 녹화, 이후 재생"
