export interface AssistantSource {
  title: string
  section_title?: string
  text: string
  source_type: 'product_doc'
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: AssistantSource[]
}

export const getLatestUserQuestion = (messages: AssistantMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index].content
  }
  return ''
}

export type AssistantStreamEvent =
  | { type: 'sources'; sources: AssistantSource[] }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export const parseAssistantSseEvent = (raw: string): AssistantStreamEvent | null => {
  const line = raw.trim()
  if (!line.startsWith('data:')) return null

  const payload = line.slice(5).trim()
  if (!payload) return null

  try {
    return JSON.parse(payload) as AssistantStreamEvent
  } catch {
    return null
  }
}

const getToken = (): string | null => {
  try {
    const stored = localStorage.getItem('noteflow-user')
    return stored ? JSON.parse(stored)?.state?.token ?? null : null
  } catch {
    return null
  }
}

export const askAssistantStream = async (
  data: { question: string; history: AssistantMessage[] },
  handlers: {
    onSources?: (sources: AssistantSource[]) => void
    onDelta?: (text: string) => void
    onDone?: () => void
    onError?: (message: string) => void
    signal?: AbortSignal
  },
): Promise<void> => {
  const baseURL = ((import.meta.env.VITE_API_BASE_URL as string) || '/api').replace(/\/$/, '')
  const response = await fetch(`${baseURL}/assistant/ask_stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify(data),
    signal: handlers.signal,
  })

  if (!response.ok || !response.body) {
    const message = `请求失败（${response.status}）`
    handlers.onError?.(message)
    throw new Error(message)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (raw: string) => {
    const event = parseAssistantSseEvent(raw)
    if (!event) return
    if (event.type === 'sources') handlers.onSources?.(event.sources)
    else if (event.type === 'delta') handlers.onDelta?.(event.content)
    else if (event.type === 'done') handlers.onDone?.()
    else if (event.type === 'error') handlers.onError?.(event.message)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      dispatch(buffer.slice(0, separatorIndex))
      buffer = buffer.slice(separatorIndex + 2)
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) dispatch(buffer)
}
