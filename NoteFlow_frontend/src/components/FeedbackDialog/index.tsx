import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import toast from 'react-hot-toast'
import { submitFeedback, type FeedbackCategory } from '@/services/feedback'

interface Props {
  open: boolean
  onClose: () => void
}

const CATEGORIES = [
  { value: 'bug', label: '功能异常 / Bug' },
  { value: 'feature', label: '功能建议' },
  { value: 'ui', label: '界面问题' },
  { value: 'perf', label: '性能问题' },
  { value: 'other', label: '其他' },
]

export default function FeedbackDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ category: '', title: '', content: '', contact: '' })

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.category) return toast.error('请选择反馈类型')
    if (!form.content.trim()) return toast.error('请填写反馈内容')

    setLoading(true)
    try {
      await submitFeedback({
        category: form.category as FeedbackCategory,
        title: form.title.trim() || undefined,
        content: form.content.trim(),
        contact: form.contact.trim() || undefined,
      })
      toast.success('感谢你的反馈，我们会认真处理！')
      setForm({ category: '', title: '', content: '', contact: '' })
      onClose()
    } catch {
      // request 拦截器已弹 toast，这里只兜底
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>问题反馈</DialogTitle>
          <DialogDescription>遇到问题或有好的想法？告诉我们。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>反馈类型</Label>
            <Select
              value={form.category}
              onValueChange={(v) => setForm((prev) => ({ ...prev, category: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>标题（可选）</Label>
            <Input
              placeholder="一句话概括问题"
              value={form.title}
              onChange={set('title')}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label>
              详细描述 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="请描述你遇到的问题，尽量包含复现步骤..."
              value={form.content}
              onChange={set('content')}
              rows={5}
              maxLength={2000}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>联系方式（可选）</Label>
            <Input
              placeholder="邮箱或微信，方便我们回复你"
              value={form.contact}
              onChange={set('contact')}
              maxLength={100}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '提交中...' : '提交反馈'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
