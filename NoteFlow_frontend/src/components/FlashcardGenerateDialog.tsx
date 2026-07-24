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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useModelStore } from '@/store/modelStore'
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
  const modelList = useModelStore((s) => s.modelList)
  const loadEnabledModels = useModelStore((s) => s.loadEnabledModels)

  const [modelName, setModelName] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [cardCount, setCardCount] = useState(10)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (open && modelList.length === 0) loadEnabledModels()
  }, [open, modelList.length, loadEnabledModels])

  useEffect(() => {
    if (open && !modelName && modelList.length > 0) {
      setModelName(modelList[0].model_name)
    }
  }, [open, modelName, modelList])

  useEffect(() => {
    if (!open) {
      setCustomPrompt('')
      setCardCount(10)
    }
  }, [open])

  const handleGenerate = async () => {
    if (!taskId) return
    const selected = modelList.find((m) => m.model_name === modelName)
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
          <DialogDescription>围绕这篇笔记生成一组问答卡片，帮助快速记忆核心内容。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">生成模型</label>
            <Select value={modelName} onValueChange={setModelName}>
              <SelectTrigger className="w-full shadow-none">
                <SelectValue placeholder="请选择模型" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem key={m.id} value={m.model_name}>
                    {m.model_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              onChange={(e) => setCardCount(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-neutral-700">自定义出题要求（可选）</label>
            <Textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="例如：多考察具体数据和结论，少考察概念定义"
              className="resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={generating || !modelName} onClick={handleGenerate}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
