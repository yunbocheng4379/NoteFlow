import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Eye,
  LineChart,
  MousePointerClick,
  RefreshCw,
  Users,
} from 'lucide-react'
import {
  analyticsAdminApi,
  type AnalyticsEventItem,
  type AnalyticsFeature,
  type AnalyticsOverview,
  type AnalyticsTrendPoint,
  type AnalyticsUser,
} from '@/services/admin'

const today = new Date()

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function getDefaultStartDate(): string {
  const value = new Date(today)
  value.setDate(value.getDate() - 6)
  return toInputDate(value)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return value.slice(0, 16).replace('T', ' ')
}

function featureLabel(value: string): string {
  const labels: Record<string, string> = {
    note_generate: '生成笔记',
    knowledge_base: '知识库问答',
    explore_search: '探索搜索',
    collection: '笔记合集',
    upgrade: '升级/充值',
    product_assistant: 'AI 客服',
    human_support: '人工客服',
  }
  return labels[value] ?? value
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: string | number
  hint: string
  icon: typeof Eye
  tone: 'teal' | 'blue' | 'amber' | 'rose'
}) {
  const tones = {
    teal: 'bg-[#e6f7f5] text-[#167a6e]',
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
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

function TrendChart({ data }: { data: AnalyticsTrendPoint[] }) {
  const [hovered, setHovered] = useState<{ item: AnalyticsTrendPoint; x: number; y: number } | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const width = 720
  const height = 240
  const padding = { top: 18, right: 18, bottom: 32, left: 36 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const max = Math.max(1, ...data.flatMap(item => [item.pv, item.uv]))
  const points = (key: 'pv' | 'uv') =>
    data
      .map((item, index) => {
        const x = padding.left + (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth)
        const y = padding.top + innerHeight - (item[key] / max) * innerHeight
        return `${x},${y}`
      })
      .join(' ')

  const pointX = (index: number) =>
    padding.left + (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth)

  const updateHovered = (event: ReactMouseEvent<SVGGElement>, item: AnalyticsTrendPoint) => {
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
    <div className="overflow-hidden rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#243447]">PV / UV 趋势</h2>
          <p className="mt-1 text-xs text-[#9ab1ab]">按页面访问统计，每日自动补齐无数据日期</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#78938d]">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#167a6e]" />PV</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#74a9e8]" />UV</span>
        </div>
      </div>
      <div className="mt-4 w-full overflow-x-auto">
        <div ref={chartRef} className="relative min-w-[560px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" role="img" aria-label="PV UV 趋势图">
            {[0, 0.5, 1].map(ratio => {
              const y = padding.top + innerHeight * ratio
              return <line key={ratio} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#edf3f0" strokeWidth="1" />
            })}
            <polyline points={points('pv')} fill="none" stroke="#167a6e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={points('uv')} fill="none" stroke="#74a9e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {data.map((item, index) => {
              const x = pointX(index)
              const previousX = index === 0 ? padding.left : pointX(index - 1)
              const nextX = index === data.length - 1 ? width - padding.right : pointX(index + 1)
              const hoverStart = index === 0 ? padding.left : (previousX + x) / 2
              const hoverEnd = index === data.length - 1 ? width - padding.right : (x + nextX) / 2
              return (
                <g
                  key={item.date}
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  onMouseEnter={event => updateHovered(event, item)}
                  onMouseMove={event => updateHovered(event, item)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ item, x: 8, y: 140 })}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${item.date}：PV ${item.pv}，总 UV ${item.uv}，登录 UV ${item.logged_in_uv}，匿名 UV ${item.anonymous_uv}`}</title>
                  <rect x={hoverStart} y={padding.top} width={hoverEnd - hoverStart} height={innerHeight} fill="transparent" />
                  <circle cx={x} cy={padding.top + innerHeight - (item.pv / max) * innerHeight} r="4" fill="#167a6e" />
                  <circle cx={x} cy={padding.top + innerHeight - (item.uv / max) * innerHeight} r="4" fill="#74a9e8" />
                  <text x={x} y={height - 8} textAnchor="middle" fill="#9ab1ab" fontSize="10">{item.date.slice(5)}</text>
                </g>
              )
            })}
          </svg>
          {hovered && (
            <div className="pointer-events-none absolute z-10 w-[210px] rounded-xl border border-[#d9ebe6] bg-white/95 p-3 text-xs shadow-[0_10px_30px_rgba(36,52,71,0.14)] backdrop-blur-sm" style={{ left: hovered.x, top: hovered.y, transform: 'translateY(-100%)' }}>
              <div className="mb-2 font-semibold text-[#243447]">{hovered.item.date}</div>
              <div className="flex items-center justify-between gap-5 text-[#56716b]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#167a6e]" />页面 PV</span><strong className="font-mono text-[#167a6e]">{hovered.item.pv.toLocaleString()}</strong></div>
              <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#74a9e8]" />总 UV</span><strong className="font-mono text-[#3578c9]">{hovered.item.uv.toLocaleString()}</strong></div>
              <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span>登录 UV</span><strong className="font-mono text-[#3578c9]">{hovered.item.logged_in_uv.toLocaleString()}</strong></div>
              <div className="mt-1.5 flex items-center justify-between gap-5 text-[#56716b]"><span>匿名 UV</span><strong className="font-mono text-[#b67814]">{hovered.item.anonymous_uv.toLocaleString()}</strong></div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-8 text-center text-xs text-[#9ab1ab]">{label}</div>
}

export default function AnalyticsPage() {
  const [startDate, setStartDate] = useState(getDefaultStartDate)
  const [endDate, setEndDate] = useState(toInputDate(today))
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [trend, setTrend] = useState<AnalyticsTrendPoint[]>([])
  const [features, setFeatures] = useState<AnalyticsFeature[]>([])
  const [users, setUsers] = useState<AnalyticsUser[]>([])
  const [events, setEvents] = useState<AnalyticsEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const params = { start_date: startDate, end_date: endDate }
    setLoading(true)
    setError(null)
    Promise.all([
      analyticsAdminApi.overview(params),
      analyticsAdminApi.trend(params),
      analyticsAdminApi.features(params),
      analyticsAdminApi.users({ ...params, page: 1, page_size: 8 }),
      analyticsAdminApi.events({ ...params, page: 1, page_size: 10 }),
    ])
      .then(([nextOverview, nextTrend, nextFeatures, nextUsers, nextEvents]) => {
        if (cancelled) return
        setOverview(nextOverview)
        setTrend(nextTrend)
        setFeatures(nextFeatures)
        setUsers(nextUsers.list)
        setEvents(nextEvents.list)
      })
      .catch(() => {
        if (!cancelled) setError('数据加载失败，请稍后刷新重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [startDate, endDate, refreshKey])

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(key => key + 1), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const summary = overview ?? {
    pv: 0,
    uv: 0,
    logged_in_uv: 0,
    anonymous_uv: 0,
    active_users: 0,
    feature_events: 0,
    feature_success: 0,
    feature_error: 0,
    feature_success_rate: 0,
    start_date: startDate,
    end_date: endDate,
  }

  const loginRatio = useMemo(
    () => Math.round((summary.logged_in_uv / Math.max(1, summary.uv)) * 100),
    [summary.logged_in_uv, summary.uv],
  )

  return (
    <div className="h-full overflow-auto bg-[#f7faf9] p-6">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#167a6e]"><LineChart className="h-5 w-5" /><span className="text-xs font-medium tracking-[0.18em] uppercase">Analytics</span></div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#243447]">数据分析</h1>
            <p className="mt-1 text-sm text-[#78938d]">查看用户访问、核心功能使用和产品行为趋势</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#56716b]">
              <CalendarDays className="h-3.5 w-3.5 text-[#167a6e]" />
              <input aria-label="开始日期" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="bg-transparent outline-none" />
              <span>至</span>
              <input aria-label="结束日期" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="bg-transparent outline-none" />
            </label>
            <button type="button" onClick={() => setRefreshKey(key => key + 1)} disabled={loading} className="flex items-center gap-1.5 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs font-medium text-[#34534d] transition-colors hover:border-[#8bcabb] hover:text-[#167a6e] disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-[#f3c5bc] bg-[#fff5f2] px-4 py-3 text-sm text-[#b25548]">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard label="页面 PV" value={summary.pv.toLocaleString()} hint="页面访问次数" icon={Eye} tone="teal" />
          <StatCard label="总 UV" value={summary.uv.toLocaleString()} hint="去重访客数" icon={Users} tone="blue" />
          <StatCard label="登录 UV" value={summary.logged_in_uv.toLocaleString()} hint={`占总 UV ${loginRatio}%`} icon={Activity} tone="teal" />
          <StatCard label="匿名 UV" value={summary.anonymous_uv.toLocaleString()} hint="未登录访客" icon={Eye} tone="amber" />
          <StatCard label="功能事件" value={summary.feature_events.toLocaleString()} hint="点击与提交次数" icon={MousePointerClick} tone="blue" />
          <StatCard label="功能成功率" value={`${summary.feature_success_rate}%`} hint={`${summary.feature_success} 成功 / ${summary.feature_error} 失败`} icon={CheckCircle2} tone="rose" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
          <TrendChart data={trend} />
          <div className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
            <h2 className="text-sm font-semibold text-[#243447]">访客构成</h2>
            <p className="mt-1 text-xs text-[#9ab1ab]">当前时间范围内的 UV 分布</p>
            <div className="mt-7 flex items-center justify-center">
              <div className="relative flex h-36 w-36 items-center justify-center rounded-full" style={{ background: `conic-gradient(#167a6e ${loginRatio}%, #dbece8 0)` }}>
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><span className="text-2xl font-semibold text-[#243447]">{loginRatio}%</span><span className="text-[11px] text-[#9ab1ab]">登录用户</span></div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 text-center text-xs"><div className="rounded-xl bg-[#f1faf8] p-3"><div className="font-semibold text-[#167a6e]">{summary.logged_in_uv}</div><div className="mt-1 text-[#78938d]">登录 UV</div></div><div className="rounded-xl bg-[#fff8e9] p-3"><div className="font-semibold text-[#b67814]">{summary.anonymous_uv}</div><div className="mt-1 text-[#78938d]">匿名 UV</div></div></div>
          </div>
        </div>

        <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#243447]">核心功能表现</h2><p className="mt-1 text-xs text-[#9ab1ab]">按功能入口汇总点击、使用人数和结果</p></div><MousePointerClick className="h-4 w-4 text-[#167a6e]" /></div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs"><thead className="border-b border-[#edf3f0] text-[#9ab1ab]"><tr><th className="px-3 py-2 font-medium">功能</th><th className="px-3 py-2 font-medium">点击量</th><th className="px-3 py-2 font-medium">使用人数</th><th className="px-3 py-2 font-medium">使用率</th><th className="px-3 py-2 font-medium">提交</th><th className="px-3 py-2 font-medium">成功</th><th className="px-3 py-2 font-medium">失败</th><th className="px-3 py-2 font-medium">成功率</th></tr></thead><tbody>{features.length ? features.map(item => <tr key={item.feature} className="border-b border-[#f1f5f3] last:border-0"><td className="px-3 py-3 font-medium text-[#34534d]">{featureLabel(item.feature)}</td><td className="px-3 py-3 text-[#243447]">{item.clicks}</td><td className="px-3 py-3 text-[#243447]">{item.users}</td><td className="px-3 py-3"><span className="rounded-full bg-[#edf4ff] px-2 py-1 text-[#3578c9]">{item.usage_rate}%</span></td><td className="px-3 py-3 text-[#56716b]">{item.submits}</td><td className="px-3 py-3 text-[#167a6e]">{item.successes}</td><td className="px-3 py-3 text-[#c66b5d]">{item.errors}</td><td className="px-3 py-3"><span className="rounded-full bg-[#e6f7f5] px-2 py-1 text-[#167a6e]">{item.success_rate}%</span></td></tr>) : <tr><td colSpan={8}><EmptyState label={loading ? '正在加载…' : '暂无功能事件'} /></td></tr>}</tbody></table>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-[#243447]">登录用户使用排行</h2><p className="mt-1 text-xs text-[#9ab1ab]">仅展示已有账号信息的用户</p></div><Users className="h-4 w-4 text-[#167a6e]" /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-[#edf3f0] text-[#9ab1ab]"><tr><th className="px-3 py-2 font-medium">用户</th><th className="px-3 py-2 font-medium">PV</th><th className="px-3 py-2 font-medium">活跃天数</th><th className="px-3 py-2 font-medium">功能数</th><th className="px-3 py-2 font-medium">最近访问</th></tr></thead><tbody>{users.length ? users.map(user => <tr key={user.user_id} className="border-b border-[#f1f5f3] last:border-0"><td className="px-3 py-3"><div className="font-medium text-[#34534d]">{user.username}</div><div className="mt-0.5 text-[10px] text-[#9ab1ab]">{user.email || '未绑定邮箱'}</div></td><td className="px-3 py-3 text-[#243447]">{user.pv}</td><td className="px-3 py-3 text-[#56716b]">{user.active_days}</td><td className="px-3 py-3 text-[#56716b]">{user.feature_count}</td><td className="px-3 py-3 text-[#78938d]">{formatDate(user.last_seen_at)}</td></tr>) : <tr><td colSpan={5}><EmptyState label={loading ? '正在加载…' : '暂无登录用户数据'} /></td></tr>}</tbody></table></div></section>

          <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-[#243447]">最近埋点明细</h2><p className="mt-1 text-xs text-[#9ab1ab]">用于核对前端事件是否正常上报</p></div><AlertTriangle className="h-4 w-4 text-[#b67814]" /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-[#edf3f0] text-[#9ab1ab]"><tr><th className="px-3 py-2 font-medium">时间</th><th className="px-3 py-2 font-medium">事件</th><th className="px-3 py-2 font-medium">页面 / 目标</th><th className="px-3 py-2 font-medium">访客</th></tr></thead><tbody>{events.length ? events.map(event => <tr key={event.id} className="border-b border-[#f1f5f3] last:border-0"><td className="px-3 py-3 whitespace-nowrap text-[#78938d]">{formatDate(event.occurred_at)}</td><td className="px-3 py-3"><span className="rounded-full bg-[#f1faf8] px-2 py-1 text-[#167a6e]">{event.event_name}</span></td><td className="max-w-[220px] px-3 py-3"><div className="truncate text-[#34534d]">{event.page_path}</div><div className="mt-0.5 truncate text-[10px] text-[#9ab1ab]">{event.target ? featureLabel(event.target) : '—'}</div></td><td className="px-3 py-3 text-[#56716b]">{event.username || event.user_type}</td></tr>) : <tr><td colSpan={4}><EmptyState label={loading ? '正在加载…' : '暂无埋点数据'} /></td></tr>}</tbody></table></div></section>
        </div>
      </div>
    </div>
  )
}
