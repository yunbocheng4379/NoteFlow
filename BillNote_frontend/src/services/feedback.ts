import request from '@/utils/request'

export type FeedbackStatus = 'pending' | 'processing' | 'done' | 'stalled'
export type FeedbackCategory = 'bug' | 'feature' | 'ui' | 'perf' | 'other'

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: '未处理',
  processing: '处理中',
  done: '已完成',
  stalled: '已停滞',
}

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '功能异常 / Bug',
  feature: '功能建议',
  ui: '界面问题',
  perf: '性能问题',
  other: '其他',
}

export interface FeedbackItem {
  id: number
  user_id: number | null
  category: FeedbackCategory
  title: string | null
  content: string
  contact: string | null
  status: FeedbackStatus
  admin_note: string | null
  handled_by: number | null
  handled_at: string | null
  created_at: string
  updated_at: string
}

export interface FeedbackListResp {
  items: FeedbackItem[]
  total: number
  page: number
  page_size: number
}

export interface FeedbackStats {
  total: number
  pending: number
  processing: number
  done: number
  stalled: number
}

export interface SubmitFeedbackParams {
  category: FeedbackCategory
  content: string
  title?: string
  contact?: string
}

export const submitFeedback = (params: SubmitFeedbackParams) =>
  request.post<any, { id: number; status: FeedbackStatus }>('/feedback/submit', params)

export const listFeedbacks = (params: {
  status?: FeedbackStatus
  category?: FeedbackCategory
  keyword?: string
  page?: number
  page_size?: number
}) => request.get<any, FeedbackListResp>('/feedback/list', { params })

export const getFeedbackStats = () =>
  request.get<any, FeedbackStats>('/feedback/stats')

export const getFeedback = (id: number) =>
  request.get<any, FeedbackItem>(`/feedback/${id}`)

export const updateFeedbackStatus = (
  id: number,
  body: { status: FeedbackStatus; admin_note?: string | null },
) => request.post<any, FeedbackItem>(`/feedback/${id}/status`, body)

export const deleteFeedback = (id: number) =>
  request.delete<any, { deleted: true }>(`/feedback/${id}`)

export const batchDeleteFeedbacks = (ids: number[]) =>
  request.post<any, { deleted: number }>('/feedback/batch_delete', { ids })
