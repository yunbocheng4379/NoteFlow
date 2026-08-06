import { create } from 'zustand'
import {
  createConversation,
  listConversations,
  getConversationMessages,
  deleteConversation,
  updateConversation,
  type KbConversation,
  type KbMessage,
  type KbSource,
} from '@/services/knowledgeBase'

// 会话列表始终按“置顶优先 + 更新时间倒序”展示；后端已按此排序，
// 前端在本地乐观更新（置顶/取消置顶）后需重新排一次序，避免与后端结果不一致。
const sortConversations = (list: KbConversation[]): KbConversation[] => {
  return [...list].sort((a, b) => {
    const ap = a.is_pinned ? 1 : 0
    const bp = b.is_pinned ? 1 : 0
    if (ap !== bp) return bp - ap
    return (b.updated_at || '').localeCompare(a.updated_at || '')
  })
}

interface KnowledgeBaseStore {
  conversations: KbConversation[]
  activeConversationId: number | null
  messages: KbMessage[]
  loaded: boolean

  loadConversations: (force?: boolean) => Promise<void>
  newConversation: () => Promise<number | null>
  selectConversation: (id: number) => Promise<void>
  removeConversation: (id: number) => Promise<void>
  renameConversation: (id: number, title: string) => Promise<boolean>
  togglePinConversation: (id: number) => Promise<void>
  markConversationUnread: (id: number, unread?: boolean) => Promise<void>
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
      set({ conversations: sortConversations(list), loaded: true })
    } catch (error) {
      console.error('加载知识库会话列表失败', error)
    }
  },

  newConversation: async () => {
    try {
      const conv = await createConversation()
      set(state => ({
        conversations: sortConversations([conv, ...state.conversations]),
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
    // 选中会话即视为“已读”，如果之前被标记为未读则同步取消。
    const prev = get().conversations.find(c => c.id === id)
    set(state => ({
      activeConversationId: id,
      messages: [],
      conversations: prev?.is_unread
        ? state.conversations.map(c => (c.id === id ? { ...c, is_unread: false } : c))
        : state.conversations,
    }))
    try {
      const messages = await getConversationMessages(id)
      set({ messages })
    } catch (error) {
      console.error('加载知识库会话消息失败', error)
    }
    if (prev?.is_unread) {
      try {
        await updateConversation(id, { is_unread: false })
      } catch (error) {
        console.error('取消未读标记失败', error)
      }
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

  renameConversation: async (id: number, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return false
    try {
      const updated = await updateConversation(id, { title: trimmed })
      set(state => ({
        conversations: sortConversations(
          state.conversations.map(c => (c.id === id ? { ...c, ...updated } : c))
        ),
      }))
      return true
    } catch (error) {
      console.error('重命名会话失败', error)
      return false
    }
  },

  togglePinConversation: async (id: number) => {
    const current = get().conversations.find(c => c.id === id)
    if (!current) return
    const nextPinned = !current.is_pinned
    try {
      const updated = await updateConversation(id, { is_pinned: nextPinned })
      set(state => ({
        conversations: sortConversations(
          state.conversations.map(c => (c.id === id ? { ...c, ...updated } : c))
        ),
      }))
    } catch (error) {
      console.error('置顶操作失败', error)
    }
  },

  markConversationUnread: async (id: number, unread = true) => {
    try {
      const updated = await updateConversation(id, { is_unread: unread })
      set(state => ({
        conversations: state.conversations.map(c => (c.id === id ? { ...c, ...updated } : c)),
      }))
    } catch (error) {
      console.error('标记未读失败', error)
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
