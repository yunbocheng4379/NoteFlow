import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatSource } from '@/services/chat'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
}

interface ChatState {
  chatHistory: Record<string, ChatMessage[]>
  addMessage: (taskId: string, msg: ChatMessage) => void
  /** 向当前任务最后一条消息追加文本（流式打字机用） */
  appendToLastMessage: (taskId: string, text: string) => void
  /** 设置当前任务最后一条消息的引用来源 */
  setLastMessageSources: (taskId: string, sources: ChatSource[]) => void
  clearChat: (taskId: string) => void
  getMessages: (taskId: string) => ChatMessage[]
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chatHistory: {},

      addMessage: (taskId, msg) =>
        set(state => ({
          chatHistory: {
            ...state.chatHistory,
            [taskId]: [...(state.chatHistory[taskId] || []), msg],
          },
        })),

      appendToLastMessage: (taskId, text) =>
        set(state => {
          const list = state.chatHistory[taskId] || []
          if (list.length === 0) return state
          const next = list.slice()
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + text }
          return { chatHistory: { ...state.chatHistory, [taskId]: next } }
        }),

      setLastMessageSources: (taskId, sources) =>
        set(state => {
          const list = state.chatHistory[taskId] || []
          if (list.length === 0) return state
          const next = list.slice()
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, sources }
          return { chatHistory: { ...state.chatHistory, [taskId]: next } }
        }),

      clearChat: (taskId) =>
        set(state => {
          const { [taskId]: _, ...rest } = state.chatHistory
          return { chatHistory: rest }
        }),

      getMessages: (taskId) => get().chatHistory[taskId] || [],
    }),
    {
      name: 'noteflow-chat-storage',
    },
  ),
)
