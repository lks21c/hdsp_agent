import shutil
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class BundleAgentModulesHook(BuildHookInterface):
    """Ensure bundled agent modules exist for wheel/editable builds."""

    def initialize(self, version: str, build_data: dict) -> None:
        self._copied_paths = []
        root = Path(self.root)
        bundles = {
            "agent_server": root / "agent_server",
            "hdsp_agent_core": root / "hdsp_agent_core",
        }
        sources = {
            "agent_server": root.parent.parent / "agent-server" / "agent_server",
            "hdsp_agent_core": root.parent.parent / "hdsp_agent_core" / "hdsp_agent_core",
        }

        for key, dest in bundles.items():
            if dest.exists():
                continue
            source = sources[key]
            if source.exists():
                shutil.copytree(source, dest)
                self._copied_paths.append(dest)

    def finalize(self, version: str, build_data: dict, artifact_path: str) -> None:
        for path in getattr(self, "_copied_paths", []):
            shutil.rmtree(path, ignore_errors=True)
