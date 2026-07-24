import request from '@/utils/request'

export interface FlashcardItem {
  question: string
  answer: string
}

export interface FlashcardSetSummary {
  id: number
  title: string | null
  card_count: number
  created_at: string | null
}

export interface FlashcardSetDetail {
  id: number
  title: string | null
  task_id: string
  card_count: number
  cards: FlashcardItem[]
}

export interface GenerateFlashcardsResult {
  set_id: number
  title: string | null
  card_count: number
  cards: FlashcardItem[]
}

export const generateFlashcards = (data: {
  task_id: string
  provider_id: string
  model_name: string
  custom_prompt?: string
  card_count: number
}): Promise<GenerateFlashcardsResult> => request.post('/flashcards/generate', data)

export const getFlashcardSets = (taskId: string): Promise<FlashcardSetSummary[]> =>
  request.get(`/flashcards/sets/${taskId}`)

export const getFlashcardSet = (setId: number): Promise<FlashcardSetDetail> =>
  request.get(`/flashcards/set/${setId}`)

export const deleteFlashcardSet = (setId: number): Promise<void> =>
  request.delete(`/flashcards/set/${setId}`)

export const exportFlashcardsCsv = async (setId: number, filename: string): Promise<void> => {
  const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
  let token: string | null = null
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) token = JSON.parse(stored)?.state?.token ?? null
  } catch {
    // ignore
  }

  const axios = (await import('axios')).default
  const response = await axios.get(`${baseURL}/flashcards/set/${setId}/export_csv`, {
    responseType: 'blob',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000,
  })

  const blob = new Blob([response.data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
