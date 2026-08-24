export type KnowledgeBasePanelState = 'empty' | 'messages' | 'loading'

export function getKnowledgeBasePanelState({
  messageCount,
  questionLoading,
  messagesLoading,
}: {
  messageCount: number
  questionLoading: boolean
  messagesLoading: boolean
}): KnowledgeBasePanelState {
  if (messagesLoading) return 'loading'
  return messageCount === 0 && !questionLoading ? 'empty' : 'messages'
}
