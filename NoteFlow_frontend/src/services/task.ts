import request from '@/utils/request'

export interface TaskSummary {
  task_id: string
  video_id: string
  platform: string
  video_url: string
  model_name: string
  credits_used: number
  created_at: string
  completed_at: string
  status: 'PENDING' | 'PARSING' | 'DOWNLOADING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'FORMATTING' | 'SAVING' | 'SUCCESS' | 'FAILED'
  title: string
  cover_url: string
  duration: number
  batch_id?: string | null
}

export const getTasks = async (): Promise<TaskSummary[]> => {
  const data = await request.get<any, TaskSummary[]>('/tasks')
  return Array.isArray(data) ? data : []
}

export const deleteTask = async (taskId: string): Promise<void> => {
  await request.delete(`/tasks/${taskId}`)
}
