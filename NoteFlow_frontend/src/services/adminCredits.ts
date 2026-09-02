import request from '@/utils/request'

export interface CreditOverviewSummary {
  total_users: number
  active_users: number
  current_balance: number
  total_consumed: number
  total_granted: number
  total_refunded: number
  total_adjusted: number
  users_with_usage: number
}

export interface CreditTrendPoint {
  date: string
  consumed: number
  granted: number
  adjusted: number
  refunded: number
}

export interface CreditOverview {
  summary: CreditOverviewSummary
  trend: CreditTrendPoint[]
  start_date: string
  end_date: string
}

export interface AdminCreditTransaction {
  id: number
  username: string
  email: string | null
  type: string
  type_label: string
  amount: number
  balance_after: number
  note: string | null
  related_task_id: string | null
  related_order_id: number | null
  related_subscription_id: number | null
  created_at: string | null
}

export interface AdminCreditTransactionList {
  list: AdminCreditTransaction[]
  total: number
  page: number
  page_size: number
  type_labels: Record<string, string>
}

export interface CreditAdjustmentResult {
  transaction_id: number
  user_id: number
  username: string
  delta: number
  credits: number
  note: string
}

export interface BatchCreditAdjustmentResult {
  affected: number
  total_delta: number
  items: CreditAdjustmentResult[]
}

export const adminCreditsApi = {
  overview: (params?: { start_date?: string; end_date?: string }) =>
    request.get<unknown, CreditOverview>('/admin/credits/overview', { params }),

  listTransactions: (params: {
    page?: number
    page_size?: number
    keyword?: string
    type?: string
    start_date?: string
    end_date?: string
  }) => request.get<unknown, AdminCreditTransactionList>('/admin/credits/transactions', { params }),

  adjust: (payload: { user_id: number; delta: number; note: string }) =>
    request.post<unknown, CreditAdjustmentResult>('/admin/credits/adjust', payload, { suppressToast: true }),

  batchAdjust: (payload: { user_ids: number[]; delta: number; note: string }) =>
    request.post<unknown, BatchCreditAdjustmentResult>('/admin/credits/batch-adjust', payload, { suppressToast: true }),
}
