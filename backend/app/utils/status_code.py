from enum import IntEnum

class StatusCode(IntEnum):
    SUCCESS = 0
    FAIL = 1

    DOWNLOAD_ERROR = 1001
    TRANSCRIBE_ERROR = 1002
    GENERATE_ERROR = 1003

    INVALID_URL = 2001
    PARAM_ERROR = 2002

    # 认证相关
    ACCOUNT_NOT_FOUND = 40401   # 账户不存在
    PASSWORD_INCORRECT = 40101  # 密码错误
    ACCOUNT_DISABLED = 40301    # 账号被禁用
    USERNAME_EXISTS = 40901     # 用户名已存在
    EMAIL_EXISTS = 40902        # 邮箱已被注册

    # 验证码登录 / 绑定手机号相关
    TARGET_NOT_FOUND = 40402    # 验证码登录目标(手机号/邮箱)对应账号不存在
    PHONE_EXISTS = 40903        # 手机号已被其他账号绑定
    CODE_INVALID = 40103        # 验证码错误
    CODE_EXPIRED = 40104        # 验证码已过期或不存在
    RATE_LIMITED = 42901        # 发送过于频繁
    SEND_CODE_FAILED = 50001    # 验证码发送失败(短信/邮件服务异常)
    TICKET_INVALID = 40105      # 换绑凭证缺失/失效, 需先重新验证原手机号或邮箱