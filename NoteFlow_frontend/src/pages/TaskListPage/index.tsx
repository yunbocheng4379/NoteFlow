import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  PlayCircle,
  ArrowRight,
  FileText,
  ListChecks,
  Zap,
  ExternalLink,
  Trash2,
  FolderPlus,
  Sparkles,
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
import AddToCollectionDialog from '@/components/AddToCollectionDialog'

const PLATFORM_LABELS: Record<string, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
  local: '本地文件',
  merged: '笔记融合',
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

const RUNNING_STATUSES = new Set([
  'PENDING',
  'PARSING',
  'DOWNLOADING',
  'TRANSCRIBING',
  'SUMMARIZING',
  'FORMATTING',
  'SAVING',
])

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
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
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

function CoverFallback({ platform }: { platform: string }) {
  if (platform === 'merged') {
    return (
      <div className="from-primary to-primary/70 flex h-full w-full items-center justify-center bg-gradient-to-br text-white/80">
        <Sparkles className="h-5 w-5" />
      </div>
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-neutral-300">
      <PlayCircle className="h-5 w-5" />
    </div>
  )
}

function CoverImage({ src, platform }: { src: string; platform: string }) {
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const proxied =
    src && platform !== 'local' ? `${baseURL}/image_proxy?url=${encodeURIComponent(src)}` : src

  return (
    <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-neutral-100">
      {proxied ? (
        <img
          src={proxied}
          alt=""
          className="h-full w-full object-cover"
          onError={e => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <CoverFallback platform={platform} />
      )}
    </div>
  )
}

function EmptyTasksState({
  activeTab,
  onCreate,
  onShowAll,
}: {
  activeTab: TabKey
  onCreate: () => void
  onShowAll: () => void
}) {
  const isAll = activeTab === 'ALL'

  return (
    <div className="flex h-[calc(100vh-142px)] min-h-[520px] items-center justify-center px-8 py-10">
      <div className="flex w-full max-w-[720px] flex-col items-center text-center">
        <div className="relative mb-7 h-28 w-40">
          <div className="absolute top-8 left-1 h-16 w-24 rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="mt-4 space-y-2 px-3">
              <div className="h-1.5 w-12 rounded-full bg-neutral-100" />
              <div className="h-1.5 w-16 rounded-full bg-neutral-100" />
            </div>
          </div>
          <div className="absolute top-1 right-1 h-20 w-28 rounded-2xl border border-teal-100 bg-white shadow-sm">
            <div className="mt-4 flex items-center gap-2 px-3">
              <span className="bg-primary/70 h-2.5 w-2.5 rounded-full" />
              <div className="h-1.5 flex-1 rounded-full bg-teal-50" />
            </div>
            <div className="mt-3 space-y-2 px-3">
              <div className="h-1.5 w-20 rounded-full bg-neutral-100" />
              <div className="h-1.5 w-14 rounded-full bg-neutral-100" />
            </div>
          </div>
          <div className="text-primary absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl bg-[var(--primary-light)] shadow-[0_18px_45px_rgba(20,140,126,0.12)]">
            {isAll ? <ListChecks className="h-9 w-9" /> : <FileText className="h-9 w-9" />}
          </div>
          <div className="text-primary absolute right-5 bottom-2 flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-white shadow-sm">
            <PlayCircle className="h-4 w-4" />
          </div>
        </div>

        <p className="text-2xl font-semibold tracking-normal text-gray-900">
          {isAll ? '还没有任务记录' : '这个分类暂时为空'}
        </p>
        <p className="mt-3 max-w-[520px] text-sm leading-6 text-neutral-500">
          {isAll
            ? '从工作台粘贴视频链接或上传本地文件，生成完成后，任务进度、耗电和笔记入口都会沉淀在这里。'
            : '当前筛选条件下没有匹配任务。你可以查看全部记录，或先去工作台创建新的笔记任务。'}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {isAll ? (
            <Button onClick={onCreate} className="h-11 rounded-xl px-5">
              去工作台生成笔记
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button onClick={onShowAll} className="h-10 rounded-xl px-4">
                查看全部任务
              </Button>
              <Button variant="outline" onClick={onCreate} className="h-10 rounded-xl px-4">
                去工作台
              </Button>
            </>
          )}
        </div>

        {isAll && (
          <div className="mt-8 grid w-full max-w-[560px] gap-2 sm:grid-cols-3">
            {['提交视频', '跟踪进度', '打开笔记'].map((step, index) => (
              <div
                key={step}
                className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs text-neutral-500"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-medium text-neutral-500">
                  {index + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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

  // 加入合集 dialog（单篇传 1 个 id，批量传多个）
  const [addCollectionTaskIds, setAddCollectionTaskIds] = useState<string[]>([])

  // batch delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()
  const removeTask = useTaskStore(state => state.removeTask)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)

  const hasRunning = (list: TaskSummary[]) => list.some(t => RUNNING_STATUSES.has(t.status))

  const startTimer = useCallback((loadFn: () => void) => {
    if (timerRef.current) return
    timerRef.current = setInterval(() => {
      loadFn()
    }, 60_000)
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

  const silentLoad = useCallback(() => {
    load()
  }, [load])

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
      setSelectedIds(prev => {
        const s = new Set(prev)
        s.delete(taskId)
        return s
      })
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

  // 按 batch_id 分组统计（用于在批量任务的首行渲染分组标签）
  const batchCounts = new Map<string, number>()
  filtered.forEach(t => {
    if (t.batch_id) batchCounts.set(t.batch_id, (batchCounts.get(t.batch_id) || 0) + 1)
  })
  const seenBatchIds = new Set<string>()

  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.task_id))
  const someFilteredSelected = filtered.some(t => selectedIds.has(t.task_id))
  // 只有已完成的笔记才能加入合集
  const selectedSuccessIds = tasks
    .filter(t => selectedIds.has(t.task_id) && t.status === 'SUCCESS')
    .map(t => t.task_id)

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
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={selectedSuccessIds.length === 0}
                onClick={() => setAddCollectionTaskIds(selectedSuccessIds)}
              >
                <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                批量加入合集 ({selectedSuccessIds.length})
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBatchDialogOpen(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                批量删除 ({selectedIds.size})
              </Button>
            </>
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
                ? 'text-primary after:bg-primary font-medium after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span
                className={`rounded-full px-1.5 py-0 text-[10px] leading-4 font-medium ${
                  activeTab === tab.key
                    ? 'bg-primary/10 text-primary'
                    : 'bg-neutral-100 text-neutral-500'
                }`}
              >
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
          <EmptyTasksState
            activeTab={activeTab}
            onCreate={() => navigate('/')}
            onShowAll={() => setActiveTab('ALL')}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                <th className="w-10 px-4 py-2.5 text-left font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={el => {
                      if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected
                    }}
                    onChange={toggleSelectAll}
                    className="accent-primary h-3.5 w-3.5 cursor-pointer"
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
              {filtered.map(task => {
                const isBatchStart = !!task.batch_id && !seenBatchIds.has(task.batch_id)
                if (task.batch_id) seenBatchIds.add(task.batch_id)
                return (
                  <Fragment key={task.task_id}>
                    {isBatchStart && (
                      <tr key={`batch-${task.batch_id}`} className="bg-neutral-50/80">
                        <td
                          colSpan={9}
                          className="px-4 py-1.5 text-[11px] font-medium text-neutral-400"
                        >
                          批量任务 · {batchCounts.get(task.batch_id!)} 个视频
                        </td>
                      </tr>
                    )}
                    <tr
                      className={`group transition-colors hover:bg-neutral-50/60 ${selectedIds.has(task.task_id) ? 'bg-primary/5' : ''}`}
                    >
                      {/* 勾选 */}
                      <td className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(task.task_id)}
                          onChange={() => toggleSelect(task.task_id)}
                          className="accent-primary h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>

                      {/* 视频链接 + 封面 */}
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <CoverImage src={task.cover_url} platform={task.platform} />
                          <div className="min-w-0">
                            <div className="max-w-[240px] truncate text-xs leading-snug font-medium text-gray-800">
                              {task.title || task.video_id || '未命名'}
                            </div>
                            {task.video_url ? (
                              <a
                                href={task.video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-0.5 flex max-w-[240px] items-center gap-0.5 truncate text-[11px] text-blue-500 hover:underline"
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
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setCurrentTask(task.task_id)
                                  navigate('/')
                                }}
                              >
                                查看笔记
                              </Button>
                              <button
                                onClick={() => setAddCollectionTaskIds([task.task_id])}
                                className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-blue-50 hover:text-blue-500"
                                title="加入合集"
                              >
                                <FolderPlus className="h-3.5 w-3.5" />
                              </button>
                            </>
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
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* 单条删除确认 dialog */}
      <Dialog
        open={deleteDialogId !== null}
        onOpenChange={open => {
          if (!open) setDeleteDialogId(null)
        }}
      >
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
              {deletingId === deleteDialogId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                '确认删除'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除确认 dialog */}
      <Dialog
        open={batchDialogOpen}
        onOpenChange={open => {
          if (!open) setBatchDialogOpen(false)
        }}
      >
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
              {batchDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `确认删除 (${selectedIds.size})`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddToCollectionDialog
        taskIds={addCollectionTaskIds}
        open={addCollectionTaskIds.length > 0}
        onOpenChange={open => {
          if (!open) setAddCollectionTaskIds([])
        }}
        onAdded={() => setSelectedIds(new Set())}
      />
    </div>
  )
}
