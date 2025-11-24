"""Setup file for JupyterLab extension development."""
from pathlib import Path
from setuptools import setup

HERE = Path(__file__).parent.resolve()

# Get version from _version.py
version_file = HERE / "backend" / "_version.py"
version_ns = {}
with open(version_file) as f:
    exec(f.read(), version_ns)
version = version_ns["__version__"]

# Read package.json for labextension metadata
lab_path = HERE / "backend" / "labextension" / "package.json"

setup_args = dict(
    name="hdsp-agent",
    version=version,
    description="AI-powered code assistance for JupyterLab",
    packages=["backend", "backend.handlers", "backend.services"],
    include_package_data=True,
    python_requires=">=3.8",
    install_requires=[
        "jupyter_server>=2.0.0",
    ],
    data_files=[
        (
            "share/jupyter/labextensions/@hdsp-agent/extension",
            ["backend/labextension/package.json"],
        ),
        (
            "share/jupyter/labextensions/@hdsp-agent/extension/static",
            [str(p) for p in Path("backend/labextension/static").glob("*") if p.is_file()],
        ),
        (
            "etc/jupyter/jupyter_server_config.d",
            ["backend/etc/jupyter/jupyter_server_config.d/hdsp_agent.json"],
        ),
    ],
    zip_safe=False,
)

if __name__ == "__main__":
    setup(**setup_args)
