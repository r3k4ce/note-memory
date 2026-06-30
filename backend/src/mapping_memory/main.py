from fastapi import FastAPI

from mapping_memory.settings import Settings

settings = Settings()
app = FastAPI(title=settings.app_name)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
