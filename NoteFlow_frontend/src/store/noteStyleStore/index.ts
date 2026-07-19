import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { noteStyleApi, type NoteStyle } from '@/services/note_style'
import { fallbackNoteStyles } from '@/constant/note.ts'

interface NoteStyleStore {
  styles: NoteStyle[]
  loading: boolean
  loaded: boolean
  loadStyles: (force?: boolean) => Promise<void>
}

export const useNoteStyleStore = create<NoteStyleStore>()(
  devtools((set, get) => ({
    styles: [],
    loading: false,
    loaded: false,

    // 获取当前用户可见的全部风格（系统内置 + 自己的 + 他人公开的）
    loadStyles: async (force = false) => {
      if (get().loaded && !force) return
      try {
        set({ loading: true })
        const styles = await noteStyleApi.list({ category: 'all' })
        set({ styles, loaded: true })
      } catch (error) {
        console.error('加载笔记风格失败，使用内置风格兜底', error)
        set({ styles: fallbackNoteStyles, loaded: true })
      } finally {
        set({ loading: false })
      }
    },
  }))
)
