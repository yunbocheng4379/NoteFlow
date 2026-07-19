import request from '@/utils/request'

export interface Platform {
  platform_id: string
  name: string
  icon_url: string | null
  proxy_url: string
  is_enabled: boolean
  sort_order: number
  created_at: string | null
  updated_at: string | null
}

export interface PlatformUpdate {
  name?: string
  icon_url?: string | null
  proxy_url?: string  // ""=清空, undefined=不修改
  is_enabled?: boolean
  sort_order?: number
}

export const platformAPI = {
  list: () =>
    request.get<Platform[]>('/platforms'),

  create: (data: {
    platform_id: string
    name: string
    icon_url?: string | null
    proxy_url?: string | null
    is_enabled?: boolean
    sort_order?: number
  }) =>
    request.post<Platform>('/platforms', data),

  update: (platform_id: string, data: PlatformUpdate) =>
    request.put<Platform>(`/platforms/${platform_id}`, data),

  delete: (platform_id: string) =>
    request.delete<void>(`/platforms/${platform_id}`),
}
