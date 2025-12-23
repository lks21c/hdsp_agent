"""
HDSP Agent Core - CollectionIndex Tests

Tests for CollectionIndex class and collection_index.yaml loading.
"""

import tempfile
from pathlib import Path

import pytest
import yaml

from hdsp_agent_core.knowledge.collection_index import (
    CollectionIndex,
    CollectionInfo,
    get_collection_index,
    reset_collection_index,
)


@pytest.fixture
def reset_singleton():
    """Reset CollectionIndex singleton before and after each test."""
    reset_collection_index()
    yield
    reset_collection_index()


@pytest.fixture
def sample_yaml_content():
    """Sample collection index YAML content for testing."""
    return {
        "version": "1.0",
        "collections": [
            {
                "name": "dask",
                "display_name": "Dask DataFrame",
                "description": "대용량 데이터 처리, 분산 컴퓨팅",
                "key_topics": ["dd.read_csv", "compute()", "distributed"],
                "use_cases": ["메모리 초과 데이터", "병렬 처리"],
                "keywords": ["dask", "dask.dataframe", "dd.read"],
            },
            {
                "name": "matplotlib",
                "display_name": "Matplotlib Visualization",
                "description": "데이터 시각화, 차트, 그래프",
                "key_topics": ["plt.figure", "한글 폰트", "차트 종류"],
                "use_cases": ["시각화", "EDA"],
                "keywords": ["matplotlib", "plt"],
            },
        ],
    }


@pytest.fixture
def temp_yaml_file(sample_yaml_content):
    """Create a temporary YAML file with sample content."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False, encoding="utf-8"
    ) as f:
        yaml.dump(sample_yaml_content, f, allow_unicode=True)
        temp_path = f.name
    yield temp_path
    # Cleanup
    Path(temp_path).unlink(missing_ok=True)


class TestCollectionInfo:
    """Tests for CollectionInfo dataclass."""

    def test_collection_info_creation(self):
        """Test CollectionInfo can be created with all fields."""
        info = CollectionInfo(
            name="test",
            display_name="Test Collection",
            description="A test collection",
            key_topics=["api1", "api2"],
            use_cases=["use1"],
            keywords=["kw1", "kw2"],
        )
        assert info.name == "test"
        assert info.display_name == "Test Collection"
        assert info.description == "A test collection"
        assert info.key_topics == ["api1", "api2"]
        assert info.use_cases == ["use1"]
        assert info.keywords == ["kw1", "kw2"]

    def test_collection_info_default_lists(self):
        """Test CollectionInfo default empty lists."""
        info = CollectionInfo(
            name="minimal",
            display_name="Minimal",
            description="Minimal collection",
        )
        assert info.key_topics == []
        assert info.use_cases == []
        assert info.keywords == []


class TestCollectionIndex:
    """Tests for CollectionIndex class."""

    def test_load_from_yaml(self, temp_yaml_file):
        """Test loading collection index from YAML file."""
        index = CollectionIndex(index_path=temp_yaml_file)
        collections = index.list_collections()

        assert "dask" in collections
        assert "matplotlib" in collections
        assert len(collections) == 2

    def test_get_collection(self, temp_yaml_file):
        """Test getting a specific collection."""
        index = CollectionIndex(index_path=temp_yaml_file)
        dask = index.get_collection("dask")

        assert dask is not None
        assert dask.name == "dask"
        assert dask.display_name == "Dask DataFrame"
        assert "dd.read_csv" in dask.key_topics
        assert "메모리 초과 데이터" in dask.use_cases

    def test_get_collection_not_found(self, temp_yaml_file):
        """Test getting a non-existent collection returns None."""
        index = CollectionIndex(index_path=temp_yaml_file)
        result = index.get_collection("nonexistent")
        assert result is None

    def test_list_collections(self, temp_yaml_file):
        """Test listing all collection names."""
        index = CollectionIndex(index_path=temp_yaml_file)
        collections = index.list_collections()

        assert isinstance(collections, list)
        assert "dask" in collections
        assert "matplotlib" in collections

    def test_format_for_prompt(self, temp_yaml_file):
        """Test formatting collection index for LLM prompt."""
        index = CollectionIndex(index_path=temp_yaml_file)
        prompt = index.format_for_prompt()

        # Check header
        assert "## 📚 Available Knowledge Collections" in prompt
        assert "requiredCollections" in prompt

        # Check dask section
        assert "Dask DataFrame (`dask`)" in prompt
        assert "대용량 데이터 처리" in prompt
        assert "dd.read_csv" in prompt

        # Check matplotlib section
        assert "Matplotlib Visualization (`matplotlib`)" in prompt
        assert "데이터 시각화" in prompt

    def test_format_for_prompt_empty(self):
        """Test format_for_prompt with non-existent file returns empty string."""
        index = CollectionIndex(index_path="/nonexistent/path.yaml")
        prompt = index.format_for_prompt()
        assert prompt == ""

    def test_validate_collections(self, temp_yaml_file):
        """Test validating collection names."""
        index = CollectionIndex(index_path=temp_yaml_file)

        # Valid collections should be returned
        valid = index.validate_collections(["dask", "matplotlib"])
        assert valid == ["dask", "matplotlib"]

        # Invalid collections should be filtered out
        mixed = index.validate_collections(["dask", "invalid", "matplotlib"])
        assert "dask" in mixed
        assert "matplotlib" in mixed
        assert "invalid" not in mixed
        assert len(mixed) == 2

        # All invalid should return empty
        all_invalid = index.validate_collections(["invalid1", "invalid2"])
        assert all_invalid == []

    def test_validate_collections_empty_input(self, temp_yaml_file):
        """Test validating empty collection list."""
        index = CollectionIndex(index_path=temp_yaml_file)
        result = index.validate_collections([])
        assert result == []

    def test_lazy_loading(self, temp_yaml_file):
        """Test that YAML is only loaded when needed."""
        index = CollectionIndex(index_path=temp_yaml_file)
        assert index._loaded is False

        # Accessing collections should trigger load
        _ = index.list_collections()
        assert index._loaded is True

    def test_load_once(self, temp_yaml_file):
        """Test that YAML is only loaded once."""
        index = CollectionIndex(index_path=temp_yaml_file)

        # Load multiple times
        index._load()
        index._load()
        index._load()

        # Still should only have loaded once
        assert index._loaded is True
        assert len(index._collections) == 2

    def test_empty_yaml(self):
        """Test handling of empty YAML file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            f.write("")
            temp_path = f.name

        try:
            index = CollectionIndex(index_path=temp_path)
            collections = index.list_collections()
            assert collections == []
        finally:
            Path(temp_path).unlink(missing_ok=True)

    def test_yaml_without_collections(self):
        """Test YAML without collections key."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yaml", delete=False
        ) as f:
            yaml.dump({"version": "1.0"}, f)
            temp_path = f.name

        try:
            index = CollectionIndex(index_path=temp_path)
            collections = index.list_collections()
            assert collections == []
        finally:
            Path(temp_path).unlink(missing_ok=True)


class TestSingletonFunctions:
    """Tests for singleton getter and reset functions."""

    def test_get_collection_index_singleton(self, reset_singleton):
        """Test get_collection_index returns same instance."""
        index1 = get_collection_index()
        index2 = get_collection_index()
        assert index1 is index2

    def test_reset_collection_index(self, reset_singleton):
        """Test reset_collection_index clears singleton."""
        index1 = get_collection_index()
        reset_collection_index()
        index2 = get_collection_index()
        assert index1 is not index2


class TestDefaultCollectionIndexYAML:
    """Tests for the actual collection_index.yaml file."""

    def test_default_yaml_exists(self, reset_singleton):
        """Test that the default collection_index.yaml exists and loads."""
        index = get_collection_index()
        collections = index.list_collections()

        # Should have at least some collections
        assert len(collections) > 0

    def test_default_yaml_has_dask(self, reset_singleton):
        """Test that default YAML includes dask collection."""
        index = get_collection_index()
        dask = index.get_collection("dask")

        # dask should be defined
        assert dask is not None
        assert "dask" in dask.name.lower() or "Dask" in dask.display_name

    def test_format_for_prompt_not_empty(self, reset_singleton):
        """Test that format_for_prompt produces output with default YAML."""
        index = get_collection_index()
        prompt = index.format_for_prompt()

        assert len(prompt) > 0
        assert "Available Knowledge Collections" in prompt
