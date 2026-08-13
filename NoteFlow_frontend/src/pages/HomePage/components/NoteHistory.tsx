import { useTaskStore } from '@/store/taskStore'
import { cn } from '@/lib/utils.ts'
import { Trash, Search, Share2, Pencil, Check, X } from 'lucide-react'
import Fuse from 'fuse.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import LazyImage from '@/components/LazyImage.tsx'
import { FC, useState, useMemo, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import ShareNoteDialog from '@/components/ShareNoteDialog.tsx'
import toast from 'react-hot-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  BiliBiliLogo,
  DouyinLogo,
  KuaishouLogo,
  LocalLogo,
  YoutubeLogo,
} from '@/components/Icons/platform.tsx'

interface NoteHistoryProps {
  onSelect: (taskId: string) => void
  selectedId: string | null
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  FAILED:  { label: '失败',   cls: 'bg-red-50 text-red-500' },
}

const PLATFORM_BADGE = {
  bilibili: {
    label: 'B站',
    Logo: BiliBiliLogo,
    cls: 'border-pink-100 bg-pink-50/80 text-pink-600',
  },
  youtube: {
    label: 'YouTube',
    Logo: YoutubeLogo,
    cls: 'border-red-100 bg-red-50/80 text-red-600',
  },
  douyin: {
    label: '抖音',
    Logo: DouyinLogo,
    cls: 'border-neutral-200 bg-neutral-900 text-white',
  },
  kuaishou: {
    label: '快手',
    Logo: KuaishouLogo,
    cls: 'border-orange-100 bg-orange-50/80 text-orange-600',
  },
  local: {
    label: '本地',
    Logo: LocalLogo,
    cls: 'border-amber-100 bg-amber-50/80 text-amber-600',
  },
} satisfies Record<string, { label: string; Logo: FC; cls: string }>

function getPlatformBadge(platform?: string) {
  if (!platform) return null
  return PLATFORM_BADGE[platform as keyof typeof PLATFORM_BADGE] ?? null
}

function formatShortDate(dateStr?: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const NoteHistory: FC<NoteHistoryProps> = ({ onSelect, selectedId }) => {
  const tasks = useTaskStore(state => state.tasks)
  const historyLoaded = useTaskStore(state => state.historyLoaded)
  const removeTask = useTaskStore(state => state.removeTask)
  const renameTask = useTaskStore(state => state.renameTask)
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || 'api').replace(/\/$/, '')

  const [search, setSearch] = useState('')
  const [shareTaskId, setShareTaskId] = useState<string | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  useEffect(() => {
    if (!contextMenu) return
    const close = (e: MouseEvent) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) return
      setContextMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', () => setContextMenu(null), true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', () => setContextMenu(null), true)
    }
  }, [contextMenu])

  const openContextMenu = (e: ReactMouseEvent, taskId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 144
    const menuHeight = 110
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
    setContextMenu({ taskId, x, y })
  }

  const startRename = (taskId: string, currentTitle: string) => {
    setRenamingId(taskId)
    setRenameValue(currentTitle)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const commitRename = async (taskId: string) => {
    const trimmed = renameValue.trim()
    setRenamingId(null)
    if (!trimmed) return
    try {
      await renameTask(taskId, trimmed)
    } catch {
      toast.error('重命名失败，请稍后重试')
    }
  }

  const fuse = useMemo(
    () => new Fuse(tasks, { keys: ['audioMeta.title'], threshold: 0.4 }),
    [tasks],
  )

  const filteredTasks = search.trim() ? fuse.search(search).map(r => r.item) : tasks

  // 检测是否有任务正在生成中
  const hasGeneratingTask = useMemo(() => {
    return tasks.some(task => task.status !== 'SUCCESS' && task.status !== 'FAILED')
  }, [tasks])

  const handleTaskClick = (taskId: string) => {
    // 检查是否点击的是正在生成的任务本身
    const clickedTask = tasks.find(t => t.id === taskId)
    const isClickingGeneratingTask = clickedTask && clickedTask.status !== 'SUCCESS' && clickedTask.status !== 'FAILED'

    // 如果有任务正在生成，且点击的不是当前正在生成的任务，则提示用户
    if (hasGeneratingTask && !isClickingGeneratingTask) {
      toast('正在生成笔记，请稍后再切换查看其他笔记', { icon: '⏳' })
      return
    }
    onSelect(taskId)
  }

  if (!historyLoaded) {
    return (
      <div className="flex flex-col gap-1.5 pt-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex animate-pulse items-center gap-2 rounded-lg p-2">
            <div className="h-10 w-14 shrink-0 rounded-md bg-neutral-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-4/5 rounded bg-neutral-200" />
              <div className="h-2.5 w-1/2 rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-1.5">
      {/* 搜索框 */}
      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          placeholder="搜索笔记..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-primary focus:bg-white"
        />
      </div>

      {filteredTasks.length === 0 ? (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 py-8 text-center">
          <p className="text-xs text-neutral-400">暂无记录</p>
        </div>
      ) : (
        filteredTasks.map(task => {
          const isSelected = selectedId === task.id
          const isPending = task.status !== 'SUCCESS' && task.status !== 'FAILED'
          const statusInfo = isPending
            ? { label: '进行中', cls: 'bg-amber-50 text-amber-600' }
            : STATUS_LABEL[task.status] ?? { label: task.status, cls: 'bg-neutral-100 text-neutral-500' }
          const platform = task.audioMeta?.platform || task.formData?.platform || ''
          const platformBadge = getPlatformBadge(platform)

          const coverSrc =
            platform === 'local'
              ? task.audioMeta?.cover_url || '/placeholder.png'
              : task.audioMeta?.cover_url
                ? `${baseURL}/image_proxy?url=${encodeURIComponent(task.audioMeta.cover_url)}`
                : '/placeholder.png'

          return (
            <div
              key={task.id}
              onClick={() => handleTaskClick(task.id)}
              onContextMenu={e => openContextMenu(e, task.id)}
              className={cn(
                'group flex items-center gap-2.5 rounded-lg border px-2 py-2 transition-colors',
                // 只有当有任务在生成且当前项不是正在生成的任务时，才显示禁用状态
                hasGeneratingTask && !isPending
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:border-neutral-200 hover:bg-neutral-50',
                isSelected
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-transparent',
              )}
            >
              {/* 封面图 */}
              <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                {platform === 'local' ? (
                  <img src={coverSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <LazyImage src={coverSrc} alt="" className="h-full w-full object-cover" />
                )}
              </div>

              {/* 文字区 */}
              <div className="min-w-0 flex-1">
                {renamingId === task.id ? (
                  <div
                    className="flex items-center gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(task.id)
                        if (e.key === 'Escape') cancelRename()
                      }}
                      maxLength={200}
                      className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => commitRename(task.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={cancelRename}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="line-clamp-2 cursor-pointer text-xs leading-snug text-neutral-800">
                        {task.audioMeta?.title || '未命名笔记'}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start">
                      <p className="max-w-xs text-xs">{task.audioMeta?.title || '未命名笔记'}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <div className="mt-1 flex items-end justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('rounded px-1 py-0.5 text-[10px] font-medium', statusInfo.cls)}>
                      {statusInfo.label}
                    </span>
                    {task.createdAt && (
                      <span className="truncate text-[10px] text-neutral-400">
                        生成于 {formatShortDate(task.createdAt)}
                      </span>
                    )}
                  </div>

                  {platformBadge && (
                    <span
                      className={cn(
                        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border shadow-sm',
                        platformBadge.cls,
                      )}
                      title={`来源：${platformBadge.label}`}
                      aria-label={`来源：${platformBadge.label}`}
                    >
                      <span className="h-3.5 w-3.5 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                        <platformBadge.Logo />
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>

    {contextMenu && createPortal(
      <div
        ref={contextMenuRef}
        style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
        className="w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
      >
        <button
          onClick={() => {
            const task = tasks.find(t => t.id === contextMenu.taskId)
            startRename(contextMenu.taskId, task?.audioMeta?.title || '')
            setContextMenu(null)
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
        >
          <Pencil className="h-3.5 w-3.5 text-neutral-400" />
          重命名
        </button>
        <button
          onClick={() => {
            setShareTaskId(contextMenu.taskId)
            setContextMenu(null)
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-50"
        >
          <Share2 className="h-3.5 w-3.5 text-neutral-400" />
          分享笔记
        </button>
        <button
          onClick={() => {
            setDeleteTaskId(contextMenu.taskId)
            setContextMenu(null)
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-500 hover:bg-red-50"
        >
          <Trash className="h-3.5 w-3.5" />
          删除
        </button>
      </div>,
      document.body,
    )}

    <ShareNoteDialog
      taskId={shareTaskId}
      open={shareTaskId !== null}
      onOpenChange={open => { if (!open) setShareTaskId(null) }}
    />

    <AlertDialog open={deleteTaskId !== null} onOpenChange={open => { if (!open) setDeleteTaskId(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除这条笔记记录吗？该操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-500 hover:bg-red-600 text-white"
            onClick={() => {
              if (deleteTaskId) removeTask(deleteTaskId)
              setDeleteTaskId(null)
            }}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

export default NoteHistory
