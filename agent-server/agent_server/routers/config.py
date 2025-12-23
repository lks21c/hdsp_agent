"""
Config Router - Configuration management endpoints
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from hdsp_agent_core.managers.config_manager import ConfigManager
from pydantic import BaseModel

router = APIRouter()


class ConfigResponse(BaseModel):
    """Configuration response model"""

    provider: str
    gemini: Optional[Dict[str, Any]] = None
    openai: Optional[Dict[str, Any]] = None
    vllm: Optional[Dict[str, Any]] = None


class ConfigUpdateRequest(BaseModel):
    """Configuration update request model"""

    provider: Optional[str] = None
    gemini: Optional[Dict[str, Any]] = None
    openai: Optional[Dict[str, Any]] = None
    vllm: Optional[Dict[str, Any]] = None


@router.get("", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """
    Get current configuration.

    Returns the current LLM provider settings (API keys are masked).
    """
    try:
        config_manager = ConfigManager.get_instance()
        config = config_manager.get_config()

        # Mask API keys for security
        masked_config = _mask_api_keys(config)

        return ConfigResponse(
            provider=masked_config.get("provider", "gemini"),
            gemini=masked_config.get("gemini"),
            openai=masked_config.get("openai"),
            vllm=masked_config.get("vllm"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("")
async def update_config(request: ConfigUpdateRequest) -> Dict[str, Any]:
    """
    Update configuration.

    Updates LLM provider settings.
    """
    try:
        config_manager = ConfigManager.get_instance()

        # Build update dict from request
        updates = {}
        if request.provider:
            updates["provider"] = request.provider
        if request.gemini:
            updates["gemini"] = request.gemini
        if request.openai:
            updates["openai"] = request.openai
        if request.vllm:
            updates["vllm"] = request.vllm

        if updates:
            config_manager.update_config(updates)

        return {"status": "success", "message": "Configuration updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _mask_api_keys(config: Dict[str, Any]) -> Dict[str, Any]:
    """Mask API keys in configuration for security"""
    masked = config.copy()

    for provider in ["gemini", "openai", "vllm"]:
        if provider in masked and isinstance(masked[provider], dict):
            provider_config = masked[provider].copy()
            if "apiKey" in provider_config and provider_config["apiKey"]:
                key = provider_config["apiKey"]
                if len(key) > 8:
                    provider_config["apiKey"] = f"{key[:4]}...{key[-4:]}"
                else:
                    provider_config["apiKey"] = "***"
            masked[provider] = provider_config

    return masked
