import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
JUPYTER_EXT_PATH = ROOT / "extensions" / "jupyter"
if str(JUPYTER_EXT_PATH) not in sys.path:
    sys.path.insert(0, str(JUPYTER_EXT_PATH))

from jupyter_ext.handlers import (  # noqa: E402
    _resolve_command_cwd,
    _resolve_workspace_root,
)


def _make_workspace(tmp_path: Path):
    project_root = tmp_path / "project"
    (project_root / "extensions").mkdir(parents=True)
    (project_root / "agent-server").mkdir(parents=True)
    server_root = project_root / "extensions" / "jupyter"
    server_root.mkdir(parents=True)
    workspace_root = _resolve_workspace_root(str(server_root))
    return project_root, server_root, workspace_root


def test_resolve_command_cwd_defaults_to_server_root(tmp_path: Path):
    project_root, server_root, workspace_root = _make_workspace(tmp_path)
    assert workspace_root == str(project_root)
    cwd = _resolve_command_cwd(str(server_root), workspace_root, None)
    assert cwd == os.path.abspath(str(server_root))


def test_resolve_command_cwd_relative_requested_cwd(tmp_path: Path):
    _, server_root, workspace_root = _make_workspace(tmp_path)
    notebooks = server_root / "notebooks"
    notebooks.mkdir()
    cwd = _resolve_command_cwd(str(server_root), workspace_root, "notebooks")
    assert cwd == os.path.abspath(str(notebooks))


def test_resolve_command_cwd_rejects_escape(tmp_path: Path):
    _, server_root, workspace_root = _make_workspace(tmp_path)
    escape = os.path.join("..", "..", "..", "..")
    with pytest.raises(ValueError, match="cwd escapes workspace root"):
        _resolve_command_cwd(str(server_root), workspace_root, escape)
