import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarClock, Download, Info, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import SearchableSelect, { type SearchableSelectOption } from '@/components/SearchableSelect'
import { aiUsageApi, type AiUsageFacets, type AiUsageFilters, type AiUsageGroup, type AiUsageLog, type AiUsageOverview, type AiUsageTrendPoint } from '@/services/aiUsage'
import { TokenBars, TokenTrendChart, UsageRank } from '@/pages/SettingPage/components/AiUsageCharts'
import AiUsageDetailDrawer from '@/pages/SettingPage/components/AiUsageDetailDrawer'
import { AI_USAGE_STATUS_LABELS, formatScene, formatStatus, getSceneDefinition } from './aiUsageLabels'
import { clearAiUsageFilter, isInvalidAiUsageDateRange } from './aiUsageFilters'

const today = new Date().toISOString().slice(0, 10)
const emptyOverview: AiUsageOverview = { calls: 0, attempts: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0, failed_calls: 0, failure_rate: 0, average_latency_ms: 0, unpriced_attempts: 0, start_date: today, end_date: today }
const emptyFacets: AiUsageFacets = { users: [], models: [], scenes: [], statuses: [] }
const INVALID_DATE_RANGE_TOAST_ID = 'ai-usage-invalid-date-range'

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

function FilterField({ label, value, onChange, onClear, placeholder }: { label: string; value: string; onChange: (value: string) => void; onClear: () => void; placeholder?: string }) {
  return <label className="relative flex h-9 w-full items-center gap-2 rounded-xl border border-[#d9ebe6] bg-white px-3 text-xs text-[#78938d] sm:shrink-0"><span className="shrink-0">{label}</span><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={`min-w-0 flex-1 bg-transparent text-[#34534d] outline-none placeholder:text-[#b0c1bd] ${value ? 'pr-6' : ''}`} />{value && <button type="button" aria-label={`清除${label}筛选`} onClick={event => { event.preventDefault(); event.stopPropagation(); onClear() }} className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-md text-[#9ab1ab] hover:bg-[#edf6f3] hover:text-[#167a6e]"><X className="h-3.5 w-3.5" /></button>}</label>
}

function DateTimeField({ label, value, onChange, ariaLabel }: { label: string; value: string; onChange: (value: string) => void; ariaLabel: string }) {
  return <div className="relative flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-[#f7faf9] px-2 transition-colors focus-within:bg-[#eef8f5]">
    <span className="shrink-0 text-[10px] font-semibold tracking-wide text-[#8da9a2]">{label}</span>
    <div className="relative min-w-0 flex-1">
      {!value && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[11px] text-[#b0c1bd]">选择日期时间</span>}
      <input aria-label={ariaLabel} type="datetime-local" step="60" value={value} onChange={event => onChange(event.target.value)} className={`relative h-6 w-full min-w-0 appearance-none bg-transparent text-[11px] outline-none [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 ${value ? 'text-[#34534d] [&::-webkit-datetime-edit]:text-[#34534d]' : 'text-transparent [&::-webkit-datetime-edit]:text-transparent'}`} />
    </div>
  </div>
}

function DateRangeFilter({ startDateTime, endDateTime, onStartChange, onEndChange, onClear }: { startDateTime: string; endDateTime: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void; onClear: () => void }) {
  return <div className="relative box-border flex h-9 w-full items-center gap-1.5 rounded-xl border border-[#d9ebe6] bg-white p-1 pr-9 text-xs text-[#56716b] shadow-[0_2px_8px_rgba(36,52,71,0.03)] transition-colors focus-within:border-[#9bcfc2] focus-within:shadow-[0_0_0_3px_rgba(22,122,110,0.08)] sm:w-[410px] sm:shrink-0">
    <CalendarClock className="ml-1 h-4 w-4 shrink-0 text-[#167a6e]" />
    <DateTimeField label="从" value={startDateTime} onChange={onStartChange} ariaLabel="开始日期和时间" />
    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#a2bbb5]" />
    <DateTimeField label="到" value={endDateTime} onChange={onEndChange} ariaLabel="结束日期和时间" />
    {(startDateTime || endDateTime) && <button type="button" aria-label="清除日期时间筛选" onClick={event => { event.preventDefault(); event.stopPropagation(); onClear() }} className="absolute right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-[#9ab1ab] transition-colors hover:bg-[#edf6f3] hover:text-[#167a6e]"><X className="h-3.5 w-3.5" /></button>}
  </div>
}

function Status({ value }: { value: string }) {
  const style = value === 'success' ? 'bg-[#e6f7f5] text-[#167a6e]' : value === 'failed' || value === 'timeout' ? 'bg-[#fff0ed] text-[#b25548]' : 'bg-[#edf4ff] text-[#3578c9]'
  return <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${style}`}>{formatStatus(value)}</span>
}

export default function AiUsagePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [overview, setOverview] = useState<AiUsageOverview>(emptyOverview)
  const [trend, setTrend] = useState<AiUsageTrendPoint[]>([])
  const [users, setUsers] = useState<AiUsageGroup[]>([])
  const [models, setModels] = useState<AiUsageGroup[]>([])
  const [scenes, setScenes] = useState<AiUsageGroup[]>([])
  const [logs, setLogs] = useState<{ items: AiUsageLog[]; total: number }>({ items: [], total: 0 })
  const [facets, setFacets] = useState<AiUsageFacets>(emptyFacets)
  const [detail, setDetail] = useState<{ log: AiUsageLog; trace: AiUsageLog[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const filters = useMemo(() => Object.fromEntries(searchParams.entries()) as AiUsageFilters, [searchParams])
  const page = Number(searchParams.get('page') || '1')

  const setFilter = (key: keyof AiUsageFilters, value: string) => {
    const next = clearAiUsageFilter(searchParams, key)
    if (value) next.set(key, value)
    setSearchParams(next)
  }
  const clearFilter = (key: keyof AiUsageFilters) => setSearchParams(clearAiUsageFilter(searchParams, key))
  const clearDateRange = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('start_datetime')
    next.delete('end_datetime')
    next.delete('start_date')
    next.delete('end_date')
    next.delete('page')
    setSearchParams(next)
  }

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    if (isInvalidAiUsageDateRange(filters.start_datetime || '', filters.end_datetime || '')) {
      setLoading(false)
      toast('结束时间不能早于或等于开始时间', {
        id: INVALID_DATE_RANGE_TOAST_ID,
        icon: '⚠️',
        duration: 3200,
        style: { background: '#fff8db', color: '#8a5a00', border: '1px solid #f0c36d', boxShadow: '0 8px 24px rgba(138, 90, 0, 0.12)' },
      })
      return
    }
    toast.dismiss(INVALID_DATE_RANGE_TOAST_ID)
    const facetFilters = { start_datetime: filters.start_datetime, end_datetime: filters.end_datetime }
    Promise.all([aiUsageApi.overview(filters), aiUsageApi.trend(filters), aiUsageApi.byUser(filters), aiUsageApi.byModel(filters), aiUsageApi.byScene(filters), aiUsageApi.logs(filters, page), aiUsageApi.facets(facetFilters)])
      .then(([nextOverview, nextTrend, nextUsers, nextModels, nextScenes, nextLogs, nextFacets]) => { setOverview(nextOverview); setTrend(nextTrend); setUsers(nextUsers.items); setModels(nextModels); setScenes(nextScenes); setLogs({ items: nextLogs.items, total: nextLogs.total }); setFacets(nextFacets) })
      .catch(() => setError('Token 数据加载失败，请刷新重试'))
      .finally(() => setLoading(false))
  }, [filters, page])

  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if (isInvalidAiUsageDateRange(filters.start_datetime || '', filters.end_datetime || '')) return
    const timer = window.setInterval(reload, 15000)
    return () => window.clearInterval(timer)
  }, [reload, filters.start_datetime, filters.end_datetime])

  const userOptions = useMemo<SearchableSelectOption[]>(() => facets.users.map(user => ({ value: user, label: user, searchText: user })), [facets.users])
  const modelOptions = useMemo<SearchableSelectOption[]>(() => {
    const providers = new Map<string, Set<string>>()
    facets.models.forEach(item => { if (!providers.has(item.model_name)) providers.set(item.model_name, new Set()); if (item.provider_name) providers.get(item.model_name)?.add(item.provider_name) })
    return [...providers].map(([model, providerNames]) => { const providerText = [...providerNames].join('、'); return { value: model, label: model, description: providerText ? `服务商：${providerText}` : '服务商未知', searchText: `${model} ${providerText}` } })
  }, [facets.models])
  const sceneOptions = useMemo<SearchableSelectOption[]>(() => facets.scenes.map(scene => { const definition = getSceneDefinition(scene); return { value: scene, label: formatScene(scene), description: definition.description, searchText: `${scene} ${definition.label} ${definition.description}` } }), [facets.scenes])
  const statusOptions = useMemo<SearchableSelectOption[]>(() => { const statuses = facets.statuses.length ? facets.statuses : Object.keys(AI_USAGE_STATUS_LABELS); return statuses.map(status => ({ value: status, label: formatStatus(status), searchText: status })) }, [facets.statuses])

  const summary = overview || emptyOverview
  const updatePage = (nextPage: number) => { const next = new URLSearchParams(searchParams); next.set('page', String(nextPage)); setSearchParams(next) }
  const totalPages = Math.max(1, Math.ceil(logs.total / 12))

  return <div className="h-full overflow-auto bg-[#f7faf9] p-6"><div className="mx-auto max-w-[1540px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[#167a6e]"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-[0.18em]">AI Cost Control</span></div><h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#243447]">AI Token 运营中心</h1><p className="mt-1 text-sm text-[#78938d]">统一观察 AI 问答、视频笔记、闪记卡和全部模型调用成本</p></div><div className="flex gap-2"><button type="button" onClick={() => aiUsageApi.export(filters)} className="flex items-center gap-1.5 rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-xs text-[#34534d]"><Download className="h-3.5 w-3.5" />导出日志</button><button type="button" onClick={reload} disabled={loading} className="flex items-center gap-1.5 rounded-xl bg-[#167a6e] px-3 py-2 text-xs font-medium text-white disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新</button></div></header>
    <section className="space-y-3 rounded-2xl border border-[#e5efeb] bg-[#f0f8f6] p-3"><div className="flex flex-wrap gap-2"><DateRangeFilter startDateTime={filters.start_datetime || ''} endDateTime={filters.end_datetime || ''} onStartChange={value => setFilter('start_datetime', value)} onEndChange={value => setFilter('end_datetime', value)} onClear={clearDateRange} /><div className="w-full sm:w-[180px] sm:shrink-0"><SearchableSelect options={userOptions} value={filters.user_name || ''} onValueChange={value => setFilter('user_name', value)} onClear={() => clearFilter('user_name')} placeholder="全部用户" searchPlaceholder="搜索用户名..." /></div><div className="w-full sm:w-[300px] sm:shrink-0"><SearchableSelect options={sceneOptions} value={filters.scene || ''} onValueChange={value => setFilter('scene', value)} onClear={() => clearFilter('scene')} placeholder="全部场景" searchPlaceholder="搜索场景..." /></div><div className="w-full sm:w-[250px] sm:shrink-0"><SearchableSelect options={modelOptions} value={filters.model_name || ''} onValueChange={value => setFilter('model_name', value)} onClear={() => clearFilter('model_name')} placeholder="全部模型" searchPlaceholder="搜索模型..." /></div><div className="w-full sm:w-[200px] sm:shrink-0"><FilterField label="Key 指纹" value={filters.key_fingerprint || ''} onChange={value => setFilter('key_fingerprint', value)} onClear={() => clearFilter('key_fingerprint')} placeholder="模糊搜索" /></div><div className="w-full sm:w-[220px] sm:shrink-0"><FilterField label="关键词" value={filters.keyword || ''} onChange={value => setFilter('keyword', value)} onClear={() => clearFilter('keyword')} placeholder="资源/错误" /></div><div className="w-full sm:w-[150px] sm:shrink-0"><SearchableSelect options={statusOptions} value={filters.status || ''} onValueChange={value => setFilter('status', value)} onClear={() => clearFilter('status')} placeholder="全部状态" searchPlaceholder="搜索状态..." /></div><button type="button" onClick={() => setSearchParams(new URLSearchParams())} className="flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs text-[#78938d] hover:bg-white"><X className="h-3.5 w-3.5" />清空全部</button></div><div className="flex items-start gap-2 rounded-xl border border-[#d9ebe6] bg-white/70 px-3 py-2.5 text-xs text-[#78938d]"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#167a6e]" /><span><strong className="font-medium text-[#56716b]">场景说明：</strong>每条记录代表一次模型调用；一次业务操作可能包含多次底层尝试。下拉选项同时展示中文名称、英文代码和用途，便于管理员定位消耗来源。</span></div></section>
    {summary.unpriced_attempts > 0 && <div className="flex items-center gap-3 rounded-xl border border-[#f0c36d] bg-[#fff8db] px-4 py-3 text-xs text-[#8a5a00]"><Info className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1">有 {summary.unpriced_attempts} 条调用未配置输入/输出 Token 价格，“待配置”不代表免费。为对应模型配置每百万 Token 单价后，历史记录会自动补算。</span><button type="button" onClick={() => navigate('/settings/model')} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#e5b548] bg-[#fff1bd] px-2.5 py-1.5 font-medium text-[#8a5a00] transition-colors hover:bg-[#ffe89a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d39b2a] focus-visible:ring-offset-1"><span>去配置</span><ArrowRight className="h-3.5 w-3.5" /></button></div>}
    {error && <div className="rounded-xl border border-[#f3c5bc] bg-[#fff5f2] px-4 py-3 text-sm text-[#b25548]">{error}</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['调用次数', summary.calls.toLocaleString(), `底层请求 ${summary.attempts.toLocaleString()}`], ['总 Token', formatTokens(summary.total_tokens), `输入 ${formatTokens(summary.input_tokens)} / 输出 ${formatTokens(summary.output_tokens)}`], ['预估成本', summary.unpriced_attempts && summary.estimated_cost === 0 ? '待配置' : `¥ ${summary.estimated_cost.toFixed(2)}`, summary.unpriced_attempts ? `${summary.unpriced_attempts} 条未配置价格` : '按价格快照计算'], ['失败率', `${summary.failure_rate}%`, `失败 ${summary.failed_calls} 次`], ['平均延迟', `${summary.average_latency_ms} ms`, '仅统计已结束请求']].map(([label, value, hint]) => <div key={label} className="rounded-2xl border border-[#e5efeb] bg-white p-4 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="text-xs text-[#78938d]">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-[#243447]">{value}</div><div className="mt-1 text-[11px] text-[#9ab1ab]">{hint}</div></div>)}</section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]"><TokenTrendChart data={trend} /><TokenBars data={trend} /></section>
    <section className="grid gap-5 xl:grid-cols-3"><UsageRank title="用户消耗排行" data={users} label={item => item.user_name || item.user_snapshot || '未知用户'} /><UsageRank title="模型 / Key 消耗" data={models} label={item => `${item.model_name || '未指定模型'} · ${item.key_masked || '无 Key'}`} /><UsageRank title="业务场景分布" data={scenes} label={item => formatScene(item.scene)} /></section>
    <section className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-[#243447]">最近 AI 调用</h2><p className="mt-1 text-xs text-[#9ab1ab]">每次请求均保留用户、场景、模型、Key 指纹、Token、成本和状态</p></div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead className="border-b border-[#edf3f0] text-[#9ab1ab]"><tr>{['时间', '用户', '场景', '模型', 'Key', '输入', '输出', '成本', '状态'].map(item => <th key={item} className="px-3 py-2 font-medium">{item}</th>)}</tr></thead><tbody>{logs.items.length ? logs.items.map(log => <tr key={log.id} onClick={() => aiUsageApi.detail(log.id).then(setDetail)} className="cursor-pointer border-b border-[#f1f5f3] last:border-0 hover:bg-[#f7faf9]"><td className="whitespace-nowrap px-3 py-3 text-[#78938d]">{log.started_at?.slice(0, 19).replace('T', ' ') || '—'}</td><td className="px-3 py-3 font-medium text-[#34534d]">{log.user_name || '未知用户'}</td><td className="px-3 py-3"><div className="text-[#56716b]">{formatScene(log.scene)}</div><div className="mt-0.5 text-[10px] text-[#9ab1ab]">{getSceneDefinition(log.scene).description}</div></td><td className="px-3 py-3"><div className="font-medium text-[#34534d]">{log.model_name || '未指定模型'}</div><div className="text-[10px] text-[#9ab1ab]">{log.provider_name || '服务商未知'}</div></td><td className="px-3 py-3 text-[#78938d]">{log.key_masked || '—'}</td><td className="px-3 py-3 text-[#56716b]">{log.input_tokens?.toLocaleString() || '—'}</td><td className="px-3 py-3 text-[#56716b]">{log.output_tokens?.toLocaleString() || '—'}</td><td className="px-3 py-3 text-[#34534d]">{log.estimated_cost == null ? '—' : `¥${log.estimated_cost.toFixed(4)}`}</td><td className="px-3 py-3"><Status value={log.status} /></td></tr>) : <tr><td colSpan={9} className="py-10 text-center text-xs text-[#9ab1ab]">{loading ? '正在加载…' : '暂无 AI 调用日志'}</td></tr>}</tbody></table></div><div className="mt-4 flex items-center justify-between text-xs text-[#78938d]"><span>共 {logs.total.toLocaleString()} 条</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => updatePage(page - 1)} className="rounded-lg border border-[#d9ebe6] px-3 py-1.5 disabled:opacity-40">上一页</button><span>{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => updatePage(page + 1)} className="rounded-lg border border-[#d9ebe6] px-3 py-1.5 disabled:opacity-40">下一页</button></div></div></section>
  </div><AiUsageDetailDrawer detail={detail} onClose={() => setDetail(null)} /></div>
}
