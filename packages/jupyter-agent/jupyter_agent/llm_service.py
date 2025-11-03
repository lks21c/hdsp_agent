"""
LLM Service - Handles interactions with different LLM providers
"""

import os
import json
import asyncio
from typing import Dict, Any, Optional
import aiohttp


class LLMService:
    """Service for interacting with various LLM providers"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider = config.get('provider', 'gemini')

    async def generate_response(self, prompt: str, context: Optional[str] = None) -> str:
        """Generate a response from the configured LLM provider"""

        if self.provider == 'gemini':
            return await self._call_gemini(prompt, context)
        elif self.provider == 'vllm':
            return await self._call_vllm(prompt, context)
        elif self.provider == 'openai':
            return await self._call_openai(prompt, context)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")

    async def _call_gemini(self, prompt: str, context: Optional[str] = None, max_retries: int = 3) -> str:
        """Call Google Gemini API with retry logic"""
        gemini_config = self.config.get('gemini', {})
        api_key = gemini_config.get('apiKey')
        model = gemini_config.get('model', 'gemini-2.5-pro')

        if not api_key:
            raise ValueError("Gemini API key not configured")

        print(f"[LLMService] Calling Gemini API with model: {model}")
        print(f"[LLMService] API URL: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        # Construct message with context if provided
        full_prompt = prompt
        if context:
            full_prompt = f"Context:\n{context}\n\nUser Request:\n{prompt}"

        payload = {
            "contents": [{
                "parts": [{
                    "text": full_prompt
                }]
            }],
            "generationConfig": {
                "temperature": 0.7,
                "topK": 40,
                "topP": 0.95,
                "maxOutputTokens": 4096
            },
            "safetySettings": [
                {
                    "category": "HARM_CATEGORY_HARASSMENT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_HATE_SPEECH",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                    "threshold": "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        }

        # Retry logic with exponential backoff
        for attempt in range(max_retries):
            try:
                # Set timeout to 60 seconds for gemini-2.5-pro (slower than 2.0-flash-exp)
                timeout = aiohttp.ClientTimeout(total=60)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(url, json=payload) as response:
                        if response.status == 503:
                            # Service overloaded - retry with backoff
                            if attempt < max_retries - 1:
                                wait_time = (2 ** attempt) * 2  # 2, 4, 8 seconds
                                print(f"[LLMService] Gemini API overloaded (503). Retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                                await asyncio.sleep(wait_time)
                                continue
                            else:
                                error_text = await response.text()
                                print(f"[LLMService] Gemini API Error after {max_retries} retries: {error_text}")
                                raise Exception(f"Gemini API overloaded after {max_retries} retries: {error_text}")

                        if response.status == 429:
                            # Rate limit - retry with longer backoff
                            if attempt < max_retries - 1:
                                wait_time = (2 ** attempt) * 5  # 5, 10, 20 seconds
                                print(f"[LLMService] Gemini API rate limit (429). Retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                                await asyncio.sleep(wait_time)
                                continue
                            else:
                                error_text = await response.text()
                                print(f"[LLMService] Gemini API rate limit after {max_retries} retries: {error_text}")
                                raise Exception(f"Gemini API rate limit after {max_retries} retries: {error_text}")

                        if response.status != 200:
                            error_text = await response.text()
                            print(f"[LLMService] Gemini API Error: {error_text}")
                            raise Exception(f"Gemini API error: {error_text}")

                        data = await response.json()
                        print(f"[LLMService] Gemini API Response Status: {response.status}")

                        # Extract response text from Gemini format
                        if 'candidates' in data and len(data['candidates']) > 0:
                            candidate = data['candidates'][0]
                            if 'content' in candidate and 'parts' in candidate['content']:
                                parts = candidate['content']['parts']
                                if len(parts) > 0 and 'text' in parts[0]:
                                    response_text = parts[0]['text']
                                    print(f"[LLMService] Successfully received response from {model} (length: {len(response_text)} chars)")
                                    return response_text

                        raise Exception("No valid response from Gemini API")

            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 3  # 3, 6, 12 seconds
                    print(f"[LLMService] Request timeout. Retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    raise Exception(f"Request timeout after {max_retries} retries")

            except Exception as e:
                # For other exceptions, don't retry
                if "API error" in str(e) or "timeout" in str(e):
                    raise
                # For network errors, retry
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 2
                    print(f"[LLMService] Network error: {e}. Retrying in {wait_time}s... (attempt {attempt + 1}/{max_retries})")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    raise

    async def _call_vllm(self, prompt: str, context: Optional[str] = None) -> str:
        """Call vLLM endpoint with OpenAI Compatible API"""
        vllm_config = self.config.get('vllm', {})
        endpoint = vllm_config.get('endpoint', 'http://localhost:8000')
        api_key = vllm_config.get('apiKey')
        model = vllm_config.get('model', 'default')

        # Construct message with context if provided
        full_prompt = prompt
        if context:
            full_prompt = f"Context:\n{context}\n\nUser Request:\n{prompt}"

        # OpenAI Compatible API: use /v1/chat/completions endpoint
        url = f"{endpoint}/v1/chat/completions"
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": full_prompt
                }
            ],
            "max_tokens": 4096,
            "temperature": 0.7,
            "stream": False
        }

        # Add authorization header if API key is provided
        headers = {
            "Content-Type": "application/json"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        # Set timeout to 60 seconds
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"vLLM API error: {error_text}")

                data = await response.json()

                # OpenAI format response
                if 'choices' in data and len(data['choices']) > 0:
                    choice = data['choices'][0]
                    if 'message' in choice and 'content' in choice['message']:
                        return choice['message']['content']
                    # Fallback to text field if exists
                    elif 'text' in choice:
                        return choice['text']

                raise Exception("No valid response from vLLM API")

    async def _call_openai(self, prompt: str, context: Optional[str] = None) -> str:
        """Call OpenAI API"""
        openai_config = self.config.get('openai', {})
        api_key = openai_config.get('apiKey')
        model = openai_config.get('model', 'gpt-4')

        if not api_key:
            raise ValueError("OpenAI API key not configured")

        # Construct message with context if provided
        messages = []
        if context:
            messages.append({
                "role": "system",
                "content": f"Context:\n{context}"
            })
        messages.append({
            "role": "user",
            "content": prompt
        })

        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": 2000,
            "temperature": 0.7
        }

        # Set timeout to 60 seconds
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"OpenAI API error: {error_text}")

                data = await response.json()

                if 'choices' in data and len(data['choices']) > 0:
                    return data['choices'][0]['message']['content']

                raise Exception("No valid response from OpenAI API")
