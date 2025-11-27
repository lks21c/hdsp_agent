"""
Chat message handler for Jupyter Agent
"""

import json
from dataclasses import dataclass
from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.iostream import StreamClosedError
from ..llm_service import LLMService
import uuid


@dataclass
class ChatRequest:
    """Parsed chat request data"""
    message: str
    conversation_id: str | None


class BaseChatHandler(APIHandler):
    """Base handler with shared chat functionality"""

    # Store conversations in memory (in production, use a database)
    conversations = {}

    # Provider configuration mapping: provider -> (config_key, default_model)
    PROVIDER_CONFIG = {
        'gemini': ('gemini', 'gemini-pro'),
        'vllm': ('vllm', 'unknown'),
        'openai': ('openai', 'gpt-4'),
    }

    def _parse_request(self) -> ChatRequest:
        """Parse and return chat request data"""
        data = self.get_json_body()
        return ChatRequest(
            message=data.get('message', ''),
            conversation_id=data.get('conversationId')
        )

    def _get_or_create_conversation(self, conversation_id: str | None) -> str:
        """Get existing conversation or create new one"""
        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            self.conversations[conversation_id] = []
        return conversation_id

    def _validate_config(self, config: dict | None) -> tuple[bool, str | None]:
        """Validate LLM configuration. Returns (is_valid, error_message)"""
        if not config:
            return False, 'LLM not configured. Please configure your LLM provider in settings.'
        if not isinstance(config, dict):
            return False, 'Invalid configuration format.'
        if 'provider' not in config:
            return False, 'LLM not configured. Please configure your LLM provider in settings.'
        return True, None

    def _get_config(self) -> tuple[dict | None, str | None]:
        """Get and validate config. Returns (config, error_message)"""
        config_manager = self.settings.get('config_manager')
        if not config_manager:
            return None, 'Configuration manager not available'

        config = config_manager.get_config()
        is_valid, error = self._validate_config(config)
        if not is_valid:
            return None, error
        return config, None

    def _build_context(self, conversation_id: str, max_messages: int = 5) -> str | None:
        """Build conversation context from history"""
        if conversation_id not in self.conversations:
            return None

        history = self.conversations[conversation_id]
        if not history:
            return None

        recent_history = history[-max_messages:]
        return "\n".join([
            f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
            for msg in recent_history
        ])

    def _store_messages(self, conversation_id: str, user_message: str, assistant_response: str):
        """Store user and assistant messages in conversation history"""
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = []

        self.conversations[conversation_id].append({
            'role': 'user',
            'content': user_message
        })
        self.conversations[conversation_id].append({
            'role': 'assistant',
            'content': assistant_response
        })

    def _get_provider_config(self, config: dict) -> tuple[str, str, dict]:
        """Get provider-specific config. Returns (provider, model, provider_config)"""
        provider = config.get('provider')
        if provider in self.PROVIDER_CONFIG:
            key, default = self.PROVIDER_CONFIG[provider]
            provider_config = config.get(key, {})
            model = provider_config.get('model', default)
            return provider, model, provider_config
        return provider or 'unknown', 'unknown', {}

    def _get_model_from_config(self, config: dict) -> str:
        """Extract model name from config based on provider"""
        _, model, _ = self._get_provider_config(config)
        return model

    def _build_metadata(self, config: dict) -> dict:
        """Build response metadata"""
        return {
            'provider': config.get('provider'),
            'model': self._get_model_from_config(config)
        }

    def _log_provider_info(self, config: dict):
        """Log provider-specific configuration details"""
        provider, model, provider_config = self._get_provider_config(config)
        self.log.info(f"Using provider: {provider}")
        self.log.info(f"{provider.capitalize()} Model: {model}")

        if provider == 'vllm':
            endpoint = provider_config.get('endpoint', 'http://localhost:8000')
            self.log.info(f"vLLM Endpoint: {endpoint}")

    def _create_llm_service(self, config: dict, conversation_id: str) -> tuple[LLMService, str | None]:
        """Create LLM service and build context. Returns (llm_service, context)"""
        return LLMService(config), self._build_context(conversation_id)


class ChatHandler(BaseChatHandler):
    """Handler for chat messages (non-streaming)"""

    @web.authenticated
    async def post(self):
        """Handle chat message request"""
        try:
            request = self._parse_request()

            self.log.info(f"=== Chat message received ===")
            self.log.info(f"Message: {request.message}")
            self.log.info(f"Conversation ID: {request.conversation_id}")

            if not request.message:
                self.log.warning("Message is empty")
                self.set_status(400)
                self.finish(json.dumps({'error': 'Message is required'}))
                return

            conversation_id = self._get_or_create_conversation(request.conversation_id)

            config, error = self._get_config()
            if error:
                status = 500 if 'manager' in error.lower() else 400
                self.log.error(error) if status == 500 else self.log.warning(error)
                self.set_status(status)
                self.finish(json.dumps({'error': error}))
                return

            self._log_provider_info(config)

            self.log.info("Initializing LLM service...")
            llm_service, context = self._create_llm_service(config, conversation_id)
            if context:
                self.log.info("Using context with previous messages")

            self.log.info(f"Calling LLM with message: {request.message[:50]}...")
            response_text = await llm_service.generate_response(request.message, context)
            self.log.info(f"LLM response received: {response_text[:100]}...")

            self._store_messages(conversation_id, request.message, response_text)

            response = {
                'conversationId': conversation_id,
                'messageId': str(uuid.uuid4()),
                'content': response_text,
                'metadata': self._build_metadata(config)
            }

            self.finish(json.dumps(response))

        except ValueError as e:
            self.set_status(400)
            self.finish(json.dumps({'error': str(e)}))
        except Exception as e:
            self.log.error(f"Error in chat handler: {e}")
            self.set_status(500)
            self.finish(json.dumps({'error': f'Failed to generate response: {str(e)}'}))


class ChatStreamHandler(BaseChatHandler):
    """Handler for streaming chat messages via SSE"""

    async def _send_sse_message(self, data: dict):
        """Send a Server-Sent Events message"""
        message = f"data: {json.dumps(data)}\n\n"
        self.write(message)
        await self.flush()

    @web.authenticated
    async def post(self):
        """Handle streaming chat message request"""
        try:
            self.set_header('Content-Type', 'text/event-stream')
            self.set_header('Cache-Control', 'no-cache')
            self.set_header('Connection', 'keep-alive')
            self.set_header('X-Accel-Buffering', 'no')

            request = self._parse_request()

            if not request.message:
                await self._send_sse_message({'error': 'Message is required', 'done': True})
                return

            conversation_id = self._get_or_create_conversation(request.conversation_id)

            config, error = self._get_config()
            if error:
                await self._send_sse_message({'error': error, 'done': True})
                return

            await self._send_sse_message({
                'conversationId': conversation_id,
                'messageId': str(uuid.uuid4()),
                'content': '',
                'done': False
            })

            llm_service, context = self._create_llm_service(config, conversation_id)

            full_response = ""
            try:
                async for chunk in llm_service.generate_response_stream(request.message, context):
                    full_response += chunk
                    await self._send_sse_message({
                        'content': chunk,
                        'done': False
                    })
            except StreamClosedError:
                self.log.warning("Client disconnected during streaming")
                return
            except Exception as e:
                self.log.error(f"Error during streaming: {e}")
                await self._send_sse_message({'error': str(e), 'done': True})
                return

            self._store_messages(conversation_id, request.message, full_response)

            await self._send_sse_message({
                'content': '',
                'done': True,
                'metadata': self._build_metadata(config)
            })

        except StreamClosedError:
            self.log.warning("Client disconnected")
        except Exception as e:
            self.log.error(f"Error in chat stream handler: {e}")
            try:
                await self._send_sse_message({'error': str(e), 'done': True})
            except StreamClosedError:
                pass
