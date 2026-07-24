import { useEffect, useState } from 'react'
import { Loader2, Folder } from 'lucide-react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCollectionStore } from '@/store/collectionStore'
import { addCollectionItems } from '@/services/collection'

interface AddToCollectionDialogProps {
  taskIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => void
}

/** 把一篇或多篇笔记加入某个已有合集，供任务列表页「加入合集」/「批量加入合集」操作使用 */
const AddToCollectionDialog = ({ taskIds, open, onOpenChange, onAdded }: AddToCollectionDialogProps) => {
  const { collections, loading, loadCollections, patchCollection } = useCollectionStore()
  const [submittingId, setSubmittingId] = useState<number | null>(null)

  useEffect(() => {
    if (open) loadCollections()
  }, [open, loadCollections])

  const handleAdd = async (collectionId: number) => {
    if (taskIds.length === 0) return
    setSubmittingId(collectionId)
    try {
      const result = await addCollectionItems(collectionId, taskIds)
      patchCollection(collectionId, { note_count: result.note_count })
      toast.success(taskIds.length > 1 ? `已加入 ${taskIds.length} 篇笔记` : '已加入合集')
      onAdded?.()
      onOpenChange(false)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>加入合集</DialogTitle>
          <DialogDescription>选择要加入的合集。</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-72">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
            </div>
          ) : collections.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-neutral-400">
              还没有合集，先去「笔记合集」创建一个
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {collections.map((c) => (
                <button
                  key={c.id}
                  disabled={submittingId !== null}
                  onClick={() => handleAdd(c.id)}
                  className="flex w-full items-center gap-2.5 px-1 py-2.5 text-left hover:bg-neutral-50 disabled:opacity-50"
                >
                  <Folder className="h-4 w-4 shrink-0 text-neutral-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{c.name}</span>
                  <span className="text-xs text-neutral-400">{c.note_count} 篇</span>
                  {submittingId === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AddToCollectionDialog
