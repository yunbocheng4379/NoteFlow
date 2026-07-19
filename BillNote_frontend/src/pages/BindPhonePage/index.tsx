import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, AuthErrorCode } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import BrandLogo from '@/components/BrandLogo'
import toast from 'react-hot-toast'

const RESEND_COOLDOWN = 60

export default function BindPhonePage() {
  const navigate = useNavigate()
  const { token, user, setAuth } = useUserStore()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // 已绑定或未登录都不应停留在这个页面
    if (!token) {
      navigate('/login', { replace: true })
    } else if (user?.phone) {
      navigate('/', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleSendCode = async () => {
    const trimmed = phone.trim()
    if (!/^1\d{10}$/.test(trimmed)) return toast.error('请输入正确的手机号')
    if (countdown > 0) return

    // 点击后立即进入倒计时/禁用态，不等接口返回，避免网络等待期间被重复点击
    startCountdown()
    try {
      await authApi.sendCode({ target: trimmed, target_type: 'phone', purpose: 'bind' })
      toast.success('验证码已发送')
    } catch (err: any) {
      // 发送失败, 回滚倒计时让用户可以立即重试
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(0)

      const code = err?.code
      if (code === AuthErrorCode.PHONE_EXISTS) {
        toast.error('该手机号已被其他账号绑定')
      } else if (code === AuthErrorCode.RATE_LIMITED) {
        toast.error(err?.msg || '发送过于频繁，请稍后再试')
      } else if (code === AuthErrorCode.SEND_CODE_FAILED) {
        toast.error('验证码发送失败，请稍后再试')
      } else {
        toast.error(err?.msg || '发送失败，请稍后再试')
      }
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = phone.trim()
    if (!/^1\d{10}$/.test(trimmed)) return toast.error('请输入正确的手机号')
    if (!code.trim()) return toast.error('请输入验证码')

    setLoading(true)
    try {
      await authApi.bindPhone({ phone: trimmed, code: code.trim() })
      if (token && user) {
        setAuth(token, { ...user, phone: trimmed })
      }
      toast.success('手机号绑定成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const errCode = err?.code
      if (errCode === AuthErrorCode.PHONE_EXISTS) {
        toast.error('该手机号已被其他账号绑定')
      } else if (errCode === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (errCode === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else {
        toast.error(err?.msg || '绑定失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-white px-8">
      <div className="w-full max-w-[22rem]">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <BrandLogo className="h-7 w-auto flex-shrink-0" />
          <span className="text-xl font-semibold tracking-tight text-gray-900">BiliNote</span>
        </div>

        <div className="mb-7 text-center">
          <h1 className="font-bold text-gray-900 mb-1" style={{ fontSize: '1.375rem', letterSpacing: '-0.016em' }}>
            绑定手机号
          </h1>
          <p className="text-[13px] text-gray-400">
            为了账号安全，请绑定手机号后继续使用
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-[13px] font-medium text-gray-600">
              手机号
            </Label>
            <Input
              id="phone"
              type="tel"
              placeholder="请输入手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              maxLength={11}
              className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bindCode" className="text-[13px] font-medium text-gray-600">
              验证码
            </Label>
            <div className="flex gap-2">
              <Input
                id="bindCode"
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                maxLength={6}
                className="h-10 flex-1 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0}
                className="h-10 shrink-0 rounded-lg px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                style={{ background: '#f4f4f5', color: countdown > 0 ? '#9ca3af' : '#167a6e' }}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg text-[13px] font-medium text-white transition-all duration-150 mt-1 active:scale-[0.99] disabled:opacity-55 disabled:cursor-not-allowed"
            style={{
              background: loading ? '#167a6e' : 'linear-gradient(135deg, #167a6e 0%, #1aa396 100%)',
            }}
          >
            {loading ? '绑定中...' : '确认绑定'}
          </button>
        </form>
      </div>
    </div>
  )
}
