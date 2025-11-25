"""
Cell Action Handler - Handles explain, fix, and custom prompt actions
"""

from tornado import web
from .base import BaseAgentHandler
from ..services.prompt_builder import PromptBuilder
import time

class CellActionHandler(BaseAgentHandler):
    """Handle cell-level actions"""

    @web.authenticated
    async def post(self):
        """Process cell action request"""
        try:
            # Parse request
            data = self.get_json_body()

            # Validate required fields
            required = ['cellId', 'cellContent', 'action']
            for field in required:
                if field not in data:
                    self.write_error_json(400, f"Missing required field: {field}")
                    return

            cell_id = data['cellId']
            cell_content = data['cellContent']
            action = data['action']
            custom_prompt = data.get('customPrompt')

            # Validate action
            valid_actions = ['explain', 'fix', 'custom']
            if action not in valid_actions:
                self.write_error_json(400, f"Invalid action: {action}. Must be one of {valid_actions}")
                return

            # Build prompt
            prompt = self._build_prompt(action, cell_content, custom_prompt)

            # Call LLM
            start_time = time.time()

            try:
                llm_response = await self.llm_client.generate(prompt)
            except Exception as e:
                self.log.error(f"LLM generation failed: {e}")
                self.write_error_json(500, f"LLM generation failed: {str(e)}")
                return

            duration = int((time.time() - start_time) * 1000)  # ms

            # Build response
            result = {
                'cellId': cell_id,
                'response': llm_response['content'],
                'metadata': {
                    'model': llm_response.get('model', 'unknown'),
                    'tokens': llm_response.get('tokens', 0),
                    'duration': duration
                }
            }

            # Add suggestions or fixed code if applicable
            if action == 'fix' and llm_response.get('fixedCode'):
                result['fixedCode'] = llm_response['fixedCode']

            if llm_response.get('suggestions'):
                result['suggestions'] = llm_response['suggestions']

            self.write_json(result)

        except ValueError as e:
            self.write_error_json(400, str(e))
        except Exception as e:
            self.log.error(f"Cell action failed: {e}")
            self.write_error_json(500, "Internal server error")

    def _build_prompt(self, action: str, cell_content: str, custom_prompt: str = None) -> str:
        """Build LLM prompt based on action type"""
        if action == 'explain':
            return PromptBuilder.build_explain_prompt(cell_content)
        elif action == 'fix':
            return PromptBuilder.build_fix_prompt(cell_content)
        elif action == 'custom':
            return PromptBuilder.build_custom_prompt(custom_prompt, cell_content)
        else:
            raise ValueError(f"Unknown action: {action}")
