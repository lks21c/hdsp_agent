"""
Chat message handler for Jupyter Agent
"""

import json
from jupyter_server.base.handlers import APIHandler
from tornado import web
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

            # Check if config has required settings
            if not config or 'provider' not in config:
                self.log.warning(f"Invalid config: {config}")
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
