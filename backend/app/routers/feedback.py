from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_user
from app.db import feedback_dao
from app.db.models.feedbacks import (
    FEEDBACK_CATEGORIES,
    FEEDBACK_STATUSES,
)
from app.db.models.users import User
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

router = APIRouter(prefix="/feedback", tags=["feedback"])


# 一期没有专门的 admin 角色字段，登录用户即可查看/处理反馈。
# 后续如果新增 users.role / users.is_admin，把这里换成更严格的依赖即可，
# 而不需要改动路由层的业务代码。
require_admin = get_current_user


class SubmitFeedbackRequest(BaseModel):
    category: str = Field(..., description="反馈分类：bug/feature/ui/perf/other")
    content: str = Field(..., min_length=1, max_length=2000)
    title: Optional[str] = Field(None, max_length=200)
    contact: Optional[str] = Field(None, max_length=128)


class UpdateStatusRequest(BaseModel):
    status: str = Field(..., description="pending/processing/done/stalled")
    admin_note: Optional[str] = Field(None, max_length=2000)


class BatchDeleteRequest(BaseModel):
    # 上限 500 防止前端越权一次清空表；正常人工选择也撑不到这个量
    ids: list[int] = Field(..., min_length=1, max_length=500)


def _to_dict(record) -> dict:
    return {
        "id": record.id,
        "user_id": record.user_id,
        "category": record.category,
        "title": record.title,
        "content": record.content,
        "contact": record.contact,
        "status": record.status,
        "admin_note": record.admin_note,
        "handled_by": record.handled_by,
        "handled_at": record.handled_at.isoformat() if record.handled_at else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }


@router.post("/submit")
def submit_feedback(
    body: SubmitFeedbackRequest,
    current_user: User = Depends(get_current_user),
):
    """登录用户提交反馈。匿名提交一期不开放，避免被刷。"""
    if body.category not in FEEDBACK_CATEGORIES:
        return R.error(code=StatusCode.PARAM_ERROR, msg="非法反馈分类")

    record = feedback_dao.create_feedback(
        user_id=current_user.id,
        category=body.category,
        content=body.content,
        title=body.title,
        contact=body.contact,
    )
    return R.success({"id": record.id, "status": record.status})


@router.get("/list")
def list_feedbacks(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    _: User = Depends(require_admin),
):
    """分页查询反馈列表。"""
    if status and status not in FEEDBACK_STATUSES:
        return R.error(code=StatusCode.PARAM_ERROR, msg="非法状态")
    if category and category not in FEEDBACK_CATEGORIES:
        return R.error(code=StatusCode.PARAM_ERROR, msg="非法分类")

    items, total = feedback_dao.list_feedbacks(
        status=status,
        category=category,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    return R.success({
        "items": [_to_dict(it) for it in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/stats")
def feedback_stats(_: User = Depends(require_admin)):
    """状态计数，用于看板顶部小卡片。"""
    return R.success(feedback_dao.count_by_status())


@router.get("/{feedback_id}")
def get_feedback_detail(
    feedback_id: int,
    _: User = Depends(require_admin),
):
    record = feedback_dao.get_feedback(feedback_id)
    if not record:
        return R.error(msg="反馈不存在", code=StatusCode.PARAM_ERROR)
    return R.success(_to_dict(record))


@router.post("/{feedback_id}/status")
def update_feedback_status(
    feedback_id: int,
    body: UpdateStatusRequest,
    current_user: User = Depends(require_admin),
):
    if body.status not in FEEDBACK_STATUSES:
        return R.error(code=StatusCode.PARAM_ERROR, msg="非法状态")

    record = feedback_dao.update_status(
        feedback_id=feedback_id,
        status=body.status,
        admin_note=body.admin_note,
        handled_by=current_user.id,
    )
    if not record:
        return R.error(msg="反馈不存在", code=StatusCode.PARAM_ERROR)
    return R.success(_to_dict(record))


@router.delete("/{feedback_id}")
def delete_feedback(
    feedback_id: int,
    _: User = Depends(require_admin),
):
    ok = feedback_dao.delete_feedback(feedback_id)
    if not ok:
        return R.error(msg="反馈不存在", code=StatusCode.PARAM_ERROR)
    return R.success({"deleted": True})


# 用 POST + body 而不是 DELETE + body —— 不少代理 / 客户端会丢掉 DELETE 的请求体，
# 服务端就只能看到一个空 ids 列表，然后被当成「啥也没传」。
@router.post("/batch_delete")
def batch_delete(
    body: BatchDeleteRequest,
    _: User = Depends(require_admin),
):
    deleted = feedback_dao.batch_delete_feedbacks(body.ids)
    return R.success({"deleted": deleted})
