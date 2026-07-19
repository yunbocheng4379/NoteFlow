import request from '@/utils/request'

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
