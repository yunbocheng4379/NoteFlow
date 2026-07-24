import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folder, Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCollectionStore } from '@/store/collectionStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

function formatShortDate(dateStr?: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const CollectionPage = () => {
  const navigate = useNavigate()
  const { collections, loading, loadCollections, createCollection } = useCollectionStore()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadCollections(true)
  }, [loadCollections])

  const filtered = useMemo(() => {
    if (!search.trim()) return collections
    const kw = search.trim().toLowerCase()
    return collections.filter(
      (c) => c.name.toLowerCase().includes(kw) || c.description?.toLowerCase().includes(kw),
    )
  }, [collections, search])

  const resetForm = () => {
    setName('')
    setDescription('')
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('请输入合集名称')
      return
    }
    setSubmitting(true)
    try {
      const created = await createCollection({ name: name.trim(), description: description.trim() || undefined })
      toast.success('合集创建成功')
      setCreateOpen(false)
      resetForm()
      navigate(`/collections/${created.id}`)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#f5f5f5] px-8 py-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
            <Folder className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">笔记合集</h1>
            <p className="mt-0.5 text-sm text-neutral-500">把同一主题的笔记集中管理，后续可继续融合、分享和导出。</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索合集名 / 描述"
              className="h-9 w-64 pl-8 text-sm"
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新建合集
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {filtered.map((c) => {
          const coverSrc = c.cover_url
            ? c.cover_url.startsWith('http') ? c.cover_url : `${API_BASE}${c.cover_url}`
            : null
          return (
            <button
              key={c.id}
              onClick={() => navigate(`/collections/${c.id}`)}
              className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-shadow hover:shadow-md"
            >
              <div className="flex h-32 items-center justify-center bg-neutral-50">
                {coverSrc ? (
                  <img src={coverSrc} alt={c.name} className="h-full w-full object-cover" />
                ) : (
                  <Folder className="h-10 w-10 text-neutral-300" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 border-t border-neutral-100 px-3 py-2.5">
                <span className="truncate text-sm font-medium text-neutral-800">{c.name}</span>
                <div className="flex items-center gap-3 text-xs text-neutral-400">
                  <span>{c.note_count} 篇笔记</span>
                  <span>{formatShortDate(c.updated_at)}</span>
                </div>
              </div>
            </button>
          )
        })}

        <button
          onClick={() => setCreateOpen(true)}
          className="flex h-full min-h-[176px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100">
            <Plus className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">新建合集</span>
          <span className="text-xs text-neutral-400">整理课程、主题或批量生成的笔记</span>
        </button>
      </div>

      {!loading && filtered.length === 0 && collections.length > 0 && (
        <p className="mt-6 text-center text-sm text-neutral-400">没有匹配的合集</p>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm() }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>新建合集</DialogTitle>
            <DialogDescription>创建后可以把笔记加入这个合集。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">合集名称</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Python 入门课程" maxLength={100} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">描述（可选）</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个合集是关于…"
                rows={3}
                maxLength={500}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={submitting} onClick={handleCreate}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CollectionPage
