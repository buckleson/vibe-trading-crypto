"""Claude chat routes (ADR 0003): status and an SSE chat stream."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.api.security import require_auth, require_settings_write_auth
from src.claude_chat import service


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=20000)
    session_id: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,100}$")
    model: Optional[str] = Field(default=None, max_length=100)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v


def register_claude_chat_routes(app: FastAPI) -> None:
    @app.get("/api/claude/status", dependencies=[Depends(require_auth)])
    async def claude_status() -> dict:
        return service.claude_status()

    @app.post("/api/claude/chat", dependencies=[Depends(require_settings_write_auth)])
    async def claude_chat(req: ChatRequest) -> StreamingResponse:
        async def gen():
            async for e in service.stream_chat(req.message, req.session_id, req.model):
                yield f"event: {e['type']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
