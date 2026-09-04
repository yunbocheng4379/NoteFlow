"""kb_permissions.require_pro 单测 - 用轻量 stub 代替真实 User ORM 对象"""
import pytest

from app.exceptions.biz_exception import BizException
from app.services.kb_permissions import require_pro


class _StubUser:
    def __init__(self, active_subscription_id=None):
        self.active_subscription_id = active_subscription_id


def test_require_pro_passes_for_subscribed_user():
    require_pro(_StubUser(active_subscription_id=42))  # 不应抛异常


def test_require_pro_raises_for_free_user():
    with pytest.raises(BizException) as exc_info:
        require_pro(_StubUser(active_subscription_id=None))
    assert exc_info.value.code == 40601


def test_require_pro_rejects_free_user_for_original_screenshot():
    with pytest.raises(BizException) as exc_info:
        require_pro(_StubUser(active_subscription_id=None), "原片截图")

    assert exc_info.value.code == 40601
    assert exc_info.value.message == "原片截图为会员功能，请升级 Pro"
