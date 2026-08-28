import { useEffect, useState } from 'react'
import { ArrowUpRight, Coins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { aiUsageApi } from '@/services/aiUsage'

export default function AiUsageWidget() {
  const [summary, setSummary] = useState<{ total_tokens: number; estimated_cost: number; failure_rate: number } | null>(null)
  useEffect(() => { const today = new Date().toISOString().slice(0, 10); aiUsageApi.overview({ start_date: today, end_date: today }).then(setSummary).catch(() => setSummary(null)) }, [])
  return <div className="mt-3 rounded-xl border border-[#d9ebe6] bg-[#f1faf8] p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold text-[#34534d]"><Coins className="h-3.5 w-3.5 text-[#167a6e]" />Token 概览</div><Link to="/settings/ai-usage" className="text-[#167a6e]" aria-label="打开 AI Token 运营"><ArrowUpRight className="h-3.5 w-3.5" /></Link></div>{summary ? <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><div className="text-[#9ab1ab]">今日 Token</div><div className="mt-0.5 font-semibold text-[#34534d]">{summary.total_tokens.toLocaleString()}</div></div><div><div className="text-[#9ab1ab]">预估成本</div><div className="mt-0.5 font-semibold text-[#34534d]">¥{summary.estimated_cost.toFixed(2)}</div></div></div> : <div className="mt-2 text-[10px] text-[#9ab1ab]">暂无数据</div>}<Link to="/settings/ai-usage" className="mt-2 block text-[10px] font-medium text-[#167a6e]">查看完整运营数据 →</Link></div>
}
