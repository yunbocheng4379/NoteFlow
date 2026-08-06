import { useState, useEffect } from 'react'
import { useModelStore } from '@/store/modelStore'
import { Input } from '@/components/ui/input'
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
import { ModelOptionLabel } from '@/components/ModelProviderLogo'

interface ModelSelectorProps {
  providerId: string
  apiKey?: string
  onSaved?: () => void
}

const isMasked = (key?: string) => !key || key.includes('*')

export function ModelSelector({ providerId, apiKey, onSaved }: ModelSelectorProps) {
  const { models, loading, selectedModel, loadModels, setSelectedModel, addNewModel } =
    useModelStore()
  const providers = useProviderStore(s => s.provider)
  const fetchProviderList = useProviderStore(s => s.fetchProviderList)
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tier, setTier] = useState<'normal' | 'pro'>('normal')
  const [supportsReasoning, setSupportsReasoning] = useState<'yes' | 'no'>('no')
  const [supportsVision, setSupportsVision] = useState<'yes' | 'no'>('no')

  const effectiveApiKey = isMasked(apiKey) ? undefined : apiKey

  const filteredModels = models.filter(model => {
    const keywords = search.trim().toLowerCase().split(/\s+/)
    const target = model.id.toLowerCase()
    return keywords.every(kw => target.includes(kw))
  })

  useEffect(() => {
    if (providerId) {
      loadModels(providerId, effectiveApiKey)
      if (providers.length === 0) fetchProviderList()
    }
  }, [providerId])

  const handleSubmit = async () => {
    if (!selectedModel) {
      toast.error('请选择一个模型')
      return
    }
    try {
      setSubmitting(true)
      await addNewModel(providerId, selectedModel, tier, supportsReasoning === 'yes', supportsVision === 'yes')
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

      <Select value={selectedModel} onValueChange={setSelectedModel}>
        <SelectTrigger className="w-[300px]">
          <SelectValue placeholder="请选择模型" />
        </SelectTrigger>
        <SelectContent>
          <div className="p-2">
            <Input
              placeholder="搜索模型..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          {filteredModels.map((model, index) => (
            <SelectItem key={`${model.id}-${index}`} value={model.id}>
              <ModelOptionLabel
                providerId={providerId}
                modelName={model.id}
                providers={providers}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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

      <Button onClick={handleSubmit} disabled={submitting || !selectedModel}>
        {submitting ? '保存中...' : '保存模型'}
      </Button>
    </div>
  )
}
