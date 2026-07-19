import request from '@/utils/request'

// ============ 类型定义 ============

export interface ActiveSubscription {
  plan_code: string
  plan_name: string
  start_at: string
  end_at: string
  days_left: number
  monthly_credits: number
}

export interface BalanceResp {
  credits: number
  used_points: number
  active_subscription: ActiveSubscription | null
}

export interface RechargePackage {
  id: number
  code: string
  name: string
  price_cents: number
  credits: number
  unit_price_text: string | null
  sort_order: number
  badge: string | null
  description: string | null
}

export interface SubscriptionPlan {
  id: number
  code: string
  name: string
  duration_days: number
  monthly_credits: number
  first_price_cents: number
  renewal_price_cents: number
  original_price_cents: number | null
  current_price_cents: number
  is_first_subscription: boolean
  sort_order: number
  badge: string | null
  description: string | null
}

export interface Order {
  id: number
  order_no: string
  kind: 'RECHARGE' | 'SUBSCRIPTION'
  package_id: number | null
  plan_id: number | null
  amount_cents: number
  credits_amount: number
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED'
  pay_method: string
  mock_qrcode_token: string | null
  is_first_subscription: boolean
  paid_at: string | null
  cancelled_at: string | null
  created_at: string
}

export interface CreditTransaction {
  id: number
  type: string
  amount: number
  balance_after: number
  related_task_id: string | null
  related_order_id: number | null
  note: string | null
  created_at: string
}

export interface ReferralStats {
  referral_code: string
  invited_count: number
  total_rewards_credits: number
}

export interface InvitedUser {
  invitee_id: number
  invitee_masked: string
  registered_at: string
  has_first_subscription: boolean
  reward_credits: number
}

export interface ReferralReward {
  id: number
  reward_type: 'REGISTER' | 'FIRST_SUBSCRIPTION'
  inviter_credits: number
  invitee_user_id: number
  trigger_order_id: number | null
  paid_at: string
}

export interface PricingPreview {
  model_name: string | null
  duration_sec: number | null
  model_rate_per_minute: number
  required_credits: number
  current_balance: number
  sufficient: boolean
}

export interface Paginated<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}

// ============ API ============

export const billingApi = {
  balance: () => request.get<any, BalanceResp>('/billing/balance'),

  pricingPreview: (model_name: string, duration_sec: number) =>
    request.post<any, PricingPreview>('/billing/pricing/preview', { model_name, duration_sec }),

  rechargePackages: () => request.get<any, RechargePackage[]>('/billing/recharge/packages'),

  subscriptionPlans: () => request.get<any, SubscriptionPlan[]>('/billing/subscription/plans'),

  createRechargeOrder: (package_id: number, pay_method: string = 'MOCK_ALIPAY') =>
    request.post<any, Order>('/billing/order/recharge', { package_id, pay_method }),

  createSubscriptionOrder: (plan_id: number, pay_method: string = 'MOCK_ALIPAY') =>
    request.post<any, Order>('/billing/order/subscription', { plan_id, pay_method }),

  mockPay: (order_no: string, mock_qrcode_token: string) =>
    request.post<any, Order>('/billing/order/mock_pay', { order_no, mock_qrcode_token }),

  getOrder: (order_no: string) => request.get<any, Order>(`/billing/order/${order_no}`),

  listOrders: (page: number = 1, page_size: number = 20) =>
    request.get<any, Paginated<Order>>('/billing/orders', { params: { page, page_size } }),

  listTransactions: (page: number = 1, page_size: number = 20) =>
    request.get<any, Paginated<CreditTransaction>>('/billing/transactions', {
      params: { page, page_size },
    }),

  referralMe: () => request.get<any, ReferralStats>('/billing/referral/me'),

  referralInvited: (page: number = 1, page_size: number = 20) =>
    request.get<any, Paginated<InvitedUser>>('/billing/referral/invited', {
      params: { page, page_size },
    }),

  referralRewards: (page: number = 1, page_size: number = 20) =>
    request.get<any, Paginated<ReferralReward>>('/billing/referral/rewards', {
      params: { page, page_size },
    }),
}

// ============ 工具 ============

export function formatYuan(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

export const TX_TYPE_LABEL: Record<string, string> = {
  RECHARGE: '充值',
  CONSUME: '生成笔记',
  REFUND: '任务退费',
  MONTHLY_GRANT: '会员发放',
  REGISTER_GRANT: '注册赠送',
  REGISTER_INVITEE: '注册邀请奖励',
  REGISTER_INVITER: '邀请注册返点',
  FIRST_SUB_INVITER: '邀请订阅返点',
  ADMIN_ADJUST: '管理员调整',
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付',
  PAID: '已支付',
  CANCELLED: '已取消',
  REFUNDED: '已退款',
}
