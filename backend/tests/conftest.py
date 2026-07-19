from contextlib import AbstractAsyncContextManager
from pathlib import Path
from types import TracebackType
from typing import Any, Self

import anyio
import anyio.to_thread
import fastapi.testclient
import httpx
import pytest
from fastapi import FastAPI


@pytest.fixture(autouse=True)
def isolate_provider_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "app.sqlite"))
    monkeypatch.setenv("VAULT_PATH", str(tmp_path / "vault"))
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "chroma"))
    monkeypatch.setenv("MEMORY_PATH", str(tmp_path / "memory"))
    if request.node.get_closest_marker("live") is None:
        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("VOYAGE_API_KEY", "")


# Starlette 1.3.1's bundled TestClient uses httpx2 in this environment, and
# even a minimal FastAPI request can hang. Keep the workaround test-local.
class FastApiClient:
    __test__ = False

    def __init__(self, app: FastAPI, *, base_url: str = "http://testserver", **_: Any) -> None:
        self.app = app
        self.base_url = base_url
        self._lifespan: AbstractAsyncContextManager[Any] | None = None

    def __enter__(self) -> Self:
        anyio.run(self._start_lifespan)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        anyio.run(self._stop_lifespan)

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("DELETE", url, **kwargs)

    def options(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("OPTIONS", url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return anyio.run(self._request, method, url, kwargs)

    def close(self) -> None:
        if self._lifespan is not None:
            anyio.run(self._stop_lifespan)

    async def _request(self, method: str, url: str, kwargs: dict[str, Any]) -> httpx.Response:
        transport = httpx.ASGITransport(app=self.app)
        async with httpx.AsyncClient(transport=transport, base_url=self.base_url) as client:
            return await client.request(method, url, **kwargs)

    async def _start_lifespan(self) -> None:
        lifespan = self.app.router.lifespan_context(self.app)
        self._lifespan = lifespan
        await lifespan.__aenter__()

    async def _stop_lifespan(
        self,
        exc_type: type[BaseException] | None = None,
        exc_value: BaseException | None = None,
        traceback: TracebackType | None = None,
    ) -> None:
        if self._lifespan is None:
            return

        lifespan = self._lifespan
        self._lifespan = None
        await lifespan.__aexit__(exc_type, exc_value, traceback)


fastapi.testclient.TestClient = FastApiClient


# Sync FastAPI endpoints are normally dispatched through AnyIO's threadpool.
# The installed AnyIO/httpx2 combination can leave that worker waiting forever
# under pytest, so execute sync endpoint callables inline for this test harness.
async def _run_sync_inline(
    func: Any,
    *args: Any,
    abandon_on_cancel: bool = False,
    cancellable: bool | None = None,
    limiter: Any = None,
) -> Any:
    return func(*args)


anyio.to_thread.run_sync = _run_sync_inline
