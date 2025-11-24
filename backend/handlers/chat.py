"""
Chat message handler for Jupyter Agent
"""

import json
from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.iostream import StreamClosedError
from ..llm_service import LLMService
import uuid


class ChatHandler(APIHandler):
    """Handler for chat messages"""

    # Store conversations in memory (in production, use a database)
    conversations = {}

    @web.authenticated
    async def post(self):
        """Handle chat message request"""
        try:
            # Parse request body
            data = self.get_json_body()
            message = data.get('message', '')
            conversation_id = data.get('conversationId')

            self.log.info(f"=== Chat message received ===")
            self.log.info(f"Message: {message}")
            self.log.info(f"Conversation ID: {conversation_id}")

            if not message:
                self.log.warning("Message is empty")
                self.set_status(400)
                self.finish(json.dumps({'error': 'Message is required'}))
                return

            # Get or create conversation
            if not conversation_id:
                conversation_id = str(uuid.uuid4())
                self.conversations[conversation_id] = []

            # Get LLM config from extension settings
            config_manager = self.settings.get('config_manager')
            self.log.info(f"Config manager: {config_manager}")

            if not config_manager:
                self.log.error("Config manager not available in settings")
                self.set_status(500)
                self.finish(json.dumps({'error': 'Configuration manager not available'}))
                return

            config = config_manager.get_config()
            self.log.info(f"Loaded config: {config}")
            self.log.info(f"Config type: {type(config)}")
            self.log.info(f"Config keys: {config.keys() if isinstance(config, dict) else 'Not a dict'}")

            # Check if config has required settings
            if not config:
                self.log.warning("Config is None or empty")
                self.set_status(400)
                self.finish(json.dumps({
                    'error': 'LLM not configured. Please configure your LLM provider in settings.'
                }))
                return
            
            if not isinstance(config, dict):
                self.log.warning(f"Config is not a dict: {type(config)}")
                self.set_status(400)
                self.finish(json.dumps({
                    'error': 'Invalid configuration format.'
                }))
                return

            if 'provider' not in config:
                self.log.warning(f"Provider not found in config. Available keys: {list(config.keys())}")
                self.set_status(400)
                self.finish(json.dumps({
                    'error': 'LLM not configured. Please configure your LLM provider in settings.'
                }))
                return

            provider = config.get('provider')
            self.log.info(f"Using provider: {provider}")

            # Log detailed model configuration
            if provider == 'gemini':
                model = config.get('gemini', {}).get('model', 'gemini-pro')
                self.log.info(f"Gemini Model: {model}")
            elif provider == 'vllm':
                model = config.get('vllm', {}).get('model', 'default')
                endpoint = config.get('vllm', {}).get('endpoint', 'http://localhost:8000')
                self.log.info(f"vLLM Model: {model}, Endpoint: {endpoint}")
            elif provider == 'openai':
                model = config.get('openai', {}).get('model', 'gpt-4')
                self.log.info(f"OpenAI Model: {model}")

            # Initialize LLM service
            self.log.info("Initializing LLM service...")
            llm_service = LLMService(config)

            # Get conversation history as context
            context = None
            if conversation_id in self.conversations:
                history = self.conversations[conversation_id]
                if len(history) > 0:
                    # Include last 5 messages as context
                    recent_history = history[-5:]
                    context = "\n".join([
                        f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
                        for msg in recent_history
                    ])
                    self.log.info(f"Using context with {len(recent_history)} previous messages")

            # Generate response from LLM
            self.log.info(f"Calling LLM with message: {message[:50]}...")
            response_text = await llm_service.generate_response(message, context)
            self.log.info(f"LLM response received: {response_text[:100]}...")

            # Store messages in conversation
            if conversation_id not in self.conversations:
                self.conversations[conversation_id] = []

            self.conversations[conversation_id].append({
                'role': 'user',
                'content': message
            })
            self.conversations[conversation_id].append({
                'role': 'assistant',
                'content': response_text
            })

            # Build response
            response = {
                'conversationId': conversation_id,
                'messageId': str(uuid.uuid4()),
                'content': response_text,
                'metadata': {
                    'provider': config.get('provider'),
                    'model': self._get_model_from_config(config)
                }
            }

            self.finish(json.dumps(response))

        except ValueError as e:
            self.set_status(400)
            self.finish(json.dumps({'error': str(e)}))
        except Exception as e:
            self.log.error(f"Error in chat handler: {e}")
            self.set_status(500)
            self.finish(json.dumps({'error': f'Failed to generate response: {str(e)}'}))

    def _get_model_from_config(self, config):
        """Extract model name from config based on provider"""
        provider = config.get('provider')
        if provider == 'gemini':
            return config.get('gemini', {}).get('model', 'gemini-pro')
        elif provider == 'vllm':
            return config.get('vllm', {}).get('model', 'unknown')
        elif provider == 'openai':
            return config.get('openai', {}).get('model', 'gpt-4')
        return 'unknown'


class ChatStreamHandler(APIHandler):
    """Handler for streaming chat messages via SSE"""

    # Share conversations with ChatHandler
    conversations = ChatHandler.conversations

    async def _send_sse_message(self, data: dict):
        """Send a Server-Sent Events message"""
        message = f"data: {json.dumps(data)}\n\n"
        self.write(message)
        await self.flush()

    @web.authenticated
    async def post(self):
        """Handle streaming chat message request"""
        try:
            # Set SSE headers
            self.set_header('Content-Type', 'text/event-stream')
            self.set_header('Cache-Control', 'no-cache')
            self.set_header('Connection', 'keep-alive')
            self.set_header('X-Accel-Buffering', 'no')

            # Parse request body
            data = self.get_json_body()
            message = data.get('message', '')
            conversation_id = data.get('conversationId')

            if not message:
                await self._send_sse_message({'error': 'Message is required', 'done': True})
                return

            # Get or create conversation
            if not conversation_id:
                conversation_id = str(uuid.uuid4())
                self.conversations[conversation_id] = []

            # Get LLM config
            config_manager = self.settings.get('config_manager')
            if not config_manager:
                await self._send_sse_message({'error': 'Configuration manager not available', 'done': True})
                return

            config = config_manager.get_config()
            if not config or not isinstance(config, dict) or 'provider' not in config:
                await self._send_sse_message({'error': 'LLM not configured. Please configure your LLM provider.', 'done': True})
                return

            # Send initial message with conversation info
            message_id = str(uuid.uuid4())
            await self._send_sse_message({
                'conversationId': conversation_id,
                'messageId': message_id,
                'content': '',
                'done': False
            })

            # Initialize LLM service
            llm_service = LLMService(config)

            # Get conversation context
            context = None
            if conversation_id in self.conversations:
                history = self.conversations[conversation_id]
                if len(history) > 0:
                    recent_history = history[-5:]
                    context = "\n".join([
                        f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
                        for msg in recent_history
                    ])

            # Stream response from LLM
            full_response = ""
            try:
                async for chunk in llm_service.generate_response_stream(message, context):
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

            # Store messages in conversation
            if conversation_id not in self.conversations:
                self.conversations[conversation_id] = []

            self.conversations[conversation_id].append({
                'role': 'user',
                'content': message
            })
            self.conversations[conversation_id].append({
                'role': 'assistant',
                'content': full_response
            })

            # Send final message
            await self._send_sse_message({
                'content': '',
                'done': True,
                'metadata': {
                    'provider': config.get('provider'),
                    'model': self._get_model_from_config(config)
                }
            })

        except StreamClosedError:
            self.log.warning("Client disconnected")
        except Exception as e:
            self.log.error(f"Error in chat stream handler: {e}")
            try:
                await self._send_sse_message({'error': str(e), 'done': True})
            except StreamClosedError:
                pass

    def _get_model_from_config(self, config):
        """Extract model name from config based on provider"""
        provider = config.get('provider')
        if provider == 'gemini':
            return config.get('gemini', {}).get('model', 'gemini-pro')
        elif provider == 'vllm':
            return config.get('vllm', {}).get('model', 'unknown')
        elif provider == 'openai':
            return config.get('openai', {}).get('model', 'gpt-4')
        return 'unknown'
