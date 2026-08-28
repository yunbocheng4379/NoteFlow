import type { AiUsageGroup, AiUsageTrendPoint } from '@/services/aiUsage'

export function TokenTrendChart({ data }: { data: AiUsageTrendPoint[] }) {
  const width = 760
  const height = 240
  const padding = { top: 18, right: 18, bottom: 34, left: 42 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const max = Math.max(1, ...data.map(item => item.total_tokens))
  const points = (key: 'input_tokens' | 'output_tokens') => data.map((item, index) => {
    const x = padding.left + (data.length <= 1 ? innerWidth / 2 : index / (data.length - 1) * innerWidth)
    const y = padding.top + innerHeight - item[key] / max * innerHeight
    return `${x},${y}`
  }).join(' ')
  return (
    <div className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-[#243447]">Token 消耗趋势</h2><p className="mt-1 text-xs text-[#9ab1ab]">按日聚合，单位为 Token</p></div><div className="flex gap-3 text-[11px] text-[#78938d]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#167a6e]" />输入</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#8b74d8]" />输出</span></div></div>
      <div className="mt-4 overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="min-w-[620px]" role="img" aria-label="Token 消耗趋势图">
        {[0, 0.5, 1].map(ratio => <line key={ratio} x1={padding.left} x2={width - padding.right} y1={padding.top + innerHeight * ratio} y2={padding.top + innerHeight * ratio} stroke="#edf3f0" />)}
        <polyline points={points('input_tokens')} fill="none" stroke="#167a6e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={points('output_tokens')} fill="none" stroke="#8b74d8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((item, index) => { const x = padding.left + (data.length <= 1 ? innerWidth / 2 : index / (data.length - 1) * innerWidth); return <text key={item.date} x={x} y={height - 8} textAnchor="middle" fill="#9ab1ab" fontSize="10">{item.date.slice(5)}</text> })}
      </svg></div>
    </div>
  )
}

export function TokenBars({ data }: { data: AiUsageTrendPoint[] }) {
  const max = Math.max(1, ...data.map(item => item.total_tokens))
  return <div className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><div><h2 className="text-sm font-semibold text-[#243447]">输入 / 输出结构</h2><p className="mt-1 text-xs text-[#9ab1ab]">每日 Token 构成</p></div><div className="mt-5 flex h-[205px] items-end gap-2 border-b border-[#edf3f0] px-2">{data.slice(-14).map(item => <div key={item.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1"><div className="flex w-full max-w-7 flex-col justify-end overflow-hidden rounded-t-md" style={{ height: `${Math.max(5, item.total_tokens / max * 100)}%` }}><div className="bg-[#73978f]" style={{ height: `${item.total_tokens ? item.input_tokens / item.total_tokens * 100 : 0}%` }} /><div className="bg-[#b6a9e2]" style={{ height: `${item.total_tokens ? item.output_tokens / item.total_tokens * 100 : 0}%` }} /></div><span className="text-[10px] text-[#9ab1ab]">{item.date.slice(5)}</span></div>)}</div><div className="mt-3 flex gap-4 text-[11px] text-[#78938d]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#73978f]" />输入 Token</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#b6a9e2]" />输出 Token</span></div></div>
}

export function UsageRank({ title, data, label }: { title: string; data: AiUsageGroup[]; label: (item: AiUsageGroup) => string }) {
  const max = Math.max(1, ...data.map(item => item.total_tokens))
  return <div className="rounded-2xl border border-[#e5efeb] bg-white p-5 shadow-[0_8px_24px_rgba(36,52,71,0.04)]"><h2 className="text-sm font-semibold text-[#243447]">{title}</h2><p className="mt-1 text-xs text-[#9ab1ab]">按总 Token 排序</p><div className="mt-4 space-y-4">{data.slice(0, 5).map(item => <div key={`${label(item)}-${item.total_tokens}`}><div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="truncate text-[#34534d]">{label(item)}</span><span className="shrink-0 text-[#78938d]">{item.total_tokens.toLocaleString()} · ¥{item.estimated_cost.toFixed(2)}</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf3f0]"><div className="h-full rounded-full bg-[#5c9e92]" style={{ width: `${item.total_tokens / max * 100}%` }} /></div></div>)}</div>{!data.length && <div className="py-8 text-center text-xs text-[#9ab1ab]">暂无数据</div>}</div>
}
