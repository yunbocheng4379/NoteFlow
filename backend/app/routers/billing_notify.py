"""
支付宝 / 微信支付 异步通知 (notify) 回调.

这两个接口由支付网关的服务器直接 POST 调用, 不可能带 JWT, 所以不挂 get_current_user.
验签 (支付宝 RSA2 / 微信 v3 签名+证书链) 是这里唯一的信任边界, 必须先验签再落库,
不允许"先返回 success 再补校验"的顺序。
"""
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.db.engine import SessionLocal
from app.services.billing import order_service
from app.services.billing.pay_channels import alipay_channel, wechat_channel
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/billing/notify", tags=["billing-notify"])


@router.post("/alipay")
async def alipay_notify(request: Request):
    form = await request.form()
    data = dict(form)

    if not alipay_channel.verify_notify(data):
        logger.warning(f"[alipay-notify] 验签失败, out_trade_no={data.get('out_trade_no')}")
        return PlainTextResponse("fail")

    trade_status = data.get("trade_status")
    out_trade_no = data.get("out_trade_no")
    if trade_status not in ("TRADE_SUCCESS", "TRADE_FINISHED") or not out_trade_no:
        # 非支付成功事件 (如 TRADE_CLOSED), 确认收到即可, 不落库
        return PlainTextResponse("success")

    db: Session = SessionLocal()
    try:
        with db.begin():
            order_service.settle_order_by_gateway(
                db,
                order_no=out_trade_no,
                trade_no=data.get("trade_no"),
                raw_payload=json.dumps(data, ensure_ascii=False),
            )
    except Exception:
        logger.exception(f"[alipay-notify] 结算订单异常, out_trade_no={out_trade_no}")
        return PlainTextResponse("fail")
    finally:
        db.close()

    return PlainTextResponse("success")


@router.post("/wechat")
async def wechat_notify(request: Request):
    body = await request.body()
    headers = {
        "Wechatpay-Signature": request.headers.get("Wechatpay-Signature"),
        "Wechatpay-Timestamp": request.headers.get("Wechatpay-Timestamp"),
        "Wechatpay-Nonce": request.headers.get("Wechatpay-Nonce"),
        "Wechatpay-Serial": request.headers.get("Wechatpay-Serial"),
    }

    resource = wechat_channel.verify_notify(headers, body)
    if not resource:
        logger.warning("[wechat-notify] 验签/解密失败或非支付成功事件")
        return JSONResponse(status_code=400, content={"code": "FAIL", "message": "验签失败"})

    out_trade_no = resource.get("out_trade_no")
    if not out_trade_no:
        return JSONResponse(status_code=400, content={"code": "FAIL", "message": "缺少 out_trade_no"})

    db: Session = SessionLocal()
    try:
        with db.begin():
            order_service.settle_order_by_gateway(
                db,
                order_no=out_trade_no,
                trade_no=resource.get("transaction_id"),
                raw_payload=json.dumps(resource, ensure_ascii=False),
            )
    except Exception:
        logger.exception(f"[wechat-notify] 结算订单异常, out_trade_no={out_trade_no}")
        return JSONResponse(status_code=500, content={"code": "FAIL", "message": "处理失败"})
    finally:
        db.close()

    return JSONResponse(content={"code": "SUCCESS", "message": "成功"})
