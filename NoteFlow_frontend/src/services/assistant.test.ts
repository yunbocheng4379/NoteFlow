import type { AssistantStreamEvent } from './assistant'
import { getLatestUserQuestion, parseAssistantSseEvent } from './assistant'

export function assistantSseParserContract(): AssistantStreamEvent | null {
  const source = parseAssistantSseEvent(
    'data: {"type":"sources","sources":[]}\n\n',
  )
  if (source?.type !== 'sources') throw new Error('sources event was not parsed')

  const delta = parseAssistantSseEvent('data: {"type":"delta","content":"你好"}')
  if (delta?.type !== 'delta' || delta.content !== '你好') {
    throw new Error('delta event was not parsed')
  }

  return parseAssistantSseEvent('data: {"type":"done"}')
}

export function assistantLastQuestionContract(): string {
  const question = getLatestUserQuestion([
    { role: 'user', content: '第一条问题' },
    { role: 'assistant', content: '第一条回答' },
    { role: 'user', content: '最近一条问题' },
  ])
  if (question !== '最近一条问题') throw new Error('latest user question was not selected')

  if (getLatestUserQuestion([{ role: 'assistant', content: '只有回答' }]) !== '') {
    throw new Error('missing user question should return an empty string')
  }

  return question
}
