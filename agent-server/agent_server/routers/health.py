"""
Health Router - Health check endpoints for the Agent Server
"""

from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    """Health check response model"""

    status: str
    timestamp: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns server status, timestamp, and version.
    """
    return HealthResponse(
        status="healthy",
        timestamp=datetime.utcnow().isoformat(),
        version="1.0.0",
    )


@router.get("/")
async def root():
    """Root endpoint with server information"""
    return {
        "name": "HDSP Agent Server",
        "version": "1.0.0",
        "description": "AI Agent Server for IDE integrations",
    }
