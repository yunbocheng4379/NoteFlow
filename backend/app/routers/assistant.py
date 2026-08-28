from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.db.models.users import User
from app.services.product_assistant_service import encode_sse_event, product_assistant_stream
from app.utils.response import ResponseWrapper as R

router = APIRouter()


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AssistantAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[AssistantMessage] = Field(default_factory=list, max_length=20)


@router.post("/assistant/ask_stream")
def ask_assistant_stream(data: AssistantAskRequest, current_user: User = Depends(get_current_user)):
    question = data.question.strip()
    if not question:
        return R.error(msg="请输入问题后再发送")

    history = [{"role": item.role, "content": item.content} for item in data.history]

    def event_generator():
        for event in product_assistant_stream(question, history, user_id=current_user.id):
            yield encode_sse_event(event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
