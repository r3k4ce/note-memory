from fastapi import APIRouter, HTTPException, Response, status

from mapping_memory.chat import (
    clear_chat,
    learning_enabled,
    list_chat_messages,
    set_learning_enabled,
)
from mapping_memory.memory import LOCAL_OWNER_ID, MemoryAdapter, MemoryNotFoundError
from mapping_memory.schemas import (
    ChatMessageRead,
    MemoryRecord,
    MemorySettingsRead,
    MemorySettingsUpdate,
    MemoryUpdate,
)
from mapping_memory.settings import Settings


def create_memory_router(settings: Settings, adapter: MemoryAdapter) -> APIRouter:
    router = APIRouter()

    @router.get("/chat", response_model=list[ChatMessageRead])
    def get_chat() -> list[ChatMessageRead]:
        return list_chat_messages(settings.sqlite_path, LOCAL_OWNER_ID)

    @router.delete("/chat", status_code=status.HTTP_204_NO_CONTENT)
    def delete_chat() -> Response:
        clear_chat(settings.sqlite_path, LOCAL_OWNER_ID)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/memories", response_model=list[MemoryRecord])
    def get_memories() -> list[MemoryRecord]:
        return adapter.list()

    @router.patch("/memories/{memory_id}", response_model=MemoryRecord)
    def update_memory(memory_id: str, request: MemoryUpdate) -> MemoryRecord:
        try:
            return adapter.update(memory_id, request.content)
        except MemoryNotFoundError as error:
            raise HTTPException(status_code=404, detail="Memory not found") from error

    @router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_memory(memory_id: str) -> Response:
        try:
            adapter.delete(memory_id)
        except MemoryNotFoundError as error:
            raise HTTPException(status_code=404, detail="Memory not found") from error
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete("/memories", status_code=status.HTTP_204_NO_CONTENT)
    def delete_memories() -> Response:
        adapter.delete_all()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/memory-settings", response_model=MemorySettingsRead)
    def get_memory_settings() -> MemorySettingsRead:
        return MemorySettingsRead(
            available=adapter.available,
            learning_enabled=learning_enabled(settings.sqlite_path, LOCAL_OWNER_ID),
        )

    @router.patch("/memory-settings", response_model=MemorySettingsRead)
    def update_memory_settings(request: MemorySettingsUpdate) -> MemorySettingsRead:
        set_learning_enabled(settings.sqlite_path, LOCAL_OWNER_ID, request.learning_enabled)
        return MemorySettingsRead(
            available=adapter.available,
            learning_enabled=request.learning_enabled,
        )

    return router
