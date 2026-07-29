"""
支付宝当面付 (扫码支付) 封装.

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


def _get_client():
    from alipay import AliPay

    app_id = os.getenv("ALIPAY_APP_ID")
    private_key = _read_key_file(os.getenv("ALIPAY_PRIVATE_KEY_PATH"))
    public_key = _read_key_file(os.getenv("ALIPAY_PUBLIC_KEY_PATH"))
    if not app_id or not private_key or not public_key:
        raise AlipayNotConfiguredError()

    sandbox = os.getenv("ALIPAY_SANDBOX", "false").strip().lower() in ("1", "true", "yes")
    return AliPay(
        appid=app_id,
        app_notify_url=os.getenv("ALIPAY_NOTIFY_URL") or None,
        app_private_key_string=private_key,
        alipay_public_key_string=public_key,
        sign_type="RSA2",
        debug=sandbox,
    )


def create_qrcode(order: Order, *, subject: str) -> str:
    """
    调用 alipay.trade.precreate (当面付), 返回二维码内容 (qr_code URL).
    金额单位: order.amount_cents 是分, 支付宝要求元 (字符串, 两位小数).
    """
    client = _get_client()
    amount_yuan = f"{order.amount_cents / 100:.2f}"
    result = client.api_alipay_trade_precreate(
        subject=subject,
        out_trade_no=order.order_no,
        total_amount=amount_yuan,
        notify_url=os.getenv("ALIPAY_NOTIFY_URL") or None,
    )
    qr_code = result.get("qr_code")
    if not qr_code:
        logger.error(f"[alipay] precreate 未返回 qr_code, order_no={order.order_no}, resp={result}")
        raise BillingError("支付宝下单失败, 请稍后重试")
    return qr_code


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
