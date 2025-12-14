"""
API Keys Handler - Manage Gemini API key rotation
"""

import aiohttp
from tornado import web
from .base import BaseAgentHandler
from ..services.api_key_manager import get_key_manager


async def test_gemini_api_key(api_key: str) -> tuple:
    """
    Test if a Gemini API key is valid by making a simple API call.
    Returns (success: bool, message: str)
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    return True, "API key is valid"
                elif response.status == 400:
                    error_data = await response.json()
                    error_msg = error_data.get('error', {}).get('message', 'Invalid API key')
                    return False, f"Invalid API key: {error_msg}"
                elif response.status == 403:
                    return False, "API key is forbidden or disabled"
                else:
                    return False, f"API validation failed (HTTP {response.status})"
    except aiohttp.ClientError as e:
        return False, f"Network error: {str(e)}"
    except Exception as e:
        return False, f"Validation error: {str(e)}"


class GeminiKeysHandler(BaseAgentHandler):
    """Handle Gemini API key management operations (GET, POST, DELETE)"""

    @web.authenticated
    async def get(self):
        """GET /hdsp-agent/gemini-keys - Get all keys status"""
        try:
            key_manager = get_key_manager(self.config_manager)
            keys_status = key_manager.get_all_keys_status()

            self.write_json({
                "keys": keys_status,
                "maxKeys": key_manager.MAX_KEYS,
                "currentCount": key_manager.get_key_count()
            })
        except Exception as e:
            self.log.error(f"Get keys failed: {e}")
            self.write_error_json(500, str(e))

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/gemini-keys - Add a new key (with API validation)"""
        try:
            data = self.get_json_body()
            api_key = data.get('apiKey', '').strip()

            if not api_key:
                return self.write_error_json(400, "API key is required")

            # Basic validation for Gemini API key format
            if not api_key.startswith('AIza'):
                return self.write_error_json(400, "Invalid Gemini API key format (should start with 'AIza')")

            # Test the API key before adding
            self.log.info("Testing Gemini API key before adding...")
            is_valid, test_message = await test_gemini_api_key(api_key)

            if not is_valid:
                self.log.warning(f"API key validation failed: {test_message}")
                return self.write_error_json(400, f"API key validation failed: {test_message}")

            self.log.info("API key validation successful, adding to key manager...")

            key_manager = get_key_manager(self.config_manager)
            success, message = key_manager.add_key(api_key)

            if success:
                self.write_json({
                    "success": True,
                    "message": f"API key validated and added successfully",
                    "keys": key_manager.get_all_keys_status()
                })
            else:
                self.write_error_json(400, message)

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Add key failed: {e}")
            self.write_error_json(500, str(e))

    @web.authenticated
    async def delete(self):
        """DELETE /hdsp-agent/gemini-keys - Remove a key"""
        try:
            data = self.get_json_body()
            key_id = data.get('keyId', '').strip()

            if not key_id:
                return self.write_error_json(400, "Key ID is required")

            key_manager = get_key_manager(self.config_manager)
            success, message = key_manager.remove_key(key_id)

            if success:
                self.write_json({
                    "success": True,
                    "message": message,
                    "keys": key_manager.get_all_keys_status()
                })
            else:
                self.write_error_json(404, message)

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Remove key failed: {e}")
            self.write_error_json(500, str(e))


class GeminiKeysTestHandler(BaseAgentHandler):
    """Test all Gemini API keys"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/gemini-keys/test - Test all keys"""
        try:
            key_manager = get_key_manager(self.config_manager)
            keys_status = key_manager.get_all_keys_status()

            results = []
            for key_info in keys_status:
                key_id = key_info['id']
                # Get actual key from manager
                actual_key = key_manager._get_key_by_id(key_id)

                if actual_key and key_info['enabled']:
                    is_valid, message = await test_gemini_api_key(actual_key)
                    results.append({
                        'id': key_id,
                        'maskedKey': key_info['maskedKey'],
                        'success': is_valid,
                        'message': message if not is_valid else 'OK'
                    })
                else:
                    results.append({
                        'id': key_id,
                        'maskedKey': key_info['maskedKey'],
                        'success': False,
                        'message': 'Disabled' if not key_info['enabled'] else 'Key not found'
                    })

            self.write_json({
                'results': results,
                'totalKeys': len(results),
                'successCount': sum(1 for r in results if r['success'])
            })

        except Exception as e:
            self.log.error(f"Test keys failed: {e}")
            self.write_error_json(500, str(e))


class GeminiKeyToggleHandler(BaseAgentHandler):
    """Handle key enable/disable toggle"""

    @web.authenticated
    async def post(self):
        """POST /hdsp-agent/gemini-keys/toggle - Toggle key enabled state"""
        try:
            data = self.get_json_body()
            key_id = data.get('keyId', '').strip()
            enabled = data.get('enabled', True)

            if not key_id:
                return self.write_error_json(400, "Key ID is required")

            key_manager = get_key_manager(self.config_manager)
            success, message = key_manager.toggle_key(key_id, enabled)

            if success:
                self.write_json({
                    "success": True,
                    "message": message,
                    "keys": key_manager.get_all_keys_status()
                })
            else:
                self.write_error_json(404, message)

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Toggle key failed: {e}")
            self.write_error_json(500, str(e))
