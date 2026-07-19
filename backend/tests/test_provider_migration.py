import tomllib
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_no_openai_runtime_imports_or_settings_remain() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8") for path in sorted((BACKEND_DIR / "src").rglob("*.py"))
    )
    environment_example = (BACKEND_DIR / ".env.example").read_text(encoding="utf-8")
    active_documentation = "\n".join(
        [
            (BACKEND_DIR.parent / "README.md").read_text(encoding="utf-8"),
            (BACKEND_DIR / "README.md").read_text(encoding="utf-8"),
        ]
    )

    assert "from openai import" not in source
    assert "import openai" not in source
    assert "OPENAI_API_KEY" not in source
    assert "OPENAI_API_KEY" not in environment_example
    assert "OPENAI_ORGANIZER_MODEL" not in environment_example
    assert "OPENAI_EMBEDDING_MODEL" not in environment_example
    assert "OPENAI_API_KEY" not in active_documentation
    assert "OPENAI_ORGANIZER_MODEL" not in active_documentation
    assert "OPENAI_EMBEDDING_MODEL" not in active_documentation


def test_openai_is_not_a_direct_runtime_dependency() -> None:
    project = tomllib.loads((BACKEND_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    dependency_names = {
        dependency.split("[", 1)[0].split("=", 1)[0].split(">", 1)[0].split("<", 1)[0]
        for dependency in project["project"]["dependencies"]
    }

    assert "openai" not in dependency_names
