import request from '@/utils/request'
import { DISMISSED_UPDATE_LOG_SESSION_KEY } from '@/constant/updateLog'

// ============ 类型 ============

export type UpdateLogStatus = 'pending' | 'active' | 'ended'

export interface UpdateLogItem {
  id: number
  title: string
  version: string | null
  summary: string
  content: string
  status: UpdateLogStatus
  published_at: string | null
  ended_at: string | null
  created_by: number | null
  published_by: number | null
  created_at: string | null
  updated_at: string | null
}

export interface UpdateLogList {
  items: UpdateLogItem[]
  total: number
  page: number
  page_size: number
}

// ============ 用户 API ============

export const userUpdateLogApi = {
  /** 当前唯一一条 active 行, 用于顶部横幅. 没有则返回 null. */
  active: () => request.get<any, UpdateLogItem | null>('/update_logs/active'),
  /** 用户可见列表: active + ended. */
  list: (params?: { page?: number; page_size?: number }) =>
    request.get<any, UpdateLogList>('/update_logs', { params }),
  /** 单条详情; pending 行禁止访问. */
  detail: (id: number) => request.get<any, UpdateLogItem>(`/update_logs/${id}`),
}

// ============ 管理员 API ============

export interface CreateUpdateLogPayload {
  title: string
  summary: string
  content: string
  version?: string | null
}

export interface UpdateUpdateLogPayload {
  title?: string
  summary?: string
  content?: string
  version?: string | null
}

export const adminUpdateLogApi = {
  list: (params?: { status?: UpdateLogStatus; keyword?: string; page?: number; page_size?: number }) =>
    request.get<any, UpdateLogList>('/admin/update_logs', { params }),

  detail: (id: number) => request.get<any, UpdateLogItem>(`/admin/update_logs/${id}`),

  create: (payload: CreateUpdateLogPayload) =>
    request.post<any, UpdateLogItem>('/admin/update_logs', payload),

  update: (id: number, payload: UpdateUpdateLogPayload) =>
    request.patch<any, UpdateLogItem>(`/admin/update_logs/${id}`, payload),

  publish: (id: number) =>
    request.post<any, UpdateLogItem>(`/admin/update_logs/${id}/publish`),

  end: (id: number) =>
    request.post<any, UpdateLogItem>(`/admin/update_logs/${id}/end`),

  remove: (id: number) =>
    request.delete<any, { deleted: true }>(`/admin/update_logs/${id}`),
}

// 本次登录会话内"已关闭"过的 active update_log id 集合 key
export const DISMISSED_LOG_SESSION_KEY = DISMISSED_UPDATE_LOG_SESSION_KEY

/**
 * 退出登录时清空「已关闭」记录.
 *
 * sessionStorage 只在标签页关闭时才会清空, 同一标签页内退出重登不会重置 —
 * 必须在每个登出入口显式调用, 否则用户退出重新登录后仍然看不到管理员还没结束的通知.
 */
export function clearDismissedUpdateLogs() {
  try {
    sessionStorage.removeItem(DISMISSED_UPDATE_LOG_SESSION_KEY)
  } catch {
    /* 私密模式等场景可忽略 */
  }
}
