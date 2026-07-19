import { useCallback, useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { get_task_status } from '@/services/note.ts'
import toast from 'react-hot-toast'

const hasContent = (task: ReturnType<typeof useTaskStore.getState>['tasks'][number]) => {
  if (Array.isArray(task.markdown)) return task.markdown.length > 0
  return !!task.markdown
}

export const useTaskPolling = (interval = 3000) => {
  const tasks = useTaskStore(state => state.tasks)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)

  const tasksRef = useRef(tasks)
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const pollOnce = useCallback(async () => {
    const current = tasksRef.current

    // Tasks still in progress — need status updates
    const activeTasks = current.filter(
      t => t.status !== 'SUCCESS' && t.status !== 'FAILED',
    )

    // SUCCESS tasks whose content was not persisted (page refresh) — need content restore
    const needsRestore = current.filter(
      t => t.status === 'SUCCESS' && !hasContent(t),
    )

    if (activeTasks.length === 0 && needsRestore.length === 0) return

    for (const task of [...activeTasks, ...needsRestore]) {
      try {
        const res = await get_task_status(task.id)
        const { status } = res

        if (!status) continue

        if (status === 'SUCCESS') {
          const { markdown, transcript, audio_meta } = res.result ?? {}
          // Only toast for tasks that just transitioned to SUCCESS (not restores)
          if (task.status !== 'SUCCESS') {
            toast.success('笔记生成成功')
          }
          updateTaskContent(task.id, {
            status,
            markdown,
            transcript,
            audioMeta: audio_meta,
          })
        } else if (status === 'FAILED') {
          if (task.status !== 'FAILED') {
            updateTaskContent(task.id, { status })
            console.warn(`⚠️ 任务 ${task.id} 失败`)
          }
        } else {
          // 进行中：合并状态变化 + 后端提前返回的封面/标题元信息
          const patch: Parameters<typeof updateTaskContent>[1] = {}
          if (status !== task.status) patch.status = status

          const meta = (res as any).meta
          const needCover = !task.audioMeta?.cover_url && meta?.cover_url
          const needTitle = !task.audioMeta?.title && meta?.title
          if (meta && (needCover || needTitle)) {
            patch.audioMeta = {
              ...task.audioMeta,
              title: meta.title || task.audioMeta?.title || '',
              cover_url: meta.cover_url || task.audioMeta?.cover_url || '',
              duration: meta.duration || task.audioMeta?.duration || 0,
              platform: meta.platform || task.audioMeta?.platform || '',
              video_id: meta.video_id || task.audioMeta?.video_id || '',
              raw_info: meta.raw_info ?? task.audioMeta?.raw_info ?? null,
            }
          }

          if (Object.keys(patch).length > 0) updateTaskContent(task.id, patch)
        }
      } catch (e: any) {
        console.error('❌ 任务轮询失败：', e)
        if (task.status !== 'SUCCESS') {
          // 提取后端翻译过的失败原因（R.error 的 msg 字段），便于前端展示 / 触发 Cookie 弹窗
          const errorMessage: string | undefined =
            e?.response?.data?.msg || e?.data?.msg || e?.message
          updateTaskContent(task.id, { status: 'FAILED', errorMessage })
        }
      }
    }
  }, [updateTaskContent])

  // 周期轮询
  useEffect(() => {
    const timer = setInterval(pollOnce, interval)
    return () => clearInterval(timer)
  }, [interval, pollOnce])

  // 一旦出现新的进行中任务，立即拉取一次，避免等待整个间隔才看到首个阶段
  const activeKey = tasks
    .filter(t => t.status !== 'SUCCESS' && t.status !== 'FAILED')
    .map(t => t.id)
    .join(',')
  useEffect(() => {
    if (activeKey) pollOnce()
  }, [activeKey, pollOnce])
}
