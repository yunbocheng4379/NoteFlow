import { useEffect, useState } from 'react'
import { Copy, Eye, Link, Loader2, ToggleLeft, ToggleRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { getShareStatus, enableShare, disableShare, type ShareStatus } from '@/services/share.ts'
import toast from 'react-hot-toast'

interface Props {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ShareNoteDialog({ taskId, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!open || !taskId) return
    setLoading(true)
    getShareStatus(taskId)
      .then(setStatus)
      .catch(() => toast.error('获取分享状态失败'))
      .finally(() => setLoading(false))
  }, [open, taskId])

  const shareUrl = status?.share_token
    ? `${window.location.origin}/sn/${status.share_token}`
    : ''

  const handleToggle = async () => {
    if (!taskId) return
    setToggling(true)
    try {
      if (status?.is_active) {
        await disableShare(taskId)
        setStatus(s => s ? { ...s, is_active: false } : s)
        toast.success('分享已关闭')
      } else {
        const next = await enableShare(taskId)
        setStatus(next)
        toast.success('分享已开启')
      }
    } catch {
      toast.error('操作失败，请重试')
    } finally {
      setToggling(false)
    }
  }

  const handleCopy = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(() => toast.success('链接已复制'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>分享笔记</DialogTitle>
          <DialogDescription className="sr-only">管理笔记的公开分享链接</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            {/* 开启/关闭分享 */}
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-800">
                  {status?.is_active ? '分享已开启' : '开启分享'}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {status?.is_active
                    ? '任何拥有链接的人无需登录即可访问'
                    : '开启后生成可公开访问的链接'}
                </p>
              </div>
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={
                  status?.is_active
                    ? 'flex h-8 items-center gap-1.5 rounded-md bg-red-50 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50'
                    : 'flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50'
                }
              >
                {toggling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : status?.is_active ? (
                  <>
                    <ToggleRight className="h-3.5 w-3.5" />
                    关闭分享
                  </>
                ) : (
                  <>
                    <ToggleLeft className="h-3.5 w-3.5" />
                    开启分享
                  </>
                )}
              </button>
            </div>

            {/* 链接区 + 浏览次数 */}
            {status?.is_active && shareUrl && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <Link className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span className="flex-1 truncate text-xs text-neutral-700">{shareUrl}</span>
                  <button
                    onClick={handleCopy}
                    className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <Eye className="h-3.5 w-3.5" />
                  <span>已被浏览 <strong className="text-neutral-800">{status.view_count}</strong> 次</span>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
