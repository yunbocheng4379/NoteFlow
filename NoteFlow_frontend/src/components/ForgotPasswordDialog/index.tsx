import { useEffect, useRef, useState } from 'react'
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
import toast from 'react-hot-toast'
import { authApi, AuthErrorCode, type TargetType } from '@/services/auth'

const RESEND_COOLDOWN = 60
const PHONE_PATTERN = /^1\d{10}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  open: boolean
  onClose: () => void
}

export default function ForgotPasswordDialog({ open, onClose }: Props) {
  const [targetType, setTargetType] = useState<TargetType>('email')
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (open) {
      setTargetType('email')
      setTarget('')
      setCode('')
      setNewPwd('')
      setConfirmPwd('')
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const startCountdown = () => {
    setCountdown(RESEND_COOLDOWN)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  const validateTarget = (v: string) => (targetType === 'email' ? EMAIL_PATTERN.test(v) : PHONE_PATTERN.test(v))

  const handleSendCode = async () => {
    const trimmed = target.trim()
    if (!validateTarget(trimmed)) return toast.error(targetType === 'email' ? '请输入正确的邮箱' : '请输入正确的手机号')
    if (countdown > 0) return

    // 点击后立即进入倒计时/禁用态，不等接口返回，避免网络等待期间被重复点击
    startCountdown()
    try {
      await authApi.sendCode({ target: trimmed, target_type: targetType, purpose: 'reset_password' })
      toast.success('验证码已发送')
    } catch (err: any) {
      // 发送失败, 回滚倒计时让用户可以立即重试
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(0)

      const errCode = err?.code
      if (errCode === AuthErrorCode.TARGET_NOT_FOUND) {
        toast.error('该邮箱/手机号未注册')
      } else if (errCode === AuthErrorCode.ACCOUNT_DISABLED) {
        toast.error('账号已被禁用')
      } else if (errCode === AuthErrorCode.RATE_LIMITED) {
        toast.error(err?.msg || '发送过于频繁，请稍后再试')
      } else if (errCode === AuthErrorCode.SEND_CODE_FAILED) {
        toast.error('验证码发送失败，请稍后再试')
      } else {
        toast.error(err?.msg || '发送失败，请稍后再试')
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = target.trim()
    if (!validateTarget(trimmed)) return toast.error(targetType === 'email' ? '请输入正确的邮箱' : '请输入正确的手机号')
    if (!code.trim()) return toast.error('请输入验证码')
    if (newPwd.length < 6) return toast.error('新密码至少 6 位')
    if (newPwd !== confirmPwd) return toast.error('两次输入的密码不一致')

    setSubmitting(true)
    try {
      await authApi.resetPassword({
        target: trimmed,
        target_type: targetType,
        code: code.trim(),
        new_password: newPwd,
      })
      toast.success('密码重置成功，请使用新密码登录')
      onClose()
    } catch (err: any) {
      const errCode = err?.code
      if (errCode === AuthErrorCode.ACCOUNT_NOT_FOUND) {
        toast.error('账户不存在')
      } else if (errCode === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (errCode === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else if (errCode === AuthErrorCode.ACCOUNT_DISABLED) {
        toast.error('账号已被禁用')
      } else {
        toast.error(err?.msg || '重置失败，请稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>找回密码</DialogTitle>
          <DialogDescription>通过已绑定的邮箱或手机号验证身份后，重置登录密码。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="flex rounded-lg p-1" style={{ background: '#f4f4f5' }}>
            {(['email', 'phone'] as TargetType[]).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => {
                  setTargetType(tt)
                  setTarget('')
                  setCode('')
                }}
                className="flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150"
                style={
                  targetType === tt
                    ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                    : { color: '#6b7280' }
                }
              >
                {tt === 'email' ? '邮箱验证' : '手机验证'}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label>{targetType === 'email' ? '邮箱' : '手机号'}</Label>
            <Input
              type={targetType === 'email' ? 'email' : 'tel'}
              placeholder={targetType === 'email' ? '请输入已绑定的邮箱' : '请输入已绑定的手机号'}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              maxLength={targetType === 'email' ? 128 : 11}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>验证码</Label>
            <div className="flex gap-2">
              <Input
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSendCode}
                disabled={countdown > 0}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>新密码</Label>
            <Input
              type="password"
              placeholder="至少 6 位"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>确认新密码</Label>
            <Input
              type="password"
              placeholder="再次输入新密码"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? '提交中...' : '重置密码'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
