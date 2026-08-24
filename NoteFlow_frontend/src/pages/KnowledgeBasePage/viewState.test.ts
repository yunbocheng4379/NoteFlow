import { strict as assert } from 'node:assert'
import { getKnowledgeBasePanelState } from './viewState.ts'

export function knowledgeBaseConversationSwitchContract() {
  assert.equal(
    getKnowledgeBasePanelState({ messageCount: 0, questionLoading: false, messagesLoading: true }),
    'loading',
  )
  assert.equal(
    getKnowledgeBasePanelState({ messageCount: 0, questionLoading: false, messagesLoading: false }),
    'empty',
  )
  assert.equal(
    getKnowledgeBasePanelState({ messageCount: 2, questionLoading: false, messagesLoading: false }),
    'messages',
  )
}

knowledgeBaseConversationSwitchContract()
