import request from '@/utils/request'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSource {
  text: string
  source_type: 'markdown' | 'transcript'
  section_title?: string
  start_time?: number
  end_time?: number
}

export interface AskResponse {
  answer: string
  sources: ChatSource[]
}

export type IndexStatus = 'idle' | 'indexing' | 'indexed' | 'failed'

export interface ChatStatusResponse {
  indexed: boolean
  status: IndexStatus
}

export const indexTask = async (taskId: string): Promise<void> => {
  return await request.post('/chat/index', { task_id: taskId })
}

export const askQuestion = async (data: {
  task_id: string
  question: string
  history: ChatMessage[]
  provider_id: string
  model_name: string
}): Promise<AskResponse> => {
  return await request.post('/chat/ask', data, { timeout: 60000 })
}

export const getChatStatus = async (taskId: string): Promise<ChatStatusResponse> => {
  return await request.get(`/chat/status?task_id=${taskId}`)
}

/** SSE 流式事件 */
export type ChatStreamEvent =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/**
 * 流式问答：通过 fetch 读取 text/event-stream，逐段回调。
 * 复用 request 的 baseURL 与 localStorage 中的鉴权 token。
 */
export const askQuestionStream = async (
  data: {
    task_id: string
    question: string
    history: ChatMessage[]
    provider_id: string
    model_name: string
  },
  handlers: {
    onSources?: (sources: ChatSource[]) => void
    onDelta?: (text: string) => void
    onDone?: () => void
    onError?: (msg: string) => void
    signal?: AbortSignal
  },
): Promise<void> => {
  const baseURL = (import.meta.env.VITE_API_BASE_URL as string) || '/api'

  let token: string | null = null
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) token = JSON.parse(stored)?.state?.token ?? null
  } catch {
    // ignore
  }

  const resp = await fetch(`${baseURL.replace(/\/$/, '')}/chat/ask_stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: handlers.signal,
  })

  if (!resp.ok || !resp.body) {
    handlers.onError?.(`请求失败（${resp.status}）`)
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    const line = raw.trim()
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    let evt: ChatStreamEvent
    try {
      evt = JSON.parse(payload)
    } catch {
      return
    }
    if (evt.type === 'sources') handlers.onSources?.(evt.sources)
    else if (evt.type === 'delta') handlers.onDelta?.(evt.content)
    else if (evt.type === 'done') handlers.onDone?.()
    else if (evt.type === 'error') handlers.onError?.(evt.message)
  }

  // SSE 事件以空行分隔，按 \n\n 切分缓冲区
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      chunk.split('\n').forEach(dispatch)
    }
  }
  if (buffer.trim()) buffer.split('\n').forEach(dispatch)
}
