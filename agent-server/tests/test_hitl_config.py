from agent_server.langchain.hitl_config import get_hitl_interrupt_config


def test_hitl_interrupt_config_includes_file_tools():
    config = get_hitl_interrupt_config()

    assert "execute_command_tool" in config
    assert "list_files_tool" in config
    assert "read_file_tool" in config

    for tool_name in ("execute_command_tool", "list_files_tool", "read_file_tool"):
        tool_config = config[tool_name]
        assert isinstance(tool_config, dict)
        assert "allowed_decisions" in tool_config
        assert "edit" in tool_config["allowed_decisions"]
