import { useEffect, useMemo, useState, useCallback } from 'react'
import { Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUS_LABEL,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStats,
  type FeedbackStatus,
  batchDeleteFeedbacks,
  deleteFeedback,
  getFeedbackStats,
  listFeedbacks,
  updateFeedbackStatus,
} from '@/services/feedback'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const STATUS_CARD_ORDER: FeedbackStatus[] = ['pending', 'processing', 'done', 'stalled']

const STATUS_CARD_CLASS: Record<FeedbackStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  stalled: 'bg-neutral-100 text-neutral-700 border-neutral-200',
}

const STATUS_PILL: Record<FeedbackStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  stalled: 'bg-neutral-100 text-neutral-600 border-neutral-200',
}

const PAGE_SIZE = 20

function formatDateTime(s: string | null | undefined) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

export default function FeedbackPage() {
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | 'all'>('all')
  const [keyword, setKeyword] = useState('')

  const [active, setActive] = useState<FeedbackItem | null>(null)
  const [editStatus, setEditStatus] = useState<FeedbackStatus>('pending')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)

  // 单条删除确认
  const [deleteDialogId, setDeleteDialogId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 批量删除
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchDeleting, setBatchDeleting] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const fetchStats = useCallback(async () => {
    try {
      const s = await getFeedbackStats()
      setStats(s)
    } catch {
      // ignore
    }
  }, [])

  const fetchList = useCallback(
    async (targetPage = page) => {
      setLoading(true)
      try {
        const resp = await listFeedbacks({
          status: statusFilter === 'all' ? undefined : statusFilter,
          category: categoryFilter === 'all' ? undefined : categoryFilter,
          keyword: keyword.trim() || undefined,
          page: targetPage,
          page_size: PAGE_SIZE,
        })
        setItems(resp.items)
        setTotal(resp.total)
        setPage(resp.page)
      } finally {
        setLoading(false)
      }
    },
    [statusFilter, categoryFilter, keyword, page],
  )

  useEffect(() => {
    fetchStats()
    fetchList(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFilterChange = () => {
    setPage(1)
    fetchList(1)
    fetchStats()
  }

  const openDetail = (item: FeedbackItem) => {
    setActive(item)
    setEditStatus(item.status)
    setEditNote(item.admin_note ?? '')
  }

  const handleSave = async () => {
    if (!active) return
    setSaving(true)
    try {
      const updated = await updateFeedbackStatus(active.id, {
        status: editStatus,
        admin_note: editNote.trim() || null,
      })
      toast.success('已更新')
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      fetchStats()
      setActive(null)
    } catch {
      // toast already shown by interceptor
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await deleteFeedback(id)
      setItems((prev) => prev.filter((it) => it.id !== id))
      setSelectedIds((prev) => {
        const s = new Set(prev)
        s.delete(id)
        return s
      })
      toast.success('已删除')
      fetchStats()
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
      await batchDeleteFeedbacks(ids)
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)))
      setSelectedIds(new Set())
      toast.success(`已删除 ${ids.length} 条反馈`)
      fetchStats()
    } catch {
      // error toast shown by interceptor
    } finally {
      setBatchDeleting(false)
      setBatchDialogOpen(false)
    }
  }

  const allSelected = items.length > 0 && items.every((it) => selectedIds.has(it.id))
  const someSelected = items.some((it) => selectedIds.has(it.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const s = new Set(prev)
        items.forEach((it) => s.delete(it.id))
        return s
      })
    } else {
      setSelectedIds((prev) => {
        const s = new Set(prev)
        items.forEach((it) => s.add(it.id))
        return s
      })
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const deleteTarget = items.find((it) => it.id === deleteDialogId) ?? null

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden bg-neutral-50 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-medium">问题反馈</div>
          <div className="text-sm text-muted-foreground">查看与处理用户提交的反馈</div>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchList()
              fetchStats()
            }}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 状态计数卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
          <div className="text-xs text-muted-foreground">全部</div>
          <div className="mt-1 text-2xl font-semibold">{stats?.total ?? '-'}</div>
        </div>
        {STATUS_CARD_ORDER.map((s) => (
          <div
            key={s}
            className={`rounded-lg border px-4 py-3 ${STATUS_CARD_CLASS[s]}`}
          >
            <div className="text-xs opacity-80">{FEEDBACK_STATUS_LABEL[s]}</div>
            <div className="mt-1 text-2xl font-semibold">{stats?.[s] ?? '-'}</div>
          </div>
        ))}
      </div>

      {/* 过滤栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as FeedbackStatus | 'all')}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {STATUS_CARD_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {FEEDBACK_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter(v as FeedbackCategory | 'all')}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {(Object.keys(FEEDBACK_CATEGORY_LABEL) as FeedbackCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {FEEDBACK_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            placeholder="搜索标题 / 内容"
            className="pl-7"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFilterChange()
            }}
          />
        </div>

        <Button size="sm" onClick={handleFilterChange} disabled={loading}>
          应用筛选
        </Button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="w-10 px-3 py-2 font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected
                  }}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-primary"
                  aria-label="全选当前页"
                />
              </th>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">分类</th>
              <th className="px-3 py-2 font-medium">标题 / 内容</th>
              <th className="px-3 py-2 font-medium">用户</th>
              <th className="px-3 py-2 font-medium">提交时间</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className={`border-t border-neutral-100 transition-colors hover:bg-neutral-50 ${
                  selectedIds.has(it.id) ? 'bg-primary/5' : ''
                }`}
              >
                <td className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(it.id)}
                    onChange={() => toggleSelect(it.id)}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    aria-label={`选中反馈 #${it.id}`}
                  />
                </td>
                <td className="px-3 py-2 text-neutral-500">{it.id}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_PILL[it.status]}`}
                  >
                    {FEEDBACK_STATUS_LABEL[it.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {FEEDBACK_CATEGORY_LABEL[it.category] ?? it.category}
                </td>
                <td className="max-w-md px-3 py-2">
                  <div className="truncate font-medium text-gray-800">
                    {it.title || '(无标题)'}
                  </div>
                  <div className="truncate text-xs text-neutral-500">{it.content}</div>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {it.user_id ?? '-'}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {formatDateTime(it.created_at)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => openDetail(it)}>
                      处理
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => setDeleteDialogId(it.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-neutral-400">
                  暂无反馈
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          共 {total} 条，当前第 {page} / {totalPages} 页
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => fetchList(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => fetchList(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* 详情 / 处理 */}
      <Dialog open={!!active} onOpenChange={(v) => !v && setActive(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>反馈详情 #{active?.id}</DialogTitle>
            <DialogDescription>
              {active ? formatDateTime(active.created_at) : ''}
            </DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">分类</Label>
                  <div className="mt-1">{FEEDBACK_CATEGORY_LABEL[active.category]}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">联系方式</Label>
                  <div className="mt-1 break-all">{active.contact || '-'}</div>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">标题</Label>
                <div className="mt-1 font-medium">{active.title || '(无)'}</div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">内容</Label>
                <div className="mt-1 whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
                  {active.content}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>处理状态</Label>
                  <Select
                    value={editStatus}
                    onValueChange={(v) => setEditStatus(v as FeedbackStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_CARD_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>
                          {FEEDBACK_STATUS_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">最近处理</Label>
                  <div className="mt-2 text-xs text-neutral-500">
                    {active.handled_at ? formatDateTime(active.handled_at) : '—'}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label>处理备注</Label>
                <Textarea
                  rows={3}
                  placeholder="内部跟进说明，仅管理员可见"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  maxLength={2000}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单条删除确认 */}
      <Dialog
        open={deleteDialogId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogId(null)
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `将删除反馈「${deleteTarget.title || deleteTarget.content.slice(0, 20) || `#${deleteTarget.id}`}」，此操作不可恢复。`
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
              onClick={() => deleteDialogId !== null && handleDelete(deleteDialogId)}
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

      {/* 批量删除确认 */}
      <Dialog
        open={batchDialogOpen}
        onOpenChange={(open) => {
          if (!open) setBatchDialogOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>批量删除</DialogTitle>
            <DialogDescription>
              将删除已选中的 {selectedIds.size} 条反馈记录，此操作不可恢复。
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
    </div>
  )
}
