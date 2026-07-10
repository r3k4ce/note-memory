from fastapi import APIRouter, HTTPException, Response, status

from mapping_memory.chat import (
    clear_chat,
    create_chat_thread,
    delete_chat_thread,
    get_chat_thread,
    learning_enabled,
    list_chat_messages,
    list_chat_threads,
    set_learning_enabled,
    update_chat_thread,
)
from mapping_memory.memory import LOCAL_OWNER_ID, MemoryAdapter, MemoryNotFoundError
from mapping_memory.schemas import (
    ChatMessageRead,
    ChatThreadCreate,
    ChatThreadRead,
    ChatThreadUpdate,
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

    @router.get("/chat/threads", response_model=list[ChatThreadRead])
    def get_chat_threads() -> list[ChatThreadRead]:
        threads = list_chat_threads(settings.sqlite_path, LOCAL_OWNER_ID)
        return threads if threads else [create_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID)]

    @router.post(
        "/chat/threads",
        response_model=ChatThreadRead,
        status_code=status.HTTP_201_CREATED,
    )
    def post_chat_thread(request: ChatThreadCreate) -> ChatThreadRead:
        try:
            return create_chat_thread(
                settings.sqlite_path,
                LOCAL_OWNER_ID,
                title=request.title,
                scope=request.scope,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @router.patch("/chat/threads/{thread_id}", response_model=ChatThreadRead)
    def patch_chat_thread(thread_id: int, request: ChatThreadUpdate) -> ChatThreadRead:
        try:
            thread = update_chat_thread(
                settings.sqlite_path,
                LOCAL_OWNER_ID,
                thread_id,
                title=request.title,
                scope=request.scope,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if thread is None:
            raise HTTPException(status_code=404, detail="Chat thread not found")
        return thread

    @router.delete("/chat/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_chat_thread_endpoint(thread_id: int) -> Response:
        if not delete_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID, thread_id):
            raise HTTPException(status_code=404, detail="Chat thread not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/chat/threads/{thread_id}/messages", response_model=list[ChatMessageRead])
    def get_chat_thread_messages(thread_id: int) -> list[ChatMessageRead]:
        if get_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID, thread_id) is None:
            raise HTTPException(status_code=404, detail="Chat thread not found")
        return list_chat_messages(settings.sqlite_path, LOCAL_OWNER_ID, thread_id)

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
