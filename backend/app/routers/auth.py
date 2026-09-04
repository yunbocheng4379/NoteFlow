import base64
import uuid
import os
import re
import json
import secrets
from datetime import datetime
from urllib.parse import quote_plus, urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.jwt_handler import hash_password, verify_password, create_access_token
from app.auth.dependencies import get_current_user, get_current_user_optional
from app.db.engine import get_db
from app.db.models.users import User
from app.db.redis_client import get_redis
from app.services.verification_code import (
    generate_and_store,
    clear_pending_code,
    verify_and_consume,
    RateLimitedError,
    CodeExpiredError,
    CodeInvalidError,
)
from app.services.sms_service import send_verification_sms
from app.services.wechat_miniprogram import (
    WechatMiniProgramError,
    login_with_wechat_code,
)
from app.utils.mailer import send_verification_code_email
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

router = APIRouter(prefix="/auth", tags=["auth"])

PHONE_PATTERN = r"^1\d{10}$"


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    # 保留该字段以兼容旧客户端，但注册不再要求或校验二次输入密码。
    confirm_password: str | None = None
    invite_code: str | None = None  # 可选; 6 位 base32; 大小写不敏感

    @field_validator("username")
    @classmethod
    def username_length(cls, v):
        if len(v) < 3 or len(v) > 32:
            raise ValueError("用户名长度需在 3~32 字符之间")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v

    @field_validator("invite_code")
    @classmethod
    def invite_code_norm(cls, v):
        if v is None:
            return None
        v = v.strip().upper()
        return v if v else None

class LoginRequest(BaseModel):
    # 支持用户名/邮箱/手机号登录
    account: str
    password: str


class SendCodeRequest(BaseModel):
    target: str = ""  # verify_phone/verify_email 场景由服务端从登录用户身上取值, 客户端无需(也不能)传入
    target_type: str  # "email" | "phone"
    purpose: str       # "login" | "bind" | "bind_email" | "verify_phone" | "verify_email" | "reset_password"

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v

    @field_validator("purpose")
    @classmethod
    def purpose_valid(cls, v):
        if v not in ("login", "bind", "bind_email", "verify_phone", "verify_email", "reset_password"):
            raise ValueError("purpose 不合法")
        return v

    @model_validator(mode="after")
    def target_format_valid(self):
        import re
        if self.purpose in ("verify_phone", "verify_email"):
            return self
        target = self.target.strip()
        if self.target_type == "phone" and not re.match(PHONE_PATTERN, target):
            raise ValueError("手机号格式不正确")
        if self.target_type == "email" and ("@" not in target or "." not in target.split("@")[-1]):
            raise ValueError("邮箱格式不正确")
        self.target = target
        return self


class LoginByCodeRequest(BaseModel):
    target: str
    target_type: str  # "email" | "phone"
    code: str

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v


class ResetPasswordRequest(BaseModel):
    target: str
    target_type: str  # "email" | "phone"
    code: str
    new_password: str

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v

    @field_validator("new_password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v

    @model_validator(mode="after")
    def target_format_valid(self):
        import re
        target = self.target.strip()
        if self.target_type == "phone" and not re.match(PHONE_PATTERN, target):
            raise ValueError("手机号格式不正确")
        if self.target_type == "email" and ("@" not in target or "." not in target.split("@")[-1]):
            raise ValueError("邮箱格式不正确")
        self.target = target
        return self


class BindPhoneRequest(BaseModel):
    phone: str
    code: str
    ticket: str | None = None  # 已绑定过手机号(换绑场景)时必填, 见 verify-contact

    @field_validator("phone")
    @classmethod
    def phone_format_valid(cls, v):
        import re
        v = v.strip()
        if not re.match(PHONE_PATTERN, v):
            raise ValueError("手机号格式不正确")
        return v


class BindEmailRequest(BaseModel):
    email: EmailStr
    code: str
    ticket: str  # 邮箱一定已绑定(注册必填), 换绑始终要求先验证原邮箱, 见 verify-contact


class VerifyContactRequest(BaseModel):
    target_type: str  # "phone" | "email", 验证登录用户自己当前绑定的手机号/邮箱

    code: str

    @field_validator("target_type")
    @classmethod
    def target_type_valid(cls, v):
        if v not in ("email", "phone"):
            raise ValueError("target_type 必须是 email 或 phone")
        return v


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar": user.avatar,
        "is_admin": int(user.is_admin or 0),
    }


@router.post("/register")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    from app.services.billing import credit_ledger, referral_service

    if db.query(User).filter(User.username == body.username).first():
        return R.error(code=StatusCode.USERNAME_EXISTS, msg="用户名已存在")
    if db.query(User).filter(User.email == body.email).first():
        return R.error(code=StatusCode.EMAIL_EXISTS, msg="邮箱已被注册")

    # 单事务: 创建用户 + 生成邀请码 + 发放 100 电力 + (可选) 推荐奖励
    try:
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            credits=0,       # 由 ledger.grant 补 100, 保证审计流水完整
            total_points=0,  # 双写期同步置 0
            used_points=0,
        )
        db.add(user)
        db.flush()  # 拿 user.id

        # 生成邀请码
        referral_service.generate_referral_code(db, user.id)

        # 发放注册赠送 100 电力
        credit_ledger.grant(
            db,
            user_id=user.id,
            amount=referral_service.REGISTER_GRANT_CREDITS,
            type_="REGISTER_GRANT",
            note="新用户注册赠送",
        )

        # 处理邀请码 (若提供)
        referral_service.bind_referrer_and_pay_register_reward(
            db, invitee_user_id=user.id, invite_code=body.invite_code
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    token = create_access_token(user.id, user.username)
    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    account = body.account.strip()
    user = (
        db.query(User)
        .filter(or_(User.username == account, User.email == account, User.phone == account))
        .first()
    )
    # 账户不存在 —— 前端据此引导去注册
    if not user:
        return R.error(code=StatusCode.ACCOUNT_NOT_FOUND, msg="账户不存在，请先注册")
    # 密码错误 —— 前端据此停留在登录表单
    if not verify_password(body.password, user.hashed_password):
        return R.error(code=StatusCode.PASSWORD_INCORRECT, msg="密码错误")
    if not user.is_active:
        return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")

    token = create_access_token(user.id, user.username)

    user.last_login_at = datetime.now()
    db.commit()

    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/send-code")
def send_code(
    body: SendCodeRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    # bind/bind_email/verify_* 场景的验证码只能由已登录用户为自己发起, 未登录不允许探测手机号/邮箱占用情况。
    # login/reset_password 场景本身就是给未登录用户找回登录方式/重置密码用的, 不要求登录。
    # 401 复用 get_current_user 抛出未授权时的现成模式(HTTPException + 统一 exception handler),
    # 而不是塞一个语义不准确的 StatusCode。
    if body.purpose in ("bind", "bind_email", "verify_phone", "verify_email") and current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录后再进行此操作",
        )

    # verify_phone/verify_email 是"验证原手机号/邮箱"步骤: target 必须是当前登录用户自己已绑定的值,
    # 不接受客户端传入的任意 target, 否则等于让任何登录用户都能对任意手机号/邮箱发起验证码(被用于短信轰炸)。
    if body.purpose == "verify_phone":
        target_type = "phone"
        if not current_user.phone:
            return R.error(code=StatusCode.TARGET_NOT_FOUND, msg="尚未绑定手机号，无需验证")
        target = current_user.phone
    elif body.purpose == "verify_email":
        target_type = "email"
        target = current_user.email
    else:
        target_type = body.target_type
        target = body.target

    if body.purpose in ("login", "bind", "bind_email", "reset_password"):
        if target_type == "phone":
            existing = db.query(User).filter(User.phone == target).first()
        else:
            existing = db.query(User).filter(User.email == target).first()

        if body.purpose in ("login", "reset_password"):
            if not existing:
                return R.error(code=StatusCode.TARGET_NOT_FOUND, msg="该手机号/邮箱未注册，请先注册")
            if not existing.is_active:
                return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")
        elif body.purpose == "bind_email":
            if existing:
                return R.error(code=StatusCode.EMAIL_EXISTS, msg="该邮箱已被其他账号绑定")
        else:  # bind (phone)
            if existing:
                return R.error(code=StatusCode.PHONE_EXISTS, msg="该手机号已被其他账号绑定")

    try:
        code = generate_and_store(target, body.purpose)
    except RateLimitedError as e:
        return R.error(code=StatusCode.RATE_LIMITED, msg=str(e))

    if target_type == "phone":
        sent = send_verification_sms(target, code)
    else:
        sent = send_verification_code_email(target, code)

    if not sent:
        clear_pending_code(target, body.purpose, code)
        return R.error(code=StatusCode.SEND_CODE_FAILED, msg="验证码发送失败，请稍后重试")

    return R.success({"sent": True})


@router.post("/login-by-code")
def login_by_code(body: LoginByCodeRequest, db: Session = Depends(get_db)):
    target = body.target.strip()

    if body.target_type == "phone":
        user = db.query(User).filter(User.phone == target).first()
    else:
        user = db.query(User).filter(User.email == target).first()

    if not user:
        return R.error(code=StatusCode.ACCOUNT_NOT_FOUND, msg="账户不存在，请先注册")

    try:
        verify_and_consume(target, "login", body.code)
    except CodeExpiredError as e:
        return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
    except CodeInvalidError as e:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

    if not user.is_active:
        return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")

    token = create_access_token(user.id, user.username)
    user.last_login_at = datetime.now()
    db.commit()

    return R.success({
        "token": token,
        "user": _user_payload(user),
    })


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    target = body.target

    if body.target_type == "phone":
        user = db.query(User).filter(User.phone == target).first()
    else:
        user = db.query(User).filter(User.email == target).first()

    if not user:
        return R.error(code=StatusCode.ACCOUNT_NOT_FOUND, msg="账户不存在，请先注册")

    try:
        verify_and_consume(target, "reset_password", body.code)
    except CodeExpiredError as e:
        return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
    except CodeInvalidError as e:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

    if not user.is_active:
        return R.error(code=StatusCode.ACCOUNT_DISABLED, msg="账号已被禁用")

    user.hashed_password = hash_password(body.new_password)
    db.commit()

    return R.success({"reset": True})


# 释放锁时只删除自己持有的 token, 防止 A 请求超时(处理时间超过锁 TTL)后,
# B 拿到新锁, 而 A 的 finally 把 B 的锁误删。用 EVAL 保证 GET+DEL 不被打断。
_LOCK_RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""

BIND_PHONE_LOCK_TTL_SECONDS = 5  # 覆盖一次请求处理耗时(查重+验证码校验+写库)即可, 不需要更长

CONTACT_CHANGE_TICKET_TTL_SECONDS = 600  # 验证原手机号/邮箱后, 给用户 10 分钟窗口去完成换绑


def _contact_ticket_key(user_id: int, target_type: str) -> str:
    return f"contact_change_ticket:{target_type}:{user_id}"


# 与 _LOCK_RELEASE_SCRIPT 同样的原子 GET+DEL 手法, 保证 ticket 一次性消费 (防重放),
# 且只有 value 完全匹配才删除, 避免误删并发请求下别的用户/别的 ticket。
_TICKET_CONSUME_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""


def _consume_contact_ticket(user_id: int, target_type: str, ticket: str | None) -> bool:
    if not ticket:
        return False
    r = get_redis()
    key = _contact_ticket_key(user_id, target_type)
    return bool(r.eval(_TICKET_CONSUME_SCRIPT, 1, key, ticket))


@router.post("/verify-contact")
def verify_contact(
    body: VerifyContactRequest,
    current_user: User = Depends(get_current_user),
):
    """验证登录用户当前绑定的手机号/邮箱, 成功后签发一次性 ticket,
    换绑接口(bind-phone/bind-email)凭此 ticket 才允许写入新值 —— 防止仅凭一个泄露/被盗用的
    登录态就能直接顶替掉原手机号/邮箱(账号找回渠道), 必须先证明拥有旧联系方式。"""
    target_type = body.target_type
    target = current_user.phone if target_type == "phone" else current_user.email

    if target_type == "phone" and not target:
        return R.error(code=StatusCode.TARGET_NOT_FOUND, msg="尚未绑定手机号，无需验证")

    purpose = "verify_phone" if target_type == "phone" else "verify_email"
    try:
        verify_and_consume(target, purpose, body.code)
    except CodeExpiredError as e:
        return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
    except CodeInvalidError as e:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

    ticket = uuid.uuid4().hex
    r = get_redis()
    r.set(_contact_ticket_key(current_user.id, target_type), ticket, ex=CONTACT_CHANGE_TICKET_TTL_SECONDS)

    return R.success({"ticket": ticket})


@router.post("/bind-phone")
def bind_phone(
    body: BindPhoneRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    phone = body.phone

    # 已绑定过手机号的账号属于"换绑", 必须先通过 /verify-contact 证明拥有原手机号才能继续,
    # 否则仅凭一个登录态(如被盗用的 token)就能直接顶掉账号的找回渠道。首次绑定(当前无手机号)
    # 场景不存在"旧手机号"可验证, 直接放行。
    if current_user.phone and not _consume_contact_ticket(current_user.id, "phone", body.ticket):
        return R.error(code=StatusCode.TICKET_INVALID, msg="请先验证原手机号")

    # users.phone 目前没有唯一索引兜底, check-then-write 存在并发绑定竞态,
    # 用 Redis 短锁序列化对同一手机号的绑定尝试(数据库唯一索引迁移是后续独立任务)。
    r = get_redis()
    lock_key = f"bind_phone_lock:{phone}"
    lock_token = uuid.uuid4().hex
    if not r.set(lock_key, lock_token, nx=True, ex=BIND_PHONE_LOCK_TTL_SECONDS):
        return R.error(code=StatusCode.PHONE_EXISTS, msg="该手机号正在被绑定，请稍后重试")

    try:
        existing = db.query(User).filter(User.phone == phone, User.id != current_user.id).first()
        if existing:
            return R.error(code=StatusCode.PHONE_EXISTS, msg="该手机号已被其他账号绑定")

        try:
            verify_and_consume(phone, "bind", body.code)
        except CodeExpiredError as e:
            return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
        except CodeInvalidError as e:
            return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

        current_user.phone = phone
        db.commit()
    finally:
        r.eval(_LOCK_RELEASE_SCRIPT, 1, lock_key, lock_token)

    return R.success({"phone": phone})


@router.post("/bind-email")
def bind_email(
    body: BindEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email = body.email

    # 邮箱注册时必填, 一定已绑定, 换绑必须先通过 /verify-contact 证明拥有原邮箱才能继续,
    # 理由同 bind-phone: 防止仅凭登录态就顶替掉账号的找回渠道。
    if not _consume_contact_ticket(current_user.id, "email", body.ticket):
        return R.error(code=StatusCode.TICKET_INVALID, msg="请先验证原邮箱")

    # users.email 已有唯一索引兜底, 但仍用 Redis 短锁保持与 bind-phone 一致的行为/报错文案,
    # 避免并发绑定时直接抛出未处理的 IntegrityError。
    r = get_redis()
    lock_key = f"bind_email_lock:{email}"
    lock_token = uuid.uuid4().hex
    if not r.set(lock_key, lock_token, nx=True, ex=BIND_PHONE_LOCK_TTL_SECONDS):
        return R.error(code=StatusCode.EMAIL_EXISTS, msg="该邮箱正在被绑定，请稍后重试")

    try:
        existing = db.query(User).filter(User.email == email, User.id != current_user.id).first()
        if existing:
            return R.error(code=StatusCode.EMAIL_EXISTS, msg="该邮箱已被其他账号绑定")

        try:
            verify_and_consume(email, "bind_email", body.code)
        except CodeExpiredError as e:
            return R.error(code=StatusCode.CODE_EXPIRED, msg=str(e))
        except CodeInvalidError as e:
            return R.error(code=StatusCode.CODE_INVALID, msg=str(e))

        current_user.email = email
        db.commit()
    finally:
        r.eval(_LOCK_RELEASE_SCRIPT, 1, lock_key, lock_token)

    return R.success({"email": email})


class WechatLoginRequest(BaseModel):
    code: str  # 小程序调用 wx.login() 获取的临时登录凭证


@router.post("/wechat-login")
async def wechat_login(body: WechatLoginRequest, db: Session = Depends(get_db)):
    """微信小程序一键登录：code → openid → 查/建用户 → 签发 JWT"""
    try:
        user, is_new, token = await login_with_wechat_code(db, body.code)
    except WechatMiniProgramError as exc:
        return R.error(code=StatusCode.CODE_INVALID, msg=str(exc))
    except Exception:
        db.rollback()
        return R.error(code=StatusCode.FAIL, msg="微信登录失败，请稍后重试")

    return R.success({"token": token, "user": _user_payload(user), "is_new": is_new})


# ─────────────────────────────────────────────────────────────
# 微信小程序扫码桥接登录 (PC 端)
# ─────────────────────────────────────────────────────────────

class WechatMiniQrCompleteRequest(BaseModel):
    state: str
    code: str


class WechatMiniExchangeRequest(BaseModel):
    state: str


_WECHAT_MINI_PC_STATE_TTL = max(60, int(os.getenv("WECHAT_MP_QR_TTL", "180")))
_WECHAT_MINI_PC_TICKET_TTL = 60
_WECHAT_MINI_ACCESS_TOKEN_TTL = 7200
_WECHAT_MINI_TOKEN_KEY = "wechat:mini:access_token"
_WECHAT_MINI_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
_WECHAT_MINI_QR_URL = "https://api.weixin.qq.com/wxa/getwxacodeunlimit"
_WECHAT_MINI_STATE_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def _wechat_mini_pc_state_key(state: str) -> str:
    return f"wechat:mini:pc:state:{state}"


def _wechat_mini_pc_ticket_key(state: str) -> str:
    return f"wechat:mini:pc:ticket:{state}"


def _valid_wechat_mini_state(state: str) -> bool:
    return bool(_WECHAT_MINI_STATE_RE.fullmatch(state or ""))


async def _wechat_mini_access_token() -> str:
    r = get_redis()
    cached = r.get(_WECHAT_MINI_TOKEN_KEY)
    if cached:
        return cached

    appid = os.getenv("WECHAT_MP_APPID", "").strip()
    secret = os.getenv("WECHAT_MP_SECRET", "").strip()
    if not appid or not secret:
        raise WechatMiniProgramError("微信小程序登录未配置")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                _WECHAT_MINI_TOKEN_URL,
                params={
                    "grant_type": "client_credential",
                    "appid": appid,
                    "secret": secret,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise WechatMiniProgramError("微信二维码服务异常，请稍后重试") from exc
    except Exception as exc:
        raise WechatMiniProgramError("微信二维码服务异常，请稍后重试") from exc

    if payload.get("errcode") or not payload.get("access_token"):
        raise WechatMiniProgramError("微信二维码服务异常，请稍后重试")

    expires_in = int(payload.get("expires_in") or _WECHAT_MINI_ACCESS_TOKEN_TTL)
    r.set(_WECHAT_MINI_TOKEN_KEY, payload["access_token"], ex=max(60, expires_in - 60))
    return payload["access_token"]


async def _wechat_mini_qr_bytes(state: str) -> bytes:
    access_token = await _wechat_mini_access_token()
    page = os.getenv("WECHAT_MP_PAGE", "pages/pc-login/pc-login").strip()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                _WECHAT_MINI_QR_URL,
                params={"access_token": access_token},
                json={"scene": state, "page": page},
            )
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                payload = response.json()
                raise WechatMiniProgramError(
                    payload.get("errmsg") or "微信二维码生成失败"
                )
            if not response.content:
                raise WechatMiniProgramError("微信二维码生成失败")
            return response.content
    except WechatMiniProgramError:
        raise
    except httpx.HTTPError as exc:
        raise WechatMiniProgramError("微信二维码服务异常，请稍后重试") from exc
    except Exception as exc:
        raise WechatMiniProgramError("微信二维码服务异常，请稍后重试") from exc


@router.get("/wechat/mini/qr")
async def wechat_mini_pc_qr():
    # getwxacodeunlimit 的 scene 最长 32 个字符；24 字节随机值编码后正好 32 字符。
    state = secrets.token_urlsafe(24)
    try:
        qr_bytes = await _wechat_mini_qr_bytes(state)
        get_redis().set(
            _wechat_mini_pc_state_key(state),
            "pending",
            ex=_WECHAT_MINI_PC_STATE_TTL,
        )
    except WechatMiniProgramError as exc:
        return R.error(code=StatusCode.SEND_CODE_FAILED, msg=str(exc))
    except Exception:
        return R.error(code=StatusCode.SEND_CODE_FAILED, msg="微信二维码生成失败，请稍后重试")

    qr_image = "data:image/png;base64," + base64.b64encode(qr_bytes).decode("ascii")
    return R.success({
        "qr_image": qr_image,
        "state": state,
        "expires_in": _WECHAT_MINI_PC_STATE_TTL,
    })


@router.post("/wechat/mini/complete")
async def wechat_mini_pc_complete(
    body: WechatMiniQrCompleteRequest,
    db: Session = Depends(get_db),
):
    if not _valid_wechat_mini_state(body.state):
        return R.error(code=StatusCode.CODE_INVALID, msg="登录二维码无效")

    r = get_redis()
    state_key = _wechat_mini_pc_state_key(body.state)
    if r.delete(state_key) != 1:
        return R.error(code=StatusCode.CODE_INVALID, msg="登录二维码已失效，请重新扫码")

    try:
        user, is_new, token = await login_with_wechat_code(db, body.code)
        payload = json.dumps({
            "token": token,
            "user": _user_payload(user),
            "is_new": is_new,
        }, ensure_ascii=False)
        r.set(
            _wechat_mini_pc_ticket_key(body.state),
            payload,
            ex=_WECHAT_MINI_PC_TICKET_TTL,
        )
    except WechatMiniProgramError as exc:
        r.set(state_key, "failed", ex=10)
        return R.error(code=StatusCode.CODE_INVALID, msg=str(exc))
    except Exception:
        db.rollback()
        r.set(state_key, "failed", ex=10)
        return R.error(code=StatusCode.FAIL, msg="微信登录失败，请稍后重试")

    return R.success({"completed": True})


@router.get("/wechat/mini/status")
def wechat_mini_pc_status(state: str = ""):
    if not _valid_wechat_mini_state(state):
        return R.success({"status": "expired"})

    r = get_redis()
    if r.get(_wechat_mini_pc_ticket_key(state)) is not None:
        return R.success({"status": "ready"})
    current = r.get(_wechat_mini_pc_state_key(state))
    if current == "pending":
        return R.success({"status": "pending"})
    if current == "failed":
        return R.success({"status": "failed"})
    return R.success({"status": "expired"})


@router.post("/wechat/mini/exchange")
def wechat_mini_pc_exchange(body: WechatMiniExchangeRequest):
    if not _valid_wechat_mini_state(body.state):
        return R.error(code=StatusCode.CODE_INVALID, msg="登录二维码已失效，请重新扫码")

    raw = get_redis().getdel(_wechat_mini_pc_ticket_key(body.state))
    if raw is None:
        return R.error(code=StatusCode.CODE_INVALID, msg="登录链接已失效，请重新扫码")
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return R.error(code=StatusCode.FAIL, msg="登录数据异常，请重新扫码")
    return R.success(data)


# ─────────────────────────────────────────────────────────────
# 微信开放平台『网站应用』扫码登录 (Web 端)
#   小程序登录 (/wechat-login) 走 jscode2session, 网站扫码走 oauth2.
#   两者是不同 AppID 下的两套 openid, 但同一开放平台账号下 unionid 相同,
#   建号时优先按 unionid 合并, 避免同一微信号在两端各建一个账号.
# ─────────────────────────────────────────────────────────────

_WECHAT_WEB_STATE_TTL = 300   # 二维码 state 有效期 (秒)
_WECHAT_WEB_TICKET_TTL = 60   # 扫码结果暂存有效期; 前端弹窗打开后 60s 内必须 exchange 掉
_WECHAT_WEB_QR_BASE = "https://open.weixin.qq.com/connect/qrconnect"
_WECHAT_WEB_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
_WECHAT_WEB_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"

# 部分微信昵称包含 emoji ZWJ / 变体选择符 / 控制字符, 存进某些 collation 的 MySQL 列可能报错.
# 清洗成"仅保留可打印 Unicode + 常见符号"; 若清洗后为空, 由调用方 fallback 到 wx_xxx.
_NICKNAME_STRIP_RE = re.compile(r"[​-‏ - ︀-️﻿]")


def _clean_wechat_nickname(raw: str | None) -> str:
    if not raw:
        return ""
    s = _NICKNAME_STRIP_RE.sub("", raw).strip()
    # 太长的截断到 32 (users.username 上限)
    return s[:32]


def _wechat_web_state_key(state: str) -> str:
    return f"wechat:oauth_state:{state}"


def _wechat_web_ticket_key(state: str) -> str:
    return f"wechat:qr_ticket:{state}"


class WechatExchangeRequest(BaseModel):
    state: str

    @field_validator("state")
    @classmethod
    def state_len(cls, v):
        v = (v or "").strip()
        if not v or len(v) > 64:
            raise ValueError("state 参数不合法")
        return v


@router.get("/wechat/qr-url")
def wechat_qr_url():
    """生成微信扫码登录的二维码 URL + 一次性 state.

    前端拿到 qr_url 后放进 iframe.src 即可展示官方二维码;
    state 会在 callback 阶段被消费, 防 CSRF.
    """
    appid = os.getenv("WECHAT_WEB_APPID", "").strip()
    secret = os.getenv("WECHAT_WEB_SECRET", "").strip()
    mock = os.getenv("WECHAT_WEB_MOCK", "false").strip().lower() == "true"

    if not (appid and secret) and not mock:
        raise HTTPException(
            status_code=500,
            detail="微信 Web 登录未配置 (缺少 WECHAT_WEB_APPID / WECHAT_WEB_SECRET, 或设置 WECHAT_WEB_MOCK=true 走 mock)",
        )

    redirect_base = os.getenv("WECHAT_WEB_REDIRECT_BASE", "http://localhost:8483").rstrip("/")
    redirect_uri = f"{redirect_base}/api/auth/wechat/callback"

    # state 用于将扫码流程"再穿回"当前浏览器 tab: qr-url 阶段生成 → 前端在 iframe 里
    # 打开 qr_url → 微信 302 时带回 → callback 校验消费. 生成 + 存入 Redis (SETNX 防重放).
    state = secrets.token_urlsafe(24)
    r = get_redis()
    if not r.set(_wechat_web_state_key(state), "1", nx=True, ex=_WECHAT_WEB_STATE_TTL):
        # 极小概率碰撞, 重生成一次
        state = secrets.token_urlsafe(24)
        r.set(_wechat_web_state_key(state), "1", ex=_WECHAT_WEB_STATE_TTL)

    if mock and not (appid and secret):
        # mock 模式: 直接把 qr_url 指向后端 mock 回调, 前端无需真扫码
        qr_url = f"{redirect_base}/api/auth/wechat/callback?code=MOCK_{state[:8]}&state={state}"
    else:
        qr_params = {
            "appid": appid,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "snsapi_login",
            "state": state,
        }
        qr_url = f"{_WECHAT_WEB_QR_BASE}?{urlencode(qr_params)}#wechat_redirect"

    return R.success({"qr_url": qr_url, "state": state})


def _wechat_frontend_callback(state: str, error: str | None = None) -> str:
    base = os.getenv("WECHAT_WEB_FRONTEND_CALLBACK", "http://localhost:3015/wechat/callback")
    params = {"state": state}
    if error:
        params["error"] = error
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urlencode(params)}"


async def _wechat_web_fetch_openid(code: str) -> dict:
    """调 sns/oauth2/access_token + sns/userinfo, 返回统一格式.

    mock 模式下不发外网请求, 直接根据 code 造一个稳定的 openid.
    """
    mock = os.getenv("WECHAT_WEB_MOCK", "false").strip().lower() == "true"
    if mock:
        # code 形如 MOCK_xxxxxxxx, 用它保证同一次扫码稳定拿到同一 openid;
        # 不同浏览器 tab 产生不同 code, 因此可以 mock 出多个"用户"
        suffix = code.replace("MOCK_", "")[:8] or "default"
        return {
            "openid": f"mock_web_{suffix}",
            "unionid": None,
            "nickname": f"微信用户_{suffix[:4]}",
            "headimgurl": None,
        }

    appid = os.getenv("WECHAT_WEB_APPID", "").strip()
    secret = os.getenv("WECHAT_WEB_SECRET", "").strip()

    async with httpx.AsyncClient(timeout=10) as client:
        # Step 1: code → access_token + openid + unionid
        token_resp = await client.get(
            _WECHAT_WEB_TOKEN_URL,
            params={
                "appid": appid,
                "secret": secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()

        if token_data.get("errcode"):
            raise ValueError(f"errcode={token_data.get('errcode')} errmsg={token_data.get('errmsg')}")

        access_token = token_data.get("access_token")
        openid = token_data.get("openid")
        unionid = token_data.get("unionid")
        if not (access_token and openid):
            raise ValueError("missing access_token/openid")

        # Step 2: 拿昵称+头像; userinfo 失败不影响登录, 只是新用户没头像/用兜底 username
        nickname = ""
        headimgurl = None
        try:
            info_resp = await client.get(
                _WECHAT_WEB_USERINFO_URL,
                params={"access_token": access_token, "openid": openid, "lang": "zh_CN"},
            )
            info_resp.raise_for_status()
            info_data = info_resp.json()
            if not info_data.get("errcode"):
                nickname = info_data.get("nickname") or ""
                headimgurl = info_data.get("headimgurl") or None
                if not unionid:
                    unionid = info_data.get("unionid") or None
        except Exception:
            pass

        return {
            "openid": openid,
            "unionid": unionid,
            "nickname": nickname,
            "headimgurl": headimgurl,
        }


def _find_or_create_wechat_web_user(db: Session, profile: dict) -> tuple[User, bool]:
    """按 unionid → web_openid 顺序查用户; 都没命中则建新号. 返回 (user, is_new)."""
    from app.services.billing import credit_ledger, referral_service

    openid = profile["openid"]
    unionid = profile.get("unionid")
    nickname = _clean_wechat_nickname(profile.get("nickname"))
    headimgurl = profile.get("headimgurl")

    user: User | None = None
    if unionid:
        user = db.query(User).filter(User.wechat_unionid == unionid).first()
    if user is None:
        user = db.query(User).filter(User.wechat_web_openid == openid).first()

    if user is not None:
        # 复用已有账号: 补齐可能空缺的字段 (小程序先注册 → Web 扫码时补 web_openid)
        changed = False
        if not user.wechat_web_openid:
            user.wechat_web_openid = openid
            changed = True
        if unionid and not user.wechat_unionid:
            user.wechat_unionid = unionid
            changed = True
        if not user.avatar and headimgurl:
            user.avatar = headimgurl
            changed = True
        user.last_login_at = datetime.now()
        if changed:
            db.add(user)
        db.commit()
        db.refresh(user)
        return user, False

    # 建新号 —— 与 /wechat-login 小程序注册流程保持完全一致的收尾 (邀请码 + 100 电力赠送)
    fallback_username = f"wx_{openid[:10]}_{secrets.token_hex(2)}"
    username = nickname or fallback_username

    for attempt in range(3):
        candidate = username if attempt == 0 else f"{username}_{secrets.token_hex(2)}"
        try:
            user = User(
                username=candidate,
                email=None,
                hashed_password=None,
                wechat_openid=None,
                wechat_web_openid=openid,
                wechat_unionid=unionid,
                avatar=headimgurl or None,
                phone=None,
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
                note="微信网站扫码新用户注册赠送",
            )
            db.commit()
            db.refresh(user)
            return user, True
        except IntegrityError:
            db.rollback()
            # username 冲突: 换个后缀重试
            continue

    # 3 次都撞: 直接用 fallback 兜底
    user = User(
        username=fallback_username,
        email=None,
        hashed_password=None,
        wechat_openid=None,
        wechat_web_openid=openid,
        wechat_unionid=unionid,
        avatar=headimgurl or None,
        phone=None,
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
        note="微信网站扫码新用户注册赠送",
    )
    db.commit()
    db.refresh(user)
    return user, True


@router.get("/wechat/callback")
async def wechat_web_callback(code: str = "", state: str = "", db: Session = Depends(get_db)):
    """微信扫码后 302 命中的入口. 处理完把结果塞进 Redis ticket, 再 302 回前端 /wechat/callback."""
    from app.utils.logger import get_logger
    logger = get_logger(__name__)

    if not (code and state):
        return RedirectResponse(_wechat_frontend_callback(state, error="invalid_request"))

    r = get_redis()
    # 消费 state (一次性), 防重放/防 CSRF
    if not r.delete(_wechat_web_state_key(state)):
        return RedirectResponse(_wechat_frontend_callback(state, error="state_invalid"))

    try:
        profile = await _wechat_web_fetch_openid(code)
    except Exception as e:
        logger.exception(f"[wechat-web-login] fetch openid failed: {e}")
        return RedirectResponse(_wechat_frontend_callback(state, error="wechat_error"))

    try:
        user, is_new = _find_or_create_wechat_web_user(db, profile)
    except Exception:
        db.rollback()
        logger.exception("[wechat-web-login] find_or_create failed")
        return RedirectResponse(_wechat_frontend_callback(state, error="server_error"))

    if not user.is_active:
        return RedirectResponse(_wechat_frontend_callback(state, error="account_disabled"))

    token = create_access_token(user.id, user.username)
    payload = json.dumps({
        "token": token,
        "user": _user_payload(user),
        "is_new": is_new,
    })
    r.set(_wechat_web_ticket_key(state), payload, ex=_WECHAT_WEB_TICKET_TTL)

    return RedirectResponse(_wechat_frontend_callback(state))


@router.post("/wechat/exchange")
def wechat_web_exchange(body: WechatExchangeRequest):
    """前端 iframe 落地 /wechat/callback 后, 通过 postMessage 触发父页调此接口拿 token + user."""
    r = get_redis()
    key = _wechat_web_ticket_key(body.state)
    raw = r.get(key)
    if raw is None:
        return R.error(code=StatusCode.CODE_INVALID, msg="登录链接已失效, 请重新扫码")
    # 一次性消费
    r.delete(key)
    try:
        data = json.loads(raw)
    except Exception:
        return R.error(code=StatusCode.FAIL, msg="登录数据异常, 请重新扫码")
    return R.success(data)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return R.success(_user_payload(current_user))
