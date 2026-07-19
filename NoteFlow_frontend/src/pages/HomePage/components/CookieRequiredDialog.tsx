import { FC, useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { Label } from '@/components/ui/label.tsx'
import {
  getDownloaderCookie,
  updateDownloaderCookie,
} from '@/services/downloader.ts'
import { videoPlatforms } from '@/constant/note.ts'

interface CookieRequiredDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: string
  /** Error message returned from backend (without the [NEED_COOKIE:...] marker) */
  reason?: string
  /** Called after the user saves a cookie — typically used to retry the failed task */
  onSaved?: () => void
}

const platformLabel = (platform: string): string =>
  videoPlatforms.find(p => p.value === platform)?.label || platform

const CookieRequiredDialog: FC<CookieRequiredDialogProps> = ({
  open,
  onOpenChange,
  platform,
  reason,
  onSaved,
}) => {
  const navigate = useNavigate()
  const [cookie, setCookie] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Preload the existing cookie value (if any) so the user can incrementally edit instead of overwriting
  useEffect(() => {
    if (!open || !platform) return
    setLoading(true)
    getDownloaderCookie(platform)
      .then((res: any) => {
        setCookie(res?.cookie || '')
      })
      .catch(() => {
        // No existing cookie — fine, start blank
        setCookie('')
      })
      .finally(() => setLoading(false))
  }, [open, platform])

  const handleSave = async () => {
    const value = cookie.trim()
    if (!value) {
      toast.error('请粘贴 Cookie 内容')
      return
    }
    setSaving(true)
    try {
      await updateDownloaderCookie({ platform, cookie: value })
      toast.success(`${platformLabel(platform)} Cookie 已保存`)
      onSaved?.()
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e?.response?.data?.msg || e?.message || 'Cookie 保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleGotoSettings = () => {
    onOpenChange(false)
    navigate(`/settings/download/${platform}`)
  }

  const label = platformLabel(platform)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>需要配置 {label} Cookie</DialogTitle>
          <DialogDescription>
            {reason ||
              `${label} 服务返回了登录验证或风控错误，需要在本机配置一份有效的 Cookie 才能继续解析。`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="cookie-input" className="text-sm font-medium">
            粘贴 {label} Cookie
          </Label>
          <Textarea
            id="cookie-input"
            value={cookie}
            onChange={e => setCookie(e.target.value)}
            disabled={loading || saving}
            placeholder={
              loading
                ? '正在读取已有 Cookie…'
                : `打开浏览器登录 ${label}，在 DevTools → Network 任意请求里复制 Cookie 请求头`
            }
            className="min-h-[120px] font-mono text-xs leading-relaxed"
          />
          <p className="text-xs text-neutral-500">
            Cookie 仅保存在本地数据库，会与「设置 → 下载配置 →{' '}
            <button
              type="button"
              onClick={handleGotoSettings}
              className="text-primary inline-flex items-center gap-0.5 hover:underline"
            >
              {label}
              <ExternalLink className="h-3 w-3" />
            </button>
            」联动。
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleGotoSettings}
            disabled={saving}
          >
            前往完整设置页
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || !cookie.trim()}
            className="bg-primary hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                保存中…
              </>
            ) : (
              '保存并重试'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CookieRequiredDialog
