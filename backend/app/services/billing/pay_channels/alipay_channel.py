"""
支付宝电脑网站支付封装.

SDK 在函数内部按需 import, 避免未安装 python-alipay-sdk 时导致整个后端启动失败
(参考 app/utils/mailer.py 的降级模式, 而不是 app/services/sms_service.py 的顶层 eager import).
"""
import os
from typing import Optional

from app.db.models.orders import Order
from app.services.billing.exceptions import BillingError
from app.utils.logger import get_logger

logger = get_logger(__name__)


class AlipayNotConfiguredError(BillingError):
    code = 50010

    def __init__(self):
        super().__init__("支付宝未配置 (缺少 ALIPAY_APP_ID / 密钥文件), 无法使用该支付方式")


def _read_key_file(path: Optional[str]) -> Optional[str]:
    if not path or not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _is_sandbox() -> bool:
    return os.getenv("ALIPAY_SANDBOX", "false").strip().lower() in ("1", "true", "yes")


def _get_client():
    from alipay import AliPay

    app_id = os.getenv("ALIPAY_APP_ID")
    private_key = _read_key_file(os.getenv("ALIPAY_PRIVATE_KEY_PATH"))
    public_key = _read_key_file(os.getenv("ALIPAY_PUBLIC_KEY_PATH"))
    if not app_id or not private_key or not public_key:
        raise AlipayNotConfiguredError()

    sandbox = _is_sandbox()
    return AliPay(
        appid=app_id,
        app_notify_url=os.getenv("ALIPAY_NOTIFY_URL") or None,
        app_private_key_string=private_key,
        alipay_public_key_string=public_key,
        sign_type="RSA2",
        debug=sandbox,
    )


def create_page_payment_url(order: Order, *, subject: str) -> str:
    """调用 alipay.trade.page.pay, 返回电脑网站支付收银台 URL."""
    client = _get_client()
    signed_query = client.api_alipay_trade_page_pay(
        subject=subject,
        out_trade_no=order.order_no,
        total_amount=f"{order.amount_cents / 100:.2f}",
        return_url=os.getenv("ALIPAY_RETURN_URL") or None,
        notify_url=os.getenv("ALIPAY_NOTIFY_URL") or None,
    )
    if not signed_query:
        logger.error(f"[alipay] page.pay 未返回签名参数, order_no={order.order_no}")
        raise BillingError("支付宝下单失败, 请稍后重试")

    gateway = (
        "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
        if _is_sandbox()
        else "https://openapi.alipay.com/gateway.do"
    )
    return f"{gateway}?{signed_query}"


def verify_notify(form_data: dict) -> bool:
    """
    校验支付宝异步通知签名. form_data 为 POST 表单原始字段 (含 sign/sign_type).
    校验通过返回 True, 否则 False. 不在此处做业务判断 (订单查找/状态迁移由调用方负责).
    """
    client = _get_client()
    data = dict(form_data)
    signature = data.pop("sign", None)
    data.pop("sign_type", None)
    if not signature:
        return False
    try:
        return client.verify(data, signature)
    except Exception:
        logger.exception("[alipay] notify 验签异常")
        return False


def query_order(order_no: str) -> Optional[dict]:
    """查单接口, 用于对账兜底. 返回 None 表示查询失败或订单不存在."""
    client = _get_client()
    try:
        return client.api_alipay_trade_query(out_trade_no=order_no)
    except Exception:
        logger.exception(f"[alipay] query_order 异常, order_no={order_no}")
        return None
