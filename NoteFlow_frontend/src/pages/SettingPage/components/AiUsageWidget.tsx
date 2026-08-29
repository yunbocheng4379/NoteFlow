import { useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, Coins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { aiUsageApi } from '@/services/aiUsage'

const AI_USAGE_ROUTE = '/settings/ai-usage'

export default function AiUsageWidget() {
  const [summary, setSummary] = useState<{ total_tokens: number; estimated_cost: number; failure_rate: number } | null>(null)
  useEffect(() => { const today = new Date().toISOString().slice(0, 10); aiUsageApi.overview({ start_date: today, end_date: today }).then(setSummary).catch(() => setSummary(null)) }, [])
  return (
    <Link
      to={AI_USAGE_ROUTE}
      aria-label="打开 AI Token 运营中心"
      className="group mt-3 block overflow-hidden rounded-2xl border border-[#d5ebe5] bg-gradient-to-br from-[#f5fcfa] via-[#effaf7] to-[#e8f6f2] text-left shadow-[0_10px_24px_rgba(22,122,110,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#a9d9ce] hover:shadow-[0_14px_30px_rgba(22,122,110,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#167a6e]/35 focus-visible:ring-offset-2"
    >
      <div className="relative p-4">
        <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/45 blur-2xl transition-transform duration-300 group-hover:translate-x-2 group-hover:-translate-y-1" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#167a6e] shadow-sm ring-1 ring-[#d5ebe5]">
              <Coins className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold tracking-tight text-[#294b45]">AI Token 用量</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#36a893] shadow-[0_0_0_3px_rgba(54,168,147,0.12)]" />
              </div>
              <p className="mt-0.5 text-[10px] text-[#83a39d]">今日运营概览</p>
            </div>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#167a6e] ring-1 ring-[#b8dcd4] transition-all duration-200 group-hover:bg-[#167a6e] group-hover:text-white group-hover:ring-[#167a6e]">
            <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:rotate-12" />
          </span>
        </div>

        <div className="relative mt-4 grid grid-cols-2 divide-x divide-[#cfe5df] rounded-xl bg-white/45 py-2.5">
          <div className="px-2.5">
            <div className="text-[10px] text-[#83a39d]">今日 Token</div>
            <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-[#294b45]">
              {summary ? summary.total_tokens.toLocaleString() : '—'}
            </div>
          </div>
          <div className="px-2.5">
            <div className="text-[10px] text-[#83a39d]">预估成本</div>
            <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-[#294b45]">
              {summary ? `¥${summary.estimated_cost.toFixed(2)}` : '—'}
            </div>
          </div>
        </div>

        <div className="relative mt-3 flex items-center justify-between border-t border-[#cfe5df]/80 pt-3 text-xs font-medium text-[#167a6e]">
          <span>查看完整运营数据</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  )
}
