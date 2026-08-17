"""微信小程序登录服务。

该模块只负责小程序 code 换身份、用户匹配/创建和系统 JWT 签发，HTTP 路由
可以复用同一套逻辑完成小程序自身登录及 PC 扫码桥接登录。
"""

import os
import secrets
from datetime import datetime

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.jwt_handler import create_access_token
from app.db.models.users import User


class WechatMiniProgramError(Exception):
    """可安全返回给客户端的微信小程序登录错误。"""


async def wechat_code_to_session(code: str) -> dict:
    """使用小程序临时 code 换取 openid/unionid。"""
    appid = os.getenv("WECHAT_MP_APPID", "").strip()
    secret = os.getenv("WECHAT_MP_SECRET", "").strip()
    if not appid or not secret:
        raise WechatMiniProgramError("微信小程序登录未配置")
    if not code or not code.strip():
        raise WechatMiniProgramError("微信登录凭证不能为空")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params={
                    "appid": appid,
                    "secret": secret,
                    "js_code": code,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise WechatMiniProgramError("微信登录服务异常，请稍后重试") from exc
    except Exception as exc:
        raise WechatMiniProgramError("微信登录服务异常，请稍后重试") from exc

    if payload.get("errcode"):
        errmsg = payload.get("errmsg") or "未知错误"
        raise WechatMiniProgramError(f"微信登录失败: {errmsg}")

    openid = payload.get("openid")
    if not openid:
        raise WechatMiniProgramError("获取微信用户标识失败")
    return {"openid": openid, "unionid": payload.get("unionid")}


def _new_wechat_username(openid: str) -> str:
    return f"wx_{openid[:10]}_{secrets.token_hex(2)}"


def find_or_create_wechat_user(
    db: Session, openid: str, unionid: str | None
) -> tuple[User, bool]:
    """按小程序 openid → unionid 查找用户，未命中时创建新用户。"""
    from app.services.billing import credit_ledger, referral_service

    user = db.query(User).filter(User.wechat_openid == openid).first()
    if user is None and unionid:
        user = db.query(User).filter(User.wechat_unionid == unionid).first()

    if user is not None:
        if user.wechat_openid and user.wechat_openid != openid:
            raise WechatMiniProgramError("微信账号关联冲突，请联系客服处理")
        if not user.wechat_openid:
            user.wechat_openid = openid
        if unionid and not user.wechat_unionid:
            user.wechat_unionid = unionid
        user.last_login_at = datetime.now()
        db.commit()
        db.refresh(user)
        return user, False

    try:
        user = User(
            username=_new_wechat_username(openid),
            email=None,
            hashed_password=None,
            wechat_openid=openid,
            wechat_unionid=unionid,
            credits=0,
            total_points=0,
            used_points=0,
        )
        db.add(user)
        db.flush()
        referral_service.generate_referral_code(db, user.id)
        credit_ledger.grant(
            db,
            user_id=user.id,
            amount=referral_service.REGISTER_GRANT_CREDITS,
            type_="REGISTER_GRANT",
            note="微信小程序新用户注册赠送",
        )
        db.commit()
        db.refresh(user)
        return user, True
    except IntegrityError as exc:
        db.rollback()
        raise WechatMiniProgramError("创建微信用户失败，请稍后重试") from exc
    except Exception:
        db.rollback()
        raise


async def login_with_wechat_code(db: Session, code: str) -> tuple[User, bool, str]:
    """完成 code2session、用户匹配和 JWT 签发。"""
    session = await wechat_code_to_session(code)
    user, is_new = find_or_create_wechat_user(
        db, session["openid"], session.get("unionid")
    )
    if not user.is_active:
        raise WechatMiniProgramError("账号已被禁用")
    token = create_access_token(user.id, user.username)
    return user, is_new, token
