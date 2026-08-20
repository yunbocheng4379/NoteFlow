const SUPPORT_PHRASES = [
  '联系客服',
  '人工客服',
  '转人工',
  '人工服务',
  '售后',
  '技术支持',
  '退款',
  '支付问题',
  '付款问题',
  '支付失败',
  '充值问题',
  '订单问题',
  '账号问题',
  '客服',
  'customer service',
  'human support',
]

export function isCustomerSupportQuestion(question: string): boolean {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) return false
  if (SUPPORT_PHRASES.some(phrase => normalized.includes(phrase))) return true
  return normalized.includes('人工') && !normalized.includes('人工智能')
}

export function getCustomerSupportReply(question: string, qrUrl: string): string | null {
  if (!isCustomerSupportQuestion(question)) return null
  return [
    '可以的，我来帮你联系人工客服。请扫描下面的二维码，备注你的账号和问题：',
    '',
    `![联系客服二维码](${qrUrl})`,
  ].join('\n')
}
