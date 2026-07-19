import request from '@/utils/request'

export interface NoteStyle {
  id: number
  name: string
  value: string
  description: string | null
  prompt: string
  source: 'system' | 'user'
  user_id: number | null
  is_public: boolean
  icon: string | null
  created_at: string | null
}

export interface CreateStyleParams {
  name: string
  value: string
  description?: string
  prompt: string
  is_public?: boolean
  icon?: string
}

export interface UpdateStyleParams {
  name?: string
  description?: string
  prompt?: string
  is_public?: boolean
  icon?: string
}

export const noteStyleApi = {
  list: (params?: { category?: string; keyword?: string }) =>
    request.get<any, NoteStyle[]>('/note_styles', { params }),

  create: (data: CreateStyleParams) =>
    request.post<any, NoteStyle>('/note_styles', data),

  update: (id: number, data: UpdateStyleParams) =>
    request.put<any, NoteStyle>(`/note_styles/${id}`, data),

  remove: (id: number) =>
    request.delete<any, null>(`/note_styles/${id}`),

  togglePublic: (id: number, is_public: boolean) =>
    request.patch<any, NoteStyle>(`/note_styles/${id}/public`, null, {
      params: { is_public },
    }),
}
