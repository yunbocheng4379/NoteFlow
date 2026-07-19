import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  PlayCircle,
  Zap,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import { getTasks, type TaskSummary } from '@/services/task'
import { useTaskStore } from '@/store/taskStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

const PLATFORM_LABELS: Record<string, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
  local: '本地文件',
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  SUCCESS: {
    label: '已完成',
    icon: <CheckCircle2 className="h-3 w-3" />,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  FAILED: {
    label: '失败',
    icon: <XCircle className="h-3 w-3" />,
    className: 'bg-red-50 text-red-600 border-red-200',
  },
  PENDING: {
    label: '排队中',
    icon: <Clock className="h-3 w-3" />,
    className: 'bg-neutral-50 text-neutral-500 border-neutral-200',
  },
  PARSING: {
    label: '解析中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  DOWNLOADING: {
    label: '下载中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  TRANSCRIBING: {
    label: '转写中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-violet-50 text-violet-600 border-violet-200',
  },
  SUMMARIZING: {
    label: '总结中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-amber-50 text-amber-600 border-amber-200',
  },
  FORMATTING: {
    label: '格式化中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-amber-50 text-amber-600 border-amber-200',
  },
  SAVING: {
    label: '保存中',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: 'bg-amber-50 text-amber-600 border-amber-200',
  },
}

const RUNNING_STATUSES = new Set(['PENDING', 'PARSING', 'DOWNLOADING', 'TRANSCRIBING', 'SUMMARIZING', 'FORMATTING', 'SAVING'])

type TabKey = 'ALL' | 'RUNNING' | 'SUCCESS' | 'FAILED'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'RUNNING', label: '进行中' },
  { key: 'SUCCESS', label: '已完成' },
  { key: 'FAILED', label: '失败' },
]

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  )
}

function CoverFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-neutral-300">
      <PlayCircle className="h-5 w-5" />
    </div>
  )
}

function CoverImage({ src, platform }: { src: string; platform: string }) {
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const proxied = src && platform !== 'local'
    ? `${baseURL}/image_proxy?url=${encodeURIComponent(src)}`
    : src

  return (
    <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-neutral-100">
      {proxied ? (
        <img src={proxied} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <CoverFallback />
      )}
    </div>
  )
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('ALL')

  // single-delete dialog
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // batch delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const removeTask = useTaskStore(state => state.removeTask)

  const hasRunning = (list: TaskSummary[]) => list.some(t => RUNNING_STATUSES.has(t.status))

  const startTimer = useCallback((loadFn: () => void) => {
    if (timerRef.current) return
    timerRef.current = setInterval(() => { loadFn() }, 60_000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const load = useCallback(async (showToast = false) => {
    setLoading(true)
    try {
      const data = await getTasks()
      setTasks(data)
      if (showToast) toast.success('刷新成功')
      return data
    } finally {
      setLoading(false)
    }
  }, [])

  const silentLoad = useCallback(() => { load() }, [load])

  // initial load + timer setup
  useEffect(() => {
    load().then(data => {
      if (data && hasRunning(data)) {
        startTimer(silentLoad)
      }
    })
    return () => stopTimer()
  }, [load, startTimer, stopTimer, silentLoad])

  // manage timer when tasks change
  useEffect(() => {
    if (hasRunning(tasks)) {
      startTimer(silentLoad)
    } else {
      stopTimer()
    }
  }, [tasks, startTimer, stopTimer, silentLoad])

  const handleDelete = async (taskId: string) => {
    setDeletingId(taskId)
    try {
      // 走 taskStore，使工作台等共享同一数据源的视图实时同步
      await removeTask(taskId)
      setTasks(prev => prev.filter(t => t.task_id !== taskId))
      setSelectedIds(prev => { const s = new Set(prev); s.delete(taskId); return s })
      toast.success('已删除')
    } catch {
      // error toast shown by interceptor
    } finally {
      setDeletingId(null)
      setDeleteDialogId(null)
    }
  }

  const handleBatchDelete = async () => {
    setBatchDeleting(true)
    const ids = [...selectedIds]
    try {
      await Promise.all(ids.map(id => removeTask(id)))
      setTasks(prev => prev.filter(t => !selectedIds.has(t.task_id)))
      setSelectedIds(new Set())
      toast.success(`已删除 ${ids.length} 条记录`)
    } catch {
      // error toast shown by interceptor
    } finally {
      setBatchDeleting(false)
      setBatchDialogOpen(false)
    }
  }

  const counts: Record<TabKey, number> = {
    ALL: tasks.length,
    RUNNING: tasks.filter(t => RUNNING_STATUSES.has(t.status)).length,
    SUCCESS: tasks.filter(t => t.status === 'SUCCESS').length,
    FAILED: tasks.filter(t => t.status === 'FAILED').length,
  }

  const filtered = tasks.filter(t => {
    if (activeTab === 'ALL') return true
    if (activeTab === 'RUNNING') return RUNNING_STATUSES.has(t.status)
    return t.status === activeTab
  })

  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.task_id))
  const someFilteredSelected = filtered.some(t => selectedIds.has(t.task_id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const s = new Set(prev)
        filtered.forEach(t => s.delete(t.task_id))
        return s
      })
    } else {
      setSelectedIds(prev => {
        const s = new Set(prev)
        filtered.forEach(t => s.add(t.task_id))
        return s
      })
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const deleteTarget = tasks.find(t => t.task_id === deleteDialogId)

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">任务记录</h1>
          <p className="mt-0.5 text-xs text-neutral-400">共 {tasks.length} 条</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBatchDialogOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              批量删除 ({selectedIds.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-neutral-100 px-6">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab.key
                ? 'text-primary font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={`rounded-full px-1.5 py-0 text-[10px] leading-4 font-medium ${
                activeTab === tab.key ? 'bg-primary/10 text-primary' : 'bg-neutral-100 text-neutral-500'
              }`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        {loading && tasks.length === 0 ? (
          <div className="flex h-60 items-center justify-center text-sm text-neutral-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 text-sm text-neutral-400">
            <PlayCircle className="h-8 w-8 text-neutral-200" />
            {activeTab === 'ALL' ? '还没有任务记录，去工作台生成第一个吧' : '该分类下暂无记录'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                <th className="w-10 px-4 py-2.5 text-left font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-6 py-2.5 text-left font-medium">视频链接</th>
                <th className="px-4 py-2.5 text-left font-medium">平台</th>
                <th className="px-4 py-2.5 text-left font-medium">模型</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-left font-medium">电力消耗</th>
                <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                <th className="px-4 py-2.5 text-left font-medium">完成时间</th>
                <th className="px-4 py-2.5 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filtered.map(task => (
                <tr
                  key={task.task_id}
                  className={`group transition-colors hover:bg-neutral-50/60 ${selectedIds.has(task.task_id) ? 'bg-primary/5' : ''}`}
                >
                  {/* 勾选 */}
                  <td className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.task_id)}
                      onChange={() => toggleSelect(task.task_id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    />
                  </td>

                  {/* 视频链接 + 封面 */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <CoverImage src={task.cover_url} platform={task.platform} />
                      <div className="min-w-0">
                        <div className="max-w-[240px] truncate font-medium text-gray-800 leading-snug text-xs">
                          {task.title || task.video_id || '未命名'}
                        </div>
                        {task.video_url ? (
                          <a
                            href={task.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 flex items-center gap-0.5 max-w-[240px] truncate text-[11px] text-blue-500 hover:underline"
                          >
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            {task.video_url}
                          </a>
                        ) : (
                          <div className="mt-0.5 max-w-[240px] truncate font-mono text-[11px] text-neutral-400">
                            {task.video_id}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 平台 */}
                  <td className="px-4 py-3">
                    <PlatformBadge platform={task.platform} />
                  </td>

                  {/* 模型 */}
                  <td className="px-4 py-3 text-xs text-neutral-600">
                    {task.model_name || '—'}
                  </td>

                  {/* 状态 */}
                  <td className="px-4 py-3">
                    <StatusBadge status={task.status} />
                  </td>

                  {/* 电力消耗 */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-0.5 text-xs text-neutral-600">
                      <Zap className="h-3 w-3 text-amber-400" />
                      {task.credits_used ?? 20}
                    </span>
                  </td>

                  {/* 创建时间 */}
                  <td className="px-4 py-3 text-xs text-neutral-500 tabular-nums">
                    {formatDate(task.created_at)}
                  </td>

                  {/* 完成时间 */}
                  <td className="px-4 py-3 text-xs text-neutral-500 tabular-nums">
                    {formatDate(task.completed_at)}
                  </td>

                  {/* 操作 */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {task.status === 'SUCCESS' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => navigate('/', { state: { taskId: task.task_id } })}
                        >
                          查看笔记
                        </Button>
                      )}
                      <button
                        onClick={() => setDeleteDialogId(task.task_id)}
                        className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                        title="删除任务"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* 单条删除确认 dialog */}
      <Dialog open={deleteDialogId !== null} onOpenChange={open => { if (!open) setDeleteDialogId(null) }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `将删除「${deleteTarget.title || deleteTarget.video_id || '该任务'}」及其相关笔记和数据，此操作不可恢复。`
                : '此操作不可恢复。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteDialogId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deletingId === deleteDialogId}
              onClick={() => deleteDialogId && handleDelete(deleteDialogId)}
            >
              {deletingId === deleteDialogId
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认 dialog */}
      <Dialog open={batchDialogOpen} onOpenChange={open => { if (!open) setBatchDialogOpen(false) }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>批量删除</DialogTitle>
            <DialogDescription>
              将删除已选中的 {selectedIds.size} 条记录及其相关笔记和数据，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBatchDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={batchDeleting}
              onClick={handleBatchDelete}
            >
              {batchDeleting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : `确认删除 (${selectedIds.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
