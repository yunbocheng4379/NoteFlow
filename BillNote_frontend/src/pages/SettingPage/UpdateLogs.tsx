import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Megaphone,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Send,
  StopCircle,
  Plus,
  RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'

import {
  adminUpdateLogApi,
  type UpdateLogItem,
  type UpdateLogStatus,
} from '@/services/updateLog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const PAGE_SIZE = 20

const STATUS_LABEL: Record<UpdateLogStatus, string> = {
  pending: '未通知',
  active: '通知中',
  ended: '已结束',
}

const STATUS_BADGE: Record<UpdateLogStatus, string> = {
  pending: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ended: 'bg-amber-50 text-amber-700 ring-amber-200',
}

const STATUS_OPTIONS: { value: UpdateLogStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '未通知' },
  { value: 'active', label: '通知中' },
  { value: 'ended', label: '已结束' },
]

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function UpdateLogsAdminPage() {
  const [items, setItems] = useState<UpdateLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(PAGE_SIZE)
  const [status, setStatus] = useState<UpdateLogStatus | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [loading, setLoading] = useState(false)

  const [active, setActive] = useState<UpdateLogItem | null>(null)
  const [editing, setEditing] = useState<UpdateLogItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UpdateLogItem | null>(null)
  const [busy, setBusy] = useState(false)

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  )

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const res = await adminUpdateLogApi.list({
          status: status === 'all' ? undefined : status,
          keyword: appliedKeyword || undefined,
          page: targetPage,
          page_size: pageSize,
        })
        setItems(res.items)
        setTotal(res.total)
        setPage(res.page)
      } catch {
        // toast handled by interceptor
      } finally {
        setLoading(false)
      }
    },
    [status, appliedKeyword, pageSize],
  )

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedKeyword])

  const handleSearch = () => {
    setAppliedKeyword(keyword.trim())
  }

  const refetchCurrentPage = () => load(page)

  // ── 发布 (publish) ──
  const handlePublish = async (it: UpdateLogItem) => {
    setBusy(true)
    try {
      const updated = await adminUpdateLogApi.publish(it.id)
      toast.success('已发布，当前正在通知所有用户')
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      if (editing?.id === updated.id) setEditing(updated)
      refetchCurrentPage()
    } catch (e: any) {
      const msg = e?.msg || e?.response?.data?.msg || '发布失败'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  // ── 结束 (end) ──
  const handleEnd = async (it: UpdateLogItem) => {
    setBusy(true)
    try {
      const updated = await adminUpdateLogApi.end(it.id)
      toast.success('已结束通知')
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      if (editing?.id === updated.id) setEditing(updated)
      refetchCurrentPage()
    } catch {
      // toast handled by interceptor
    } finally {
      setBusy(false)
    }
  }

  // ── 删除 ──
  const handleDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await adminUpdateLogApi.remove(deleteTarget.id)
      toast.success('已删除')
      setDeleteTarget(null)
      refetchCurrentPage()
    } catch {
      // toast handled by interceptor
    } finally {
      setBusy(false)
    }
  }

  // ── 保存编辑/创建 ──
  const handleSave = async (payload: {
    id?: number
    title: string
    summary: string
    content: string
    version: string | null
  }) => {
    setBusy(true)
    try {
      if (payload.id) {
        const updated = await adminUpdateLogApi.update(payload.id, {
          title: payload.title,
          summary: payload.summary,
          content: payload.content,
          version: payload.version,
        })
        toast.success('已保存')
        setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
        setEditing(null)
        if (active?.id === updated.id) setActive(updated)
      } else {
        const created = await adminUpdateLogApi.create({
          title: payload.title,
          summary: payload.summary,
          content: payload.content,
          version: payload.version,
        })
        toast.success('已创建（状态：未通知）')
        setCreating(false)
        setItems((prev) => [created, ...prev])
        setTotal((t) => t + 1)
      }
    } catch {
      // toast handled by interceptor
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
      <div className="mx-auto w-full max-w-6xl shrink-0 px-6 pt-6">
        {/* 顶部 */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold text-neutral-900">更新日志配置</h1>
            {total > 0 && (
              <span className="ml-2 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                共 {total} 条
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => refetchCurrentPage()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="ml-1">刷新</span>
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              新建
            </Button>
          </div>
        </div>

        {/* 说明 */}
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-700">
          <div>
            <strong>pending</strong>（未通知）= 提前写好但还没发布，仅管理员可见；
            <strong> active</strong>（通知中）= 顶栏横幅 + 用户页可见，<b>任意时刻全局唯一</b>；
            <strong> ended</strong>（已结束）= 仅用户页可见的历史记录。
          </div>
          <div className="mt-1 text-blue-600/80">
            发布新日志前要先「结束」当前通知中的那条。
          </div>
        </div>

        {/* 工具栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索标题/简介/正文"
              className="h-9 w-64 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleSearch}>
            搜索
          </Button>

          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as UpdateLogStatus | 'all')
              setPage(1)
            }}
          >
            <SelectTrigger className="h-9 w-[140px] border-neutral-200 bg-white text-sm shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              暂无更新日志
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start gap-3 px-5 py-4 hover:bg-neutral-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">{it.title}</span>
                      {it.version && (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">
                          {it.version}
                        </span>
                      )}
                      <span
                        className={`rounded px-2 py-0.5 text-xs ring-1 ${STATUS_BADGE[it.status]}`}
                      >
                        {STATUS_LABEL[it.status]}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                      {it.summary}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                      <span>创建 {fmt(it.created_at)}</span>
                      {it.published_at && <span>发布 {fmt(it.published_at)}</span>}
                      {it.ended_at && <span>结束 {fmt(it.ended_at)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditing(it)}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        disabled={busy}
                        onClick={() => setDeleteTarget(it)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      {it.status !== 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          disabled={busy}
                          onClick={() => handlePublish(it)}
                          title="将该日志置为「通知中」"
                        >
                          <Send className="mr-1 h-3 w-3" />
                          发布
                        </Button>
                      )}
                      {it.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                          disabled={busy}
                          onClick={() => handleEnd(it)}
                          title="结束通知，移入「已结束」"
                        >
                          <StopCircle className="mr-1 h-3 w-3" />
                          结束
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <span>
                共 {total} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => load(page - 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => load(page + 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 编辑/创建 Modal */}
      {(editing || creating) && (
        <UpdateLogFormDialog
          mode={editing ? 'edit' : 'create'}
          initial={editing}
          busy={busy}
          onClose={() => {
            setEditing(null)
            setCreating(false)
          }}
          onSubmit={handleSave}
        />
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除更新日志"
        description={
          deleteTarget
            ? `将删除「${deleteTarget.title}」，此操作不可恢复。`
            : '此操作不可恢复。'
        }
        confirmText="确认删除"
        destructive
        loading={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ─── 表单对话框 ──────────────────────────────────────────────────────────────

interface FormState {
  title: string
  version: string
  summary: string
  content: string
}

interface UpdateLogFormDialogProps {
  mode: 'create' | 'edit'
  initial: UpdateLogItem | null
  busy: boolean
  onClose: () => void
  onSubmit: (payload: {
    id?: number
    title: string
    summary: string
    content: string
    version: string | null
  }) => void
}

function UpdateLogFormDialog({
  mode,
  initial,
  busy,
  onClose,
  onSubmit,
}: UpdateLogFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => ({
    title: initial?.title ?? '',
    version: initial?.version ?? '',
    summary: initial?.summary ?? '',
    content: initial?.content ?? '',
  }))

  useEffect(() => {
    setForm({
      title: initial?.title ?? '',
      version: initial?.version ?? '',
      summary: initial?.summary ?? '',
      content: initial?.content ?? '',
    })
  }, [initial])

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSave = () => {
    const title = form.title.trim()
    const summary = form.summary.trim()
    const content = form.content.trim()
    if (!title) return toast.error('请填写标题')
    if (!summary) return toast.error('请填写简介')
    if (!content) return toast.error('请填写内容')
    onSubmit({
      id: initial?.id,
      title,
      summary,
      content,
      version: form.version.trim() || null,
    })
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '编辑更新日志' : '新建更新日志'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-muted-foreground">标题 *</Label>
              <Input
                value={form.title}
                onChange={set('title')}
                placeholder="例如：新增 Cookie 池管理页面"
                maxLength={255}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">版本号 (可选)</Label>
              <Input
                value={form.version}
                onChange={set('version')}
                placeholder="v1.3.0"
                maxLength={32}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              简介 * <span className="text-neutral-400">(≤ 500 字，用于顶部通知条)</span>
            </Label>
            <Input
              value={form.summary}
              onChange={set('summary')}
              placeholder="一句话概括本次更新"
              maxLength={500}
            />
            <div className="text-right text-[11px] text-gray-300">
              {form.summary.length}/500
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">内容 * (Markdown)</Label>
            <Textarea
              rows={10}
              value={form.content}
              onChange={set('content')}
              placeholder="支持 Markdown: 标题、列表、代码块、链接..."
            />
          </div>

          {initial && (
            <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              状态：
              <span className={`ml-1 inline-block rounded px-2 py-0.5 text-xs ring-1 ${STATUS_BADGE[initial.status]}`}>
                {STATUS_LABEL[initial.status]}
              </span>
              {initial.published_at && (
                <span className="ml-3">发布 {fmt(initial.published_at)}</span>
              )}
              {initial.ended_at && (
                <span className="ml-3">结束 {fmt(initial.ended_at)}</span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
