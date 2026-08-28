import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { aiUsageApi, type AiUsageFilters, type AiUsageGroup, type AiUsageLog, type AiUsageOverview, type AiUsageTrendPoint } from '@/services/aiUsage'
import { TokenBars, TokenTrendChart, UsageRank } from '@/pages/SettingPage/components/AiUsageCharts'
import AiUsageDetailDrawer from '@/pages/SettingPage/components/AiUsageDetailDrawer'

const today = new Date().toISOString().slice(0, 10)
const emptyOverview: AiUsageOverview = { calls: 0, attempts: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0, failed_calls: 0, failure_rate: 0, average_latency_ms: 0, unpriced_attempts: 0, start_date: today, end_date: today }

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="flex min-w-[125px] flex-1 items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#78938d]"><span className="shrink-0">{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[#34534d] outline-none placeholder:text-[#b0c1bd]" /></label>
}

function Status({ value }: { value: string }) {
  const style = value === 'success' ? 'bg-[#e6f7f5] text-[#167a6e]' : value === 'failed' || value === 'timeout' ? 'bg-[#fff0ed] text-[#b25548]' : 'bg-[#edf4ff] text-[#3578c9]'
  return <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${style}`}>{value === 'success' ? '成功' : value === 'failed' ? '失败' : value}</span>
}

export default function AiUsagePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [overview, setOverview] = useState<AiUsageOverview>(emptyOverview)
  const [trend, setTrend] = useState<AiUsageTrendPoint[]>([])
  const [users, setUsers] = useState<AiUsageGroup[]>([])
  const [models, setModels] = useState<AiUsageGroup[]>([])
  const [scenes, setScenes] = useState<AiUsageGroup[]>([])
  const [logs, setLogs] = useState<{ items: AiUsageLog[]; total: number }>({ items: [], total: 0 })
  const [detail, setDetail] = useState<{ log: AiUsageLog; trace: AiUsageLog[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const filters = useMemo(() => Object.fromEntries(searchParams.entries()) as AiUsageFilters, [searchParams])
  const page = Number(searchParams.get('page') || '1')

  const setFilter = (key: keyof AiUsageFilters, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setSearchParams(next)
  }

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([aiUsageApi.overview(filters), aiUsageApi.trend(filters), aiUsageApi.byUser(filters), aiUsageApi.byModel(filters), aiUsageApi.byScene(filters), aiUsageApi.logs(filters, page)])
      .then(([nextOverview, nextTrend, nextUsers, nextModels, nextScenes, nextLogs]) => { setOverview(nextOverview); setTrend(nextTrend); setUsers(nextUsers.items); setModels(nextModels); setScenes(nextScenes); setLogs({ items: nextLogs.items, total: nextLogs.total }) })
      .catch(() => setError('Token 数据加载失败，请刷新重试'))
      .finally(() => setLoading(false))
  }, [filters, page])

  useEffect(() => { reload() }, [reload])

  const summary = overview || emptyOverview
  const updatePage = (nextPage: number) => { const next = new URLSearchParams(searchParams); next.set('page', String(nextPage)); setSearchParams(next) }
  const totalPages = Math.max(1, Math.ceil(logs.total / 12))

  return <div className="h-full overflow-auto bg-[#f7faf9] p-6"><div className="mx-auto max-w-[1540px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[#167a6e]"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-[0.18em]">AI Cost Control</span></div><h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#243447]">AI Token 运营中心</h1><p className="mt-1 text-sm text-[#78938d]">统一观察 AI 问答、视频笔记、闪记卡和全部模型调用成本</p></div><div className="flex gap-2"><button type="button" onClick={() => aiUsageApi.export(filters)} className="flex items-center gap-1.5 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#34534d]"><Download className="h-3.5 w-3.5" />导出日志</button><button type="button" onClick={reload} disabled={loading} className="flex items-center gap-1.5 rounded-xl bg-[#167a6e] px-3 py-2 text-xs font-medium text-white disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新</button></div></header>
    <section className="flex flex-wrap gap-2 rounded-2xl border border-[#e5efeb] bg-[#f0f8f6] p-3"><label className="flex items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#56716b]"><CalendarDays className="h-3.5 w-3.5 text-[#167a6e]" /><input aria-label="开始日期" type="date" value={filters.start_date || ''} onChange={event => setFilter('start_date', event.target.value)} className="bg-transparent outline-none" /><span>至</span><input aria-label="结束日期" type="date" value={filters.end_date || ''} onChange={event => setFilter('end_date', event.target.value)} className="bg-transparent outline-none" /></label><Field label="用户 ID" value={filters.user_id?.toString() || ''} onChange={value => setFilter('user_id', value)} placeholder="全部用户" /><Field label="Provider" value={filters.provider_id || ''} onChange={value => setFilter('provider_id', value)} placeholder="全部 Provider" /><Field label="场景" value={filters.scene || ''} onChange={value => setFilter('scene', value)} placeholder="全部场景" /><Field label="模型" value={filters.model_name || ''} onChange={value => setFilter('model_name', value)} placeholder="全部模型" /><Field label="Key 指纹" value={filters.key_fingerprint || ''} onChange={value => setFilter('key_fingerprint', value)} placeholder="脱敏指纹" /><Field label="关键词" value={filters.keyword || ''} onChange={value => setFilter('keyword', value)} placeholder="资源/错误" /><label className="flex items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#78938d]">状态<select value={filters.status || ''} onChange={event => setFilter('status', event.target.value)} className="bg-transparent text-[#34534d] outline-none"><option value="">全部</option><option value="success">成功</option><option value="failed">失败</option><option value="timeout">超时</option><option value="cancelled">取消</option></select></label><button type="button" onClick={() => setSearchParams(new URLSearchParams())} className="flex items-center gap-1 rounded-xl px-3 py-2 text-xs text-[#78938d] hover:bg-white"><X className="h-3.5 w-3.5" />清空</button></section>
    {error && <div className="rounded-xl border border-[#f3c5bc] bg-[#fff5f2] px-4 py-3 text-sm text-[#b25548]">{error}</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['调用次数', summary.calls.toLocaleString(), `底层请求 ${summary.attempts.toLocaleString()}`], ['总 Token', formatTokens(summary.total_tokens), `输入 ${formatTokens(summary.input_tokens)} / 输出 ${formatTokens(summary.output_tokens)}`], ['预估成本', `¥ ${summary.estimated_cost.toFixed(2)}`, summary.unpriced_attempts ? `${summary.unpriced_attempts} 条未配置价格` : '按价格快照计算'], ['失败率', `${summary.failure_rate}%`, `失败 ${summary.failed_calls} 次`], ['平均延迟', `${summary.average_latency_ms} ms`, '仅统计已结束请求']].map(([label, value, hint]) => <div key={label} className="rounded-2xl border border-[#e5efeb] bg-white p-4 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="text-xs text-[#78938d]">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-[#243447]">{value}</div><div className="mt-1 text-[11px] text-[#9ab1ab]">{hint}</div></div>)}</section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]"><TokenTrendChart data={trend} /><TokenBars data={trend} /></section>
    <section className="grid gap-5 xl:grid-cols-3"><UsageRank title="用户消耗排行" data={users} label={item => item.user_snapshot || `用户 ${item.user_id ?? '系统'}`} /><UsageRank title="模型 / Key 消耗" data={models} label={item => `${item.model_name || '—'} · ${item.key_masked || '无 Key'}`} /><UsageRank title="业务场景分布" data={scenes} label={item => item.scene || 'unknown'} /></section>
    <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-[#243447]">最近 AI 调用</h2><p className="mt-1 text-xs text-[#9ab1ab]">每次请求均保留用户、场景、模型、Key 指纹、Token、成本和状态</p></div><Search className="h-4 w-4 text-[#167a6e]" /></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead className="border-b border-[#edf3f0] text-[#9ab1ab]"><tr>{['时间', '用户', '场景', '模型 / Provider', 'Key', '输入', '输出', '成本', '状态'].map(item => <th key={item} className="px-3 py-2 font-medium">{item}</th>)}</tr></thead><tbody>{logs.items.length ? logs.items.map(log => <tr key={log.id} onClick={() => aiUsageApi.detail(log.id).then(setDetail)} className="cursor-pointer border-b border-[#f1f5f3] last:border-0 hover:bg-[#f7faf9]"><td className="whitespace-nowrap px-3 py-3 text-[#78938d]">{log.started_at?.slice(0, 19).replace('T', ' ') || '—'}</td><td className="px-3 py-3 font-medium text-[#34534d]">{log.user_snapshot || log.user_id || '系统'}</td><td className="px-3 py-3 text-[#56716b]">{log.scene}</td><td className="px-3 py-3"><div className="font-medium text-[#34534d]">{log.model_name || '—'}</div><div className="text-[10px] text-[#9ab1ab]">{log.provider_name || '—'}</div></td><td className="px-3 py-3 text-[#78938d]">{log.key_masked || '—'}</td><td className="px-3 py-3 text-[#56716b]">{log.input_tokens?.toLocaleString() || '—'}</td><td className="px-3 py-3 text-[#56716b]">{log.output_tokens?.toLocaleString() || '—'}</td><td className="px-3 py-3 text-[#34534d]">{log.estimated_cost == null ? '—' : `¥${log.estimated_cost.toFixed(4)}`}</td><td className="px-3 py-3"><Status value={log.status} /></td></tr>) : <tr><td colSpan={9} className="py-10 text-center text-xs text-[#9ab1ab]">{loading ? '正在加载…' : '暂无 AI 调用日志'}</td></tr>}</tbody></table></div><div className="mt-4 flex items-center justify-between text-xs text-[#78938d]"><span>共 {logs.total.toLocaleString()} 条</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => updatePage(page - 1)} className="rounded-lg border border-[#d9ebe6] px-3 py-1.5 disabled:opacity-40">上一页</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => updatePage(page + 1)} className="rounded-lg border border-[#d9ebe6] px-3 py-1.5 disabled:opacity-40">下一页</button></div></div></section>
  </div><AiUsageDetailDrawer detail={detail} onClose={() => setDetail(null)} /></div>
}
