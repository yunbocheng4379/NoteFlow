import request from '@/utils/request'

// ============ 类型 ============

export interface AdminSubscription {
  plan_code: string | null
  plan_name: string | null
  start_at: string | null
  end_at: string | null
  days_left: number
}

export interface AdminUser {
  id: number
  username: string
  email: string
  phone: string | null
  avatar: string | null
  is_active: number
  is_admin: number
  created_at: string | null
  last_login_at: string | null
  // 电力核心数据
  credits: number
  total_recharged: number
  total_consumed: number
  // 会员权益
  is_member: boolean
  subscription: AdminSubscription | null
}

export interface AdminUserList {
  list: AdminUser[]
  total: number
  page: number
  page_size: number
}

export interface CreateUserPayload {
  username: string
  email: string
  password: string
  is_admin?: boolean
  initial_credits?: number
}

export interface RechargeOverview {
  today: {
    order_count: number
    order_users: number
    paid_orders: number
    paid_users: number
    revenue_cents: number
  }
  total: {
    paid_orders: number
    paid_users: number
    revenue_cents: number
    credits: number
  }
  package_breakdown: RechargePackagePerformance[]
}

export interface RechargePackagePerformance {
  code: string
  name: string
  paid_orders: number
  paid_users: number
  revenue_cents: number
  credits: number
}

export interface AdminRechargeOrder {
  id: number
  order_no: string
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED'
  pay_method: string
  amount_cents: number
  credits_amount: number
  created_at: string | null
  paid_at: string | null
  user: {
    id: number
    username: string
    email: string | null
    phone: string | null
  }
  package: {
    code: string
    name: string
    is_one_time: boolean
  }
}

export interface AdminRechargeOrderList {
  list: AdminRechargeOrder[]
  total: number
  page: number
  page_size: number
}

// ============ API ============

export const adminApi = {
  listUsers: (page = 1, pageSize = 20, keyword?: string) =>
    request.get<any, AdminUserList>('/admin/users', {
      params: { page, page_size: pageSize, keyword: keyword || undefined },
    }),

  createUser: (payload: CreateUserPayload) =>
    request.post<any, AdminUser>('/admin/users', payload, { suppressToast: true }),

  deleteUser: (userId: number) =>
    request.delete<any, { deleted: number }>(`/admin/users/${userId}`),

  batchDeleteUsers: (userIds: number[]) =>
    request.post<any, { deleted: number; skipped: number[] }>('/admin/users/batch_delete', {
      user_ids: userIds,
    }),

  rechargeOverview: () =>
    request.get<any, RechargeOverview>('/admin/billing/overview'),

  listRechargeOrders: (params: {
    page?: number
    page_size?: number
    keyword?: string
    status?: string
    package_code?: string
  }) => request.get<any, AdminRechargeOrderList>('/admin/billing/recharges', { params }),
}

// ============ Cookie 池 ============

export interface PlatformCookieItem {
  id: number
  platform: string
  name: string
  cookie: string  // 明文 (管理员视图)
  remark: string | null
  cohort: string
  reserved_for_tier: string[]
  max_concurrent_uses: number
  in_use_count: number
  is_enabled: number
  is_marked_invalid: number
  weight: number
  failure_count: number
  success_count: number
  usage_count: number
  last_used_at: string | null
  last_failure_at: string | null
  configured_by: number | null
  created_at: string | null
  updated_at: string | null
}

export interface PlatformCookieList {
  items: PlatformCookieItem[]
  total: number
  page: number
  page_size: number
}

export interface PlatformCookieSummary {
  [platform: string]: {
    total: number
    enabled: number
    available: number
    invalid: number
  }
}

export interface CreatePlatformCookiePayload {
  platform: string
  name: string
  cookie: string
  weight?: number
  remark?: string
  cohort?: string
  reserved_for_tier?: string[]
  max_concurrent_uses?: number
}

export interface ImportPlatformCookiesPayload {
  platform: string
  items: {
    name: string
    cookie: string
    weight?: number
    remark?: string
    cohort?: string
    reserved_for_tier?: string[]
    max_concurrent_uses?: number
  }[]
}

export interface UpdatePlatformCookiePayload {
  name?: string
  remark?: string | null
  is_enabled?: boolean
  weight?: number
  cohort?: string
  reserved_for_tier?: string[]
  max_concurrent_uses?: number
}

export const cookiesApi = {
  list: (params: {
    platform?: string
    include_invalid?: boolean
    page?: number
    page_size?: number
    keyword?: string
    cohort?: string
  }) =>
    request.get<any, PlatformCookieList>('/admin/cookies', { params }),

  summary: () =>
    request.get<any, PlatformCookieSummary>('/admin/cookies/summary'),

  create: (payload: CreatePlatformCookiePayload) =>
    request.post<any, PlatformCookieItem>('/admin/cookies', payload),

  importBulk: (payload: ImportPlatformCookiesPayload) =>
    request.post<any, { requested: number; inserted: number }>(
      '/admin/cookies/import',
      payload
    ),

  update: (id: number, payload: UpdatePlatformCookiePayload) =>
    request.patch<any, PlatformCookieItem>(`/admin/cookies/${id}`, payload),

  reset: (id: number) =>
    request.post<any, { reset: true }>(`/admin/cookies/${id}/reset`),

  remove: (id: number) =>
    request.delete<any, { deleted: true }>(`/admin/cookies/${id}`),

  reload: () =>
    request.post<any, { reloaded: true }>('/admin/cookies/reload'),
}

// ============ 通知 ============

export type NotificationCategory =
  | 'cookie_failure'
  | 'pool_exhausted'
  | 'smtp_health'
  | 'note_style_review'

export type NotificationStatus = 'pending' | 'handled' | 'closed' | 'ignored'

export interface NotificationItem {
  id: number
  category: NotificationCategory
  severity: 'info' | 'warning' | 'error'
  title: string
  content: string
  source_type: string | null
  source_id: string | null
  platform: string | null
  status: NotificationStatus
  dedup_key: string
  first_seen_at: string | null
  last_seen_at: string | null
  occurrence_count: number
  handled_by: number | null
  handled_at: string | null
  handler_note: string | null
  created_at: string | null
  updated_at: string | null
}

export interface NotificationList {
  items: NotificationItem[]
  total: number
  page: number
  page_size: number
}

export interface NotificationSummary {
  total: number
  pending: number
  handled: number
  closed: number
  ignored: number
}

export const notificationsApi = {
  list: (params: {
    status?: NotificationStatus
    category?: NotificationCategory
    platform?: string
    keyword?: string
    page?: number
    page_size?: number
  }) => request.get<any, NotificationList>('/admin/notifications', { params }),

  summary: () =>
    request.get<any, NotificationSummary>('/admin/notifications/summary'),

  unreadCount: () =>
    request.get<any, { unread: number }>('/admin/notifications/unread_count'),

  get: (id: number) =>
    request.get<any, NotificationItem>(`/admin/notifications/${id}`),

  update: (
    id: number,
    payload: { status: NotificationStatus; handler_note?: string | null }
  ) =>
    request.patch<any, NotificationItem>(`/admin/notifications/${id}`, payload),
}

// ============ 数据分析 ============

export interface AnalyticsDateParams {
  start_date: string
  end_date: string
}

export interface AnalyticsOverview {
  start_date: string
  end_date: string
  pv: number
  uv: number
  logged_in_uv: number
  anonymous_uv: number
  active_users: number
  feature_events: number
  feature_success: number
  feature_error: number
  feature_success_rate: number
}

export interface AnalyticsTrendPoint {
  date: string
  pv: number
  uv: number
  logged_in_uv: number
  anonymous_uv: number
}

export interface AnalyticsFeature {
  feature: string
  clicks: number
  submits: number
  successes: number
  errors: number
  users: number
  usage_rate: number
  success_rate: number
}

export interface AnalyticsUser {
  user_id: number
  username: string
  email: string | null
  pv: number
  active_days: number
  feature_count: number
  last_seen_at: string | null
}

export interface AnalyticsEventItem {
  id: number
  event_name: string
  page_path: string
  target: string | null
  user_type: '登录用户' | '匿名访客'
  username: string | null
  properties: Record<string, string | number | boolean | null>
  occurred_at: string | null
}

export interface AnalyticsPage<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}

export const analyticsAdminApi = {
  overview: (params: AnalyticsDateParams) =>
    request.get<any, AnalyticsOverview>('/admin/analytics/overview', { params }),
  trend: (params: AnalyticsDateParams) =>
    request.get<any, AnalyticsTrendPoint[]>('/admin/analytics/trend', { params }),
  features: (params: AnalyticsDateParams) =>
    request.get<any, AnalyticsFeature[]>('/admin/analytics/features', { params }),
  users: (params: AnalyticsDateParams & { page?: number; page_size?: number }) =>
    request.get<any, AnalyticsPage<AnalyticsUser>>('/admin/analytics/users', { params }),
  events: (params: AnalyticsDateParams & { page?: number; page_size?: number }) =>
    request.get<any, AnalyticsPage<AnalyticsEventItem>>('/admin/analytics/events', { params }),
}
