from typing import TYPE_CHECKING

from app.exceptions.biz_exception import BizException
from app.utils.status_code import StatusCode

if TYPE_CHECKING:
    from app.db.models.users import User


def require_pro(user: "User") -> None:
    """知识库为 Pro 会员专属功能；免费用户调用核心问答接口时拒绝。"""
    if not user.active_subscription_id:
        raise BizException(code=StatusCode.KB_REQUIRES_PRO.value, message="知识库为会员功能，请升级 Pro")
