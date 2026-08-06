import axios from 'axios'
import request from '@/utils/request'

export type ShareExportFormat = 'md' | 'pdf' | 'html' | 'docx' | 'png'

const EXT_MAP: Record<ShareExportFormat, string> = {
  md: '.md',
  pdf: '.pdf',
  html: '.html',
  docx: '.docx',
  png: '.png',
}

const downloadBlob = (data: BlobPart, filename: string) => {
  const blob = new Blob([data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ShareStatus {
  is_active: boolean
  share_token: string | null
  view_count: number
}

export interface SharedNote {
  task_id: string
  share_token: string
  view_count: number
  note: {
    markdown: any
    transcript: any
    audio_meta: any
  }
}

export const getShareStatus = async (taskId: string): Promise<ShareStatus> => {
  const res = await request.get(`/share/status/${taskId}`)
  return res as unknown as ShareStatus
}

export const enableShare = async (taskId: string): Promise<ShareStatus> => {
  const res = await request.post(`/share/enable/${taskId}`)
  return res as unknown as ShareStatus
}

export const disableShare = async (taskId: string): Promise<void> => {
  await request.post(`/share/disable/${taskId}`)
}

export const getSharedNote = async (token: string): Promise<SharedNote> => {
  const res = await request.get(`/share/view/${token}`)
  return res as unknown as SharedNote
}

export interface SharedCollection {
  collection: {
    id: number
    name: string
    description: string | null
    cover_url: string | null
  }
  share_token: string
  view_count: number
  notes: Array<{
    task_id: string
    note: {
      markdown: any
      transcript: any
      audio_meta: any
    }
  }>
}

export const getCollectionShareStatus = async (collectionId: number): Promise<ShareStatus> => {
  const res = await request.get(`/share/collection_status/${collectionId}`)
  return res as unknown as ShareStatus
}

export const enableCollectionShare = async (collectionId: number): Promise<ShareStatus> => {
  const res = await request.post(`/share/collection_enable/${collectionId}`)
  return res as unknown as ShareStatus
}

export const disableCollectionShare = async (collectionId: number): Promise<void> => {
  await request.post(`/share/collection_disable/${collectionId}`)
}

export const getSharedCollection = async (token: string): Promise<SharedCollection> => {
  const res = await request.get(`/share/collection_view/${token}`)
  return res as unknown as SharedCollection
}

export const exportSharedNote = async (
  token: string,
  format: ShareExportFormat,
  filename: string,
): Promise<void> => {
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const response = await axios.post(
    `${baseURL}/share/export/${token}`,
    { format },
    { responseType: 'blob', timeout: 60000 },
  )
  downloadBlob(response.data, `${filename}${EXT_MAP[format]}`)
}

export const exportSharedCollectionNote = async (
  token: string,
  taskId: string,
  format: ShareExportFormat,
  filename: string,
): Promise<void> => {
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const response = await axios.post(
    `${baseURL}/share/collection_export/${token}/${taskId}`,
    { format },
    { responseType: 'blob', timeout: 60000 },
  )
  downloadBlob(response.data, `${filename}${EXT_MAP[format]}`)
}
