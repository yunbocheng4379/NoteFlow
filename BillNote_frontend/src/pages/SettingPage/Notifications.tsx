import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  Search,
  Loader2,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  CircleX,
  Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  NotificationCategory,
  NotificationItem,
  NotificationList,
  NotificationSummary,
  NotificationStatus,
  notificationsApi,
} from '@/services/admin'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const PAGE_SIZE = 20

const CATEGORY_LABELS: Record<string, string> = {
  cookie_failure: 'Cookie 失效',
  pool_exhausted: '池耗尽',
}

const STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: '待处理',
  handled: '已处理',
  closed: '已关闭',
  ignored: '已忽略',
}

const SEVERITY_ICON = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
}

const SEVERITY_COLOR: Record<string, string> = {
  info: 'text-blue-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
}

const STATUS_COLOR: Record<NotificationStatus, string> = {
  pending: 'bg-amber-50 text-amber-600 ring-amber-200',
  handled: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  closed: 'bg-neutral-100 text-neutral-500 ring-neutral-200',
  ignored: 'bg-neutral-100 text-neutral-400 ring-neutral-200',
}

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationList | null>(null)
  const [summary, setSummary] = useState<NotificationSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'' | NotificationStatus>('')
  const [category, setCategory] = useState<NotificationCategory | ''>('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<NotificationItem | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        notificationsApi.list({
          status: status || undefined,
          category: category || undefined,
          keyword: search || undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        notificationsApi.summary(),
      ])
      setData(list)
      setSummary(sum)
    } catch {
      toast.error('加载通知失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, category, search])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  const handleSearch = () => {
    setPage(1)
    setSearch(keyword.trim())
  }

  const updateStatus = async (
    n: NotificationItem,
    next: NotificationStatus,
    note?: string
  ) => {
    setBusy(true)
    try {
      await notificationsApi.update(n.id, {
        status: next,
        handler_note: note ?? null,
      })
      toast.success(`已标记为${STATUS_LABELS[next]}`)
      setSelected(null)
      load()
    } catch {
      toast.error('状态更新失败')
    } finally {
      setBusy(false)
    }
  }

  const summaryCards = useMemo(() => {
    if (!summary) return []
    return [
      { key: 'pending', label: '待处理', value: summary.pending, color: 'text-amber-600' },
      { key: 'handled', label: '已处理', value: summary.handled, color: 'text-emerald-600' },
      { key: 'closed', label: '已关闭', value: summary.closed, color: 'text-neutral-500' },
      { key: 'ignored', label: '已忽略', value: summary.ignored, color: 'text-neutral-400' },
    ]
  }, [summary])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
      <div className="mx-auto w-full max-w-6xl shrink-0 px-6 pt-6">
        <div className="mb-6 flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">系统通知</h1>
          {data && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
              共 {data.total} 条
            </span>
          )}
        </div>

        {/* 顶部统计 */}
        {summary && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaryCards.map((card) => (
              <button
                key={card.key}
                onClick={() => {
                  setStatus((cur) =>
                    cur === card.key ? '' : (card.key as NotificationStatus)
                  )
                  setPage(1)
                }}
                className={`rounded-xl border bg-white p-4 text-left transition-all ${
                  status === card.key
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <div className="text-sm text-neutral-500">{card.label}</div>
                <div className={`mt-2 text-2xl font-bold ${card.color}`}>{card.value}</div>
              </button>
            ))}
          </div>
        )}

        {/* 工具栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索标题/内容"
              className="h-9 w-64 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleSearch}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Select
            value={category || '__all__'}
            onValueChange={(v) => {
              setCategory(v === '__all__' ? '' : (v as NotificationCategory))
              setPage(1)
            }}
          >
            <SelectTrigger className="h-9 w-[140px] border-neutral-200 bg-white text-sm shadow-none">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部类型</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
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
          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">暂无通知</div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {data.items.map((n) => {
                const Icon = SEVERITY_ICON[n.severity] || AlertTriangle
                const iconColor = SEVERITY_COLOR[n.severity] || 'text-neutral-500'
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-3 px-5 py-4 hover:bg-neutral-50"
                  >
                    <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-800">{n.title}</span>
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 ring-1 ring-neutral-200">
                          {CATEGORY_LABELS[n.category] || n.category}
                        </span>
                        {n.platform && (
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">
                            {n.platform}
                          </span>
                        )}
                        {n.occurrence_count > 1 && (
                          <span className="text-xs text-neutral-400">
                            × {n.occurrence_count}
                          </span>
                        )}
                        <span
                          className={`ml-auto rounded px-2 py-0.5 text-xs ring-1 ${STATUS_COLOR[n.status]}`}
                        >
                          {STATUS_LABELS[n.status]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{n.content}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                        <span>首次 {fmt(n.first_seen_at)}</span>
                        <span>最近 {fmt(n.last_seen_at)}</span>
                        {n.handled_at && <span>处理 {fmt(n.handled_at)}</span>}
                        <button
                          onClick={() => setSelected(n)}
                          className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Eye className="h-3.5 w-3.5" /> 详情/处理
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {data && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <span>
                共 {data.total} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
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

      {/* 详情面板 */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          onClick={() => !busy && setSelected(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-3 flex items-start gap-2">
              <h3 className="flex-1 text-lg font-semibold text-neutral-900">{selected.title}</h3>
              <span
                className={`rounded px-2 py-0.5 text-xs ring-1 ${STATUS_COLOR[selected.status]}`}
              >
                {STATUS_LABELS[selected.status]}
              </span>
            </div>
            <div className="mb-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
              {selected.content}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-500">
              <DT label="类型">{CATEGORY_LABELS[selected.category] || selected.category}</DT>
              <DT label="严重">{selected.severity}</DT>
              <DT label="平台">{selected.platform || '—'}</DT>
              <DT label="来源">
                {selected.source_type}/{selected.source_id}
              </DT>
              <DT label="首次">{fmt(selected.first_seen_at)}</DT>
              <DT label="最近">{fmt(selected.last_seen_at)}</DT>
              <DT label="发生次数">{selected.occurrence_count}</DT>
              <DT label="dedup_key">
                <code className="font-mono">{selected.dedup_key}</code>
              </DT>
              {selected.handler_note && (
                <DT label="处理备注">{selected.handler_note}</DT>
              )}
            </dl>

            <div className="mt-6 flex items-center justify-end gap-2">
              {selected.status === 'pending' ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => updateStatus(selected, 'ignored')}
                  >
                    <CircleX className="mr-1 h-3.5 w-3.5" /> 忽略
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => updateStatus(selected, 'closed')}
                  >
                    关闭
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => updateStatus(selected, 'handled')}>
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> 标记为已处理
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelected(null)}>
                  关闭
                </Button>
              )}
            </div>
            <p className="mt-3 text-xs text-neutral-400">
              通知无法物理删除；可通过状态管理。如果要写处理备注，可在「标记已处理」时附言（后续版本）。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function DT({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-neutral-700">{children}</dd>
    </div>
  )
}
