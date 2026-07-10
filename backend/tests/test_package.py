from importlib.metadata import version

import mapping_memory


def test_package_imports() -> None:
    assert mapping_memory.__version__ == "0.1.0"


def test_mem0_version_is_pinned_for_embedded_compatibility() -> None:
    assert version("mem0ai") == "2.0.11"
