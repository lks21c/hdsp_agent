"""
Tests for the FastAPI health endpoints
"""

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoints:
    """Test the health check endpoints"""

    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app"""
        from agent_server.main import app

        return TestClient(app)

    def test_health_check(self, client):
        """Test GET /health returns healthy status"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert data["version"] == "1.0.0"

    def test_root_endpoint(self, client):
        """Test GET / returns server info"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "HDSP Agent Server"
        assert "version" in data


class TestConfigEndpoints:
    """Test the configuration endpoints"""

    @pytest.fixture
    def client(self):
        """Create a test client for the FastAPI app"""
        from agent_server.main import app

        return TestClient(app)

    def test_get_config(self, client):
        """Test GET /config returns configuration"""
        response = client.get("/config")
        # Should return 200 even if config is empty
        assert response.status_code == 200
        data = response.json()
        assert "provider" in data
