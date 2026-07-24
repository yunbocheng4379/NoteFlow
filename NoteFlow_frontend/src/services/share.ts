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
