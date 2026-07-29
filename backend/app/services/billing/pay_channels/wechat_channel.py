"""
微信支付 Native (扫码支付) 封装, 基于 wechatpayv3 SDK.

SDK 在函数内部按需 import, 避免未安装 wechatpayv3 时导致整个后端启动失败.
注意: 微信支付官方沙箱已下线, 只能用真实商户号做小额真实交易验证.
"""
import json
import os
from typing import Optional

from app.db.models.orders import Order
from app.services.billing.exceptions import BillingError
from app.utils.logger import get_logger

logger = get_logger(__name__)

_client = None


class WechatNotConfiguredError(BillingError):
    code = 50011

    def __init__(self):
        super().__init__("微信支付未配置 (缺少 WECHAT_MCH_ID / 密钥文件), 无法使用该支付方式")


def _read_key_file(path: Optional[str]) -> Optional[str]:
    if not path or not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _get_client():
    global _client
    if _client is not None:
        return _client

    from wechatpayv3 import WeChatPay, WeChatPayType

    mch_id = os.getenv("WECHAT_MCH_ID")
    app_id = os.getenv("WECHAT_APP_ID")
    api_v3_key = os.getenv("WECHAT_API_V3_KEY")
    cert_serial_no = os.getenv("WECHAT_CERT_SERIAL_NO")
    private_key = _read_key_file(os.getenv("WECHAT_PRIVATE_KEY_PATH"))
    if not mch_id or not app_id or not api_v3_key or not cert_serial_no or not private_key:
        raise WechatNotConfiguredError()

    cert_dir = os.getenv("WECHAT_CERT_DIR", "backend/secrets/wechat_certs")
    os.makedirs(cert_dir, exist_ok=True)

    _client = WeChatPay(
        wechatpay_type=WeChatPayType.NATIVE,
        mchid=mch_id,
        private_key=private_key,
        cert_serial_no=cert_serial_no,
        appid=app_id,
        apiv3_key=api_v3_key,
        notify_url=os.getenv("WECHAT_NOTIFY_URL") or None,
        cert_dir=cert_dir,
    )
    return _client


def create_qrcode(order: Order, *, description: str) -> str:
    """
    调用 Native 支付下单, 返回二维码内容 (code_url).
    金额单位: order.amount_cents 已是分, 与微信要求一致.
    """
    from wechatpayv3 import WeChatPayType

    client = _get_client()
    code, message = client.pay(
        description=description,
        out_trade_no=order.order_no,
        amount={"total": order.amount_cents},
        pay_type=WeChatPayType.NATIVE,
    )
    result = json.loads(message) if message else {}
    if code not in (200, 204) or not result.get("code_url"):
        logger.error(f"[wechat] Native 下单失败, order_no={order.order_no}, code={code}, resp={result}")
        raise BillingError("微信支付下单失败, 请稍后重试")
    return result["code_url"]


def verify_notify(headers: dict, body: bytes) -> Optional[dict]:
    """
    校验并解密微信支付异步通知. 通过返回解密后的业务数据 dict (含 out_trade_no/transaction_id 等),
    验签失败或格式错误返回 None.
    """
    client = _get_client()
    try:
        result = client.callback(headers, body)
    except Exception:
        logger.exception("[wechat] notify 验签/解密异常")
        return None
    if not result or result.get("event_type") != "TRANSACTION.SUCCESS":
        return None
    return result.get("resource")


def query_order(order_no: str) -> Optional[dict]:
    """查单接口, 用于对账兜底. 返回 None 表示查询失败."""
    client = _get_client()
    try:
        code, message = client.query(out_trade_no=order_no)
        if code != 200:
            return None
        return json.loads(message)
    except Exception:
        logger.exception(f"[wechat] query_order 异常, order_no={order_no}")
        return None
