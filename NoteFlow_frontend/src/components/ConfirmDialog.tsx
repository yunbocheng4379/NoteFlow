import { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  /** destructive 用于删除等危险操作（红色按钮 + 警告图标） */
  variant?: 'destructive' | 'default'
  loading?: boolean
  onConfirm: () => void
}

/**
 * 统一的卡片式确认弹窗，替代原生 window.confirm，保持系统主题一致。
 * 居中弹窗，标题前带状态图标（destructive 显示红色警告），按钮右对齐。
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = '确认操作',
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'destructive',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const isDestructive = variant === 'destructive'
  return (
    <Dialog open={open} onOpenChange={o => { if (!loading) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-[420px] gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader className="flex-row items-start gap-3 text-left">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                isDestructive ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1 pt-1">
              <DialogTitle className="text-base">{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-1.5 leading-relaxed">
                  {description}
                </DialogDescription>
              )}
            </div>
          </DialogHeader>
        </div>
        <DialogFooter className="px-6 pb-5 pt-3 mt-0 border-t border-neutral-100 bg-neutral-50/60">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button variant={variant} size="sm" disabled={loading} onClick={onConfirm}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
