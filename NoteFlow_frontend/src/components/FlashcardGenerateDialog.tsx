import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ModelSelect } from '@/components/ModelSelect'
import { getModelKey } from '@/components/modelSelect.utils'
import { useModelStore } from '@/store/modelStore'
import { useProviderStore } from '@/store/providerStore'
import { generateFlashcards } from '@/services/flashcard'

interface Props {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_CARDS = 3
const MAX_CARDS = 50

export default function FlashcardGenerateDialog({ taskId, open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const modelList = useModelStore(s => s.modelList)
  const loadEnabledModels = useModelStore(s => s.loadEnabledModels)
  const providers = useProviderStore(s => s.provider)
  const fetchProviderList = useProviderStore(s => s.fetchProviderList)

  const [modelKey, setModelKey] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [cardCount, setCardCount] = useState(10)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (open && modelList.length === 0) loadEnabledModels()
    if (open && providers.length === 0) fetchProviderList()
  }, [open, modelList.length, loadEnabledModels, providers.length, fetchProviderList])

  useEffect(() => {
    if (open && !modelKey && modelList.length > 0) {
      setModelKey(getModelKey(modelList[0].provider_id, modelList[0].model_name))
    }
  }, [open, modelKey, modelList])

  useEffect(() => {
    if (!open) {
      setCustomPrompt('')
      setCardCount(10)
    }
  }, [open])

  const handleGenerate = async () => {
    if (!taskId) return
    const selected = modelList.find(m => getModelKey(m.provider_id, m.model_name) === modelKey)
    if (!selected) {
      toast.error('请选择生成模型')
      return
    }
    if (cardCount < MIN_CARDS || cardCount > MAX_CARDS) {
      toast.error(`卡片数量需在 ${MIN_CARDS}-${MAX_CARDS} 之间`)
      return
    }

    setGenerating(true)
    try {
      const result = await generateFlashcards({
        task_id: taskId,
        provider_id: selected.provider_id,
        model_name: selected.model_name,
        custom_prompt: customPrompt.trim() || undefined,
        card_count: cardCount,
      })
      toast.success('闪记卡生成成功')
      onOpenChange(false)
      navigate(`/flashcards/${result.set_id}`)
    } catch {
      // request 拦截器已 toast 错误
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>生成闪记卡</DialogTitle>
          <DialogDescription>
            围绕这篇笔记生成一组问答卡片，帮助快速记忆核心内容。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">生成模型</label>
            <ModelSelect
              models={modelList}
              providers={providers}
              value={modelKey}
              onValueChange={setModelKey}
              triggerClassName="shadow-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              卡片数量（{MIN_CARDS}-{MAX_CARDS}）
            </label>
            <Input
              type="number"
              min={MIN_CARDS}
              max={MAX_CARDS}
              value={cardCount}
              onChange={e => setCardCount(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">
              自定义出题要求（可选）
            </label>
            <Textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="例如：多考察具体数据和结论，少考察概念定义"
              className="resize-none text-sm"
            />
          </div>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          生成闪记卡会调用 AI 模型，按所选模型价格消耗电力，失败将自动退回。
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={generating || !modelKey} onClick={handleGenerate}>
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
