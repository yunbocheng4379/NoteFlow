import request from '@/utils/request'

export interface ModerationStyle {
  id: number
  name: string
  value: string
  description: string | null
  prompt: string
  source: 'user'
  user_id: number | null
  is_public: boolean
  moderation_status: string
  published_version_id: number | null
  pending_version_id: number | null
  review_reason: string | null
  version_id?: number
  version_no?: number
  version_status?: string
  ai_status?: string | null
  ai_risk_level?: string | null
  ai_categories?: string[] | string | null
  ai_summary?: string | null
  ai_recommendations?: string[] | string | null
  owner?: { id: number; username: string; email: string | null } | null
  versions?: Array<Record<string, unknown>>
  reviews?: Array<Record<string, unknown>>
}

export interface ModerationList {
  items: ModerationStyle[]
  total: number
  page: number
  page_size: number
}

export const noteStyleModerationApi = {
  list: (params?: { status?: string; keyword?: string; page?: number; page_size?: number }) =>
    request.get<unknown, ModerationList>('/admin/note_styles', { params }),
  summary: () => request.get<unknown, { pending_review: number }>('/admin/note_styles/summary'),
  detail: (id: number) => request.get<unknown, ModerationStyle>(`/admin/note_styles/${id}`),
  approve: (id: number) => request.post<unknown, ModerationStyle>(`/admin/note_styles/${id}/approve`),
  reject: (id: number, reason: string) =>
    request.post<unknown, ModerationStyle>(`/admin/note_styles/${id}/reject`, { reason }),
  unpublish: (id: number, reason: string) =>
    request.post<unknown, ModerationStyle>(`/admin/note_styles/${id}/unpublish`, { reason }),
  republish: (id: number) => request.post<unknown, ModerationStyle>(`/admin/note_styles/${id}/republish`),
}
