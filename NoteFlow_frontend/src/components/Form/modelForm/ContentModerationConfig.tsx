import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { ModelSelect } from '@/components/ModelSelect'
import { getModelKey } from '@/components/modelSelect.utils'
import { contentModerationApi, type ContentModerationConfig as ModerationConfig } from '@/services/content_moderation'

export default function ContentModerationConfig() {
  const [config, setConfig] = useState<ModerationConfig | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const next = await contentModerationApi.getConfig()
      setConfig(next)
      setSelectedKey(next.selected ? getModelKey(next.selected.provider_id, next.selected.model_name) : '')
    } catch {
      toast.error('加载安全检测模型配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const selectedModel = useMemo(
    () => config?.models.find(item => getModelKey(item.provider_id, item.model_name) === selectedKey) ?? null,
    [config, selectedKey],
  )

  const handleSave = async () => {
    if (!selectedModel) return toast.error('请选择安全检测模型')
    setSaving(true)
    try {
      const next = await contentModerationApi.updateConfig(selectedModel.provider_id, selectedModel.model_name)
      setConfig(next)
      setSelectedKey(next.selected ? getModelKey(next.selected.provider_id, next.selected.model_name) : '')
      toast.success('安全检测模型已保存')
    } catch {
      toast.error('保存安全检测模型失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-800">笔记风格安全检测模型</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">用户提交后由此模型进行 AI 初筛，最终结果仍由管理员人工审核。</p>
        </div>
      </div>

      {loading ? <div className="py-3 text-xs text-neutral-400">加载中…</div> : (
        <>
          <ModelSelect
            models={config?.models ?? []}
            value={selectedKey}
            onValueChange={setSelectedKey}
            disabled={saving}
            placeholder="未配置"
            triggerClassName="mt-3 h-10 border-neutral-200 bg-neutral-50/60 text-sm shadow-none"
          />
          <Button size="sm" className="mt-2 w-full" onClick={handleSave} disabled={saving || !selectedModel}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            保存检测模型
          </Button>
          {!config?.models.length && <p className="mt-2 text-xs text-amber-600">暂无已启用模型，请先配置模型供应商。</p>}
        </>
      )}
    </section>
  )
}
