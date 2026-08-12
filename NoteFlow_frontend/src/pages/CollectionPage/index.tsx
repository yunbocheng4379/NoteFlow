import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenText,
  BrainCircuit,
  Folder,
  Layers3,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useCollectionStore } from '@/store/collectionStore'
import { useUserStore } from '@/store/userStore'
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
  const { collections, loading, loaded, loadCollections, createCollection } = useCollectionStore()
  const activeSubscription = useUserStore(s => s.activeSubscription)
  const isPro = !!activeSubscription
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isPro) loadCollections(true)
  }, [isPro, loadCollections])

  const filtered = useMemo(() => {
    if (!search.trim()) return collections
    const kw = search.trim().toLowerCase()
    return collections.filter(
      c => c.name.toLowerCase().includes(kw) || c.description?.toLowerCase().includes(kw)
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
      const created = await createCollection({
        name: name.trim(),
        description: description.trim() || undefined,
      })
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

  if (!isPro) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-[#fbfcfc]">
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-white px-8 py-4">
          <div className="text-primary relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-100 bg-[var(--primary-light)] shadow-sm">
            <Layers3 className="h-5 w-5" />
            <span className="text-primary absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-lg border border-white bg-white shadow-sm">
              <BookOpenText className="h-3 w-3" />
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">笔记合集</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              把同一主题的笔记集中管理，后续可继续融合、分享和导出。
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
          <div className="flex w-full max-w-[760px] flex-col items-center text-center">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Pro 专属
            </div>

            <div className="relative mb-7 h-28 w-40">
              <div className="absolute top-8 left-1 h-16 w-24 rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="mt-4 space-y-2 px-3">
                  <div className="h-1.5 w-12 rounded-full bg-amber-50" />
                  <div className="h-1.5 w-16 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1 right-1 h-20 w-28 rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="mt-4 flex items-center gap-2 px-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <div className="h-1.5 flex-1 rounded-full bg-amber-50" />
                </div>
                <div className="mt-3 space-y-2 px-3">
                  <div className="h-1.5 w-20 rounded-full bg-neutral-100" />
                  <div className="h-1.5 w-14 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl bg-amber-50 text-amber-600 shadow-[0_18px_45px_rgba(245,158,11,0.14)]">
                <Layers3 className="h-9 w-9" />
              </div>
              <div className="absolute right-5 bottom-2 flex h-9 w-9 items-center justify-center rounded-xl border border-amber-100 bg-white text-amber-600 shadow-sm">
                <BookOpenText className="h-4 w-4" />
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-normal text-gray-900">
              升级 Pro，开启笔记合集
            </p>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-neutral-500">
              将同一课程、主题或批量生成的笔记整理到合集内，后续可以融合成综合笔记、统一分享和批量导出。
            </p>

            <Button onClick={() => navigate('/upgrade')} className="mt-7 h-11 rounded-xl px-5">
              升级 Pro
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <div className="mt-8 grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
              {[
                { title: '主题归档', desc: '课程、项目、资料按合集整理' },
                { title: '笔记融合', desc: '多篇内容汇总为一篇综合笔记' },
                { title: '分享导出', desc: '统一分享或导出为资料包' },
              ].map(item => (
                <div
                  key={item.title}
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm shadow-neutral-100/60"
                >
                  <p className="text-xs font-medium text-gray-800">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-400">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-1.5 text-xs text-neutral-400">
              <BrainCircuit className="h-3.5 w-3.5" />
              合集能力可配合知识库问答一起使用
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#f5f5f5] px-8 py-6">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="text-primary relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-100 bg-[var(--primary-light)] shadow-sm">
            <Layers3 className="h-5 w-5" />
            <span className="text-primary absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-lg border border-white bg-white shadow-sm">
              <BookOpenText className="h-3 w-3" />
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">笔记合集</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              把同一主题的笔记集中管理，后续可继续融合、分享和导出。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-neutral-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
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

      {!loaded ? (
        <div className="flex min-h-0 flex-1" />
      ) : collections.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
          <div className="flex w-full max-w-[760px] flex-col items-center text-center">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Pro 专属
            </div>

            <div className="relative mb-7 h-28 w-40">
              <div className="absolute top-8 left-1 h-16 w-24 rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="mt-4 space-y-2 px-3">
                  <div className="h-1.5 w-12 rounded-full bg-amber-50" />
                  <div className="h-1.5 w-16 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1 right-1 h-20 w-28 rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="mt-4 flex items-center gap-2 px-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <div className="h-1.5 flex-1 rounded-full bg-amber-50" />
                </div>
                <div className="mt-3 space-y-2 px-3">
                  <div className="h-1.5 w-20 rounded-full bg-neutral-100" />
                  <div className="h-1.5 w-14 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl bg-amber-50 text-amber-600 shadow-[0_18px_45px_rgba(245,158,11,0.14)]">
                <Layers3 className="h-9 w-9" />
              </div>
              <div className="absolute right-5 bottom-2 flex h-9 w-9 items-center justify-center rounded-xl border border-amber-100 bg-white text-amber-600 shadow-sm">
                <BookOpenText className="h-4 w-4" />
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-normal text-gray-900">
              还没有笔记合集
            </p>
            <p className="mt-3 max-w-[520px] text-sm leading-6 text-neutral-500">
              把同一课程、主题或批量生成的笔记整理进合集，后续可以融合成综合笔记、统一分享和批量导出。
            </p>

            <Button onClick={() => setCreateOpen(true)} className="mt-7 h-11 rounded-xl px-5">
              <Plus className="mr-1 h-4 w-4" />
              新建第一个合集
            </Button>

            <div className="mt-8 grid w-full max-w-[560px] gap-2 sm:grid-cols-3">
              {['新建主题合集', '批量加入笔记', '融合 / 分享 / 导出'].map((step, index) => (
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

            <div className="mt-6 grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
              {[
                { title: '主题归档', desc: '课程、项目、资料按合集整理', Icon: Folder },
                { title: '笔记融合', desc: '多篇内容汇总为一篇综合笔记', Icon: Layers3 },
                { title: '知识联动', desc: '配合知识库跨笔记检索问答', Icon: BrainCircuit },
              ].map(item => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm shadow-neutral-100/60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <item.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {filtered.map(c => {
              const coverSrc = c.cover_url
                ? c.cover_url.startsWith('http')
                  ? c.cover_url
                  : `${API_BASE}${c.cover_url}`
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
        </>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>新建合集</DialogTitle>
            <DialogDescription>创建后可以把笔记加入这个合集。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">合集名称</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="例如：Python 入门课程"
                maxLength={100}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                描述（可选）
              </label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
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
