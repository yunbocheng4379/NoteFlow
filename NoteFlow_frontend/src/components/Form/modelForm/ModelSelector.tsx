import { useState, useEffect } from 'react'
import { useModelStore } from '@/store/modelStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import toast from 'react-hot-toast'
import { useProviderStore } from '@/store/providerStore'
import { ModelSelect } from '@/components/ModelSelect'
import { getModelKey } from '@/components/modelSelect.utils'

interface ModelSelectorProps {
  providerId: string
  apiKey?: string
  enabledModels?: readonly EnabledModel[]
  onSaved?: () => void
}

interface EnabledModel {
  model_name: string
  tier?: 'normal' | 'pro'
  supports_reasoning?: boolean
  supports_vision?: boolean
  input_price_per_million?: number | null
  output_price_per_million?: number | null
}

const isMasked = (key?: string) => !key || key.includes('*')

export function ModelSelector({ providerId, apiKey, enabledModels = [], onSaved }: ModelSelectorProps) {
  const { models, loading, selectedModel, loadModels, setSelectedModel, addNewModel } =
    useModelStore()
  const providers = useProviderStore(s => s.provider)
  const fetchProviderList = useProviderStore(s => s.fetchProviderList)
  const [submitting, setSubmitting] = useState(false)
  const [tier, setTier] = useState<'normal' | 'pro'>('normal')
  const [supportsReasoning, setSupportsReasoning] = useState<'yes' | 'no'>('no')
  const [supportsVision, setSupportsVision] = useState<'yes' | 'no'>('no')
  const [inputPrice, setInputPrice] = useState('')
  const [outputPrice, setOutputPrice] = useState('')

  const effectiveApiKey = isMasked(apiKey) ? undefined : apiKey
  const savedModel = enabledModels.find(model => model.model_name === selectedModel)

  const modelOptions = models.map(model => ({
    provider_id: providerId,
    model_name: model.id,
    configured: enabledModels.some(enabledModel => enabledModel.model_name === model.id),
  }))

  useEffect(() => {
    if (providerId) {
      loadModels(providerId, effectiveApiKey)
      if (providers.length === 0) fetchProviderList()
    }
  }, [providerId])

  // 编辑已启用模型时回填已保存的等级、能力和 Token 价格；新模型保持空价格，避免误填。
  useEffect(() => {
    if (!selectedModel) return
    setTier(savedModel?.tier ?? 'normal')
    setSupportsReasoning(savedModel?.supports_reasoning ? 'yes' : 'no')
    setSupportsVision(savedModel?.supports_vision ? 'yes' : 'no')
    setInputPrice(savedModel?.input_price_per_million == null ? '' : String(savedModel.input_price_per_million))
    setOutputPrice(savedModel?.output_price_per_million == null ? '' : String(savedModel.output_price_per_million))
  }, [savedModel, selectedModel])

  const handleSubmit = async () => {
    if (!selectedModel) {
      toast.error('请选择一个模型')
      return
    }
    try {
      setSubmitting(true)
      const parsedInputPrice = inputPrice.trim() ? Number(inputPrice) : undefined
      const parsedOutputPrice = outputPrice.trim() ? Number(outputPrice) : undefined
      if ((parsedInputPrice !== undefined && (!Number.isFinite(parsedInputPrice) || parsedInputPrice < 0)) || (parsedOutputPrice !== undefined && (!Number.isFinite(parsedOutputPrice) || parsedOutputPrice < 0))) {
        toast.error('Token 价格必须是大于等于 0 的数字')
        return
      }
      await addNewModel(providerId, selectedModel, tier, supportsReasoning === 'yes', supportsVision === 'yes', parsedInputPrice, parsedOutputPrice)
      toast.success('保存模型成功 🎉')
      onSaved?.()
    } catch (error: any) {
      toast.error(error?.msg || '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 font-bold">
        <span>选择模型</span>
        <Button
          variant="ghost"
          type="button"
          onClick={() => loadModels(providerId, effectiveApiKey)}
          disabled={loading}
        >
          {loading ? '加载中...' : '刷新模型'}
        </Button>
      </div>

      <ModelSelect
        models={modelOptions}
        providers={providers}
        value={selectedModel ? getModelKey(providerId, selectedModel) : ''}
        onValueChange={value => {
          const model = modelOptions.find(
            option => getModelKey(option.provider_id, option.model_name) === value,
          )
          setSelectedModel(model?.model_name ?? '')
        }}
        triggerClassName="w-[300px]"
      />

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">模型等级</span>
        <Select value={tier} onValueChange={v => setTier(v as 'normal' | 'pro')}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">普通模型</SelectItem>
            <SelectItem value="pro">Pro 模型</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">支持深度思考</span>
        <Select
          value={supportsReasoning}
          onValueChange={v => setSupportsReasoning(v as 'yes' | 'no')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no">不支持</SelectItem>
            <SelectItem value="yes">支持</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">支持视觉/多模态</span>
        <Select
          value={supportsVision}
          onValueChange={v => setSupportsVision(v as 'yes' | 'no')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no">不支持</SelectItem>
            <SelectItem value="yes">支持</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">输入 Token 价格</span>
        <input type="number" min="0" step="0.000001" value={inputPrice} onChange={event => setInputPrice(event.target.value)} placeholder="¥ / 百万 Token" className="h-10 w-[160px] rounded-md border border-input bg-background px-3 text-sm" />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">输出 Token 价格</span>
        <input type="number" min="0" step="0.000001" value={outputPrice} onChange={event => setOutputPrice(event.target.value)} placeholder="¥ / 百万 Token" className="h-10 w-[160px] rounded-md border border-input bg-background px-3 text-sm" />
      </div>

      <Button onClick={handleSubmit} disabled={submitting || !selectedModel}>
        {submitting ? '保存中...' : '保存模型'}
      </Button>
    </div>
  )
}
