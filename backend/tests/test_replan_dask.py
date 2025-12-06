"""
Test Adaptive Replanning for ModuleNotFoundError scenario
dask import error가 발생했을 때 LLM이 어떤 decision을 내리는지 테스트

직접 실행: cd /Users/hydra01/repo/hdsp_agent && poetry run python backend/tests/test_replan_dask.py
"""
import asyncio
import json
import sys
import os
from pathlib import Path

# Add backend to path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from prompts.auto_agent_prompts import format_replan_prompt


def load_config():
    """Load LLM config from ~/.jupyter/hdsp_agent_config.json"""
    config_file = Path.home() / '.jupyter' / 'hdsp_agent_config.json'
    if config_file.exists():
        with open(config_file, 'r') as f:
            return json.load(f)
    return {
        'provider': 'gemini',
        'gemini': {
            'apiKey': '',
            'model': 'gemini-2.5-pro'
        }
    }


def test_format_replan_prompt():
    """Replan 프롬프트가 어떻게 생성되는지 확인"""

    # 시뮬레이션: dask import 실패 시나리오
    original_request = "dask를 사용해서 train.csv 파일을 로드하고 head() 출력해줘"

    executed_steps = []  # 아직 성공한 단계 없음

    failed_step = {
        "stepNumber": 1,
        "description": "dask.dataframe 라이브러리를 임포트합니다.",
        "toolCalls": [
            {
                "tool": "jupyter_cell",
                "parameters": {
                    "code": "import dask.dataframe as dd"
                }
            }
        ]
    }

    error_info = {
        "type": "runtime",
        "message": "ModuleNotFoundError: No module named 'dask'",
        "traceback": [
            "Traceback (most recent call last):",
            '  File "<stdin>", line 1, in <module>',
            "ModuleNotFoundError: No module named 'dask'"
        ],
        "recoverable": False
    }

    execution_output = "ModuleNotFoundError: No module named 'dask'"

    # 프롬프트 생성
    prompt = format_replan_prompt(
        original_request=original_request,
        executed_steps=executed_steps,
        failed_step=failed_step,
        error_info=error_info,
        execution_output=execution_output
    )

    print("=" * 80)
    print("Generated Replan Prompt:")
    print("=" * 80)
    print(prompt)
    print("=" * 80)

    return prompt


async def test_llm_replan():
    """실제 LLM을 호출하여 replan 결과 확인"""
    import aiohttp

    # 먼저 프롬프트 생성
    prompt = test_format_replan_prompt()

    print("\n" + "=" * 80)
    print("Calling LLM for Replan Decision...")
    print("=" * 80)

    try:
        # Config 로드
        config = load_config()
        provider = config.get('provider', 'gemini')
        print(f"Using provider: {provider}")

        if provider == 'gemini':
            gemini_cfg = config.get('gemini', {})
            api_key = gemini_cfg.get('apiKey')
            if not api_key:
                print("ERROR: No Gemini API key configured in ~/.jupyter/hdsp_agent_config.json")
                return

            model = gemini_cfg.get('model', 'gemini-2.5-pro')
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.7,
                    "topK": 40,
                    "topP": 0.95,
                    "maxOutputTokens": 4096
                }
            }

            print(f"Calling Gemini API with model: {model}")

            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        print(f"Gemini API Error: {error_text}")
                        return

                    data = await response.json()

                    # Parse response
                    if 'candidates' in data and len(data['candidates']) > 0:
                        candidate = data['candidates'][0]
                        if 'content' in candidate and 'parts' in candidate['content']:
                            parts = candidate['content']['parts']
                            if len(parts) > 0 and 'text' in parts[0]:
                                response_text = parts[0]['text']
                            else:
                                print("No text in response")
                                return
                        else:
                            print("Unexpected response structure")
                            return
                    else:
                        print("No candidates in response")
                        return
        else:
            print(f"Provider {provider} not supported in this test")
            return

        print("\n" + "=" * 80)
        print("LLM Response:")
        print("=" * 80)
        print(response_text)
        print("=" * 80)

        # JSON 파싱 시도
        import re
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', response_text)
        if not json_match:
            # Try without code block
            json_match = re.search(r'(\{[\s\S]*\})', response_text)

        if json_match:
            json_str = json_match.group(1)
            try:
                replan_data = json.loads(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parse error: {e}")
                print(f"JSON string: {json_str[:500]}...")
                return

            print("\n" + "=" * 80)
            print("Parsed Replan Decision:")
            print("=" * 80)
            print(f"Decision: {replan_data.get('decision')}")
            print(f"Reasoning: {replan_data.get('reasoning')}")
            print(f"Analysis: {json.dumps(replan_data.get('analysis', {}), indent=2, ensure_ascii=False)}")
            print(f"Changes: {json.dumps(replan_data.get('changes', {}), indent=2, ensure_ascii=False)}")
            print("=" * 80)

            # 검증
            decision = replan_data.get('decision')
            if decision == 'insert_steps':
                print("\n✅ SUCCESS: LLM correctly chose 'insert_steps'!")
                changes = replan_data.get('changes', {})
                new_steps = changes.get('new_steps', [])
                if new_steps:
                    for step in new_steps:
                        print(f"  New step: {step.get('description')}")
                        for tc in step.get('toolCalls', []):
                            if tc.get('tool') == 'jupyter_cell':
                                code = tc.get('parameters', {}).get('code', '')
                                print(f"    Code: {code}")
                                if 'pip install' in code and 'dask' in code:
                                    print("  ✅ Correct! Will install dask package.")
            elif decision == 'refine':
                print("\n⚠️ WARNING: LLM chose 'refine' - might try to replace dask with pandas")
                changes = replan_data.get('changes', {})
                refined_code = changes.get('refined_code', '')
                print(f"  Refined code: {refined_code}")
                if 'pandas' in refined_code and 'dask' not in refined_code:
                    print("  ❌ PROBLEM: LLM replaced dask with pandas!")
            elif decision == 'replan_remaining':
                print("\n⚠️ WARNING: LLM chose 'replan_remaining' - check if it's using dask or pandas")
                changes = replan_data.get('changes', {})
                new_plan = changes.get('new_plan', [])
                for step in new_plan:
                    desc = step.get('description', '')
                    print(f"  Step: {desc}")
                    for tc in step.get('toolCalls', []):
                        if tc.get('tool') == 'jupyter_cell':
                            code = tc.get('parameters', {}).get('code', '')
                            if code:
                                print(f"    Code: {code}")
                                if 'pandas' in code and 'dask' not in code and 'pip install' not in code:
                                    print("    ❌ PROBLEM: Using pandas instead of dask!")
            else:
                print(f"\n📋 Decision: {decision}")
        else:
            print("Could not find JSON in response")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # 프롬프트만 확인
    if len(sys.argv) > 1 and sys.argv[1] == "--prompt-only":
        test_format_replan_prompt()
    else:
        # LLM 호출 테스트
        asyncio.run(test_llm_replan())
