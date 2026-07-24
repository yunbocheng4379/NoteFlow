import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Folder,
  Lightbulb,
  Share2,
  Download,
  BookOpenText,
  FileDown,
  MoreVertical,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Loader2,
  Plus,
  Check,
  Sparkles,
  ListChecks,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getCollection,
  listCollectionItems,
  removeCollectionItems,
  uploadCollectionCover,
  updateCollection as updateCollectionApi,
  exportCollectionZip,
  exportCollectionObsidian,
  mergeCollectionNotes,
  type NoteCollection,
  type CollectionNoteItem,
} from '@/services/collection'
import { get_task_status } from '@/services/note'
import { useCollectionStore } from '@/store/collectionStore'
import { useModelStore } from '@/store/modelStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import AddNotesToCollectionDialog from '@/components/AddNotesToCollectionDialog'
import ShareCollectionDialog from '@/components/ShareCollectionDialog'
import FlashcardGenerateDialog from '@/components/FlashcardGenerateDialog'
import { useTaskStore } from '@/store/taskStore'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

function NoteCoverImage({ src, alt, platform }: { src: string; alt: string; platform: string }) {
  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const proxied = src && platform !== 'local'
    ? `${baseURL}/image_proxy?url=${encodeURIComponent(src)}`
    : src

  if (proxied) {
    return (
      <img
        src={proxied}
        alt=""
        title={alt}
        className="h-full w-full object-cover"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }

  if (platform === 'merged') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-primary/70 text-white/80">
        <Sparkles className="h-8 w-8" />
      </div>
    )
  }

  return <Folder className="h-8 w-8 text-neutral-300" />
}

interface MergeJob {
  taskId: string
  title: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  message?: string
}

const MERGE_QUEUE_STATUS_CONFIG: Record<MergeJob['status'], { label: string; icon: React.ReactNode; className: string }> = {
  RUNNING: {
    label: '融合中',
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className: 'text-blue-600',
  },
  SUCCESS: {
    label: '已完成',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className: 'text-emerald-600',
  },
  FAILED: {
    label: '失败',
    icon: <XCircle className="h-3.5 w-3.5" />,
    className: 'text-red-500',
  },
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

const CollectionDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const collectionId = Number(id)
  const navigate = useNavigate()
  const patchCollection = useCollectionStore((s) => s.patchCollection)
  const setCurrentTask = useTaskStore((s) => s.setCurrentTask)
  const modelList = useModelStore((s) => s.modelList)
  const loadEnabledModels = useModelStore((s) => s.loadEnabledModels)

  const [collection, setCollection] = useState<NoteCollection | null>(null)
  const [items, setItems] = useState<CollectionNoteItem[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [removeTarget, setRemoveTarget] = useState<CollectionNoteItem | null>(null)
  const [removing, setRemoving] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingObsidian, setExportingObsidian] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const [shareOpen, setShareOpen] = useState(false)
  const [flashcardOpen, setFlashcardOpen] = useState(false)

  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeModelName, setMergeModelName] = useState('')
  const [merging, setMerging] = useState(false)

  const [mergeJobs, setMergeJobs] = useState<MergeJob[]>([])
  const [mergeQueueOpen, setMergeQueueOpen] = useState(false)
  const mergeQueueRef = useRef<HTMLDivElement>(null)

  const load = () => {
    if (!collectionId) return
    setLoading(true)
    Promise.all([getCollection(collectionId), listCollectionItems(collectionId)])
      .then(([c, its]) => {
        setCollection(c)
        setItems(its)
      })
      .catch(() => navigate('/collections'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId])

  useEffect(() => {
    if (modelList.length === 0) loadEnabledModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
      if (mergeQueueRef.current && !mergeQueueRef.current.contains(e.target as Node)) setMergeQueueOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 轮询正在融合中的任务，更新队列状态；全部结束后停止轮询
  useEffect(() => {
    const hasRunning = mergeJobs.some((j) => j.status === 'RUNNING')
    if (!hasRunning) return

    const timer = setInterval(async () => {
      const running = mergeJobs.filter((j) => j.status === 'RUNNING')
      for (const job of running) {
        try {
          const res: any = await get_task_status(job.taskId)
          if (res.status === 'SUCCESS') {
            setMergeJobs((prev) =>
              prev.map((j) => (j.taskId === job.taskId ? { ...j, status: 'SUCCESS' } : j)),
            )
            toast.success(`融合笔记「${job.title}」已完成`)
            load()
          } else if (res.status === 'FAILED') {
            setMergeJobs((prev) =>
              prev.map((j) => (j.taskId === job.taskId ? { ...j, status: 'FAILED', message: res.msg } : j)),
            )
            toast.error(`融合笔记「${job.title}」失败`)
          }
        } catch {
          setMergeJobs((prev) =>
            prev.map((j) => (j.taskId === job.taskId ? { ...j, status: 'FAILED' } : j)),
          )
        }
      }
    }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeJobs])

  const coverSrc = useMemo(() => {
    if (!collection?.cover_url) return null
    return collection.cover_url.startsWith('http') ? collection.cover_url : `${API_BASE}${collection.cover_url}`
  }, [collection?.cover_url])

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleRemoveItem = async () => {
    if (!collectionId || !removeTarget) return
    const taskId = removeTarget.task_id
    setRemoving(true)
    try {
      await removeCollectionItems(collectionId, [taskId])
      setItems((prev) => prev.filter((it) => it.task_id !== taskId))
      setCollection((prev) => (prev ? { ...prev, note_count: Math.max(0, prev.note_count - 1) } : prev))
      patchCollection(collectionId, { note_count: Math.max(0, (collection?.note_count ?? 1) - 1) })
      setSelectedIds((prev) => {
        if (!prev.has(taskId)) return prev
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
      toast.success('已从合集移出')
      setRemoveTarget(null)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setRemoving(false)
    }
  }

  const openEdit = () => {
    if (!collection) return
    setEditName(collection.name)
    setEditDescription(collection.description || '')
    setEditOpen(true)
    setMoreOpen(false)
  }

  const handleSaveEdit = async () => {
    if (!collectionId || !editName.trim()) {
      toast.error('请输入合集名称')
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateCollectionApi(collectionId, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      })
      setCollection(updated)
      patchCollection(collectionId, updated)
      toast.success('已保存')
      setEditOpen(false)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!collectionId) return
    setDeleting(true)
    try {
      const { deleteCollection } = useCollectionStore.getState()
      await deleteCollection(collectionId)
      toast.success('合集已删除')
      navigate('/collections')
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setDeleting(false)
    }
  }

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !collectionId) return
    try {
      const updated = await uploadCollectionCover(collectionId, file)
      setCollection(updated)
      patchCollection(collectionId, updated)
      toast.success('封面已更新')
    } catch {
      // request 拦截器已 toast 错误
    }
    setMoreOpen(false)
  }

  const handleExportZip = async () => {
    if (!collectionId || !collection) return
    if (items.length === 0) {
      toast.error('合集内暂无笔记，无法导出')
      return
    }
    setExporting(true)
    try {
      await exportCollectionZip(collectionId, collection.name)
    } catch {
      toast.error('导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const handleExportObsidian = async () => {
    if (!collectionId || !collection) return
    if (items.length === 0) {
      toast.error('合集内暂无笔记，无法导出')
      return
    }
    setExportingObsidian(true)
    try {
      await exportCollectionObsidian(collectionId, collection.name)
    } catch {
      toast.error('导出失败，请稍后重试')
    } finally {
      setExportingObsidian(false)
    }
  }

  const openMergeDialog = () => {
    if (selectedIds.size < 2) {
      toast.error('请至少选择 2 篇笔记再进行融合')
      return
    }
    if (!mergeModelName && modelList.length > 0) setMergeModelName(modelList[0].model_name)
    setMergeOpen(true)
  }

  const handleMerge = async () => {
    if (!collectionId) return
    const selected = modelList.find((m) => m.model_name === mergeModelName)
    if (!selected) {
      toast.error('请选择融合使用的模型')
      return
    }
    setMerging(true)
    try {
      const selectedTitles = items
        .filter((it) => selectedIds.has(it.task_id))
        .map((it) => it.title || it.video_id)
      const jobTitle = selectedTitles.slice(0, 2).join(' + ') + (selectedTitles.length > 2 ? ' 等' : '')

      const { task_id } = await mergeCollectionNotes(
        collectionId,
        Array.from(selectedIds),
        selected.provider_id,
        selected.model_name,
      )
      setMergeJobs((prev) => [{ taskId: task_id, title: jobTitle, status: 'RUNNING' }, ...prev])
      setMergeQueueOpen(true)
      toast.success('融合任务已提交，生成完成后会自动加入本合集')
      setMergeOpen(false)
      setSelectedIds(new Set())
      load()
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setMerging(false)
    }
  }

  const openFlashcardDialog = () => {
    if (selectedIds.size !== 1) {
      toast.error('请先选择一篇笔记再生成闪记卡')
      return
    }
    setFlashcardOpen(true)
  }

  const flashcardTaskId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!collection) return null

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#f5f5f5] px-8 py-6">
      <Link to="/collections" className="mb-4 flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" />
        返回合集列表
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
            {coverSrc ? (
              <img src={coverSrc} alt={collection.name} className="h-full w-full object-cover" />
            ) : (
              <Folder className="h-7 w-7 text-neutral-300" />
            )}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">{collection.name}</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              {collection.note_count} 篇笔记 · 更新于 {formatDateTime(collection.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mergeJobs.length > 0 && (
            <div className="relative" ref={mergeQueueRef}>
              <Button size="sm" variant="outline" onClick={() => setMergeQueueOpen((v) => !v)}>
                <ListChecks className="h-4 w-4" />
                融合队列
                {mergeJobs.some((j) => j.status === 'RUNNING') && (
                  <span className="ml-0.5 flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </Button>
              {mergeQueueOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
                  <div className="border-b border-neutral-100 px-3 py-2">
                    <span className="text-xs font-medium text-neutral-500">融合任务队列</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {mergeJobs.map((job) => {
                      const cfg = MERGE_QUEUE_STATUS_CONFIG[job.status]
                      return (
                        <div
                          key={job.taskId}
                          className="flex items-start gap-2 border-b border-neutral-50 px-3 py-2.5 last:border-b-0"
                        >
                          <span className={`mt-0.5 shrink-0 ${cfg.className}`}>{cfg.icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-neutral-700" title={job.title}>
                              {job.title || '融合笔记'}
                            </p>
                            <p className={`mt-0.5 text-xs ${cfg.className}`}>{cfg.label}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" disabled={selectedIds.size < 2} onClick={openMergeDialog}>
                  <Lightbulb className="h-4 w-4" />
                  融合成笔记
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{selectedIds.size < 2 ? '请至少选择 2 篇笔记' : `融合选中的 ${selectedIds.size} 篇笔记`}</TooltipContent>
          </Tooltip>

          <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" />
            分享
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button size="sm" variant="outline" disabled={selectedIds.size !== 1} onClick={openFlashcardDialog}>
                  <BookOpenText className="h-4 w-4" />
                  闪记卡
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{selectedIds.size === 1 ? '生成闪记卡' : '请先选择一篇笔记'}</TooltipContent>
          </Tooltip>

          <Button size="sm" variant="outline" disabled={exportingObsidian} onClick={handleExportObsidian}>
            {exportingObsidian ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            导出 Obsidian
          </Button>

          <Button size="sm" variant="outline" disabled={exporting} onClick={handleExportZip}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            导出 ZIP
          </Button>

          <div className="relative" ref={moreRef}>
            <Button size="sm" variant="outline" onClick={() => setMoreOpen((v) => !v)}>
              <MoreVertical className="h-4 w-4" />
              更多
            </Button>
            {moreOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
                <button
                  onClick={() => coverInputRef.current?.click()}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  设置封面
                </button>
                <button
                  onClick={openEdit}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑信息
                </button>
                <div className="mx-2 h-px bg-neutral-100" />
                <button
                  onClick={() => { setDeleteOpen(true); setMoreOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除合集
                </button>
              </div>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleCoverChange}
            />
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between border-t border-neutral-100 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">合集内笔记</h2>
          <p className="text-xs text-neutral-400">
            {items.length} 篇内容，按封面浏览合集结构
            {selectedIds.size > 0 && (
              <>
                {' · '}
                已选 {selectedIds.size} 篇
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="ml-1.5 text-blue-600 hover:underline"
                >
                  清除选择
                </button>
              </>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          添加笔记
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-16 text-center text-sm text-neutral-400">
          合集还没有笔记。去任务列表把已生成的笔记加进来，或者新建笔记时选这个合集。
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {items.map((it) => {
            const selected = selectedIds.has(it.task_id)
            return (
              <div
                key={it.task_id}
                className={`group relative flex flex-col overflow-hidden rounded-xl border bg-white ${
                  selected ? 'border-primary ring-1 ring-primary/40' : 'border-neutral-200'
                }`}
              >
                <button
                  onClick={() => toggleSelect(it.task_id)}
                  className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border shadow ${
                    selected
                      ? 'border-primary bg-primary text-white'
                      : 'border-neutral-300 bg-white/90 text-transparent opacity-0 group-hover:opacity-100'
                  }`}
                  title="选择笔记"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => { setCurrentTask(it.task_id); navigate('/') }}
                  className="flex h-28 items-center justify-center bg-neutral-50"
                >
                  <NoteCoverImage src={it.cover_url} alt={it.title} platform={it.platform} />
                </button>
                <div className="flex flex-1 flex-col gap-1 border-t border-neutral-100 px-3 py-2.5">
                  <span className="truncate text-sm font-medium text-neutral-800">{it.title || it.video_id}</span>
                </div>
                <button
                  onClick={() => setRemoveTarget(it)}
                  className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-white/90 text-neutral-500 shadow group-hover:flex hover:text-red-500"
                  title="从合集移出"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>编辑合集信息</DialogTitle>
            <DialogDescription>修改合集的名称和描述。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">合集名称</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">描述（可选）</label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                maxLength={500}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={editSubmitting} onClick={handleSaveEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除合集</AlertDialogTitle>
            <AlertDialogDescription>
              删除后合集内的笔记不会被删除，仍保留在任务列表中。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从合集移出</AlertDialogTitle>
            <AlertDialogDescription>
              确定要将「{removeTarget?.title || removeTarget?.video_id}」从本合集移出吗？笔记本身不会被删除，仍保留在任务列表中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={removing}
              onClick={handleRemoveItem}
            >
              {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认移出'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddNotesToCollectionDialog
        collectionId={collectionId}
        open={addOpen}
        onOpenChange={setAddOpen}
        existingTaskIds={items.map((it) => it.task_id)}
        onAdded={load}
      />

      <ShareCollectionDialog collectionId={collectionId} open={shareOpen} onOpenChange={setShareOpen} />

      <FlashcardGenerateDialog taskId={flashcardTaskId} open={flashcardOpen} onOpenChange={setFlashcardOpen} />

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>融合成笔记</DialogTitle>
            <DialogDescription>
              把选中的 {selectedIds.size} 篇笔记通过 AI 融合成一篇新笔记，自动加入本合集，原笔记保持不变。
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">融合使用的模型</label>
            <Select value={mergeModelName} onValueChange={setMergeModelName}>
              <SelectTrigger className="w-full shadow-none">
                <SelectValue placeholder="请选择模型" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem key={m.id} value={m.model_name}>
                    {m.model_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={merging || !mergeModelName} onClick={handleMerge}>
              {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              开始融合
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CollectionDetailPage
