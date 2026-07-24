import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { generateNote } from '@/services/note.ts'
import { getTasks, deleteTask } from '@/services/task.ts'
import { v4 as uuidv4 } from 'uuid'
import toast from 'react-hot-toast'

export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export interface AudioMeta {
  cover_url: string
  duration: number
  file_path: string
  platform: string
  raw_info: any
  title: string
  video_id: string
}

export interface Segment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  full_text: string
  language: string
  raw: any
  segments: Segment[]
}

export interface Markdown {
  ver_id: string
  content: string
  style: string
  model_name: string
  created_at: string
}

export interface Task {
  id: string
  // markdown and transcript live in memory only — fetched on demand from backend
  markdown: string | Markdown[]
  transcript: Transcript
  status: TaskStatus
  audioMeta: AudioMeta
  createdAt: string
  /** Backend-translated failure message; only set when status === 'FAILED' */
  errorMessage?: string
  /** 批量生成任务的分组 ID；单个任务为 undefined */
  batchId?: string | null
  formData: {
    video_url: string
    link?: boolean
    screenshot?: boolean
    platform: string
    quality: string
    model_name: string
    provider_id: string
    style?: string
    extras?: string
    format?: string[]
    video_understanding?: boolean
    video_interval?: number
    grid_size?: [number, number]
  }
}

interface TaskStore {
  tasks: Task[]
  currentTaskId: string | null
  historyLoaded: boolean
  addPendingTask: (taskId: string, platform: string, formData: any, meta?: Partial<AudioMeta>, batchId?: string | null) => void
  updateTaskContent: (id: string, data: Partial<Omit<Task, 'id' | 'createdAt'>>) => void
  // Overwrites the content of the given version in place (no new version created).
  // Pass verId=null when the task's markdown is a plain string (no version history yet).
  overwriteVersionContent: (id: string, verId: string | null, content: string) => void
  removeTask: (id: string) => Promise<void>
  clearTasks: () => void
  setCurrentTask: (taskId: string | null) => void
  getCurrentTask: () => Task | null
  retryTask: (id: string, payload?: any) => void
  // Load full task history from backend — called on login and on boot
  loadHistory: () => Promise<void>
}

// Only currentTaskId is persisted per-user in localStorage.
// tasks[] comes from the backend on every session start.
interface PersistedState {
  currentTaskId: string | null
}

function storageKey(userId?: number | null): string {
  return userId ? `noteflow-session-${userId}` : 'noteflow-session'
}

function getUserId(): number | null {
  try {
    const raw = localStorage.getItem('noteflow-user')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed?.state?.user?.id ?? null
    }
  } catch {
    // ignore
  }
  return null
}

// Convert the backend TaskSummary shape into a full Task (with empty content fields)
function summaryToTask(s: {
  task_id: string
  video_id: string
  platform: string
  video_url: string
  model_name: string
  created_at: string
  status: string
  title: string
  cover_url: string
  duration: number
  batch_id?: string | null
}): Task {
  return {
    id: s.task_id,
    status: (s.status as TaskStatus) || 'PENDING',
    createdAt: s.created_at,
    batchId: s.batch_id ?? null,
    markdown: '',
    transcript: { full_text: '', language: '', raw: null, segments: [] },
    audioMeta: {
      cover_url: s.cover_url || '',
      duration: s.duration || 0,
      file_path: '',
      platform: s.platform,
      raw_info: null,
      title: s.title || '',
      video_id: s.video_id || '',
    },
    formData: {
      video_url: s.video_url || '',
      platform: s.platform,
      quality: 'medium',
      model_name: s.model_name || '',
      provider_id: '',
    },
  }
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentTaskId: null,
      historyLoaded: false,

      loadHistory: async () => {
        try {
          const summaries = await getTasks()
          const incoming = summaries.map(summaryToTask)

          // 从 localStorage 恢复版本数据
          const userId = getUserId()
          const versionStorageKey = `noteflow-versions-${userId || 'default'}`
          let savedVersions: Record<string, any> = {}
          try {
            const stored = localStorage.getItem(versionStorageKey)
            if (stored) {
              savedVersions = JSON.parse(stored)
            }
          } catch (e) {
            console.warn('解析版本数据失败：', e)
          }

          set(state => {
            // Keep content already loaded in memory for tasks we already have
            const contentMap = new Map<string, Pick<Task, 'markdown' | 'transcript' | 'audioMeta'>>(
              state.tasks.map(t => [t.id, { markdown: t.markdown, transcript: t.transcript, audioMeta: t.audioMeta }]),
            )
            const merged = incoming.map(t => {
              const memoryContent = contentMap.get(t.id)
              const storedVersions = savedVersions[t.id]

              // 优先使用内存中的内容，其次使用存储的版本数据
              const markdown = memoryContent?.markdown || storedVersions || t.markdown
              const transcript = memoryContent?.transcript || t.transcript
              // cover_url/title/duration 以后端最新数据为准（避免旧的空封面缓存一直覆盖新数据）；
              // raw_info/file_path 等后端摘要接口不返回的字段则保留内存中已有的
              const audioMeta = memoryContent?.audioMeta
                ? {
                    ...memoryContent.audioMeta,
                    cover_url: t.audioMeta.cover_url || memoryContent.audioMeta.cover_url,
                    title: t.audioMeta.title || memoryContent.audioMeta.title,
                    duration: t.audioMeta.duration || memoryContent.audioMeta.duration,
                  }
                : t.audioMeta

              return {
                ...t,
                markdown,
                transcript,
                audioMeta,
              }
            })
            const newCurrentTaskId = state.currentTaskId ?? (merged.length > 0 ? merged[0].id : null)
            return { tasks: merged, historyLoaded: true, currentTaskId: newCurrentTaskId }
          })
        } catch (e) {
          console.error('加载任务历史失败：', e)
        }
      },

      addPendingTask: (taskId: string, _platform: string, formData: any, meta?: Partial<AudioMeta>, batchId?: string | null) =>
        set(state => ({
          tasks: [
            {
              formData,
              id: taskId,
              status: 'PENDING',
              markdown: '',
              batchId: batchId ?? null,
              transcript: { full_text: '', language: '', raw: null, segments: [] },
              createdAt: new Date().toISOString(),
              audioMeta: {
                cover_url: meta?.cover_url || '',
                duration: meta?.duration || 0,
                file_path: '',
                platform: meta?.platform || formData.platform || '',
                raw_info: meta?.raw_info ?? null,
                title: meta?.title || '',
                video_id: meta?.video_id || '',
              },
            },
            ...state.tasks,
          ],
          currentTaskId: taskId,
        })),

      updateTaskContent: (id, data) =>
        set(state => ({
          tasks: state.tasks.map(task => {
            if (task.id !== id) return task

            const hasStoredContent = (m: any) => Array.isArray(m) ? m.length > 0 : !!m
            if (task.status === 'SUCCESS' && data.status === 'SUCCESS' && hasStoredContent(task.markdown)) return task

            if (typeof data.markdown === 'string' && data.markdown) {
              const prev = task.markdown

              // 生成版本ID：使用 v1.0, v2.0 格式
              let nextVersionNum = 1
              if (Array.isArray(prev)) {
                // 找出所有符合 v数字.数字 格式的版本号
                const versionNums = prev
                  .map(v => v.ver_id.match(/^v(\d+)\.\d+$/))
                  .filter(Boolean)
                  .map((m: RegExpMatchArray | null) => m ? parseInt(m[1], 10) : 0)
                if (versionNums.length > 0) {
                  nextVersionNum = Math.max(...versionNums) + 1
                }
              }
              const newVerId = `v${nextVersionNum}.0`

              const newVersion: Markdown = {
                ver_id: newVerId,
                content: data.markdown,
                style: task.formData.style || '',
                model_name: task.formData.model_name || '',
                created_at: new Date().toISOString(),
              }

              let updatedMarkdown: Markdown[]
              if (Array.isArray(prev)) {
                updatedMarkdown = [newVersion, ...prev]
              } else {
                updatedMarkdown = [
                  newVersion,
                  ...(typeof prev === 'string' && prev
                    ? [
                        {
                          ver_id: `v1.0`, // 第一个版本
                          content: prev,
                          style: task.formData.style || '',
                          model_name: task.formData.model_name || '',
                          created_at: new Date().toISOString(),
                        },
                      ]
                    : []),
                ]
              }

              // 将版本数据保存到 localStorage
              if (updatedMarkdown.length > 0) {
                const userId = getUserId()
                const versionStorageKey = `noteflow-versions-${userId || 'default'}`
                try {
                  let savedVersions: Record<string, any> = {}
                  const stored = localStorage.getItem(versionStorageKey)
                  if (stored) {
                    savedVersions = JSON.parse(stored)
                  }
                  savedVersions[task.id] = updatedMarkdown
                  localStorage.setItem(versionStorageKey, JSON.stringify(savedVersions))
                } catch (e) {
                  console.warn('保存版本数据到 localStorage 失败：', e)
                }
              }

              return { ...task, ...data, markdown: updatedMarkdown }
            }

            return { ...task, ...data }
          }),
        })),

      overwriteVersionContent: (id, verId, content) =>
        set(state => ({
          tasks: state.tasks.map(task => {
            if (task.id !== id) return task

            let updatedMarkdown: string | Markdown[]
            if (Array.isArray(task.markdown) && verId) {
              updatedMarkdown = task.markdown.map(v =>
                v.ver_id === verId ? { ...v, content } : v,
              )
            } else {
              updatedMarkdown = content
            }

            if (Array.isArray(updatedMarkdown)) {
              const userId = getUserId()
              const versionStorageKey = `noteflow-versions-${userId || 'default'}`
              try {
                let savedVersions: Record<string, any> = {}
                const stored = localStorage.getItem(versionStorageKey)
                if (stored) {
                  savedVersions = JSON.parse(stored)
                }
                savedVersions[task.id] = updatedMarkdown
                localStorage.setItem(versionStorageKey, JSON.stringify(savedVersions))
              } catch (e) {
                console.warn('保存版本数据到 localStorage 失败：', e)
              }
            }

            return { ...task, markdown: updatedMarkdown }
          }),
        })),

      getCurrentTask: () => {
        const { currentTaskId, tasks } = get()
        return tasks.find(t => t.id === currentTaskId) ?? null
      },

      retryTask: async (id: string, payload?: any) => {
        if (!id) {
          toast.error('任务不存在')
          return
        }
        const task = get().tasks.find(t => t.id === id)
        if (!task) return

        const newFormData = payload || task.formData
        try {
          await generateNote({ ...newFormData, task_id: id })
        } catch (e: any) {
          if (e?.data?.reason === 'transcriber_model_not_ready') {
            toast.error(
              e?.data?.downloading
                ? '转写模型正在下载中，请稍候再重试'
                : '转写模型尚未下载，请先去「设置 → 音频转写配置」页下载',
            )
            return
          }
          console.error('重试任务失败：', e)
          return
        }

        set(state => ({
          tasks: state.tasks.map(t =>
            t.id === id ? { ...t, formData: newFormData, status: 'PENDING' } : t,
          ),
        }))
      },

      removeTask: async (id: string) => {
        // 从 localStorage 删除版本数据
        const userId = getUserId()
        const versionStorageKey = `noteflow-versions-${userId || 'default'}`
        try {
          const stored = localStorage.getItem(versionStorageKey)
          if (stored) {
            const savedVersions: Record<string, any> = JSON.parse(stored)
            delete savedVersions[id]
            localStorage.setItem(versionStorageKey, JSON.stringify(savedVersions))
          }
        } catch (e) {
          console.warn('删除版本数据失败：', e)
        }

        // Optimistic: remove from memory immediately
        set(state => {
          const remaining = state.tasks.filter(t => t.id !== id)
          // 删除的若是当前选中的笔记：还有其它笔记时跳到最近生成的一条（列表已按时间倒序，取第一条），否则置空
          const nextCurrentTaskId =
            state.currentTaskId === id
              ? remaining.length > 0
                ? remaining[0].id
                : null
              : state.currentTaskId
          return { tasks: remaining, currentTaskId: nextCurrentTaskId }
        })
        // Sync to backend
        try {
          await deleteTask(id)
        } catch (e) {
          console.error('删除任务失败：', e)
        }
      },

      clearTasks: () => set({ tasks: [], currentTaskId: null, historyLoaded: false }),

      setCurrentTask: taskId => set({ currentTaskId: taskId }),
    }),
    {
      name: storageKey(getUserId()),
      storage: createJSONStorage(() => localStorage),
      // Only persist currentTaskId — tasks always reload from the backend
      partialize: (state): PersistedState => ({
        currentTaskId: state.currentTaskId,
      }),
      merge: (persisted, current) => {
        const p = persisted as PersistedState
        return {
          ...current,
          currentTaskId: p.currentTaskId ?? null,
        }
      },
    },
  ),
)

export function rehydrateTaskStore(userId: number) {
  useTaskStore.persist.setOptions({ name: storageKey(userId) })
  useTaskStore.setState({ tasks: [], currentTaskId: null, historyLoaded: false })
  useTaskStore.persist.rehydrate()
}

export function clearTaskStoreForLogout() {
  useTaskStore.setState({ tasks: [], currentTaskId: null, historyLoaded: false })
}
