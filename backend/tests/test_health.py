from fastapi.testclient import TestClient

from mapping_memory.main import create_app
from mapping_memory.settings import Settings


def test_health_returns_ok(tmp_path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "health.sqlite"))
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
