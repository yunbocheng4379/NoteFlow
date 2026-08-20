-- 将入门充值包调整为 1 分钱，用于支付宝小额联调。
-- 只影响后续新建订单；已有订单金额保存在 orders.amount_cents 中，不会被修改。
UPDATE recharge_packages
SET price_cents = 1,
    unit_price_text = '¥0.0001/电力'
WHERE code = 'PKG_BASIC';
