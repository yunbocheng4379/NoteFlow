from typing import TYPE_CHECKING

from app.exceptions.biz_exception import BizException
from app.utils.status_code import StatusCode

if TYPE_CHECKING:
    from app.db.models.users import User


def require_pro(user: "User", feature_name: str = "知识库") -> None:
    """Pro 会员专属功能校验；免费用户调用核心接口时拒绝。"""
    if not user.active_subscription_id:
        raise BizException(
            code=StatusCode.KB_REQUIRES_PRO.value,
            message=f"{feature_name}为会员功能，请升级 Pro",
        )
