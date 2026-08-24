import request from '@/utils/request'

export interface UserNotification {
  id: number
  category: string
  title: string
  content: string
  link: string | null
  severity: string
  is_read: boolean
  created_at: string | null
}

export interface UserNotificationList {
  items: UserNotification[]
  total: number
  page: number
  page_size: number
}

export const userNotificationsApi = {
  list: (params?: { page?: number; page_size?: number; unread_only?: boolean }) =>
    request.get<unknown, UserNotificationList>('/notifications', { params }),
  unreadCount: () => request.get<unknown, { unread: number }>('/notifications/unread_count'),
  markRead: (id: number) => request.patch<unknown, UserNotification>(`/notifications/${id}/read`),
  markAllRead: () => request.post<unknown, { updated: number }>('/notifications/read_all'),
}
