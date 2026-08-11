import type { AssistantStreamEvent } from './assistant'
import { parseAssistantSseEvent } from './assistant'

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
