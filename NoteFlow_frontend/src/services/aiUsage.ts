import axios from 'axios'
import request from '@/utils/request'

export interface AiUsageFilters {
  start_date?: string
  end_date?: string
  user_id?: number
  scene?: string
  provider_id?: string
  model_name?: string
  key_fingerprint?: string
  status?: string
  keyword?: string
}

export interface AiUsageOverview {
  calls: number
  attempts: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  failed_calls: number
  failure_rate: number
  average_latency_ms: number
  unpriced_attempts: number
  start_date: string
  end_date: string
}

export interface AiUsageTrendPoint {
  date: string
  calls: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  failed_calls: number
}

export interface AiUsageGroup {
  user_id?: number | null
  user_snapshot?: string | null
  provider_name?: string
  model_name?: string
  key_masked?: string | null
  scene?: string
  calls: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  failed_calls: number
  failure_rate: number
}

export interface AiUsageLog {
  id: number
  request_id: string
  trace_id: string
  parent_log_id: number | null
  user_id: number | null
  user_snapshot: string | null
  scene: string
  operation: string
  resource_type: string | null
  resource_id: string | null
  provider_name: string
  model_name: string
  key_alias: string | null
  key_fingerprint: string | null
  key_masked: string | null
  request_mode: string
  attempt_no: number
  status: string
  error_type: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  token_source: string
  input_price_per_million: number | null
  output_price_per_million: number | null
  currency: string
  estimated_cost: number | null
  prompt_content: string | null
  response_content: string | null
  prompt_sha256: string | null
  response_sha256: string | null
  metadata_json: string | null
}

export interface AiUsageLogPage {
  items: AiUsageLog[]
  total: number
  page: number
  page_size: number
}

export interface AiModelPricing {
  id: number
  provider_id: string | null
  provider_name: string
  model_name: string
  input_price_per_million: number
  output_price_per_million: number
  currency: string
  effective_from: string
  effective_to: string | null
  is_active: boolean
  note: string | null
  created_by: number | null
}

const withPage = (filters: AiUsageFilters, page = 1, pageSize = 20) => ({
  ...filters,
  page,
  page_size: pageSize,
})

export const aiUsageApi = {
  overview: (filters: AiUsageFilters) => request.get<unknown, AiUsageOverview>('/admin/ai-usage/overview', { params: filters }),
  trend: (filters: AiUsageFilters) => request.get<unknown, AiUsageTrendPoint[]>('/admin/ai-usage/trend', { params: filters }),
  byUser: (filters: AiUsageFilters, page = 1) => request.get<unknown, { items: AiUsageGroup[]; total: number }>('/admin/ai-usage/by-user', { params: withPage(filters, page, 8) }),
  byModel: (filters: AiUsageFilters) => request.get<unknown, AiUsageGroup[]>('/admin/ai-usage/by-model', { params: filters }),
  byScene: (filters: AiUsageFilters) => request.get<unknown, AiUsageGroup[]>('/admin/ai-usage/by-scene', { params: filters }),
  logs: (filters: AiUsageFilters, page = 1, pageSize = 12) => request.get<unknown, AiUsageLogPage>('/admin/ai-usage/logs', { params: withPage(filters, page, pageSize) }),
  detail: (id: number) => request.get<unknown, { log: AiUsageLog; trace: AiUsageLog[] }>(`/admin/ai-usage/logs/${id}`),
  pricing: () => request.get<unknown, AiModelPricing[]>('/admin/ai-usage/pricing'),
  createPricing: (data: Omit<AiModelPricing, 'id' | 'created_by'>) => request.post<unknown, AiModelPricing>('/admin/ai-usage/pricing', data),
  patchPricing: (id: number, data: Partial<AiModelPricing>) => request.patch<unknown, AiModelPricing>(`/admin/ai-usage/pricing/${id}`, data),
  export: async (filters: AiUsageFilters) => {
    const stored = localStorage.getItem('noteflow-user')
    const token = stored ? JSON.parse(stored).state?.token : undefined
    const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
    const response = await axios.get(`${baseURL}/admin/ai-usage/export`, {
      params: filters,
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ai_usage_logs.csv'
    link.click()
    URL.revokeObjectURL(url)
  },
}
