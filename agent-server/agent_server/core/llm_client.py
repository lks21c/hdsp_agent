"""
LLM Client - Interface with language models
"""

import os
import ssl
from typing import Any, Dict

import aiohttp
import certifi

from agent_server.prompts import DEFAULT_SYSTEM_PROMPT


class LLMClient:
    """Client for LLM API communication"""

    _instance = None

    def __init__(self, config: Dict[str, Any]):
        self._update_config(config)

    def _update_config(self, config: Dict[str, Any]):
        """Update client configuration from config dict"""
        self.config = config
        self.api_key = config.get("apiKey") or os.environ.get("OPENAI_API_KEY")
        self.base_url = config.get("baseUrl", "https://api.openai.com/v1")
        self.model = config.get("modelId", "gpt-4")
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("maxTokens", 2000)

    @classmethod
    def get_instance(cls, config: Dict[str, Any]):
        """Get singleton instance"""
        if cls._instance is None:
            cls._instance = LLMClient(config)
        else:
            cls._instance._update_config(config)
        return cls._instance

    async def generate(self, prompt: str) -> Dict[str, Any]:
        """Generate response from LLM"""
        if not self.api_key:
            raise ValueError("API key not configured")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": self.config.get("systemPrompt", DEFAULT_SYSTEM_PROMPT),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        url = f"{self.base_url}/chat/completions"

        # Create SSL context with certifi certificates
        ssl_context = ssl.create_default_context(cafile=certifi.where())

        try:
            async with aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(ssl=ssl_context)
            ) as session:
                async with session.post(url, headers=headers, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        raise RuntimeError(
                            f"API request failed ({response.status}): {error_text}"
                        )

                    data = await response.json()

                    # Extract response
                    content = data["choices"][0]["message"]["content"]
                    tokens = data.get("usage", {}).get("total_tokens", 0)

                    return {
                        "content": content,
                        "model": data.get("model", self.model),
                        "tokens": tokens,
                    }

        except aiohttp.ClientError as e:
            raise RuntimeError(f"Network error: {str(e)}")
        except KeyError as e:
            raise RuntimeError(f"Unexpected API response format: {str(e)}")
