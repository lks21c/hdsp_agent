import os

from jupyter_ext.handlers import (
    DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS,
    _append_stream_output,
    _resolve_path_in_workspace,
    _resolve_stream_timeout_ms,
    _resolve_timeout_ms,
)


def test_resolve_path_strips_duplicate_cwd_prefix() -> None:
    workspace_root = "/workspace"
    requested_cwd = os.path.join(workspace_root, "extensions", "jupyter")
    path = os.path.join("extensions", "jupyter", "cal.py")
    resolved = _resolve_path_in_workspace(path, workspace_root, requested_cwd)
    assert resolved == os.path.join(requested_cwd, "cal.py")


def test_resolve_path_relative_to_cwd() -> None:
    workspace_root = "/workspace"
    requested_cwd = os.path.join(workspace_root, "extensions", "jupyter")
    resolved = _resolve_path_in_workspace("cal.py", workspace_root, requested_cwd)
    assert resolved == os.path.join(requested_cwd, "cal.py")


def test_resolve_timeout_ms_uses_default_on_invalid() -> None:
    assert _resolve_timeout_ms(None) == DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
    assert _resolve_timeout_ms("not-a-number") == DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
    assert _resolve_timeout_ms(-1) == DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS


def test_resolve_timeout_ms_accepts_value() -> None:
    assert _resolve_timeout_ms(120000) == 120000


def test_resolve_stream_timeout_ms_uses_default_on_invalid() -> None:
    assert _resolve_stream_timeout_ms(None) == DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
    assert (
        _resolve_stream_timeout_ms("not-a-number") == DEFAULT_EXECUTE_COMMAND_TIMEOUT_MS
    )


def test_resolve_stream_timeout_ms_disables_on_non_positive() -> None:
    assert _resolve_stream_timeout_ms(0) is None
    assert _resolve_stream_timeout_ms(-1) is None


def test_append_stream_output_appends() -> None:
    output, truncated = _append_stream_output("abc", "def", max_bytes=10)
    assert output == "abcdef"
    assert truncated is False


def test_append_stream_output_truncates() -> None:
    output, truncated = _append_stream_output("abc", "def", max_bytes=5)
    assert output == "abcde"
    assert truncated is True
