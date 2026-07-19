import { useTaskStore } from '@/store/taskStore'
import { cn } from '@/lib/utils.ts'
import { Trash, Search, Share2 } from 'lucide-react'
import Fuse from 'fuse.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import LazyImage from '@/components/LazyImage.tsx'
import { FC, useState, useMemo } from 'react'
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

interface NoteHistoryProps {
  onSelect: (taskId: string) => void
  selectedId: string | null
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  FAILED:  { label: '失败',   cls: 'bg-red-50 text-red-500' },
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
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || 'api').replace(/\/$/, '')

  const [search, setSearch] = useState('')
  const [shareTaskId, setShareTaskId] = useState<string | null>(null)
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)

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

          const coverSrc =
            task.platform === 'local'
              ? task.audioMeta?.cover_url || '/placeholder.png'
              : task.audioMeta?.cover_url
                ? `${baseURL}/image_proxy?url=${encodeURIComponent(task.audioMeta.cover_url)}`
                : '/placeholder.png'

          return (
            <div
              key={task.id}
              onClick={() => handleTaskClick(task.id)}
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
                {task.platform === 'local' ? (
                  <img src={coverSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  <LazyImage src={coverSrc} alt="" className="h-full w-full object-cover" />
                )}
              </div>

              {/* 文字区 */}
              <div className="min-w-0 flex-1">
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
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={cn('rounded px-1 py-0.5 text-[10px] font-medium', statusInfo.cls)}>
                    {statusInfo.label}
                  </span>
                  {task.createdAt && (
                    <span className="text-[10px] text-neutral-400">
                      生成于 {formatShortDate(task.createdAt)}
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按钮（hover 时显示） */}
              <div className="invisible flex shrink-0 items-center gap-0.5 group-hover:visible">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={e => { e.stopPropagation(); setShareTaskId(task.id) }}
                      className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-blue-50 hover:text-blue-500"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>分享笔记</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTaskId(task.id) }}
                      className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>删除</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )
        })
      )}
    </div>

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
