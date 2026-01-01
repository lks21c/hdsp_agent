from agent_server.langchain.tools.shell_tools import execute_command_tool


def test_execute_command_tool_default_timeout() -> None:
    result = execute_command_tool.invoke({"command": "echo hi"})
    assert result["parameters"]["timeout"] == 600000
