"""
更新日志: 管理员配置 API.

前缀: ``/api/admin/update_logs`` (注册时由 app/__init__.py 加 ``/api`` 前缀).

- 仅管理员可访问 (get_current_admin).
- 支持 pending/active/ended 全状态管理, 列表可按状态过滤, 关键词检索.
- 接口行为:
  - POST   /admin/update_logs           新增 (默认 pending)
  - PATCH  /admin/update_logs/{id}      编辑字段 (title/version/summary/content), 不改 status
  - POST   /admin/update_logs/{id}/publish  pending -> active, 同一时刻全局唯一
  - POST   /admin/update_logs/{id}/end      active -> ended
  - DELETE /admin/update_logs/{id}      物理删除 (多用于 pending 阶段)
"""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from app.auth.dependencies import get_current_admin
from app.db.models.users import User
from app.db import update_log_dao
from app.utils.logger import get_logger
from app.utils.mailer import send_update_log_email
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

logger = get_logger(__name__)

router = APIRouter(prefix="/admin/update_logs", tags=["admin-update-logs"])


def _send_update_log_emails(title: str, summary: str, version: Optional[str]) -> None:
    """给所有开启「系统公告」的用户群发通知邮件。单个失败不影响其他人。"""
    from app.db.engine import SessionLocal
    from app.db.models.users import User as UserModel

    db = SessionLocal()
    try:
        users = db.query(UserModel).filter(UserModel.system_announce_enabled == 1).all()
        for user in users:
            if not user.email:
                continue
            try:
                send_update_log_email(to=user.email, title=title, summary=summary, version=version)
            except Exception as e:
                logger.warning(f"系统公告邮件发送异常 (user_id={user.id}): {e}")
    finally:
        db.close()


# ==== Schemas ====

class CreateUpdateLogRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    summary: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1)
    version: Optional[str] = Field(None, max_length=32)


class UpdateUpdateLogRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    summary: Optional[str] = Field(None, min_length=1, max_length=500)
    content: Optional[str] = Field(None, min_length=1)
    version: Optional[str] = Field(None, max_length=32)


# ==== 读 ====

@router.get("")
def list_update_logs_admin(
    status: Optional[str] = Query(None, description="pending / active / ended"),
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    _: User = Depends(get_current_admin),
):
    try:
        items, total = update_log_dao.list_for_admin(
            status=status, keyword=keyword, page=page, page_size=page_size,
        )
    except ValueError as e:
        return R.error(code=StatusCode.PARAM_ERROR, msg=str(e))
    return R.success({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })


@router.get("/{update_log_id}")
def get_update_log_admin(
    update_log_id: int,
    _: User = Depends(get_current_admin),
):
    item = update_log_dao.get_by_id(update_log_id)
    if not item:
        return R.error(msg="更新日志不存在")
    return R.success(item)


# ==== 写 ====

@router.post("")
def create_update_log(
    body: CreateUpdateLogRequest,
    current_admin: User = Depends(get_current_admin),
):
    try:
        row = update_log_dao.create_update_log(
            title=body.title,
            summary=body.summary,
            content=body.content,
            version=body.version,
            created_by=current_admin.id,
        )
    except ValueError as e:
        return R.error(code=StatusCode.PARAM_ERROR, msg=str(e))
    return R.success(row)


@router.patch("/{update_log_id}")
def update_update_log(
    update_log_id: int,
    body: UpdateUpdateLogRequest,
    _: User = Depends(get_current_admin),
):
    try:
        row = update_log_dao.update_update_log(
            update_log_id=update_log_id,
            title=body.title,
            summary=body.summary,
            content=body.content,
            version=body.version,
        )
    except ValueError as e:
        return R.error(code=StatusCode.PARAM_ERROR, msg=str(e))
    if not row:
        return R.error(msg="更新日志不存在")
    return R.success(row)


@router.post("/{update_log_id}/publish")
def publish_update_log(
    update_log_id: int,
    background_tasks: BackgroundTasks,
    current_admin: User = Depends(get_current_admin),
):
    try:
        row = update_log_dao.publish(
            update_log_id=update_log_id,
            published_by=current_admin.id,
        )
    except IntegrityError:
        # 已经存在另一条 active 行
        return R.error(msg="已有正在通知的更新日志，请先结束它再发布新的")
    if not row:
        return R.error(msg="更新日志不存在")

    background_tasks.add_task(
        _send_update_log_emails,
        title=row["title"],
        summary=row["summary"],
        version=row.get("version"),
    )
    return R.success(row)


@router.post("/{update_log_id}/end")
def end_update_log(
    update_log_id: int,
    _: User = Depends(get_current_admin),
):
    row = update_log_dao.end(update_log_id=update_log_id)
    if not row:
        return R.error(msg="更新日志不存在")
    return R.success(row)


@router.delete("/{update_log_id}")
def delete_update_log(
    update_log_id: int,
    _: User = Depends(get_current_admin),
):
    ok = update_log_dao.delete_update_log(update_log_id=update_log_id)
    if not ok:
        return R.error(msg="更新日志不存在")
    return R.success({"deleted": True})
