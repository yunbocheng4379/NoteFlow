import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth.jwt_handler import hash_password, verify_password, create_access_token
from app.auth.dependencies import get_current_user, get_current_user_optional
from app.db.engine import get_db
from app.db.models.users import User
from app.db.redis_client import get_redis
from app.services.verification_code import (
    generate_and_store,
    verify_and_consume,
    RateLimitedError,
    CodeExpiredError,
    CodeInvalidError,
)
from app.services.sms_service import send_verification_sms
from app.utils.mailer import send_verification_code_email
from app.utils.response import ResponseWrapper as R
from app.utils.status_code import StatusCode

router = APIRouter(prefix="/auth", tags=["auth"])

PHONE_PATTERN = r"^1\d{10}$"


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    confirm_password: str
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

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("两次输入的密码不一致")
        return self


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


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return R.success(_user_payload(current_user))
