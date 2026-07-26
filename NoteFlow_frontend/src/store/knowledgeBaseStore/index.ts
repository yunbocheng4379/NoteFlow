import { create } from 'zustand'
import {
  createConversation,
  listConversations,
  getConversationMessages,
  deleteConversation,
  type KbConversation,
  type KbMessage,
  type KbSource,
} from '@/services/knowledgeBase'

interface KnowledgeBaseStore {
  conversations: KbConversation[]
  activeConversationId: number | null
  messages: KbMessage[]
  loaded: boolean

  loadConversations: (force?: boolean) => Promise<void>
  newConversation: () => Promise<number | null>
  selectConversation: (id: number) => Promise<void>
  removeConversation: (id: number) => Promise<void>
  addMessage: (msg: KbMessage) => void
  appendToLastMessage: (text: string) => void
  appendToLastReasoning: (text: string) => void
  setLastMessageSources: (sources: KbSource[]) => void
  clearMessages: () => void
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStore>()((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  loaded: false,

  loadConversations: async (force = false) => {
    if (get().loaded && !force) return
    try {
      const list = await listConversations()
      set({ conversations: list, loaded: true })
    } catch (error) {
      console.error('加载知识库会话列表失败', error)
    }
  },

  newConversation: async () => {
    try {
      const conv = await createConversation()
      set(state => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: conv.id,
        messages: [],
      }))
      return conv.id
    } catch (error) {
      console.error('创建知识库会话失败', error)
      return null
    }
  },

  selectConversation: async (id: number) => {
    set({ activeConversationId: id, messages: [] })
    try {
      const messages = await getConversationMessages(id)
      set({ messages })
    } catch (error) {
      console.error('加载知识库会话消息失败', error)
    }
  },

  removeConversation: async (id: number) => {
    try {
      await deleteConversation(id)
      set(state => ({
        conversations: state.conversations.filter(c => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
        messages: state.activeConversationId === id ? [] : state.messages,
      }))
    } catch (error) {
      console.error('删除知识库会话失败', error)
    }
  },

  addMessage: (msg: KbMessage) => {
    set(state => ({ messages: [...state.messages, msg] }))
  },

  appendToLastMessage: (text: string) => {
    set(state => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = { ...last, content: last.content + text }
      return { messages }
    })
  },

  appendToLastReasoning: (text: string) => {
    set(state => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = {
        ...last,
        reasoning_content: (last.reasoning_content ?? '') + text,
      }
      return { messages }
    })
  },

  setLastMessageSources: (sources: KbSource[]) => {
    set(state => {
      if (state.messages.length === 0) return state
      const messages = [...state.messages]
      const last = messages[messages.length - 1]
      messages[messages.length - 1] = { ...last, sources }
      return { messages }
    })
  },

  clearMessages: () => set({ messages: [] }),
}))
