import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { adminApi, type AdminUser, type AdminUserList } from '@/services/admin'
import {
  adminCreditsApi,
  type AdminCreditTransactionList,
  type CreditTrendPoint,
  type CreditOverview,
} from '@/services/adminCredits'

const USER_PAGE_SIZE = 50
const TX_PAGE_SIZE = 20
const TYPE_OPTIONS = [
  { value: '', label: '全部流水' },
  { value: 'CONSUME', label: '模型调用消耗' },
  { value: 'ADMIN_ADJUST', label: '管理员调整' },
  { value: 'RECHARGE', label: '充值到账' },
  { value: 'REFUND', label: '失败退回' },
  { value: 'MONTHLY_GRANT', label: '会员月度发放' },
  { value: 'REGISTER_GRANT', label: '注册赠送' },
  { value: 'REGISTER_INVITEE', label: '被邀请奖励' },
  { value: 'REGISTER_INVITER', label: '邀请奖励' },
  { value: 'FIRST_SUB_INVITER', label: '首订奖励' },
]

const localDate = (value: Date) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const initialStartDate = () => {
  const value = new Date()
  value.setDate(value.getDate() - 29)
  return localDate(value)
}

const initialEndDate = () => localDate(new Date())

const formatNumber = (value: number) => value.toLocaleString('zh-CN')

const formatDateTime = (value: string | null) => {
  if (!value) return '—'
  return value.slice(0, 16).replace('T', ' ')
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Zap
  tone: 'teal' | 'blue' | 'amber' | 'rose'
}) {
  const colors = {
    teal: 'bg-[#e8f7f3] text-[#168878]',
    blue: 'bg-[#edf4ff] text-[#3578c9]',
    amber: 'bg-[#fff5df] text-[#b67814]',
    rose: 'bg-[#fff0ed] text-[#c66b5d]',
  }
  return (
    <div className="rounded-2xl border border-[#e5efeb] bg-white p-4 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-[#78938d]">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-[#243447]">{value}</div>
          <div className="mt-1 text-[11px] text-[#9ab1ab]">{hint}</div>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${colors[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

function CreditTrendChart({ overview }: { overview: CreditOverview | null }) {
  const data = overview?.trend ?? []
  const [hovered, setHovered] = useState<{ item: CreditTrendPoint; x: number; y: number } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const width = 820
  const height = 250
  const padding = { top: 20, right: 20, bottom: 34, left: 46 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const max = Math.max(1, ...data.flatMap(item => [item.consumed, item.granted]))
  const barWidth = data.length ? Math.max(3, innerWidth / data.length * 0.58) : 8

  const updateHovered = (event: ReactMouseEvent<SVGGElement>, item: CreditTrendPoint) => {
    const chart = chartRef.current
    if (!chart) return
    const bounds = chart.getBoundingClientRect()
    const tooltipWidth = 210
    const x = Math.min(
      Math.max(8, event.clientX - bounds.left + 14),
      Math.max(8, bounds.width - tooltipWidth - 8),
    )
    const y = Math.max(140, event.clientY - bounds.top - 12)
    setHovered({ item, x, y })
  }

  return (
    <div className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#243447]">电力消耗趋势</h2>
          <p className="mt-1 text-xs text-[#9ab1ab]">按日统计消耗与到账，帮助观察用户使用变化</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#78938d]">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#e36b61]" />消耗</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#42b7a5]" />到账</span>
        </div>
      </div>
      {data.length === 0 ? (
        <div className="py-20 text-center text-xs text-[#9ab1ab]">暂无趋势数据</div>
      ) : (
        <div className="mt-4 w-full overflow-x-auto">
          <div ref={chartRef} className="relative min-w-[640px]">
            <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label="电力消耗趋势图">
              {[0, 0.5, 1].map(ratio => {
                const y = padding.top + innerHeight * ratio
                return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#edf3f0" strokeWidth="1" />
              })}
              {data.map((item, index) => {
                const slot = innerWidth / data.length
                const slotX = padding.left + index * slot
                const x = slotX + (slot - barWidth) / 2
                const consumedHeight = (item.consumed / max) * innerHeight
                const grantedHeight = (item.granted / max) * innerHeight
                return (
                  <g
                    key={item.date}
                    className="cursor-pointer outline-none"
                    tabIndex={0}
                    onMouseEnter={event => updateHovered(event, item)}
                    onMouseMove={event => updateHovered(event, item)}
                    onFocus={() => setHovered({ item, x: 8, y: 140 })}
                    onMouseLeave={() => setHovered(null)}
                    onBlur={() => setHovered(null)}
                  >
                    <title>{`${item.date}：消耗 ${formatNumber(item.consumed)}，到账 ${formatNumber(item.granted)}`}</title>
                    <rect x={slotX} y={padding.top} width={slot} height={innerHeight} fill="transparent" />
                    <rect x={x} y={padding.top + innerHeight - consumedHeight} width={barWidth / 2 - 1} height={consumedHeight} rx="2" fill="#e36b61" opacity="0.88" />
                    <rect x={x + barWidth / 2 + 1} y={padding.top + innerHeight - grantedHeight} width={barWidth / 2 - 1} height={grantedHeight} rx="2" fill="#42b7a5" opacity="0.88" />
                    {(index === 0 || index === data.length - 1 || index % Math.max(1, Math.floor(data.length / 6)) === 0) && (
                      <text x={x + barWidth / 2} y={height - 9} textAnchor="middle" fill="#9ab1ab" fontSize="10">{item.date.slice(5)}</text>
                    )}
                  </g>
                )
              })}
            </svg>
            {hovered && (
              <div className="pointer-events-none absolute z-10 w-[210px] rounded-xl border border-[#d9ebe6] bg-white/95 p-3 text-xs shadow-[0_10px_30px_rgba(36,52,71,0.14)] backdrop-blur-sm" style={{ left: hovered.x, top: hovered.y, transform: 'translateY(-100%)' }}>
                <div className="mb-2 font-semibold text-[#243447]">{hovered.item.date}</div>
                <div className="flex items-center justify-between gap-5 text-[#56716b]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#e36b61]" />消耗电力</span><strong className="font-mono text-[#c65f56]">{formatNumber(hovered.item.consumed)}</strong></div>
                <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#42b7a5]" />到账电力</span><strong className="font-mono text-[#168878]">{formatNumber(hovered.item.granted)}</strong></div>
                {hovered.item.adjusted !== 0 && <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span>管理员调整</span><strong className="font-mono text-[#b67814]">{hovered.item.adjusted > 0 ? '+' : ''}{formatNumber(hovered.item.adjusted)}</strong></div>}
                {hovered.item.refunded !== 0 && <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span>失败退回</span><strong className="font-mono text-[#3578c9]">+{formatNumber(hovered.item.refunded)}</strong></div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AdjustDialog({
  users,
  open,
  onClose,
  onSaved,
}: {
  users: AdminUser[]
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [mode, setMode] = useState<'grant' | 'deduct'>('grant')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setAmount('')
      setNote('')
      setMode('grant')
    }
  }, [open])

  const submit = async () => {
    const parsed = Number(amount)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error('请输入大于 0 的整数电力')
      return
    }
    if (!note.trim()) {
      toast.error('请填写操作原因')
      return
    }
    if (mode === 'deduct' && users.some(user => user.credits < parsed)) {
      toast.error('至少有一名用户余额不足，本次批量扣除不会执行')
      return
    }
    setSaving(true)
    try {
      const delta = mode === 'grant' ? parsed : -parsed
      if (users.length === 1) {
        await adminCreditsApi.adjust({ user_id: users[0].id, delta, note: note.trim() })
      } else {
        await adminCreditsApi.batchAdjust({ user_ids: users.map(user => user.id), delta, note: note.trim() })
      }
      toast.success(`${mode === 'grant' ? '充值' : '扣除'}成功，共处理 ${users.length} 个用户`)
      onClose()
      await onSaved()
    } catch {
      // request interceptor 已展示后端返回的具体原因
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{users.length > 1 ? `批量调整电力（${users.length} 人）` : `调整 ${users[0]?.username ?? '用户'} 的电力`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-1">
            <button type="button" onClick={() => setMode('grant')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium ${mode === 'grant' ? 'bg-white text-emerald-700 shadow-sm' : 'text-neutral-500'}`}>
              <PlusCircle className="h-4 w-4" />充值
            </button>
            <button type="button" onClick={() => setMode('deduct')} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium ${mode === 'deduct' ? 'bg-white text-rose-600 shadow-sm' : 'text-neutral-500'}`}>
              <MinusCircle className="h-4 w-4" />扣除
            </button>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-600">电力数量</label>
            <Input type="number" min="1" step="1" value={amount} onChange={event => setAmount(event.target.value)} placeholder="请输入整数" autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-600">操作原因（必填）</label>
            <Input value={note} onChange={event => setNote(event.target.value)} placeholder={mode === 'grant' ? '例如：活动赠送' : '例如：违规扣除'} maxLength={255} />
          </div>
          {users.length > 1 && (
            <div className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              本次将对已选择的 {users.length} 个用户分别写入电力流水；任何用户余额不足都会整体取消。
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={() => { void submit() }} disabled={saving} className={mode === 'grant' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            确认{mode === 'grant' ? '充值' : '扣除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function CreditManagement() {
  const [startDate, setStartDate] = useState(initialStartDate)
  const [endDate, setEndDate] = useState(initialEndDate)
  const [overview, setOverview] = useState<CreditOverview | null>(null)
  const [users, setUsers] = useState<AdminUserList | null>(null)
  const [transactions, setTransactions] = useState<AdminCreditTransactionList | null>(null)
  const [userKeyword, setUserKeyword] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [transactionKeyword, setTransactionKeyword] = useState('')
  const [transactionSearch, setTransactionSearch] = useState('')
  const [transactionType, setTransactionType] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [transactionPage, setTransactionPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adjustUsers, setAdjustUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    const value = await adminCreditsApi.overview({ start_date: startDate, end_date: endDate })
    setOverview(value)
  }, [endDate, startDate])

  const loadUsers = useCallback(async () => {
    const value = await adminApi.listUsers(userPage, USER_PAGE_SIZE, userSearch)
    setUsers(value)
  }, [userPage, userSearch])

  const loadTransactions = useCallback(async () => {
    const value = await adminCreditsApi.listTransactions({
      page: transactionPage,
      page_size: TX_PAGE_SIZE,
      keyword: transactionSearch,
      type: transactionType || undefined,
      start_date: startDate,
      end_date: endDate,
    })
    setTransactions(value)
  }, [endDate, startDate, transactionPage, transactionSearch, transactionType])

  const reload = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await Promise.all([loadOverview(), loadUsers(), loadTransactions()])
    } catch {
      setError('电力数据加载失败，请稍后刷新重试')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadOverview, loadTransactions, loadUsers])

  useEffect(() => { void reload() }, [reload])

  const selectedUsers = useMemo(
    () => (users?.list ?? []).filter(user => selected.has(user.id)),
    [selected, users],
  )
  const userTotalPages = users ? Math.max(1, Math.ceil(users.total / users.page_size)) : 1
  const transactionTotalPages = transactions ? Math.max(1, Math.ceil(transactions.total / transactions.page_size)) : 1
  const summary = overview?.summary ?? {
    total_users: 0,
    active_users: 0,
    current_balance: 0,
    total_consumed: 0,
    total_granted: 0,
    total_refunded: 0,
    total_adjusted: 0,
    users_with_usage: 0,
  }

  const toggleUser = (userId: number) => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const togglePage = () => {
    const pageIds = (users?.list ?? []).map(user => user.id)
    const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
    setSelected(previous => {
      const next = new Set(previous)
      pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const searchUsers = () => {
    setUserPage(1)
    setSelected(new Set())
    setUserSearch(userKeyword.trim())
  }

  const searchTransactions = () => {
    setTransactionPage(1)
    setTransactionSearch(transactionKeyword.trim())
  }

  const openAdjust = (targets: AdminUser[]) => {
    if (!targets.length) return
    setAdjustUsers(targets)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f7faf9] p-6">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#167a6e]"><Zap className="h-5 w-5" /><span className="text-xs font-medium tracking-[0.18em] uppercase">Credit Control</span></div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#243447]">电力管理</h1>
            <p className="mt-1 text-sm text-[#78938d]">查看用户电力行为，支持单个或批量充值、扣除并保留完整流水</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#56716b]">
              <span>统计范围</span>
              <input aria-label="开始日期" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="bg-transparent outline-none" />
              <span>至</span>
              <input aria-label="结束日期" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="bg-transparent outline-none" />
            </label>
            <Button size="sm" variant="outline" onClick={() => { void reload() }} disabled={refreshing}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-[#f3c5bc] bg-[#fff5f2] px-4 py-3 text-sm text-[#b25548]">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="当前总余额" value={formatNumber(summary.current_balance)} hint={`${formatNumber(summary.active_users)} 个活跃用户`} icon={Zap} tone="teal" />
          <StatCard label="统计期消耗" value={formatNumber(summary.total_consumed)} hint={`${formatNumber(summary.users_with_usage)} 个用户产生消耗`} icon={BarChart3} tone="rose" />
          <StatCard label="累计到账" value={formatNumber(summary.total_granted)} hint={`失败退回 ${formatNumber(summary.total_refunded)}`} icon={PlusCircle} tone="blue" />
          <StatCard label="管理员调整" value={`${summary.total_adjusted >= 0 ? '+' : ''}${formatNumber(summary.total_adjusted)}`} hint="正数充值，负数扣除" icon={CircleDollarSign} tone="amber" />
          <StatCard label="用户总数" value={formatNumber(summary.total_users)} hint={`统计范围 ${overview?.start_date ?? startDate} 至 ${overview?.end_date ?? endDate}`} icon={Users} tone="teal" />
        </div>

        <CreditTrendChart overview={overview} />

        <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#243447]">用户电力调整</h2>
              <p className="mt-1 text-xs text-[#9ab1ab]">按用户名或邮箱搜索，选择用户后进行单个或批量操作</p>
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && <span className="text-xs text-[#78938d]">已选 {selected.size} 人</span>}
              <Button size="sm" onClick={() => openAdjust(selectedUsers)} disabled={selected.size === 0}>
                <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />调整已选用户
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <Input value={userKeyword} onChange={event => setUserKeyword(event.target.value)} onKeyDown={event => event.key === 'Enter' && searchUsers()} placeholder="搜索用户名 / 邮箱" className="pl-9" />
            </div>
            <Button variant="outline" onClick={searchUsers}>搜索用户</Button>
            <Button variant="ghost" onClick={() => { setSelected(new Set()); setUserKeyword(''); setUserSearch('') }} disabled={!selected.size && !userSearch}>清除</Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
            {loading && !users ? (
              <div className="flex items-center justify-center py-14 text-sm text-neutral-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载用户…</div>
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="w-12 px-4 py-3"><input type="checkbox" checked={(users?.list ?? []).length > 0 && (users?.list ?? []).every(user => selected.has(user.id))} onChange={togglePage} className="h-4 w-4 accent-primary" /></th>
                    <th className="px-4 py-3 font-medium">用户</th>
                    <th className="px-4 py-3 text-right font-medium">当前电力</th>
                    <th className="px-4 py-3 text-right font-medium">累计消耗</th>
                    <th className="px-4 py-3 text-right font-medium">累计到账</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(users?.list ?? []).map(user => (
                    <tr key={user.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3"><input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleUser(user.id)} className="h-4 w-4 accent-primary" /></td>
                      <td className="px-4 py-3"><div className="font-medium text-neutral-800">{user.username}</div><div className="text-xs text-neutral-400">{user.email}</div></td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-neutral-800"><Zap className="mr-1 inline h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />{formatNumber(user.credits)}</td>
                      <td className="px-4 py-3 text-right font-mono text-rose-500">{formatNumber(user.total_consumed)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{formatNumber(user.total_recharged)}</td>
                      <td className="px-4 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openAdjust([user])}>调整</Button></td>
                    </tr>
                  ))}
                  {!users?.list.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-neutral-400">没有匹配的用户</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          <Pagination page={userPage} totalPages={userTotalPages} onChange={setUserPage} />
        </section>

        <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-[#243447]">全部电力流水</h2><p className="mt-1 text-xs text-[#9ab1ab]">展示所有用户的电力变动，用户列使用用户名</p></div>
            <span className="rounded-full bg-[#e8f7f3] px-3 py-1 text-xs text-[#167a6e]">共 {transactions?.total ?? 0} 条</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><Input value={transactionKeyword} onChange={event => setTransactionKeyword(event.target.value)} onKeyDown={event => event.key === 'Enter' && searchTransactions()} placeholder="搜索用户名 / 邮箱 / 备注" className="pl-9" /></div>
            <select value={transactionType} onChange={event => { setTransactionPage(1); setTransactionType(event.target.value) }} className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-primary"><option value="">全部流水</option>{TYPE_OPTIONS.slice(1).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            <Button variant="outline" onClick={searchTransactions}>搜索流水</Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500"><tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">用户</th><th className="px-4 py-3">类型</th><th className="px-4 py-3 text-right">变动</th><th className="px-4 py-3 text-right">变动后余额</th><th className="px-4 py-3">备注</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {transactions?.list.map(row => <tr key={row.id} className="hover:bg-neutral-50"><td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{formatDateTime(row.created_at)}</td><td className="px-4 py-3"><div className="font-medium text-neutral-800">{row.username}</div><div className="text-xs text-neutral-400">{row.email || '—'}</div></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${row.amount >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{row.type_label}</span></td><td className={`px-4 py-3 text-right font-mono font-semibold ${row.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{row.amount >= 0 ? '+' : ''}{formatNumber(row.amount)}</td><td className="px-4 py-3 text-right font-mono text-neutral-700">{formatNumber(row.balance_after)}</td><td className="max-w-[300px] truncate px-4 py-3 text-neutral-500" title={row.note || ''}>{row.note || '—'}</td></tr>)}
                {!transactions?.list.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-neutral-400">暂无流水</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={transactionPage} totalPages={transactionTotalPages} onChange={setTransactionPage} />
        </section>
      </div>
      <AdjustDialog users={adjustUsers} open={adjustUsers.length > 0} onClose={() => setAdjustUsers([])} onSaved={reload} />
    </div>
  )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-end gap-2 text-xs text-neutral-500"><span>第 {page} / {totalPages} 页</span><Button size="sm" variant="outline" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}><ChevronRight className="h-3.5 w-3.5" /></Button></div>
}
