import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  type NoteCollection,
} from '@/services/collection'

interface CollectionStore {
  collections: NoteCollection[]
  loading: boolean
  loaded: boolean
  loadCollections: (force?: boolean) => Promise<void>
  createCollection: (data: { name: string; description?: string }) => Promise<NoteCollection>
  updateCollection: (id: number, data: { name?: string; description?: string }) => Promise<void>
  deleteCollection: (id: number) => Promise<void>
  patchCollection: (id: number, patch: Partial<NoteCollection>) => void
}

export const useCollectionStore = create<CollectionStore>()(
  devtools((set, get) => ({
    collections: [],
    loading: false,
    loaded: false,

    loadCollections: async (force = false) => {
      if (get().loaded && !force) return
      set({ loading: true })
      try {
        const collections = await listCollections()
        set({ collections, loaded: true })
      } finally {
        set({ loading: false })
      }
    },

    createCollection: async (data) => {
      const created = await createCollection(data)
      set({ collections: [created, ...get().collections] })
      return created
    },

    updateCollection: async (id, data) => {
      const updated = await updateCollection(id, data)
      set({ collections: get().collections.map((c) => (c.id === id ? updated : c)) })
    },

    deleteCollection: async (id) => {
      await deleteCollection(id)
      set({ collections: get().collections.filter((c) => c.id !== id) })
    },

    patchCollection: (id, patch) => {
      set({ collections: get().collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
    },
  })),
)
