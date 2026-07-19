import { FC, useEffect, useRef, useState } from 'react'
import HomeLayout from '@/layouts/HomeLayout.tsx'
import NoteForm from '@/pages/HomePage/components/NoteForm.tsx'
import MarkdownViewer from '@/pages/HomePage/components/MarkdownViewer.tsx'
import { useTaskStore } from '@/store/taskStore'
import History from '@/pages/HomePage/components/History.tsx'
import { get_task_status } from '@/services/note.ts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import CookieRequiredDialog from '@/pages/HomePage/components/CookieRequiredDialog.tsx'

/** 后端在需要 Cookie 时会在 msg 前缀埋入 [NEED_COOKIE:platform] 标记 */
const COOKIE_MARKER_RE = /\[NEED_COOKIE(?::([^\]]+))?\]\s*/

type ViewStatus = 'idle' | 'loading' | 'success' | 'failed' | 'initializing'

const hasContent = (markdown: any) =>
  Array.isArray(markdown) ? markdown.length > 0 : !!markdown

const hasTranscript = (t: any) => Array.isArray(t?.segments) && t.segments.length > 0

export const HomePage: FC = () => {
  const tasks = useTaskStore(state => state.tasks)
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const historyLoaded = useTaskStore(state => state.historyLoaded)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)

  const currentTask = tasks.find(t => t.id === currentTaskId)

  const retryTask = useTaskStore(state => state.retryTask)

  const [status, setStatus] = useState<ViewStatus>('initializing')
  const [noteFormOpen, setNoteFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'regenerate'>('create')
  const [formPrefill, setFormPrefill] = useState<{ video_url?: string; platform?: string } | undefined>()
  const fetchingRef = useRef<string | null>(null)

  /* ---------- Cookie-required 弹窗 ---------- */
  const [cookieDialog, setCookieDialog] = useState<{
    open: boolean
    platform: string
    reason: string
    taskId: string
  }>({ open: false, platform: '', reason: '', taskId: '' })
  /** 同一个任务只触发一次弹窗，避免轮询重复弹 */
  const cookiePromptedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!currentTask) return
    if (currentTask.status !== 'FAILED') return
    const raw = currentTask.errorMessage || ''
    const match = raw.match(COOKIE_MARKER_RE)
    if (!match) return
    if (cookiePromptedRef.current.has(currentTask.id)) return

    cookiePromptedRef.current.add(currentTask.id)
    setCookieDialog({
      open: true,
      // marker 中可能带 platform；否则回退到任务 formData
      platform: match[1] || currentTask.formData?.platform || '',
      reason: raw.replace(COOKIE_MARKER_RE, '').trim(),
      taskId: currentTask.id,
    })
  }, [currentTask?.id, currentTask?.status, currentTask?.errorMessage])

  useEffect(() => {
    if (!historyLoaded) {
      setStatus('initializing')
    } else if (!currentTask) {
      setStatus('idle')
    } else if (currentTask.status === 'SUCCESS') {
      setStatus('success')
    } else if (currentTask.status === 'FAILED') {
      setStatus('failed')
    } else {
      setStatus('loading')
    }
  }, [historyLoaded, currentTask, currentTask?.status])

  useEffect(() => {
    if (!currentTaskId || !currentTask) return
    if (currentTask.status !== 'SUCCESS') return
    // markdown 与 transcript 都是内存态：刷新后 markdown 可能已从 localStorage 恢复，
    // 但 transcript（原文参照）不会被持久化。只要两者任一缺失就需要重新拉取，
    // 避免刷新后「原文参照」内容为空。
    if (hasContent(currentTask.markdown) && hasTranscript(currentTask.transcript)) return
    if (fetchingRef.current === currentTaskId) return

    fetchingRef.current = currentTaskId
    get_task_status(currentTaskId)
      .then(res => {
        if (res?.status === 'SUCCESS' && res.result) {
          const { markdown, transcript, audio_meta } = res.result
          // 若 markdown 已在内存/localStorage 中，则只补齐缺失的 transcript / audioMeta，
          // 不再带上 status:SUCCESS 与 markdown —— 否则会命中 updateTaskContent 的
          // 「已有内容则原样返回」守卫，导致刚拉到的 transcript 被丢弃。
          if (hasContent(currentTask.markdown)) {
            updateTaskContent(currentTaskId, { transcript, audioMeta: audio_meta })
          } else {
            updateTaskContent(currentTaskId, { status: 'SUCCESS', markdown, transcript, audioMeta: audio_meta })
          }
        }
      })
      .catch(console.error)
      .finally(() => {
        if (fetchingRef.current === currentTaskId) fetchingRef.current = null
      })
  }, [currentTaskId])

  const handleNewNote = (prefill?: { video_url?: string; platform?: string }) => {
    setFormMode('create')
    setFormPrefill(prefill)
    setNoteFormOpen(true)
  }

  const handleRegenerate = () => {
    setFormMode('regenerate')
    setFormPrefill(undefined)
    setNoteFormOpen(true)
  }

  return (
    <>
      <HomeLayout
        Preview={<MarkdownViewer status={status} currentTaskId={currentTaskId} onNewNote={handleNewNote} onRegenerate={handleRegenerate} />}
        History={<History />}
        onNewNote={handleNewNote}
      />

      <Dialog open={noteFormOpen} onOpenChange={(open) => {
        setNoteFormOpen(open)
      }}>
        <DialogContent
          className="max-w-xl max-h-[90vh] p-0 flex flex-col [&>button[data-slot=dialog-close]]:top-[7px]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* 固定标题栏 */}
          <DialogHeader className="shrink-0 border-b border-neutral-200 px-6 py-4">
            <DialogTitle>{formMode === 'regenerate' ? '重新生成' : '新建笔记'}</DialogTitle>
          </DialogHeader>
          {/* 每次打开重新挂载，确保 prefill / mode 切换后默认值正确生效；内部自行处理滚动区 + 固定底部按钮 */}
          {noteFormOpen && (
            <NoteForm
              mode={formMode}
              prefill={formMode === 'create' ? formPrefill : undefined}
              onSubmitSuccess={() => setNoteFormOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <CookieRequiredDialog
        open={cookieDialog.open}
        onOpenChange={open => setCookieDialog(prev => ({ ...prev, open }))}
        platform={cookieDialog.platform}
        reason={cookieDialog.reason}
        onSaved={() => {
          // 保存成功后自动重试当前失败任务，省去用户再点一次「重试」
          if (cookieDialog.taskId) retryTask(cookieDialog.taskId)
        }}
      />
    </>
  )
}
