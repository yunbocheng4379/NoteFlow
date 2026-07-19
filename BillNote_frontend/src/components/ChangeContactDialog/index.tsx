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
import { authApi, AuthErrorCode } from '@/services/auth'

const RESEND_COOLDOWN = 60
const PHONE_PATTERN = /^1\d{10}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  open: boolean
  field: 'phone' | 'email'
  currentValue: string | null
  onClose: () => void
  onSuccess: (value: string) => void
}

// 修改手机号/邮箱前必须先验证"原手机号/邮箱"归属, 拿到一次性 ticket 才能提交新值 ——
// 否则任何拿到登录态(如被盗用的 token)的人都能直接顶替掉账号的找回渠道。
// 手机号首次绑定(当前无手机号)没有"旧值"可验证, 跳过第一步直接进入修改。
type Step = 'verify' | 'change'

export default function ChangeContactDialog({ open, field, currentValue, onClose, onSuccess }: Props) {
  const isPhone = field === 'phone'
  const label = isPhone ? '手机号' : '邮箱'
  const needsVerifyStep = !!currentValue

  const [step, setStep] = useState<Step>('verify')
  const [verifyCode, setVerifyCode] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)

  const [value, setValue] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (open) {
      setStep(needsVerifyStep ? 'verify' : 'change')
      setVerifyCode('')
      setTicket(null)
      setValue('')
      setCode('')
    }
  }, [open, needsVerifyStep])

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

  const rollbackCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setCountdown(0)
  }

  const reportSendError = (err: any) => {
    const errCode = err?.code
    if (errCode === AuthErrorCode.PHONE_EXISTS || errCode === AuthErrorCode.EMAIL_EXISTS) {
      toast.error(`该${label}已被其他账号绑定`)
    } else if (errCode === AuthErrorCode.RATE_LIMITED) {
      toast.error(err?.msg || '发送过于频繁，请稍后再试')
    } else if (errCode === AuthErrorCode.SEND_CODE_FAILED) {
      toast.error('验证码发送失败，请稍后再试')
    } else {
      toast.error(err?.msg || '发送失败，请稍后再试')
    }
  }

  // ── Step 1: 验证原手机号/邮箱 ──
  const handleSendVerifyCode = async () => {
    if (countdown > 0) return
    startCountdown()
    try {
      await authApi.sendCode({
        target_type: field,
        purpose: isPhone ? 'verify_phone' : 'verify_email',
      })
      toast.success('验证码已发送')
    } catch (err: any) {
      rollbackCountdown()
      reportSendError(err)
    }
  }

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!verifyCode.trim()) return toast.error('请输入验证码')

    setSubmitting(true)
    try {
      const { ticket: t } = await authApi.verifyContact({
        target_type: field,
        code: verifyCode.trim(),
      })
      setTicket(t)
      setStep('change')
      setCountdown(0)
      if (countdownRef.current) clearInterval(countdownRef.current)
    } catch (err: any) {
      const errCode = err?.code
      if (errCode === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (errCode === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else {
        toast.error(err?.msg || '验证失败，请稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 2: 输入并确认新手机号/邮箱 ──
  const validateValue = (v: string) => (isPhone ? PHONE_PATTERN.test(v) : EMAIL_PATTERN.test(v))

  const handleSendCode = async () => {
    const trimmed = value.trim()
    if (!validateValue(trimmed)) return toast.error(isPhone ? '请输入正确的手机号' : '请输入正确的邮箱')
    if (countdown > 0) return

    // 点击后立即进入倒计时/禁用态，不等接口返回，避免网络等待期间被重复点击
    startCountdown()
    try {
      await authApi.sendCode({
        target: trimmed,
        target_type: field,
        purpose: isPhone ? 'bind' : 'bind_email',
      })
      toast.success('验证码已发送')
    } catch (err: any) {
      rollbackCountdown()
      reportSendError(err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!validateValue(trimmed)) return toast.error(isPhone ? '请输入正确的手机号' : '请输入正确的邮箱')
    if (!code.trim()) return toast.error('请输入验证码')

    setSubmitting(true)
    try {
      if (isPhone) {
        await authApi.bindPhone({ phone: trimmed, code: code.trim(), ticket: ticket ?? undefined })
      } else {
        await authApi.bindEmail({ email: trimmed, code: code.trim(), ticket: ticket ?? '' })
      }
      toast.success(`${label}修改成功`)
      onSuccess(trimmed)
      onClose()
    } catch (err: any) {
      const errCode = err?.code
      if (errCode === AuthErrorCode.PHONE_EXISTS || errCode === AuthErrorCode.EMAIL_EXISTS) {
        toast.error(`该${label}已被其他账号绑定`)
      } else if (errCode === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (errCode === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else if (errCode === AuthErrorCode.TICKET_INVALID) {
        toast.error('验证已过期，请重新验证原' + label)
        setStep('verify')
        setTicket(null)
      } else {
        toast.error(err?.msg || '修改失败，请稍后再试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        {step === 'verify' ? (
          <>
            <DialogHeader>
              <DialogTitle>验证原{label}</DialogTitle>
              <DialogDescription>
                为保障账号安全，修改{label}前需先验证当前已绑定的{label}。
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleVerifySubmit} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>当前{label}</Label>
                <Input value={currentValue ?? ''} disabled />
              </div>

              <div className="space-y-2">
                <Label>验证码</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="请输入验证码"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    maxLength={6}
                    required
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSendVerifyCode}
                    disabled={countdown > 0}
                  >
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? '验证中...' : '下一步'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>修改{label}</DialogTitle>
              <DialogDescription>请输入新{label}并完成验证码校验后确认修改。</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>新{label}</Label>
                <Input
                  type={isPhone ? 'tel' : 'email'}
                  placeholder={isPhone ? '请输入新手机号' : '请输入新邮箱'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  maxLength={isPhone ? 11 : 128}
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

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? '提交中...' : '确认修改'}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
