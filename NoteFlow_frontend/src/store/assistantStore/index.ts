import { create } from 'zustand'
import type { AssistantMessage, AssistantSource } from '@/services/assistant'

interface AssistantState {
  messages: AssistantMessage[]
  addMessage: (message: AssistantMessage) => void
  appendToLastMessage: (text: string) => void
  setLastMessageSources: (sources: AssistantSource[]) => void
  clear: () => void
}

export const useAssistantStore = create<AssistantState>()(set => ({
  messages: [],

  addMessage: message =>
    set(state => ({ messages: [...state.messages, message].slice(-40) })),

  appendToLastMessage: text =>
    set(state => {
      const last = state.messages.at(-1)
      if (!last || last.role !== 'assistant') return state
      return {
        messages: [
          ...state.messages.slice(0, -1),
          { ...last, content: last.content + text },
        ],
      }
    }),

  setLastMessageSources: sources =>
    set(state => {
      const last = state.messages.at(-1)
      if (!last || last.role !== 'assistant') return state
      return {
        messages: [...state.messages.slice(0, -1), { ...last, sources }],
      }
    }),

  clear: () => set({ messages: [] }),
}))
