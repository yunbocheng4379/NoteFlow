"""电力/计费模块统一异常"""


class BillingError(Exception):
    """计费模块基类异常"""
    code: int = 50000

    def __init__(self, message: str = "", data: dict | None = None):
        super().__init__(message)
        self.message = message
        self.data = data or {}


class InsufficientCreditError(BillingError):
    """余额不足"""
    code = 40201  # HTTP 402 Payment Required 衍生

    def __init__(self, current: int, required: int):
        super().__init__(
            f"电力余额不足: 需要 {required}, 当前 {current}",
            data={"current_balance": current, "required_credits": required},
        )
        self.current = current
        self.required = required


class InvalidTransactionError(BillingError):
    """流水操作非法 (重复退费 / 无 CONSUME 记录等)"""
    code = 50001


class OrderStateError(BillingError):
    """订单状态非法 (已支付 / 已取消等)"""
    code = 50002


class InvalidInviteCodeError(BillingError):
    """邀请码非法 (不存在 / 自邀)"""
    code = 50003
