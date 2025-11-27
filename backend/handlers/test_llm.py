"""
LLM Test Handler - Test LLM configuration
"""

import json
from jupyter_server.base.handlers import APIHandler
from tornado import web
from ..llm_service import LLMService


class TestLLMHandler(APIHandler):
    """Handler for testing LLM configuration"""

    # Provider validation rules: (config_key, required_field, error_message)
    VALIDATION_RULES = {
        'gemini': ('gemini', 'apiKey', 'Gemini API 키가 필요합니다'),
        'openai': ('openai', 'apiKey', 'OpenAI API 키가 필요합니다'),
        'vllm': ('vllm', 'endpoint', 'vLLM 엔드포인트가 필요합니다'),
    }

    def _validate_provider_config(self, config: dict, provider: str) -> tuple[bool, str | None]:
        """Validate provider-specific configuration. Returns (is_valid, error_message)"""
        if provider not in self.VALIDATION_RULES:
            return True, None

        config_key, required_field, error_msg = self.VALIDATION_RULES[provider]
        if not config.get(config_key, {}).get(required_field):
            return False, error_msg
        return True, None

    @web.authenticated
    async def post(self):
        """Test LLM connection with provided config"""
        try:
            # Parse request body
            config = self.get_json_body()

            if not config or 'provider' not in config:
                self.set_status(400)
                self.finish(json.dumps({'error': 'LLM 설정이 필요합니다'}))
                return

            provider = config.get('provider')

            # Validate provider-specific config
            is_valid, error_msg = self._validate_provider_config(config, provider)
            if not is_valid:
                self.set_status(400)
                self.finish(json.dumps({'error': error_msg}))
                return

            # Initialize LLM service with test config
            llm_service = LLMService(config)

            # Send a simple test message
            test_prompt = "안녕하세요. 테스트입니다. '성공'이라고만 답변해주세요."

            try:
                response = await llm_service.generate_response(test_prompt)

                # If we got here, the API call succeeded
                self.finish(json.dumps({
                    'success': True,
                    'message': f'연결 성공! 응답: {response[:100]}...' if len(response) > 100 else f'연결 성공! 응답: {response}',
                    'provider': provider,
                    'model': self._get_model_from_config(config)
                }))

            except Exception as llm_error:
                self.set_status(400)
                self.finish(json.dumps({
                    'error': f'LLM API 호출 실패: {str(llm_error)}'
                }))

        except ValueError as e:
            self.set_status(400)
            self.finish(json.dumps({'error': str(e)}))
        except Exception as e:
            self.log.error(f"LLM test failed: {e}")
            self.set_status(500)
            self.finish(json.dumps({'error': f'테스트 실패: {str(e)}'}))

    def _get_model_from_config(self, config):
        """Extract model name from config based on provider"""
        provider = config.get('provider')
        if provider == 'gemini':
            return config.get('gemini', {}).get('model', 'gemini-2.0-flash-exp')
        elif provider == 'vllm':
            return config.get('vllm', {}).get('model', 'default')
        elif provider == 'openai':
            return config.get('openai', {}).get('model', 'gpt-4')
        return 'unknown'
