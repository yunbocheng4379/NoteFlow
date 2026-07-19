from sqlalchemy import Column, Integer, String, BigInteger, DateTime, ForeignKey, func

from app.db.engine import Base


class User(Base):
    """用户账号表"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True, comment="用户 ID，主键，自增")
    username = Column(String(64), unique=True, nullable=False, index=True, comment="登录用户名，全局唯一，最长 64 字符")
    email = Column(String(128), unique=True, nullable=False, index=True, comment="邮箱地址，全局唯一，用于注册/找回密码")
    hashed_password = Column(String(256), nullable=False, comment="bcrypt 哈希后的密码，禁止明文存储")
    avatar = Column(String(512), nullable=True, comment="头像图片 URL，可为空")
    phone = Column(String(20), nullable=True, comment="手机号")
    is_active = Column(Integer, default=1, comment="账号激活状态：1=正常，0=已停用/封禁")
    is_admin = Column(Integer, default=0, nullable=False, comment="是否为后台管理员：1=管理员，0=普通用户")
    last_login_at = Column(DateTime, nullable=True, comment="最近登录时间")
    email_notify_enabled = Column(Integer, default=1, nullable=False, comment="是否开启邮件通知 (笔记生成完成时发邮件)：1=开启，0=关闭")
    system_announce_enabled = Column(Integer, default=1, nullable=False, comment="是否开启系统公告邮件通知 (管理员发布更新日志时发邮件)：1=开启，0=关闭")

    # ===== 电力 / 计费 (双写期: total_points 保留, 实际余额走 credits) =====
    total_points = Column(Integer, default=100, nullable=False, comment="[deprecated 双写期保留] 旧字段, 由 phase2 删除")
    used_points = Column(Integer, default=0, nullable=False, comment="累计已消耗电力 (展示用, 不参与扣费计算)")
    credits = Column(Integer, default=0, nullable=False, comment="当前电力余额, 永不过期; 充值/会员/推荐/退费均累加, 生成笔记时扣减")

    # ===== 推荐码 =====
    referral_code = Column(String(16), unique=True, nullable=True, comment="用户专属邀请码 (6 位 base32 大写, 全局唯一)")
    referred_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
                                  comment="邀请人 user_id, 注册时填写邀请码后绑定, 不可修改")

    # ===== 订阅 =====
    active_subscription_id = Column(BigInteger, ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True,
                                     comment="当前生效会员订阅 ID, NULL = 免费用户")

    created_at = Column(DateTime, server_default=func.now(), comment="注册时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="最近更新时间，每次修改自动刷新")
