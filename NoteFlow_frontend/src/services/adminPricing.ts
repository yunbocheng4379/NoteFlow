import request from '@/utils/request'

// ============ 类型 ============

export interface ModelRate {
  id: number
  model_name: string
  rate_per_minute: number
  is_active: boolean
  is_default: boolean
  description: string | null
  created_at: string | null
  updated_at: string | null
}

export interface FormatRate {
  id: number
  format_key: string
  rate_per_minute: number
  is_active: boolean
  description: string | null
  created_at: string | null
  updated_at: string | null
}

// ============ API ============

export const pricingApi = {
  listModelRates: () =>
    request.get<any, ModelRate[]>('/admin/pricing/model'),

  upsertModelRate: (payload: {
    model_name: string
    rate_per_minute: number
    is_active?: boolean
    is_default?: boolean
    description?: string | null
  }) => request.post<any, ModelRate>('/admin/pricing/model', payload),

  updateModelRate: (
    modelName: string,
    payload: Partial<Pick<ModelRate, 'rate_per_minute' | 'is_active' | 'is_default' | 'description'>>
  ) => request.patch<any, ModelRate>(`/admin/pricing/model/${modelName}`, payload),

  deleteModelRate: (modelName: string) =>
    request.delete<any, { deleted: string }>(`/admin/pricing/model/${modelName}`),

  listFormatRates: () =>
    request.get<any, FormatRate[]>('/admin/pricing/format'),

  upsertFormatRate: (payload: {
    format_key: string
    rate_per_minute: number
    is_active?: boolean
    description?: string | null
  }) => request.post<any, FormatRate>('/admin/pricing/format', payload),

  updateFormatRate: (
    formatKey: string,
    payload: Partial<Pick<FormatRate, 'rate_per_minute' | 'is_active' | 'description'>>
  ) => request.patch<any, FormatRate>(`/admin/pricing/format/${formatKey}`, payload),

  deleteFormatRate: (formatKey: string) =>
    request.delete<any, { deleted: string }>(`/admin/pricing/format/${formatKey}`),
}
