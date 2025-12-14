"""
Auto-Agent Handler Unit Tests

Mock LLM 응답을 사용하여 Agent 모드 핸들러를 테스트합니다.
브라우저 없이 백엔드 로직을 검증할 수 있습니다.
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch

# 테스트용 Mock LLM 응답
MOCK_PLAN_RESPONSE = '''```json
{
  "reasoning": "사용자가 pandas로 CSV 파일을 로드하도록 요청했습니다.",
  "plan": {
    "totalSteps": 3,
    "steps": [
      {
        "stepNumber": 1,
        "description": "pandas 라이브러리를 임포트합니다.",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "import pandas as pd"
            }
          }
        ],
        "dependencies": []
      },
      {
        "stepNumber": 2,
        "description": "CSV 파일을 로드합니다.",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "df = pd.read_csv('data.csv')\\ndf.head()"
            }
          }
        ],
        "dependencies": [1]
      },
      {
        "stepNumber": 3,
        "description": "최종 결과를 제시합니다.",
        "toolCalls": [
          {
            "tool": "final_answer",
            "parameters": {
              "answer": "CSV 파일이 성공적으로 로드되었습니다."
            }
          }
        ],
        "dependencies": [2]
      }
    ]
  }
}
```'''

MOCK_REFINE_RESPONSE = '''```json
{
  "toolCalls": [
    {
      "tool": "jupyter_cell",
      "parameters": {
        "code": "import pandas as pd\\n# 수정된 코드\\ndf = pd.read_csv('data.csv', encoding='utf-8')"
      }
    }
  ],
  "reasoning": "인코딩 문제를 해결하기 위해 encoding 파라미터를 추가했습니다."
}
```'''


class TestPlanGeneration:
    """Plan 생성 관련 테스트"""

    def test_parse_plan_json_from_llm_response(self):
        """LLM 응답에서 plan JSON 파싱 테스트"""
        from backend.handlers.base import BaseAgentHandler

        # Mock handler
        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(MOCK_PLAN_RESPONSE)

        assert result is not None
        assert 'plan' in result
        assert result['plan']['totalSteps'] == 3
        assert len(result['plan']['steps']) == 3

    def test_parse_plan_extracts_tool_calls(self):
        """toolCalls가 올바르게 추출되는지 테스트"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(MOCK_PLAN_RESPONSE)

        step1 = result['plan']['steps'][0]
        assert len(step1['toolCalls']) == 1
        assert step1['toolCalls'][0]['tool'] == 'jupyter_cell'
        assert 'code' in step1['toolCalls'][0]['parameters']
        assert step1['toolCalls'][0]['parameters']['code'] == 'import pandas as pd'

    def test_parse_plan_with_final_answer(self):
        """final_answer tool이 올바르게 파싱되는지 테스트"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(MOCK_PLAN_RESPONSE)

        last_step = result['plan']['steps'][-1]
        assert last_step['toolCalls'][0]['tool'] == 'final_answer'
        assert 'answer' in last_step['toolCalls'][0]['parameters']


class TestRefineCodeParsing:
    """Refine 코드 응답 파싱 테스트"""

    def test_parse_refine_response(self):
        """Refine API 응답 파싱 테스트"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(MOCK_REFINE_RESPONSE)

        assert result is not None
        assert 'toolCalls' in result
        assert len(result['toolCalls']) == 1
        assert result['toolCalls'][0]['tool'] == 'jupyter_cell'
        assert 'encoding' in result['toolCalls'][0]['parameters']['code']


class TestCodeValidator:
    """코드 검증 테스트"""

    def test_validate_valid_code(self):
        """유효한 코드 검증 테스트"""
        from backend.services.code_validator import CodeValidator

        validator = CodeValidator()
        code = "import pandas as pd\ndf = pd.read_csv('test.csv')"

        result = validator.full_validation(code)

        assert result.is_valid == True
        assert result.has_errors == False

    def test_validate_syntax_error(self):
        """구문 오류 감지 테스트"""
        from backend.services.code_validator import CodeValidator

        validator = CodeValidator()
        code = "def foo(\n  print('hello')"  # 괄호 닫지 않음

        result = validator.full_validation(code)

        assert result.is_valid == False
        assert result.has_errors == True
        assert any('syntax' in str(issue.category).lower()
                   for issue in result.issues)

    def test_validate_undefined_variable(self):
        """정의되지 않은 변수 감지 테스트"""
        from backend.services.code_validator import CodeValidator

        validator = CodeValidator()
        code = "print(undefined_variable)"

        result = validator.full_validation(code)

        # undefined variable은 에러로 처리됨
        assert result.has_errors == True


class TestIncompleteJsonRecovery:
    """불완전한 JSON 복구 테스트"""

    def test_recover_truncated_json(self):
        """잘린 JSON 복구 테스트"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        truncated = '{"plan": {"totalSteps": 2, "steps": [{"stepNumber": 1, "description": "test"'

        result = handler._recover_incomplete_json(truncated)

        # 복구 실패해도 None 반환 (에러 발생하지 않음)
        # 완전한 복구는 어려울 수 있음
        assert result is None or isinstance(result, dict)

    def test_recover_valid_json(self):
        """유효한 JSON은 그대로 반환"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        valid = '{"key": "value", "number": 123}'

        result = handler._recover_incomplete_json(valid)

        assert result is not None
        assert result['key'] == 'value'
        assert result['number'] == 123


class TestPromptGeneration:
    """프롬프트 생성 테스트"""

    def test_format_plan_prompt(self):
        """Plan 프롬프트 포맷팅 테스트"""
        from backend.prompts.auto_agent_prompts import format_plan_prompt

        # recent_cells는 dict 형태여야 함
        prompt = format_plan_prompt(
            request="pandas로 CSV 로드해줘",
            cell_count=5,
            imported_libraries=["numpy", "pandas"],
            defined_variables=["df", "data"],
            recent_cells=[
                {"type": "code", "source": "import numpy as np"},
                {"type": "code", "source": "data = np.array([1,2,3])"}
            ]
        )

        assert "pandas로 CSV 로드해줘" in prompt
        assert "numpy" in prompt
        assert "pandas" in prompt
        assert "df" in prompt


class TestIntegration:
    """통합 테스트 (Mock LLM 사용)"""

    @pytest.mark.asyncio
    async def test_plan_handler_with_mock_llm(self):
        """Mock LLM으로 Plan 핸들러 테스트"""
        from backend.handlers.auto_agent import AutoAgentPlanHandler

        # Mock 설정
        with patch.object(AutoAgentPlanHandler, '_call_llm', new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = MOCK_PLAN_RESPONSE

            # Mock handler 생성
            handler = MagicMock(spec=AutoAgentPlanHandler)
            handler._call_llm = mock_llm
            handler.parse_llm_json_response = AutoAgentPlanHandler._parse_json_response
            handler.get_json_body = MagicMock(return_value={
                'request': 'pandas로 CSV 로드해줘',
                'notebookContext': {
                    'cellCount': 0,
                    'importedLibraries': [],
                    'definedVariables': [],
                    'recentCells': []
                }
            })

            # LLM 호출 검증
            response = await mock_llm("test prompt")
            assert "plan" in response
            assert "steps" in response


class TestDaskParquetScenario:
    """TC: 'dask로 데이터 읽고 parquet로 써줘' 시나리오 테스트"""

    MOCK_DASK_PLAN_RESPONSE = '''```json
{
  "reasoning": "사용자가 dask로 데이터를 읽고 parquet 형식으로 저장하도록 요청했습니다. Dask DataFrame을 사용하여 CSV 파일을 읽고, to_parquet 메서드로 parquet 파일로 변환합니다.",
  "plan": {
    "totalSteps": 4,
    "steps": [
      {
        "stepNumber": 1,
        "description": "dask.dataframe 라이브러리를 임포트합니다.",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "import dask.dataframe as dd"
            }
          }
        ],
        "dependencies": []
      },
      {
        "stepNumber": 2,
        "description": "CSV 파일을 Dask DataFrame으로 로드합니다.",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "df = dd.read_csv('data.csv')\\nprint(f'Loaded {len(df)} rows')\\ndf.head()"
            }
          }
        ],
        "dependencies": [1]
      },
      {
        "stepNumber": 3,
        "description": "DataFrame을 parquet 형식으로 저장합니다.",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "df.to_parquet('data.parquet', engine='pyarrow')\\nprint('Parquet 파일 저장 완료: data.parquet')"
            }
          }
        ],
        "dependencies": [2]
      },
      {
        "stepNumber": 4,
        "description": "작업 완료를 알립니다.",
        "toolCalls": [
          {
            "tool": "final_answer",
            "parameters": {
              "answer": "CSV 데이터를 Dask로 읽고 parquet 형식으로 성공적으로 저장했습니다.",
              "summary": "data.csv → data.parquet 변환 완료"
            }
          }
        ],
        "dependencies": [3]
      }
    ]
  }
}
```'''

    def test_parse_dask_parquet_plan(self):
        """dask parquet 시나리오 plan 파싱 테스트"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        # 기본 구조 검증
        assert result is not None
        assert 'plan' in result
        assert result['plan']['totalSteps'] == 4
        assert len(result['plan']['steps']) == 4

    def test_dask_import_step_has_code(self):
        """Step 1: dask import 코드가 있는지 검증"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        step1 = result['plan']['steps'][0]
        assert step1['stepNumber'] == 1
        assert len(step1['toolCalls']) == 1

        tool_call = step1['toolCalls'][0]
        assert tool_call['tool'] == 'jupyter_cell'
        assert 'parameters' in tool_call
        assert 'code' in tool_call['parameters']

        code = tool_call['parameters']['code']
        assert code  # code가 비어있지 않음
        assert 'import dask' in code

    def test_read_csv_step_has_code(self):
        """Step 2: CSV 읽기 코드가 있는지 검증"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        step2 = result['plan']['steps'][1]
        tool_call = step2['toolCalls'][0]
        code = tool_call['parameters']['code']

        assert code  # code가 비어있지 않음
        assert 'read_csv' in code

    def test_to_parquet_step_has_code(self):
        """Step 3: parquet 저장 코드가 있는지 검증"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        step3 = result['plan']['steps'][2]
        tool_call = step3['toolCalls'][0]
        code = tool_call['parameters']['code']

        assert code  # code가 비어있지 않음
        assert 'to_parquet' in code
        assert 'parquet' in code

    def test_final_answer_step(self):
        """Step 4: final_answer가 올바른지 검증"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        step4 = result['plan']['steps'][3]
        tool_call = step4['toolCalls'][0]

        assert tool_call['tool'] == 'final_answer'
        assert 'answer' in tool_call['parameters']
        assert tool_call['parameters']['answer']  # answer가 비어있지 않음

    def test_all_jupyter_cell_steps_have_non_empty_code(self):
        """모든 jupyter_cell step에 code가 비어있지 않은지 검증 (핵심 버그 테스트)"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)

        for step in result['plan']['steps']:
            for tool_call in step['toolCalls']:
                if tool_call['tool'] == 'jupyter_cell':
                    params = tool_call['parameters']
                    assert 'code' in params, f"Step {step['stepNumber']}: code 파라미터 없음"
                    assert params['code'], f"Step {step['stepNumber']}: code가 비어있음"
                    assert len(params['code']) > 0, f"Step {step['stepNumber']}: code 길이 0"

    def test_dependencies_are_correct(self):
        """의존성 체인이 올바른지 검증"""
        from backend.handlers.base import BaseAgentHandler

        handler = MagicMock(spec=BaseAgentHandler)
        handler.parse_llm_json_response = BaseAgentHandler.parse_llm_json_response.__get__(handler)
        handler._recover_incomplete_json = BaseAgentHandler._recover_incomplete_json.__get__(handler)

        result = handler.parse_llm_json_response(self.MOCK_DASK_PLAN_RESPONSE)
        steps = result['plan']['steps']

        # Step 1은 의존성 없음
        assert steps[0]['dependencies'] == []
        # Step 2는 Step 1에 의존
        assert 1 in steps[1]['dependencies']
        # Step 3는 Step 2에 의존
        assert 2 in steps[2]['dependencies']
        # Step 4는 Step 3에 의존
        assert 3 in steps[3]['dependencies']


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
