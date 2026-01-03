"""
Resource Usage Utilities for the Jupyter server host.

Collects CPU, memory, disk, and GPU usage to guide client-side execution.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from typing import Optional

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency fallback
    psutil = None


def _read_cgroup_value(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except Exception:
        return None


def _format_gb(value_bytes: float) -> float:
    return round(value_bytes / (1024**3), 2)


def _safe_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_cpu_count() -> Optional[int]:
    count = os.cpu_count()
    return int(count) if count is not None else None


def get_integrated_resources(
    env_type: str = "auto", workspace_root: str = "."
) -> dict[str, object]:
    """
    Collect resource usage snapshot for the Jupyter server host.

    Args:
        env_type: "auto", "pod", or "host" (auto detects Kubernetes)
        workspace_root: Path used to compute disk usage

    Returns:
        JSON-serializable resource snapshot dict.
    """
    is_pod = False
    if env_type == "auto":
        is_pod = os.path.exists("/var/run/secrets/kubernetes.io") or bool(
            os.environ.get("KUBERNETES_SERVICE_HOST")
        )
    else:
        is_pod = env_type.lower() == "pod"

    environment = "Kubernetes Pod" if is_pod else "Host/VM"
    cpu: dict[str, Optional[float]] = {"cores": None, "usage_percent": None}
    memory: dict[str, Optional[float]] = {
        "total_gb": None,
        "available_gb": None,
        "used_gb": None,
    }
    disk: dict[str, Optional[object]] = {
        "path": None,
        "total_gb": None,
        "free_gb": None,
        "used_gb": None,
    }
    gpus: list[dict[str, Optional[object]]] = []
    gpu_status = "not_detected"

    if is_pod:
        try:
            cpu_max = _read_cgroup_value("/sys/fs/cgroup/cpu.max")
            if cpu_max:
                quota, period = cpu_max.split()
                if quota != "max":
                    cpu_limit = float(quota) / float(period)
                else:
                    cpu_limit = psutil.cpu_count() if psutil else _safe_cpu_count() or 0
            else:
                cpu_limit = psutil.cpu_count() if psutil else _safe_cpu_count() or 0

            mem_limit_raw = _read_cgroup_value("/sys/fs/cgroup/memory.max")
            mem_current_raw = _read_cgroup_value("/sys/fs/cgroup/memory.current")

            if mem_limit_raw and mem_limit_raw != "max":
                mem_limit_gb = _format_gb(float(mem_limit_raw))
            else:
                mem_limit_gb = (
                    _format_gb(psutil.virtual_memory().total) if psutil else 0.0
                )

            mem_used_gb = _format_gb(float(mem_current_raw)) if mem_current_raw else 0.0

            cpu["cores"] = round(cpu_limit, 2)
            memory["total_gb"] = mem_limit_gb
            memory["used_gb"] = mem_used_gb
            if mem_limit_gb is not None and mem_used_gb is not None:
                memory["available_gb"] = round(mem_limit_gb - mem_used_gb, 2)
        except Exception:
            cpu_count = psutil.cpu_count() if psutil else _safe_cpu_count()
            cpu["cores"] = float(cpu_count) if cpu_count is not None else None
            if psutil:
                vm = psutil.virtual_memory()
                memory["total_gb"] = _format_gb(vm.total)
                memory["available_gb"] = _format_gb(vm.available)
                memory["used_gb"] = _format_gb(vm.total - vm.available)
    else:
        cpu_count = psutil.cpu_count() if psutil else _safe_cpu_count()
        cpu_percent = psutil.cpu_percent() if psutil else None
        cpu["cores"] = float(cpu_count) if cpu_count is not None else None
        cpu["usage_percent"] = cpu_percent
        if psutil:
            vm = psutil.virtual_memory()
            memory["total_gb"] = _format_gb(vm.total)
            memory["available_gb"] = _format_gb(vm.available)
            memory["used_gb"] = _format_gb(vm.total - vm.available)

    disk_path = workspace_root if workspace_root else "."
    if not os.path.exists(disk_path):
        disk_path = "."
    disk["path"] = os.path.abspath(disk_path)
    try:
        total, used, free = shutil.disk_usage(disk_path)
        disk["total_gb"] = _format_gb(total)
        disk["free_gb"] = _format_gb(free)
        disk["used_gb"] = _format_gb(used)
    except Exception:
        pass

    if shutil.which("nvidia-smi"):
        gpu_status = "available"
        try:
            result = subprocess.check_output(
                [
                    "nvidia-smi",
                    "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                    "--format=csv,noheader,nounits",
                ],
                encoding="utf-8",
                timeout=2,
            ).strip()
            if result:
                for line in result.split("\n"):
                    name, gpu_util, mem_used, mem_total = [
                        value.strip() for value in line.split(",")
                    ]
                    gpus.append(
                        {
                            "name": name,
                            "utilization_percent": _safe_float(gpu_util),
                            "memory_used_mb": _safe_float(mem_used),
                            "memory_total_mb": _safe_float(mem_total),
                        }
                    )
        except Exception:
            gpu_status = "unavailable"
    else:
        gpu_status = "not_detected"

    return {
        "environment": environment,
        "cpu": cpu,
        "memory": memory,
        "disk": disk,
        "gpus": gpus,
        "gpu_status": gpu_status,
    }
