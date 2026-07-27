import request from '@/utils/request'

export interface KbConversation {
  id: number
  title: string | null
  provider_id: string | null
  model_name: string | null
  created_at: string
  updated_at: string
}

export interface KbSource {
  task_id: string
  title: string
  text: string
  source_type: string
}

export interface KbMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string | null
  sources?: KbSource[] | null
}

export interface KbIndexCoverage {
  total: number
  indexed: number
}

export const createConversation = async (): Promise<KbConversation> => {
  return await request.post('/kb/conversations')
}

export const listConversations = async (): Promise<KbConversation[]> => {
  return await request.get('/kb/conversations')
}

export const getConversationMessages = async (conversationId: number): Promise<KbMessage[]> => {
  return await request.get(`/kb/conversations/${conversationId}/messages`)
}

export const deleteConversation = async (conversationId: number): Promise<void> => {
  return await request.delete(`/kb/conversations/${conversationId}`)
}

export const getKbIndexStatus = async (): Promise<KbIndexCoverage> => {
  return await request.get('/kb/index_status')
}

/** SSE 流式事件 */
export type KbStreamEvent =
  | { type: 'sources'; sources: KbSource[] }
  | { type: 'reasoning'; content: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; message_id: number }
  | { type: 'error'; message: string }

/**
 * 知识库流式问答：与 services/chat.ts 的 askQuestionStream 相同的 fetch + SSE 解析模式，
 * 多一个 reasoning 事件类型。
 */
export const askKbStream = async (
  data: {
    conversation_id: number
    question: string
    provider_id: string
    model_name: string
    enable_thinking: boolean
  },
  handlers: {
    onSources?: (sources: KbSource[]) => void
    onReasoning?: (text: string) => void
    onDelta?: (text: string) => void
    onDone?: (messageId: number) => void
    onError?: (msg: string) => void
    signal?: AbortSignal
  }
): Promise<void> => {
  const baseURL = (import.meta.env.VITE_API_BASE_URL as string) || '/api'

  let token: string | null = null
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) token = JSON.parse(stored)?.state?.token ?? null
  } catch {
    // ignore
  }

  const resp = await fetch(`${baseURL.replace(/\/$/, '')}/kb/ask_stream`, {
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
    let evt: KbStreamEvent
    try {
      evt = JSON.parse(payload)
    } catch {
      return
    }
    if (evt.type === 'sources') handlers.onSources?.(evt.sources)
    else if (evt.type === 'reasoning') handlers.onReasoning?.(evt.content)
    else if (evt.type === 'delta') handlers.onDelta?.(evt.content)
    else if (evt.type === 'done') handlers.onDone?.(evt.message_id)
    else if (evt.type === 'error') handlers.onError?.(evt.message)
  }

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
