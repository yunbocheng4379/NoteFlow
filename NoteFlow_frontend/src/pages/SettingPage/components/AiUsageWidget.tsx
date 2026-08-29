import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { aiUsageApi } from '@/services/aiUsage'

const AI_USAGE_ROUTE = '/settings/ai-usage'

export default function AiUsageWidget() {
  const [summary, setSummary] = useState<{ total_tokens: number; estimated_cost: number; failure_rate: number } | null>(null)
  useEffect(() => { const today = new Date().toISOString().slice(0, 10); aiUsageApi.overview({ start_date: today, end_date: today }).then(setSummary).catch(() => setSummary(null)) }, [])
  return (
    <Link
      to={AI_USAGE_ROUTE}
      aria-label="打开 AI Token 运营中心，查看今日 Token 和预估成本"
      className="group mt-3 block rounded-2xl border border-[#d5ebe5] bg-[#f4fbf9] p-3 text-left shadow-[0_8px_20px_rgba(22,122,110,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#9ccfc3] hover:bg-[#eef9f6] hover:shadow-[0_12px_26px_rgba(22,122,110,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#167a6e]/35 focus-visible:ring-offset-2"
    >
      <div className="grid grid-cols-2 divide-x divide-[#cfe5df] rounded-xl bg-white/60 py-2.5 transition-colors duration-200 group-hover:bg-white/75">
        <div className="px-2.5">
          <div className="text-[10px] font-medium text-[#83a39d]">今日 Token</div>
          <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-[#294b45]">
            {summary ? summary.total_tokens.toLocaleString() : '—'}
          </div>
        </div>
        <div className="px-2.5">
          <div className="text-[10px] font-medium text-[#83a39d]">预估成本</div>
          <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-[#294b45]">
            {summary ? `¥${summary.estimated_cost.toFixed(2)}` : '—'}
          </div>
        </div>
      </div>
    </Link>
  )
}
