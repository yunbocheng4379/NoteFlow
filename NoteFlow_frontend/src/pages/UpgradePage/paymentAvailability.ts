export type PaymentMethod = 'ALIPAY' | 'WECHAT'

export const WECHAT_UNAVAILABLE_MESSAGE = '微信支付暂不支持，功能即将上线，请先使用支付宝支付'

export function isPaymentMethodEnabled(method: PaymentMethod): boolean {
  return method === 'ALIPAY'
}

export function selectPaymentMethod(current: PaymentMethod, requested: PaymentMethod): PaymentMethod {
  return isPaymentMethodEnabled(requested) ? requested : current
}

export function canCreatePaymentOrder(method: PaymentMethod): boolean {
  return isPaymentMethodEnabled(method)
}
