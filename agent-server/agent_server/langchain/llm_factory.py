"""
LLM Factory for LangChain agent.

Provides functions to create LangChain LLM instances from configuration.
"""

import logging
from typing import Any, Dict

from agent_server.langchain.logging_utils import LLMTraceLogger

logger = logging.getLogger(__name__)


def create_llm(llm_config: Dict[str, Any]):
    """Create LangChain LLM from config.

    Args:
        llm_config: Configuration dictionary containing:
            - provider: "gemini", "openai", or "vllm"
            - gemini: {apiKey, model} for Gemini
            - openai: {apiKey, model} for OpenAI
            - vllm: {endpoint, model, apiKey} for vLLM

    Returns:
        Configured LangChain LLM instance

    Raises:
        ValueError: If provider is unsupported or API key is missing
    """
    provider = llm_config.get("provider", "gemini")
    callbacks = [LLMTraceLogger()]

    if provider == "gemini":
        return _create_gemini_llm(llm_config, callbacks)
    elif provider == "openai":
        return _create_openai_llm(llm_config, callbacks)
    elif provider == "vllm":
        return _create_vllm_llm(llm_config, callbacks)
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def _create_gemini_llm(llm_config: Dict[str, Any], callbacks):
    """Create Gemini LLM instance."""
    from langchain_google_genai import ChatGoogleGenerativeAI

    gemini_config = llm_config.get("gemini", {})
    api_key = gemini_config.get("apiKey")
    model = gemini_config.get("model", "gemini-2.5-pro")

    if not api_key:
        raise ValueError("Gemini API key not configured")

    logger.info(f"Creating Gemini LLM with model: {model}")

    # Gemini 2.5 Flash has issues with tool calling in LangChain
    # Use convert_system_message_to_human for better compatibility
    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.0,
        max_output_tokens=8192,
        convert_system_message_to_human=True,  # Better tool calling support
        callbacks=callbacks,
    )


def _create_openai_llm(llm_config: Dict[str, Any], callbacks):
    """Create OpenAI LLM instance."""
    from langchain_openai import ChatOpenAI

    openai_config = llm_config.get("openai", {})
    api_key = openai_config.get("apiKey")
    model = openai_config.get("model", "gpt-4")

    if not api_key:
        raise ValueError("OpenAI API key not configured")

    logger.info(f"Creating OpenAI LLM with model: {model}")

    return ChatOpenAI(
        model=model,
        api_key=api_key,
        temperature=0.0,
        max_tokens=4096,
        callbacks=callbacks,
    )


def _create_vllm_llm(llm_config: Dict[str, Any], callbacks):
    """Create vLLM-compatible LLM instance."""
    from langchain_openai import ChatOpenAI

    vllm_config = llm_config.get("vllm", {})
    endpoint = vllm_config.get("endpoint", "http://localhost:8000")
    model = vllm_config.get("model", "default")
    api_key = vllm_config.get("apiKey", "dummy")

    logger.info(f"Creating vLLM LLM with model: {model}, endpoint: {endpoint}")

    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=f"{endpoint}/v1",
        temperature=0.0,
        max_tokens=4096,
        callbacks=callbacks,
    )


def create_summarization_llm(llm_config: Dict[str, Any]):
    """Create LLM for summarization middleware.

    Uses the same provider as the main LLM but with simpler configuration.

    Args:
        llm_config: Configuration dictionary

    Returns:
        LLM instance suitable for summarization, or None if unavailable
    """
    provider = llm_config.get("provider", "gemini")

    try:
        if provider == "gemini":
            from langchain_google_genai import ChatGoogleGenerativeAI

            gemini_config = llm_config.get("gemini", {})
            api_key = gemini_config.get("apiKey")
            if api_key:
                return ChatGoogleGenerativeAI(
                    model="gemini-2.0-flash",
                    google_api_key=api_key,
                    temperature=0.0,
                )
        elif provider == "openai":
            from langchain_openai import ChatOpenAI

            openai_config = llm_config.get("openai", {})
            api_key = openai_config.get("apiKey")
            if api_key:
                return ChatOpenAI(
                    model="gpt-4o-mini",
                    api_key=api_key,
                    temperature=0.0,
                )
        elif provider == "vllm":
            from langchain_openai import ChatOpenAI

            vllm_config = llm_config.get("vllm", {})
            endpoint = vllm_config.get("endpoint", "http://localhost:8000")
            model = vllm_config.get("model", "default")
            api_key = vllm_config.get("apiKey", "dummy")

            return ChatOpenAI(
                model=model,
                api_key=api_key,
                base_url=f"{endpoint}/v1",
                temperature=0.0,
            )
    except Exception as e:
        logger.warning(f"Failed to create summarization LLM: {e}")
        return None

    return None
