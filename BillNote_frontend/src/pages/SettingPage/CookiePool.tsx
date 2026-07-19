import { useEffect, useState } from 'react'
import {
  Cookie,
  Search,
  Plus,
  Trash2,
  Loader2,
  Power,
  PowerOff,
  RefreshCw,
  Upload,
  Eye,
  EyeOff,
  ShieldOff,
  Globe,
  Check,
  ChevronsUpDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  cookiesApi,
  PlatformCookieItem,
  PlatformCookieList,
  PlatformCookieSummary,
} from '@/services/admin'
import { platformAPI, type Platform, type PlatformUpdate } from '@/services/platform'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ConfirmDialog from '@/components/ConfirmDialog'

const PAGE_SIZE = 20
const TIER_OPTIONS = ['admin', 'vip', 'user', 'svip'] as const

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ============================================================================
// 平台代理配置面板（嵌入 Cookie 池页面顶部）
// ============================================================================
function PlatformProxySection({
  platforms,
  onReload,
}: {
  platforms: Platform[]
  onReload: () => void
}) {
  const [draftProxy, setDraftProxy] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [newProxy, setNewProxy] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  useEffect(() => {
    const init: Record<string, string> = {}
    for (const p of platforms) init[p.platform_id] = p.proxy_url || ''
    setDraftProxy(init)
  }, [platforms])

  const handleSave = async (platform_id: string) => {
    setSavingId(platform_id)
    try {
      const data: PlatformUpdate = { proxy_url: draftProxy[platform_id] || '' }
      await platformAPI.update(platform_id, data)
      toast.success(`${platform_id} 代理已保存`)
      onReload()
    } catch {
      /* 拦截器已 toast */
    } finally {
      setSavingId(null)
    }
  }

  const handleToggleEnabled = async (p: Platform) => {
    try {
      await platformAPI.update(p.platform_id, { is_enabled: !p.is_enabled })
      toast.success(`${p.name} 已${!p.is_enabled ? '启用' : '禁用'}`)
      onReload()
    } catch {
      /* 拦截器已 toast */
    }
  }

  const handleDelete = async () => {
    if (!deleteTargetId) return
    const platform_id = deleteTargetId
    setDeletingId(platform_id)
    try {
      await platformAPI.delete(platform_id)
      toast.success('删除成功')
      onReload()
    } catch {
      /* 拦截器已 toast */
    } finally {
      setDeletingId(null)
      setDeleteTargetId(null)
    }
  }

  const handleCreate = async () => {
    if (!newId.trim() || !newName.trim()) {
      toast.error('请填写平台 ID 和名称')
      return
    }
    setCreating(true)
    try {
      await platformAPI.create({
        platform_id: newId.trim().toLowerCase(),
        name: newName.trim(),
        proxy_url: newProxy.trim() || null,
      })
      toast.success('平台已添加')
      setShowAddForm(false)
      setNewId('')
      setNewName('')
      setNewProxy('')
      onReload()
    } catch {
      /* 拦截器已 toast */
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <Globe className="h-4 w-4" />
          平台代理配置
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? '取消' : '+ 新增平台'}
        </Button>
      </div>

      {showAddForm && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-medium text-blue-700">新增平台</p>
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="platform_id"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="显示名称"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="代理地址（可选）"
              value={newProxy}
              onChange={e => setNewProxy(e.target.value)}
              className="text-sm"
            />
          </div>
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? '创建中…' : '确认创建'}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {platforms.map(p => (
          <div
            key={p.platform_id}
            className={`flex items-center gap-2 rounded border p-2 ${
              p.is_enabled ? 'border-neutral-200' : 'border-neutral-100 opacity-50'
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <code className="text-xs text-neutral-400">{p.platform_id}</code>
              {!p.is_enabled && (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                  已禁用
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Switch
                checked={!!p.is_enabled}
                onCheckedChange={() => handleToggleEnabled(p)}
              />
              {p.is_enabled && (
                <>
                  <Input
                    placeholder="代理地址（空则直连）"
                    value={draftProxy[p.platform_id] ?? ''}
                    onChange={e =>
                      setDraftProxy(prev => ({ ...prev, [p.platform_id]: e.target.value }))
                    }
                    className="w-52 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSave(p.platform_id)}
                    disabled={savingId === p.platform_id}
                    className="shrink-0"
                  >
                    {savingId === p.platform_id ? '…' : '保存'}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-1 text-xs text-red-500 hover:text-red-600"
                onClick={() => setDeleteTargetId(p.platform_id)}
                disabled={deletingId === p.platform_id}
              >
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={o => !o && setDeleteTargetId(null)}
        title="删除平台"
        description={
          <>
            确定要删除平台 <b>{deleteTargetId}</b> 吗？
            <br />
            删除为物理删除，操作不可撤销。
          </>
        }
        confirmText="删除"
        loading={!!deletingId}
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ============================================================================
// Cookie 池管理
// ============================================================================
export default function CookiePoolPage() {
  const [data, setData] = useState<PlatformCookieList | null>(null)
  const [summary, setSummary] = useState<PlatformCookieSummary>({})
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<string>('')
  const [cohort, setCohort] = useState<string>('')
  const [showCookies, setShowCookies] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlatformCookieItem | null>(null)
  const [resetTarget, setResetTarget] = useState<PlatformCookieItem | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPlatforms = () => platformAPI.list().then(data => setPlatforms(data)).catch(() => {})

  const load = async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        cookiesApi.list({
          platform: platform || undefined,
          page,
          page_size: PAGE_SIZE,
          keyword: search || undefined,
          cohort: cohort || undefined,
        }),
        cookiesApi.summary(),
      ])
      setData(list)
      setSummary(sum)
    } catch {
      toast.error('加载 Cookie 池失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPlatforms()
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, platform, cohort])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  const handleSearch = () => {
    setPage(1)
    setSearch(keyword.trim())
  }

  const handleReloadPool = async () => {
    setBusy(true)
    try {
      await cookiesApi.reload()
      toast.success('刷新成功，Cookie 池已更新')
      load()
    } catch {
      toast.error('刷新失败')
    } finally {
      setBusy(false)
    }
  }

  const doReset = async () => {
    if (!resetTarget) return
    setBusy(true)
    try {
      await cookiesApi.reset(resetTarget.id)
      toast.success(`已重置 ${resetTarget.name}`)
      setResetTarget(null)
      load()
    } catch {
      toast.error('重置失败')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await cookiesApi.remove(deleteTarget.id)
      toast.success('已删除')
      setDeleteTarget(null)
      load()
    } catch {
      toast.error('删除失败')
    } finally {
      setBusy(false)
    }
  }

  const doToggleEnabled = async (item: PlatformCookieItem) => {
    try {
      await cookiesApi.update(item.id, { is_enabled: !item.is_enabled })
      toast.success(item.is_enabled ? '已禁用' : '已启用')
      load()
    } catch {
      toast.error('切换失败')
    }
  }

  const platformName = (id: string) =>
    platforms.find(p => p.platform_id === id)?.name || id

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
        <div className="mx-auto w-full max-w-7xl shrink-0 px-6 pt-6">
        {/* 标题 */}
        <div className="mb-6 flex items-center gap-2">
          <Cookie className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">Cookie 池管理</h1>
          {data && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
              共 {data.total} 条
            </span>
          )}
        </div>

        {/* 平台概览 + 平台代理配置 */}
        <div className="mb-4 grid grid-cols-5 gap-4">
          {/* 左侧：平台概览统计（2/5 宽度） */}
          <div className="col-span-2 grid grid-cols-2 gap-3">
            {platforms.map(p => {
              const stat = summary[p.platform_id] || { total: 0, available: 0, invalid: 0 }
              const active = platform === p.platform_id
              return (
                <button
                  key={p.platform_id}
                  onClick={() => {
                    setPlatform(cur => (cur === p.platform_id ? '' : p.platform_id))
                    setPage(1)
                  }}
                  className={`rounded-xl border bg-white p-3 text-left transition-all ${
                    active
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-neutral-200 hover:border-neutral-300'
                  } ${!p.is_enabled ? 'opacity-50' : ''}`}
                >
                  <div className="text-sm font-medium text-neutral-700">{p.name}</div>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-xl font-bold text-emerald-600">{stat.available}</span>
                    <span className="text-xs text-neutral-400">/ {stat.total}</span>
                  </div>
                  {stat.invalid > 0 && (
                    <div className="mt-0.5 text-xs text-red-500">{stat.invalid} 条失效</div>
                  )}
                  {!p.is_enabled && (
                    <div className="mt-0.5 text-xs text-gray-400">已禁用</div>
                  )}
                </button>
              )
            })}
          </div>

          {/* 右侧：平台代理配置（3/5 宽度） */}
          <div className="col-span-3">
            <PlatformProxySection platforms={platforms} onReload={loadPlatforms} />
          </div>
        </div>

        {/* 工具栏 */}
        <div className="mb-4 flex w-full flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="按名称/备注搜索"
              className="h-9 w-56 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleSearch} className="shrink-0">
            搜索
          </Button>
          <input
            value={cohort}
            onChange={e => {
              setCohort(e.target.value)
              setPage(1)
            }}
            placeholder="按 cohort 过滤"
            className="h-9 w-44 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-primary"
            title="只显示属于该分组的 Cookie"
          />
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="shrink-0">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCookies(s => !s)}
            title={showCookies ? '隐藏 cookie 明文' : '显示 cookie 明文'}
            className="shrink-0"
          >
            {showCookies ? (
              <EyeOff className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Eye className="mr-1 h-3.5 w-3.5" />
            )}
            {showCookies ? '隐藏' : '显示'} 明文
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReloadPool}
            disabled={busy}
            title="强制刷新 Cookie 池内存缓存"
            className="shrink-0"
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            立即重载
          </Button>

          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
              className="shrink-0"
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              批量导入
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增
            </Button>
          </div>
        </div>
        </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              暂无 Cookie。点击「新增」或「批量导入」添加。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col width="96" />
                  <col width="140" />
                  <col width="200" />
                  <col width="90" />
                  <col width="100" />
                  <col width="60" />
                  <col width="70" />
                  <col width="60" />
                  <col width="60" />
                  <col width="60" />
                  <col width="110" />
                  <col width="70" />
                  <col width="100" />
                </colgroup>
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="96">平台</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="140">名称</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="200">Cookie</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="90">分组</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="100">限定 tier</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="60">权重</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="70">配额</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="60">成功</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="60">失败</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="60">使用</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="110">最后失败</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium" width="70">状态</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" width="100">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(c => (
                    <CookieRow
                      key={c.id}
                      item={c}
                      showCookies={showCookies}
                      platformName={platformName(c.platform)}
                      onToggleEnabled={() => doToggleEnabled(c)}
                      onReset={() => setResetTarget(c)}
                      onDelete={() => setDeleteTarget(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <span>
                共 {data.total} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          *「失败」= 连续失败次数；达到 3 次会自动标失效并发出通知。管理员可在此重置或删除。
        </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="删除 Cookie"
        description={
          <>
            确定要删除 <b>{deleteTarget?.name}</b> (id={deleteTarget?.id}) 吗？
            <br />
            删除为物理删除，操作不可撤销。
          </>
        }
        confirmText="删除"
        loading={busy}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={o => !o && setResetTarget(null)}
        title="重置 Cookie 状态"
        description={<>将 <b>{resetTarget?.name}</b> 的失效标记和连续失败计数清零。</>}
        confirmText="重置"
        loading={busy}
        onConfirm={doReset}
      />

      <CreateCookieDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        platforms={platforms}
        defaultPlatform={platform}
        onCreated={() => {
          setCreateOpen(false)
          setPage(1)
          load()
        }}
      />

      <ImportCookiesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        platforms={platforms}
        defaultPlatform={platform}
        onImported={() => {
          setImportOpen(false)
          setPage(1)
          load()
        }}
      />
    </div>
    </TooltipProvider>
  )
}

// ============================================================================
// 行
// ============================================================================
function CookieRow({
  item,
  showCookies,
  platformName,
  onToggleEnabled,
  onReset,
  onDelete,
}: {
  item: PlatformCookieItem
  showCookies: boolean
  platformName: string
  onToggleEnabled: () => void
  onReset: () => void
  onDelete: () => void
}) {
  const failed = item.is_marked_invalid === 1
  const disabled = item.is_enabled === 0
  return (
    <tr className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
      <td className="whitespace-nowrap px-3 py-2.5 text-xs">
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700 ring-1 ring-neutral-200">
          {platformName}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-neutral-800">
        {item.name}
        {item.remark && (
          <div className="mt-0.5 truncate text-xs text-neutral-400">{item.remark}</div>
        )}
      </td>
      <td
        style={{ width: 200, maxWidth: 200 }}
        className="whitespace-nowrap px-3 py-2.5 align-middle"
      >
        {showCookies && item.cookie ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <code className="block w-full truncate font-mono text-xs text-neutral-600">
                {item.cookie}
              </code>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-[420px] whitespace-pre-wrap break-all font-mono text-[11px]"
            >
              {item.cookie}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <code className="block w-full truncate text-center font-mono text-xs text-neutral-400 select-none">
                {'••••••••••••'}
              </code>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <span>已隐藏明文</span>
            </TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700 ring-1 ring-neutral-200">
          {item.cohort || 'default'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {item.reserved_for_tier && item.reserved_for_tier.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {item.reserved_for_tier.map(t => (
              <span
                key={t}
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-neutral-400">全部</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{item.weight}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">
        {item.max_concurrent_uses > 0 ? (
          <span
            className={
              item.in_use_count >= item.max_concurrent_uses
                ? 'text-red-500'
                : 'text-neutral-700'
            }
          >
            {item.in_use_count}/{item.max_concurrent_uses}
          </span>
        ) : (
          <span className="text-neutral-400">∞</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-emerald-600">
        {item.success_count}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-red-500">
        {item.failure_count}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-neutral-500">
        {item.usage_count}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-500">
        {fmtDateTime(item.last_failure_at)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {failed ? (
          <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-600 ring-1 ring-red-200">
            失效
          </span>
        ) : disabled ? (
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-neutral-200">
            已禁用
          </span>
        ) : (
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 ring-1 ring-emerald-200">
            可用
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {failed && (
            <button
              onClick={onReset}
              title="重置失效标记"
              className="inline-flex items-center rounded p-1.5 text-primary transition-colors hover:bg-primary/10"
            >
              <ShieldOff className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onToggleEnabled}
            title={disabled ? '启用' : '禁用'}
            className="inline-flex items-center rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100"
          >
            {disabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onDelete}
            title="删除"
            className="inline-flex items-center rounded p-1.5 text-red-500 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ============================================================================
// 新增弹窗
// ============================================================================
function CreateCookieDialog({
  open,
  onOpenChange,
  platforms,
  defaultPlatform,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  platforms: Platform[]
  defaultPlatform: string
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    platform: defaultPlatform || 'bilibili',
    name: '',
    cookie: '',
    weight: 100,
    remark: '',
    cohort: 'default',
    reserved_for_tier: [] as string[],
    max_concurrent_uses: 0,
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        platform: defaultPlatform || platforms[0]?.platform_id || 'bilibili',
        name: '',
        cookie: '',
        weight: 100,
        remark: '',
        cohort: 'default',
        reserved_for_tier: [],
        max_concurrent_uses: 0,
      })
    }
  }, [open, defaultPlatform, platforms])

  const submit = async () => {
    if (!form.name.trim()) return toast.error('名称不能为空')
    if (!form.cookie.trim()) return toast.error('Cookie 不能为空')
    setSubmitting(true)
    try {
      await cookiesApi.create({
        platform: form.platform,
        name: form.name.trim(),
        cookie: form.cookie.trim(),
        weight: Number(form.weight) || 100,
        remark: form.remark.trim() || undefined,
        cohort: form.cohort.trim() || 'default',
        reserved_for_tier:
          form.reserved_for_tier.length > 0 ? form.reserved_for_tier : undefined,
        max_concurrent_uses: Math.max(0, Number(form.max_concurrent_uses) || 0),
      })
      toast.success('已添加')
      onCreated()
    } catch (e: any) {
      toast.error(e?.msg || '新增失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleTier = (t: string) => {
    setForm(f => ({
      ...f,
      reserved_for_tier: f.reserved_for_tier.includes(t)
        ? f.reserved_for_tier.filter(x => x !== t)
        : [...f.reserved_for_tier, t],
    }))
  }

  return (
    <Dialog open={open} onOpenChange={o => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>新增 Cookie</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="平台">
            <PlatformPicker
              platforms={platforms}
              value={form.platform}
              onChange={v => setForm(f => ({ ...f, platform: v }))}
              placeholder="选择平台"
            />
          </Field>
          <Field label="名称">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="B站-主账号"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="Cookie">
            <textarea
              rows={5}
              value={form.cookie}
              onChange={e => setForm(f => ({ ...f, cookie: e.target.value }))}
              placeholder="粘贴 Netscape 格式 Cookie 行…"
              className="w-full rounded-lg border border-neutral-200 p-2 font-mono text-xs outline-none focus:border-primary"
            />
          </Field>
          <Field label="权重">
            <input
              type="number"
              min={1}
              max={1000}
              value={form.weight}
              onChange={e => setForm(f => ({ ...f, weight: Number(e.target.value) }))}
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="备注">
            <input
              value={form.remark}
              onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
              placeholder="可选，例如来源 / 用途"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="分组">
            <input
              value={form.cohort}
              onChange={e => setForm(f => ({ ...f, cohort: e.target.value }))}
              placeholder="默认: default"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary"
            />
          </Field>
          <Field label="限定 tier">
            <div className="flex flex-wrap gap-2 pt-1">
              {TIER_OPTIONS.map(t => {
                const on = form.reserved_for_tier.includes(t)
                return (
                  <button
                    type="button"
                    key={t}
                    onClick={() => toggleTier(t)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                    }`}
                  >
                    {t}
                  </button>
                )
              })}
              <span className="self-center text-xs text-neutral-400">
                {form.reserved_for_tier.length === 0
                  ? '不选 = 全部 tier'
                  : `已选: ${form.reserved_for_tier.join(', ')}`}
              </span>
            </div>
          </Field>
          <Field label="并发配额">
            <input
              type="number"
              min={0}
              value={form.max_concurrent_uses}
              onChange={e =>
                setForm(f => ({ ...f, max_concurrent_uses: Number(e.target.value) }))
              }
              placeholder="0 = 不限"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={submit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// 批量导入弹窗
// ============================================================================
function ImportCookiesDialog({
  open,
  onOpenChange,
  platforms,
  defaultPlatform,
  onImported,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  platforms: Platform[]
  defaultPlatform: string
  onImported: () => void
}) {
  const [platform, setPlatform] = useState(defaultPlatform || 'bilibili')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setPlatform(defaultPlatform || platforms[0]?.platform_id || 'bilibili')
      setText('')
    }
  }, [open, defaultPlatform, platforms])

  const submit = async () => {
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && l.includes('='))
    if (lines.length === 0) return toast.error('未检测到合法 Cookie 行')

    const items = lines.map((line, idx) => {
      const i = idx + 1
      return {
        name: `${platform}-batch-${Date.now()}-${i}`,
        cookie: line,
      }
    })

    setSubmitting(true)
    try {
      const res = await cookiesApi.importBulk({ platform, items })
      toast.success(`已导入 ${res.inserted} 条 (请求 ${res.requested} 条)`)
      onImported()
    } catch (e: any) {
      toast.error(e?.msg || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>批量导入 Cookie</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="平台">
            <PlatformPicker
              platforms={platforms}
              value={platform}
              onChange={setPlatform}
              placeholder="选择平台"
            />
          </Field>
          <Field label="Cookie 行">
            <textarea
              rows={10}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={`每行一条 Netscape Cookie。系统会自动为每条命名。\n# 注释行会被忽略。\nkey=value\n...`}
              className="w-full rounded-lg border border-neutral-200 p-2 font-mono text-xs outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-neutral-500">
              按行解析；每行形如 <code>name=value</code>。重复 name 会被跳过。
            </p>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={submit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-start gap-3">
      <label className="pt-1.5 text-sm text-neutral-500">{label}</label>
      {children}
    </div>
  )
}

// ============================================================================
// 平台选择器：点击触发居中弹窗，弹窗中以卡片网格选择平台（替代原生 <select>）
// ============================================================================
function PlatformPicker({
  platforms,
  value,
  onChange,
  placeholder = '选择平台',
  disabled = false,
}: {
  platforms: Platform[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = platforms.find(p => p.platform_id === value)
  const [confirming, setConfirming] = useState<string | null>(value)

  useEffect(() => {
    if (open) setConfirming(value)
  }, [open, value])

  const handleConfirm = () => {
    if (!confirming) return
    onChange(confirming)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={`flex h-9 w-full items-center justify-between rounded-lg border bg-white px-3 text-sm transition-colors outline-none ${
          disabled
            ? 'cursor-not-allowed border-neutral-200 text-neutral-400'
            : 'border-neutral-200 text-neutral-800 hover:border-neutral-300 focus:border-primary focus:ring-1 focus:ring-primary/30'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon_url ? (
            <img
              src={selected.icon_url}
              alt=""
              className="h-4 w-4 shrink-0 rounded object-cover"
              onError={e => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : (
            <Globe className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          )}
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          {selected && !selected.is_enabled && (
            <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-400">
              已禁用
            </span>
          )}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-neutral-400" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px] gap-0 p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-2">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-primary" />
                选择平台
              </DialogTitle>
              <p className="mt-1.5 text-sm text-neutral-500">
                点击平台卡片以选中，然后点击「确认」完成选择。
              </p>
            </DialogHeader>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-3">
            {platforms.length === 0 ? (
              <div className="py-12 text-center text-sm text-neutral-400">暂无可用平台</div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {platforms.map(p => {
                  const active = confirming === p.platform_id
                  return (
                    <button
                      type="button"
                      key={p.platform_id}
                      onClick={() => setConfirming(p.platform_id)}
                      className={`group relative flex items-center gap-2.5 rounded-lg border bg-white p-3 text-left transition-all ${
                        active
                          ? 'border-primary ring-2 ring-primary/30 bg-primary/[0.03]'
                          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                      } ${!p.is_enabled ? 'opacity-60' : ''}`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 group-hover:bg-white">
                        {p.icon_url ? (
                          <img
                            src={p.icon_url}
                            alt=""
                            className="h-5 w-5 rounded object-cover"
                            onError={e => ((e.target as HTMLImageElement).style.display = 'none')}
                          />
                        ) : (
                          <Globe className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-800">
                          {p.name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-neutral-400">
                          {p.platform_id}
                        </span>
                      </span>
                      {!p.is_enabled && (
                        <span className="absolute right-2 top-2 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-400">
                          已禁用
                        </span>
                      )}
                      {active && (
                        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50/60 px-6 py-4">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={!confirming} onClick={handleConfirm}>
              确认选择
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
