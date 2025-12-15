"""
Tests for Agent Plan API endpoint

TC-001: 실행계획 생성 API 테스트
- 프롬프트: "titanic.csv 를 dask로 EDA 및 시각화 한 뒤 결과를 요약해줘."
- 검증: plan 구조, goal 필드, steps 유효성

VCR.py 사용:
- 최초 실행: 실제 LLM API 호출 → cassettes/test_agent_plan/*.yaml 저장
- 이후 실행: 저장된 응답 재생 (토큰 0)

실행 방법:
- 최초 녹화: pytest tests/test_agent_plan.py -v --record-mode=once
- 재생 테스트: pytest tests/test_agent_plan.py -v
- 재녹화: pytest tests/test_agent_plan.py -v --record-mode=new_episodes
"""

import os
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient


# ═══════════════════════════════════════════════════════════════════════════
# TC-001: Plan Generation Unit Tests (Mock LLM)
# ═══════════════════════════════════════════════════════════════════════════


class TestPlanGenerationUnit:
    """Unit tests for plan generation with mocked LLM responses"""

    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app"""
        from agent_server.main import app
        return TestClient(app)

    @pytest.fixture
    def mock_llm_plan_response(self):
        """Mock LLM response for plan generation"""
        return '''{
  "reasoning": "titanic.csv 데이터를 Dask를 사용하여 EDA 및 시각화를 수행합니다.",
  "plan": {
    "totalSteps": 4,
    "steps": [
      {
        "stepNumber": 1,
        "description": "필요한 라이브러리 임포트 및 데이터 로드",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "import warnings\\nwarnings.filterwarnings('ignore')\\n\\nimport dask.dataframe as dd\\nimport pandas as pd\\nimport matplotlib.pyplot as plt\\nimport seaborn as sns\\n\\nplt.rcParams['font.family'] = 'AppleGothic'\\nplt.rcParams['axes.unicode_minus'] = False\\n\\ndf = dd.read_csv('titanic.csv')\\nprint('데이터 로드 완료')\\ndisplay(df.head())"
            }
          }
        ],
        "dependencies": []
      },
      {
        "stepNumber": 2,
        "description": "기본 통계 및 결측치 분석",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "print('데이터 정보:')\\nprint(f'행 수: {len(df)}')\\nprint(f'\\\\n결측치 현황:')\\ndisplay(df.isnull().sum().compute())"
            }
          }
        ],
        "dependencies": [1]
      },
      {
        "stepNumber": 3,
        "description": "시각화: 생존율 분석",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "plt.figure(figsize=(10, 6))\\nsns.countplot(data=df.compute(), x='Survived', hue='Sex')\\nplt.title('성별 생존 현황')\\nplt.show()"
            }
          }
        ],
        "dependencies": [1]
      },
      {
        "stepNumber": 4,
        "description": "분석 완료",
        "toolCalls": [
          {
            "tool": "final_answer",
            "parameters": {
              "answer": "titanic.csv 데이터에 대한 Dask 기반 EDA 및 시각화를 완료했습니다."
            }
          }
        ],
        "dependencies": [2, 3]
      }
    ]
  }
}'''

    @pytest.fixture
    def plan_request_payload(self):
        """Standard plan request payload for testing"""
        return {
            "request": "titanic.csv 를 dask로 EDA 및 시각화 한 뒤 결과를 요약해줘.",
            "notebookContext": {
                "cellCount": 0,
                "importedLibraries": [],
                "definedVariables": [],
                "recentCells": []
            },
            "llmConfig": {
                "provider": "gemini",
                "gemini": {
                    "apiKey": "test-api-key",
                    "model": "gemini-2.5-flash"
                }
            }
        }

    def test_plan_request_validation(self, client):
        """TC-001-01: Plan request without required fields should fail"""
        # Missing request field
        response = client.post("/agent/plan", json={})
        assert response.status_code == 422  # Validation error

    def test_plan_request_empty_request(self, client):
        """TC-001-02: Empty request string should return 400"""
        response = client.post("/agent/plan", json={
            "request": "",
            "notebookContext": {"cellCount": 0}
        })
        assert response.status_code == 400
        assert "request is required" in response.json()["detail"]

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_generation_success(self, mock_llm, client, mock_llm_plan_response, plan_request_payload):
        """TC-001-03: Successful plan generation should return valid structure"""
        mock_llm.return_value = mock_llm_plan_response

        response = client.post("/agent/plan", json=plan_request_payload)

        assert response.status_code == 200
        data = response.json()

        # Verify response structure
        assert "plan" in data
        assert "reasoning" in data

        # Verify plan structure
        plan = data["plan"]
        assert "goal" in plan  # goal 필드 필수
        assert "totalSteps" in plan
        assert "steps" in plan
        assert plan["totalSteps"] == len(plan["steps"])

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_goal_field_auto_filled(self, mock_llm, client, plan_request_payload):
        """TC-001-04: Goal field should be auto-filled from request if missing in LLM response"""
        # LLM response without goal field
        mock_llm.return_value = '''{
  "reasoning": "테스트",
  "plan": {
    "totalSteps": 1,
    "steps": [
      {
        "stepNumber": 1,
        "description": "테스트 단계",
        "toolCalls": [{"tool": "final_answer", "parameters": {"answer": "완료"}}],
        "dependencies": []
      }
    ]
  }
}'''

        response = client.post("/agent/plan", json=plan_request_payload)

        assert response.status_code == 200
        data = response.json()

        # Goal should be auto-filled with the request
        assert data["plan"]["goal"] == plan_request_payload["request"]

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_steps_structure(self, mock_llm, client, mock_llm_plan_response, plan_request_payload):
        """TC-001-05: Each step should have required fields"""
        mock_llm.return_value = mock_llm_plan_response

        response = client.post("/agent/plan", json=plan_request_payload)
        assert response.status_code == 200

        steps = response.json()["plan"]["steps"]
        for step in steps:
            assert "stepNumber" in step
            assert "description" in step
            assert "toolCalls" in step
            assert isinstance(step["toolCalls"], list)

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_tool_calls_structure(self, mock_llm, client, mock_llm_plan_response, plan_request_payload):
        """TC-001-06: Tool calls should have valid tool names and parameters"""
        mock_llm.return_value = mock_llm_plan_response

        response = client.post("/agent/plan", json=plan_request_payload)
        assert response.status_code == 200

        steps = response.json()["plan"]["steps"]
        valid_tools = {"jupyter_cell", "markdown", "final_answer"}

        for step in steps:
            for tool_call in step["toolCalls"]:
                assert "tool" in tool_call
                assert tool_call["tool"] in valid_tools
                assert "parameters" in tool_call

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_final_answer_exists(self, mock_llm, client, mock_llm_plan_response, plan_request_payload):
        """TC-001-07: Plan should end with final_answer tool"""
        mock_llm.return_value = mock_llm_plan_response

        response = client.post("/agent/plan", json=plan_request_payload)
        assert response.status_code == 200

        steps = response.json()["plan"]["steps"]
        last_step = steps[-1]

        # Last step should have final_answer
        tool_names = [tc["tool"] for tc in last_step["toolCalls"]]
        assert "final_answer" in tool_names


# ═══════════════════════════════════════════════════════════════════════════
# TC-002: Plan Generation Integration Tests (VCR - Real LLM)
# ═══════════════════════════════════════════════════════════════════════════


@pytest.mark.vcr()
class TestPlanGenerationIntegration:
    """Integration tests with real LLM calls (recorded with VCR)"""

    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app"""
        from agent_server.main import app
        return TestClient(app)

    @pytest.fixture
    def real_api_key(self):
        """Get real API key from environment (for VCR recording)"""
        return os.environ.get("GEMINI_API_KEY", "")

    def test_plan_generation_titanic_dask_eda(self, client, real_api_key):
        """
        TC-002-01: Real LLM plan generation for titanic EDA

        프롬프트: "titanic.csv 를 dask로 EDA 및 시각화 한 뒤 결과를 요약해줘."

        검증 항목:
        1. 응답 상태 코드 200
        2. plan 구조 유효성
        3. goal 필드 존재
        4. dask 관련 코드 포함 여부
        5. 시각화 코드 포함 여부
        6. final_answer로 종료
        """
        if not real_api_key:
            pytest.skip("GEMINI_API_KEY not set, skipping integration test")

        response = client.post("/agent/plan", json={
            "request": "titanic.csv 를 dask로 EDA 및 시각화 한 뒤 결과를 요약해줘.",
            "notebookContext": {
                "cellCount": 0,
                "importedLibraries": [],
                "definedVariables": [],
                "recentCells": []
            },
            "llmConfig": {
                "provider": "gemini",
                "gemini": {
                    "apiKey": real_api_key,
                    "model": "gemini-2.5-flash"
                }
            }
        })

        # 1. Status code check
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()

        # 2. Plan structure validation
        assert "plan" in data
        plan = data["plan"]
        assert "totalSteps" in plan
        assert "steps" in plan
        assert len(plan["steps"]) > 0

        # 3. Goal field exists
        assert "goal" in plan
        assert len(plan["goal"]) > 0

        # 4. Check for dask-related code
        all_code = ""
        for step in plan["steps"]:
            for tc in step.get("toolCalls", []):
                if tc.get("tool") == "jupyter_cell":
                    all_code += tc.get("parameters", {}).get("code", "") + "\n"

        assert "dask" in all_code.lower(), "Plan should include dask import"
        assert "read_csv" in all_code, "Plan should include data loading"

        # 5. Check for visualization code
        has_visualization = any(
            keyword in all_code.lower()
            for keyword in ["plt.", "matplotlib", "seaborn", "sns.", "plot", "figure"]
        )
        assert has_visualization, "Plan should include visualization code"

        # 6. Check final_answer exists
        last_step = plan["steps"][-1]
        tool_names = [tc["tool"] for tc in last_step.get("toolCalls", [])]
        assert "final_answer" in tool_names, "Last step should have final_answer"


# ═══════════════════════════════════════════════════════════════════════════
# TC-003: Plan Validation Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestPlanValidation:
    """Tests for plan response validation and edge cases"""

    @pytest.fixture
    def client(self):
        from agent_server.main import app
        return TestClient(app)

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_with_dependencies(self, mock_llm, client):
        """TC-003-01: Steps should have valid dependency references"""
        mock_llm.return_value = '''{
  "reasoning": "의존성 테스트",
  "plan": {
    "totalSteps": 3,
    "steps": [
      {"stepNumber": 1, "description": "Step 1", "toolCalls": [{"tool": "jupyter_cell", "parameters": {"code": "x=1"}}], "dependencies": []},
      {"stepNumber": 2, "description": "Step 2", "toolCalls": [{"tool": "jupyter_cell", "parameters": {"code": "y=x+1"}}], "dependencies": [1]},
      {"stepNumber": 3, "description": "Step 3", "toolCalls": [{"tool": "final_answer", "parameters": {"answer": "done"}}], "dependencies": [1, 2]}
    ]
  }
}'''

        response = client.post("/agent/plan", json={
            "request": "테스트",
            "notebookContext": {"cellCount": 0},
            "llmConfig": {"provider": "gemini", "gemini": {"apiKey": "test", "model": "gemini-2.5-flash"}}
        })

        assert response.status_code == 200
        steps = response.json()["plan"]["steps"]

        # Verify dependencies reference valid step numbers
        step_numbers = {s["stepNumber"] for s in steps}
        for step in steps:
            for dep in step.get("dependencies", []):
                assert dep in step_numbers, f"Invalid dependency {dep}"
                assert dep < step["stepNumber"], f"Dependency {dep} should be before step {step['stepNumber']}"

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_code_sanitization(self, mock_llm, client):
        """TC-003-02: Code in tool calls should be properly sanitized"""
        # Code with potential issues
        mock_llm.return_value = '''{
  "reasoning": "코드 정제 테스트",
  "plan": {
    "totalSteps": 1,
    "steps": [
      {
        "stepNumber": 1,
        "description": "코드 테스트",
        "toolCalls": [
          {
            "tool": "jupyter_cell",
            "parameters": {
              "code": "```python\\nprint('hello')\\n```"
            }
          }
        ],
        "dependencies": []
      }
    ]
  }
}'''

        response = client.post("/agent/plan", json={
            "request": "테스트",
            "notebookContext": {"cellCount": 0},
            "llmConfig": {"provider": "gemini", "gemini": {"apiKey": "test", "model": "gemini-2.5-flash"}}
        })

        assert response.status_code == 200
        code = response.json()["plan"]["steps"][0]["toolCalls"][0]["parameters"]["code"]

        # Code should not have markdown code block markers
        assert "```" not in code, "Code should be sanitized from markdown markers"

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_invalid_json_response(self, mock_llm, client):
        """TC-003-03: Invalid JSON from LLM should return 500 error"""
        mock_llm.return_value = "This is not valid JSON"

        response = client.post("/agent/plan", json={
            "request": "테스트",
            "notebookContext": {"cellCount": 0},
            "llmConfig": {"provider": "gemini", "gemini": {"apiKey": "test", "model": "gemini-2.5-flash"}}
        })

        assert response.status_code == 500


# ═══════════════════════════════════════════════════════════════════════════
# TC-004: LLM Config Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestLLMConfig:
    """Tests for LLM configuration handling"""

    @pytest.fixture
    def client(self):
        from agent_server.main import app
        return TestClient(app)

    def test_plan_without_llm_config(self, client):
        """TC-004-01: Request without llmConfig should use server default or fail gracefully"""
        response = client.post("/agent/plan", json={
            "request": "테스트 요청",
            "notebookContext": {"cellCount": 0}
        })

        # Should either work with default config or return proper error
        assert response.status_code in [200, 400, 500]

    @patch("agent_server.routers.agent._call_llm")
    def test_plan_with_different_providers(self, mock_llm, client):
        """TC-004-02: Plan should work with different LLM providers"""
        mock_llm.return_value = '''{
  "reasoning": "테스트",
  "plan": {"totalSteps": 1, "steps": [{"stepNumber": 1, "description": "완료", "toolCalls": [{"tool": "final_answer", "parameters": {"answer": "done"}}], "dependencies": []}]}
}'''

        providers = [
            {"provider": "gemini", "gemini": {"apiKey": "test", "model": "gemini-2.5-flash"}},
            {"provider": "openai", "openai": {"apiKey": "test", "model": "gpt-4"}},
        ]

        for llm_config in providers:
            response = client.post("/agent/plan", json={
                "request": "테스트",
                "notebookContext": {"cellCount": 0},
                "llmConfig": llm_config
            })
            assert response.status_code == 200, f"Failed for provider: {llm_config['provider']}"
