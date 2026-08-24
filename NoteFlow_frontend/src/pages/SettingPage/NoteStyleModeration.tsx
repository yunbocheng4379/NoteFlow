import { useCallback, useEffect, useState } from 'react'
import { Check, Eye, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ContentModerationConfig from '@/components/Form/modelForm/ContentModerationConfig'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { noteStyleModerationApi, type ModerationStyle } from '@/services/note_style_moderation'

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿', PENDING_REVIEW: '待审核', REJECTED: '已驳回', PUBLISHED: '已上架', UNPUBLISHED: '已下架',
}

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-neutral-100 text-neutral-600',
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  UNPUBLISHED: 'bg-neutral-200 text-neutral-700',
}

const STATUS_DOT: Record<string, string> = {
  DRAFT: 'bg-neutral-300',
  PENDING_REVIEW: 'bg-amber-500',
  REJECTED: 'bg-red-500',
  PUBLISHED: 'bg-emerald-500',
  UNPUBLISHED: 'bg-neutral-400',
}

const AI_STATUS_LABELS: Record<string, string> = {
  passed: '初筛未发现明显风险',
  risk: '初筛发现风险',
  failed: '初筛失败',
  not_configured: '未配置安全检测模型',
  pending: '检测中',
}

const aiStatusLabel = (status?: string | null) => status ? (AI_STATUS_LABELS[status] ?? status) : '未检测'

const parseList = (value: string[] | string | null | undefined): string[] => {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : [value]
  } catch {
    return [value]
  }
}

const RISK_LEVEL_LABEL: Record<string, string> = {
  none: '无明显风险',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  unknown: '未知/待人工确认',
}

const RISK_LEVEL_BADGE: Record<string, string> = {
  none: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  low: 'bg-blue-50 text-blue-700 ring-blue-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high: 'bg-red-50 text-red-700 ring-red-200',
  unknown: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}

const RISK_LEVEL_TEXT: Record<string, string> = {
  none: 'text-emerald-700',
  low: 'text-blue-700',
  medium: 'text-amber-700',
  high: 'text-red-700',
  unknown: 'text-neutral-600',
}

const RISK_CATEGORY_LABEL: Record<string, string> = {
  sexual: '色情/淫秽',
  violence: '暴力/血腥',
  crime: '违法犯罪',
  gambling: '赌博/诈骗',
  hate: '仇恨歧视',
  prompt_injection: '恶意提示词注入',
}

const riskLevelKey = (value?: string | null) => {
  const key = value?.trim().toLowerCase()
  return key && RISK_LEVEL_LABEL[key] ? key : 'unknown'
}

const riskLevelLabel = (value?: string | null) => RISK_LEVEL_LABEL[riskLevelKey(value)]

const riskLevelBadge = (value?: string | null) => RISK_LEVEL_BADGE[riskLevelKey(value)]

const riskLevelText = (value?: string | null) => RISK_LEVEL_TEXT[riskLevelKey(value)]

const formatRiskCategory = (value: string) => {
  const key = value.trim().toLowerCase()
  if (['none', 'no_risk', 'no-risk', 'none-risk'].includes(key)) return ''
  return RISK_CATEGORY_LABEL[key] ?? value
}

export default function NoteStyleModerationPage() {
  const [items, setItems] = useState<ModerationStyle[]>([])
  const [pending, setPending] = useState(0)
  const [status, setStatus] = useState('PENDING_REVIEW')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ModerationStyle | null>(null)
  const [reason, setReason] = useState('')
  const [action, setAction] = useState<'reject' | 'unpublish' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, summary] = await Promise.all([
        noteStyleModerationApi.list({ status: status || undefined, page: 1, page_size: 100 }),
        noteStyleModerationApi.summary(),
      ])
      setItems(list.items ?? [])
      setPending(summary.pending_review ?? 0)
    } catch {
      toast.error('加载笔记风格审核列表失败')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  const handleApprove = async (item: ModerationStyle) => {
    setBusy(true)
    try {
      await noteStyleModerationApi.approve(item.id)
      toast.success('已审核通过并上架')
      await load()
    } catch {
      toast.error('审核操作失败')
    } finally { setBusy(false) }
  }

  const openReason = (item: ModerationStyle, next: 'reject' | 'unpublish') => {
    setSelected(item)
    setAction(next)
    setReason('')
  }

  const submitReason = async () => {
    if (!selected || !action || !reason.trim()) return toast.error('请填写处理原因')
    setBusy(true)
    try {
      if (action === 'reject') await noteStyleModerationApi.reject(selected.id, reason.trim())
      else await noteStyleModerationApi.unpublish(selected.id, reason.trim())
      toast.success(action === 'reject' ? '已驳回，用户将收到原因' : '已下架，用户将收到原因')
      setSelected(null)
      setAction(null)
      await load()
    } catch { toast.error('审核操作失败') } finally { setBusy(false) }
  }

  const handleRepublish = async (item: ModerationStyle) => {
    setBusy(true)
    try {
      await noteStyleModerationApi.republish(item.id)
      toast.success('已恢复上架')
      await load()
    } catch { toast.error('恢复上架失败') } finally { setBusy(false) }
  }

  return (
    <div className="h-full w-full overflow-auto bg-neutral-50">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /><h1 className="text-2xl font-bold">笔记风格管理</h1><Badge className="bg-amber-100 text-amber-700">待审核 {pending}</Badge></div>
            <p className="mt-1 text-sm text-neutral-500">管理员只处理审核状态，不修改用户提交的内容。</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>
        </div>

        <div className="mb-4 max-w-md">
          <ContentModerationConfig />
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto">
          {['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED', 'DRAFT'].map((key) => (
            <button key={key} onClick={() => setStatus(key)} className={`rounded-full px-3 py-1.5 text-xs ${status === key ? 'bg-primary text-white' : 'border border-neutral-200 bg-white text-neutral-600'}`}>
              {STATUS_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading ? <div className="flex items-center justify-center py-16 text-sm text-neutral-400">加载中…</div> : items.length === 0 ? <div className="py-16 text-center text-sm text-neutral-400">暂无记录</div> : (
            <ul className="divide-y divide-neutral-100">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-neutral-50">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[item.moderation_status] ?? 'bg-neutral-300'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-neutral-800">{item.name}</h2>
                      <Badge className={STATUS_CLASS[item.moderation_status] ?? ''}>{STATUS_LABELS[item.moderation_status] ?? item.moderation_status}</Badge>
                      {item.version_no && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">版本 {item.version_no}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{item.description || '暂无简介'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                      <span>发布者：{item.owner?.username || `用户 ${item.user_id ?? '—'}`}</span>
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-500">AI 初筛：{aiStatusLabel(item.ai_status)}</span>
                    </div>
                    {item.review_reason && <p className="mt-2 text-xs text-red-600">最近原因：{item.review_reason}</p>}
                  </div>
                  <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setSelected(item)}><Eye className="mr-1 h-3.5 w-3.5" />详情</Button>
                    {item.moderation_status === 'PENDING_REVIEW' && <><Button size="sm" onClick={() => handleApprove(item)} disabled={busy}><Check className="mr-1 h-3.5 w-3.5" />通过</Button><Button size="sm" variant="outline" onClick={() => openReason(item, 'reject')} disabled={busy}><X className="mr-1 h-3.5 w-3.5" />驳回</Button></>}
                    {item.moderation_status === 'PUBLISHED' && <Button size="sm" variant="outline" onClick={() => openReason(item, 'unpublish')} disabled={busy}>下架</Button>}
                    {item.moderation_status === 'UNPUBLISHED' && <Button size="sm" onClick={() => handleRepublish(item)} disabled={busy}>恢复上架</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setAction(null) } }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.name || '笔记风格详情'}</DialogTitle><DialogDescription>内容仅供审核预览，管理员不能修改用户提交的标题、描述和提示词。</DialogDescription></DialogHeader>
          {selected && !action && <div className="space-y-4 text-sm"><div><div className="mb-1 text-xs font-medium text-neutral-500">简介</div><p className="rounded-lg bg-neutral-50 p-3">{selected.description || '暂无简介'}</p></div><div><div className="mb-1 text-xs font-medium text-neutral-500">提示词</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">{selected.prompt}</pre></div><div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600"><div className="flex flex-wrap items-center gap-2"><span className="text-neutral-400">AI 初筛：</span>{aiStatusLabel(selected.ai_status)}<span className="ml-1 text-neutral-400">风险等级：</span><span className={`rounded px-2 py-0.5 text-xs ring-1 ${riskLevelBadge(selected.ai_risk_level)}`}>{riskLevelLabel(selected.ai_risk_level)}</span></div><div className="mt-2"><span className="text-neutral-400">风险类别：</span><span className={riskLevelText(selected.ai_risk_level)}>{(() => { const categories = parseList(selected.ai_categories).map(formatRiskCategory).filter(Boolean); const level = riskLevelKey(selected.ai_risk_level); return categories.join('、') || (level === 'none' ? '未发现明显风险类别' : level === 'unknown' ? '待人工确认' : '未识别') })()}</span></div><div className="mt-2"><span className="text-neutral-400">审核摘要：</span>{selected.ai_summary || '暂无摘要'}</div><div className="mt-2"><div className="text-neutral-400">修改建议：</div>{parseList(selected.ai_recommendations).length ? <ul className="mt-1 list-disc space-y-1 pl-4">{parseList(selected.ai_recommendations).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <span className="text-neutral-400">暂无建议</span>}</div></div></div>}
          {selected && action && <div className="space-y-3"><p className="text-sm text-neutral-600">{action === 'reject' ? '请填写驳回原因，用户修改后可以重新提交。' : '请填写下架原因，系统会通知发布者。'}</p><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={5} placeholder="请输入处理原因…" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAction(null)}>返回</Button><Button onClick={submitReason} disabled={busy || !reason.trim()}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}确认处理</Button></div></div>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
