import request from '@/utils/request'

export interface NoteCollection {
  id: number
  name: string
  description: string | null
  cover_url: string | null
  note_count: number
  created_at: string | null
  updated_at: string | null
}

export interface CollectionNoteItem {
  task_id: string
  video_id: string
  platform: string
  video_url: string
  model_name: string
  created_at: string
  completed_at: string
  status: string
  title: string
  cover_url: string
  duration: number
}

export const listCollections = (keyword?: string): Promise<NoteCollection[]> =>
  request.get('/collections', { params: keyword ? { keyword } : undefined })

export const getCollection = (id: number): Promise<NoteCollection> => request.get(`/collections/${id}`)

export const createCollection = (data: { name: string; description?: string }): Promise<NoteCollection> =>
  request.post('/collections', data)

export const updateCollection = (
  id: number,
  data: { name?: string; description?: string },
): Promise<NoteCollection> => request.put(`/collections/${id}`, data)

export const deleteCollection = (id: number): Promise<void> => request.delete(`/collections/${id}`)

export const uploadCollectionCover = (id: number, file: File): Promise<NoteCollection> => {
  const form = new FormData()
  form.append('file', file)
  return request.post(`/collections/${id}/cover`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  })
}

export const listCollectionItems = (id: number): Promise<CollectionNoteItem[]> =>
  request.get(`/collections/${id}/items`)

export const addCollectionItems = (
  id: number,
  task_ids: string[],
): Promise<{ added: number; note_count: number }> =>
  request.post(`/collections/${id}/items`, { task_ids })

export const removeCollectionItems = (
  id: number,
  task_ids: string[],
): Promise<{ removed: number; note_count: number }> =>
  request.delete(`/collections/${id}/items`, { data: { task_ids } })

const downloadBlob = async (path: string, filename: string): Promise<void> => {
  const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
  let token: string | null = null
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) token = JSON.parse(stored)?.state?.token ?? null
  } catch {
    // ignore
  }

  const axios = (await import('axios')).default
  const response = await axios.get(`${baseURL}${path}`, {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 60000,
  })

  const blob = new Blob([response.data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const exportCollectionZip = (id: number, name: string): Promise<void> =>
  downloadBlob(`/collections/${id}/export_zip`, `${name}.zip`)

export const exportCollectionObsidian = (id: number, name: string): Promise<void> =>
  downloadBlob(`/collections/${id}/export_obsidian`, `${name}_obsidian.zip`)

export interface MergeResult {
  task_id: string
}

export const mergeCollectionNotes = (
  id: number,
  task_ids: string[],
  provider_id: string,
  model_name: string,
): Promise<MergeResult> => request.post(`/collections/${id}/merge`, { task_ids, provider_id, model_name })
