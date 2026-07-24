import { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getTasks, type TaskSummary } from '@/services/task'
import { addCollectionItems } from '@/services/collection'

interface AddNotesToCollectionDialogProps {
  collectionId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 已在合集内的 task_id，用于禁用/隐藏，避免重复勾选 */
  existingTaskIds?: string[]
  onAdded?: () => void
}

const AddNotesToCollectionDialog = ({
  collectionId,
  open,
  onOpenChange,
  existingTaskIds = [],
  onAdded,
}: AddNotesToCollectionDialogProps) => {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSearch('')
    setLoading(true)
    getTasks()
      .then(setTasks)
      .finally(() => setLoading(false))
  }, [open])

  const existingSet = new Set(existingTaskIds)
  const availableTasks = tasks.filter((t) => t.status === 'SUCCESS' && !existingSet.has(t.task_id))
  const filteredTasks = search.trim()
    ? availableTasks.filter((t) => t.title?.toLowerCase().includes(search.trim().toLowerCase()))
    : availableTasks

  const toggle = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!collectionId || selected.size === 0) return
    setSubmitting(true)
    try {
      await addCollectionItems(collectionId, Array.from(selected))
      toast.success(`已加入 ${selected.size} 篇笔记`)
      onAdded?.()
      onOpenChange(false)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>添加笔记到合集</DialogTitle>
          <DialogDescription>勾选要加入该合集的笔记，可多选。</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索笔记标题…"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <ScrollArea className="h-72 rounded-md border border-neutral-100">
          {loading ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-neutral-400">
              暂无可添加的笔记
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {filteredTasks.map((t) => (
                <label
                  key={t.task_id}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-neutral-50"
                >
                  <Checkbox
                    checked={selected.has(t.task_id)}
                    onChange={() => toggle(t.task_id)}
                  />
                  {t.cover_url ? (
                    <img src={t.cover_url} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-8 w-12 shrink-0 rounded bg-neutral-100" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">
                    {t.title || t.video_id}
                  </span>
                </label>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={selected.size === 0 || submitting} onClick={handleSubmit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `加入 (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AddNotesToCollectionDialog
