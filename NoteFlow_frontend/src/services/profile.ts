import request from '@/utils/request'

export interface ProfileInfo {
  id: number
  username: string
  email: string
  phone: string | null
  avatar: string | null
  created_at: string | null
  last_login_at: string | null
  total_points: number
  used_points: number
  credits: number
  email_notify_enabled: boolean
  system_announce_enabled: boolean
}

export const profileApi = {
  getProfile: () => request.get<any, ProfileInfo>('/profile'),

  updateProfile: (data: { username: string }) =>
    request.put<any, { username: string }>('/profile', data),

  changePassword: (data: { old_password: string; new_password: string }) =>
    request.put<any, { message: string }>('/profile/password', data),

  updateNotifySetting: (data: {
    email_notify_enabled?: boolean
    system_announce_enabled?: boolean
  }) =>
    request.put<any, { email_notify_enabled: boolean; system_announce_enabled: boolean }>(
      '/profile/notify',
      data,
    ),

  uploadAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request.post<any, { avatar_url: string }>('/profile/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    })
  },
}
