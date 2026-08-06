import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  pricingApi,
  type ModelRate,
  type FormatRate,
} from '@/services/adminPricing'

export default function PricingPage() {
  const [modelRates, setModelRates] = useState<ModelRate[]>([])
  const [formatRates, setFormatRates] = useState<FormatRate[]>([])
  const [loading, setLoading] = useState(false)
  const [modelDialog, setModelDialog] = useState(false)
  const [formatDialog, setFormatDialog] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [m, f] = await Promise.all([
        pricingApi.listModelRates(),
        pricingApi.listFormatRates(),
      ])
      setModelRates(m)
      setFormatRates(f)
    } catch {
      toast.error('加载费率失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading && !modelRates.length) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* ========== 模型费率 ========== */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">模型费率</h2>
          <Button size="sm" variant="outline" onClick={() => setModelDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> 新增
          </Button>
        </div>
        <p className="mb-2 text-xs text-neutral-500">
          在「AI 模型设置」里新增模型后会自动出现在这里，默认 <span className="font-mono">3</span> 电力/分钟，可按需调整。
          <span className="font-medium text-neutral-700">关闭 = 该模型走 __default__ 兜底费率</span>，
          不代表免费；要停用某模型请直接在 AI 模型设置里删除。
        </p>
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2">模型名称</th>
                <th className="px-4 py-2">电力/分钟</th>
                <th className="px-4 py-2">兜底</th>
                <th className="px-4 py-2">启用</th>
                <th className="px-4 py-2">描述</th>
                <th className="px-4 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {modelRates.map(r => (
                <ModelRateRow key={r.id} rate={r} onRefresh={load} />
              ))}
              {!modelRates.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ========== 格式费率 ========== */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">笔记格式费率</h2>
          <Button size="sm" variant="outline" onClick={() => setFormatDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> 新增
          </Button>
        </div>
        <p className="mb-2 text-xs text-neutral-500">
          格式费率与模型费率叠加计算：总费率 = 模型单价 + Σ(用户勾选的格式单价)
        </p>
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2">格式标识</th>
                <th className="px-4 py-2">电力/分钟</th>
                <th className="px-4 py-2">启用</th>
                <th className="px-4 py-2">描述</th>
                <th className="px-4 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {formatRates.map(r => (
                <FormatRateRow key={r.id} rate={r} onRefresh={load} />
              ))}
              {!formatRates.length && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ========== 公式说明 ========== */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Zap className="h-4 w-4 text-amber-500" /> 计费公式
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          所需电力 = ⌈视频时长(分钟)⌉ × (模型单价 + Σ用户勾选格式单价)，最低 1 电力
        </p>
      </section>

      <ModelRateDialog open={modelDialog} onClose={() => setModelDialog(false)} onSaved={load} />
      <FormatRateDialog open={formatDialog} onClose={() => setFormatDialog(false)} onSaved={load} />
      </div>
    </div>
  )
}


// ============================================================================
// 模型费率行
// ============================================================================

function ModelRateRow({ rate, onRefresh }: { rate: ModelRate; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false)
  const [rateVal, setRateVal] = useState(String(rate.rate_per_minute))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const v = parseInt(rateVal, 10)
    if (isNaN(v) || v < 0) { toast.error('请输入 ≥0 的整数'); return }
    setBusy(true)
    try {
      await pricingApi.updateModelRate(rate.model_name, { rate_per_minute: v })
      toast.success('已保存')
      setEditing(false)
      onRefresh()
    } catch { toast.error('保存失败') }
    finally { setBusy(false) }
  }

  const toggleActive = async () => {
    try {
      await pricingApi.updateModelRate(rate.model_name, { is_active: !rate.is_active })
      onRefresh()
    } catch { toast.error('切换失败') }
  }

  const del = async () => {
    if (rate.is_default) { toast.error('兜底行不允许删除'); return }
    if (!confirm(`确认删除模型费率「${rate.model_name}」?`)) return
    try {
      await pricingApi.deleteModelRate(rate.model_name)
      toast.success('已删除')
      onRefresh()
    } catch { toast.error('删除失败') }
  }

  return (
    <tr className="hover:bg-neutral-50/50">
      <td className="px-4 py-2 font-mono text-xs">{rate.model_name}</td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              className="h-7 w-20 text-xs"
              value={rateVal}
              onChange={e => setRateVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
            />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={save} disabled={busy}>
              保存
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        ) : (
          <span
            className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
            onClick={() => { setRateVal(String(rate.rate_per_minute)); setEditing(true) }}
          >
            {rate.rate_per_minute}
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        {rate.is_default && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">兜底</span>}
      </td>
      <td className="px-4 py-2">
        <Switch checked={rate.is_active} onCheckedChange={toggleActive} />
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500">{rate.description || '—'}</td>
      <td className="px-4 py-2 text-right">
        {!rate.is_default && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={del}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  )
}


// ============================================================================
// 格式费率行
// ============================================================================

function FormatRateRow({ rate, onRefresh }: { rate: FormatRate; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false)
  const [rateVal, setRateVal] = useState(String(rate.rate_per_minute))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const v = parseInt(rateVal, 10)
    if (isNaN(v) || v < 0) { toast.error('请输入 ≥0 的整数'); return }
    setBusy(true)
    try {
      await pricingApi.updateFormatRate(rate.format_key, { rate_per_minute: v })
      toast.success('已保存')
      setEditing(false)
      onRefresh()
    } catch { toast.error('保存失败') }
    finally { setBusy(false) }
  }

  const toggleActive = async () => {
    try {
      await pricingApi.updateFormatRate(rate.format_key, { is_active: !rate.is_active })
      onRefresh()
    } catch { toast.error('切换失败') }
  }

  const del = async () => {
    if (!confirm(`确认删除格式费率「${rate.format_key}」?`)) return
    try {
      await pricingApi.deleteFormatRate(rate.format_key)
      toast.success('已删除')
      onRefresh()
    } catch { toast.error('删除失败') }
  }

  return (
    <tr className="hover:bg-neutral-50/50">
      <td className="px-4 py-2 font-mono text-xs">{rate.format_key}</td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              className="h-7 w-20 text-xs"
              value={rateVal}
              onChange={e => setRateVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
            />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={save} disabled={busy}>
              保存
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        ) : (
          <span
            className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
            onClick={() => { setRateVal(String(rate.rate_per_minute)); setEditing(true) }}
          >
            {rate.rate_per_minute}
          </span>
        )}
      </td>
      <td className="px-4 py-2">
        <Switch checked={rate.is_active} onCheckedChange={toggleActive} />
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500">{rate.description || '—'}</td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={del}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  )
}


// ============================================================================
// 新增模型费率弹窗
// ============================================================================

function ModelRateDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('3')
  const [desc, setDesc] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) { toast.error('请输入模型名称'); return }
    const v = parseInt(rate, 10)
    if (isNaN(v) || v < 0) { toast.error('请输入 ≥0 的整数'); return }
    setBusy(true)
    try {
      await pricingApi.upsertModelRate({
        model_name: name.trim(),
        rate_per_minute: v,
        is_default: isDefault,
        description: desc.trim() || undefined,
      })
      toast.success('已保存')
      onClose()
      onSaved()
      setName(''); setRate('3'); setDesc(''); setIsDefault(false)
    } catch { toast.error('保存失败') }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新增模型费率</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-600">模型名称</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="gpt-4o" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600">电力/分钟</label>
            <Input value={rate} onChange={e => setRate(e.target.value)} type="number" min={0} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600">描述 (可选)</label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            <span className="text-xs text-neutral-600">设为兜底 (未匹配时使用)</span>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}


// ============================================================================
// 新增格式费率弹窗
// ============================================================================

function FormatRateDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [key, setKey] = useState('')
  const [rate, setRate] = useState('1')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!key.trim()) { toast.error('请输入格式标识'); return }
    const v = parseInt(rate, 10)
    if (isNaN(v) || v < 0) { toast.error('请输入 ≥0 的整数'); return }
    setBusy(true)
    try {
      await pricingApi.upsertFormatRate({
        format_key: key.trim(),
        rate_per_minute: v,
        description: desc.trim() || undefined,
      })
      toast.success('已保存')
      onClose()
      onSaved()
      setKey(''); setRate('1'); setDesc('')
    } catch { toast.error('保存失败') }
    finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新增格式费率</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <label className="mb-1 block text-xs text-neutral-600">格式标识</label>
            <Input value={key} onChange={e => setKey(e.target.value)} placeholder="screenshot" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600">电力/分钟</label>
            <Input value={rate} onChange={e => setRate(e.target.value)} type="number" min={0} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600">描述 (可选)</label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
