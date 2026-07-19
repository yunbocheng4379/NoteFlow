import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authApi, AuthErrorCode, type TargetType } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'
import BrandLogo from '@/components/BrandLogo'
import ForgotPasswordDialog from '@/components/ForgotPasswordDialog'
import toast from 'react-hot-toast'

type TopMode = 'password' | 'code'
type Mode = 'login' | 'register'

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
      </svg>
    ),
    title: '多平台解析',
    desc: '支持哔哩哔哩、YouTube、抖音、快手',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    ),
    title: 'AI 笔记生成',
    desc: '接入主流 LLM 自动生成结构化 Markdown',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
      </svg>
    ),
    title: '思维导图',
    desc: '可视化梳理内容脉络，快速掌握全貌',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    ),
    title: 'AI 问答',
    desc: '基于笔记内容进行智能对话问答',
  },
]

const AI_TAGS = [
  { label: 'OpenAI', color: '#10a37f' },
  { label: 'Claude', color: '#d97757' },
  { label: 'Gemini', color: '#4285f4' },
  { label: 'DeepSeek', color: '#4f46e5' },
  { label: 'Qwen', color: '#f97316' },
]

const RESEND_COOLDOWN = 60

export default function AuthPage() {
  const navigate = useNavigate()
  const setAuth = useUserStore((s) => s.setAuth)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const [mode, setMode] = useState<Mode>('login')
  const [topMode, setTopMode] = useState<TopMode>('password')
  const [codeTargetType, setCodeTargetType] = useState<TargetType>('email')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 从 URL ?invite=XXX 预填邀请码, 若存在则自动切到注册 tab
  const inviteFromUrl = (() => {
    try {
      const u = new URL(window.location.href)
      return (u.searchParams.get('invite') || '').trim().toUpperCase() || ''
    } catch {
      return ''
    }
  })()

  const [form, setForm] = useState({
    account: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: inviteFromUrl,
    codeTarget: '',
    code: '',
  })

  // 有邀请码时默认注册 tab
  useEffect(() => {
    if (inviteFromUrl) setMode('register')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const switchMode = (m: Mode) => {
    setMode(m)
    // 切换模式时清空密码，避免泄漏/误填
    setForm((prev) => ({ ...prev, password: '', confirmPassword: '' }))
  }

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
    const target = form.codeTarget.trim()
    if (!target) return toast.error(codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号')
    if (countdown > 0) return

    // 点击后立即进入倒计时/禁用态，不等接口返回，避免网络等待期间被重复点击
    startCountdown()
    try {
      await authApi.sendCode({ target, target_type: codeTargetType, purpose: 'login' })
      toast.success('验证码已发送')
    } catch (err: any) {
      // 发送失败, 回滚倒计时让用户可以立即重试
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(0)

      const code = err?.code
      if (code === AuthErrorCode.TARGET_NOT_FOUND) {
        toast.error('该账号未注册，请先注册')
      } else if (code === AuthErrorCode.RATE_LIMITED) {
        toast.error(err?.msg || '发送过于频繁，请稍后再试')
      } else if (code === AuthErrorCode.SEND_CODE_FAILED) {
        toast.error('验证码发送失败，请稍后再试')
      } else {
        toast.error(err?.msg || '发送失败，请稍后再试')
      }
    }
  }

  const submitPasswordLogin = async () => {
    if (!form.account.trim()) return toast.error('请输入用户名/邮箱/手机号')
    if (!form.password) return toast.error('请输入密码')
    setLoading(true)
    try {
      const result = await authApi.login({ account: form.account.trim(), password: form.password })
      setAuth(result.token, result.user)
      rehydrateTaskStore(result.user.id)
      await loadHistory()
      toast.success('登录成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.ACCOUNT_NOT_FOUND) {
        // 账户不存在 —— 提示并跳转到注册页
        toast.error('账户不存在，请先注册')
        setForm((prev) => ({ ...prev, username: prev.account, password: '', confirmPassword: '' }))
        switchMode('register')
      } else if (code === AuthErrorCode.PASSWORD_INCORRECT) {
        // 密码错误 —— 停留在登录表单，仅清空密码
        toast.error('密码错误')
        setForm((prev) => ({ ...prev, password: '' }))
      } else {
        toast.error(err?.msg || '登录失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitCodeLogin = async () => {
    const target = form.codeTarget.trim()
    if (!target) return toast.error(codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号')
    if (!form.code.trim()) return toast.error('请输入验证码')
    setLoading(true)
    try {
      const result = await authApi.loginByCode({
        target,
        target_type: codeTargetType,
        code: form.code.trim(),
      })
      setAuth(result.token, result.user)
      rehydrateTaskStore(result.user.id)
      await loadHistory()
      toast.success('登录成功')
      navigate('/', { replace: true })
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.ACCOUNT_NOT_FOUND) {
        toast.error('账户不存在，请先注册')
      } else if (code === AuthErrorCode.CODE_INVALID) {
        toast.error('验证码错误')
      } else if (code === AuthErrorCode.CODE_EXPIRED) {
        toast.error('验证码已过期，请重新获取')
      } else {
        toast.error(err?.msg || '登录失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submitRegister = async () => {
    if (!form.username.trim()) return toast.error('请填写用户名')
    if (form.username.trim().length < 3 || form.username.trim().length > 32)
      return toast.error('用户名长度需在 3~32 字符之间')
    if (!form.email.trim()) return toast.error('请填写邮箱')
    if (!form.password) return toast.error('请填写密码')
    if (form.password.length < 6) return toast.error('密码至少 6 位')
    if (!form.confirmPassword) return toast.error('请再次输入密码')
    if (form.password !== form.confirmPassword) return toast.error('两次输入的密码不一致')
    setLoading(true)
    try {
      await authApi.register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        confirm_password: form.confirmPassword,
        invite_code: form.inviteCode.trim() || undefined,
      })
      toast.success('注册成功，请登录')
      setForm((prev) => ({ ...prev, account: prev.username, email: '', password: '', confirmPassword: '' }))
      setMode('login')
      setTopMode('password')
    } catch (err: any) {
      const code = err?.code
      if (code === AuthErrorCode.USERNAME_EXISTS) {
        toast.error('用户名已存在')
      } else if (code === AuthErrorCode.EMAIL_EXISTS) {
        toast.error('邮箱已被注册')
      } else {
        toast.error(err?.msg || '注册失败，请稍后再试')
      }
    } finally {
      setLoading(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    if (mode === 'register') {
      await submitRegister()
      return
    }

    if (topMode === 'password') {
      await submitPasswordLogin()
    } else {
      await submitCodeLogin()
    }
  }

  const showCodeLoginUI = mode === 'login' && topMode === 'code'

  return (
    <div
      className="h-[100dvh] flex overflow-hidden"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-[54%] relative flex-col justify-between p-12 overflow-hidden select-none"
        style={{ background: '#0b1e2d' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 68% 52% at 44% 62%, rgba(22,122,110,0.18) 0%, transparent 100%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            opacity: 0.05,
          }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-auto flex-shrink-0" />
            <span className="text-white text-[1.0625rem] font-semibold tracking-tight">
              NoteFlow
            </span>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2
              className="font-bold leading-[1.18] mb-4"
              style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', letterSpacing: '-0.02em' }}
            >
              <span className="text-white">让每一个视频</span>
              <br />
              <span
                style={{
                  background: 'linear-gradient(90deg, #1aa396, #4dd9cc)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                变成结构化笔记
              </span>
            </h2>
            <p className="text-sm leading-relaxed max-w-[20rem]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              AI 驱动的视频笔记工具，自动转写、生成 Markdown，并支持思维导图可视化。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl p-3.5 flex flex-col gap-2"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <div style={{ color: '#1aa396' }}>{f.icon}</div>
                <div>
                  <p className="text-[13px] font-medium text-white leading-none mb-1">{f.title}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.38)' }}>
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-[11px] mb-2.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
            兼容主流模型
          </p>
          <div className="flex flex-wrap gap-2">
            {AI_TAGS.map((tag) => (
              <span
                key={tag.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: `${tag.color}18`,
                  border: `1px solid ${tag.color}40`,
                  color: tag.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: tag.color }}
                />
                {tag.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex min-h-0 flex-col items-center px-8 py-8 bg-white overflow-y-auto">
        <div className="w-full max-w-[22rem] flex-1 flex flex-col justify-center py-6">
          <div className="flex items-center justify-center gap-2.5 mb-7">
            <BrandLogo className="h-7 w-auto flex-shrink-0" />
            <span className="text-xl font-semibold tracking-tight text-gray-900">NoteFlow</span>
          </div>

          {/* 顶层 Tab: 登录 / 注册 */}
          <div className="flex rounded-lg p-1 mb-4" style={{ background: '#f4f4f5' }}>
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className="flex-1 py-2 rounded-md text-[13px] font-medium transition-all duration-150"
                style={
                  mode === m
                    ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                    : { color: '#6b7280' }
                }
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          {/* 二层 Tab: 密码登录 / 验证码登录 (仅登录模式显示) */}
          {mode === 'login' && (
            <div className="flex gap-4 mb-6 border-b border-gray-100">
              {(['password', 'code'] as TopMode[]).map((tm) => (
                <button
                  key={tm}
                  type="button"
                  onClick={() => setTopMode(tm)}
                  className="pb-2.5 text-[13px] font-medium transition-colors relative"
                  style={{ color: topMode === tm ? '#167a6e' : '#9ca3af' }}
                >
                  {tm === 'password' ? '密码登录' : '验证码登录'}
                  {topMode === tm && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: '#167a6e' }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 三层切换: 邮箱验证码 / 手机验证码 (仅验证码登录显示) */}
          {showCodeLoginUI && (
            <div className="flex rounded-lg p-1 mb-6" style={{ background: '#f4f4f5' }}>
              {(['email', 'phone'] as TargetType[]).map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => {
                    setCodeTargetType(tt)
                    setForm((prev) => ({ ...prev, codeTarget: '', code: '' }))
                  }}
                  className="flex-1 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150"
                  style={
                    codeTargetType === tt
                      ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                      : { color: '#6b7280' }
                  }
                >
                  {tt === 'email' ? '邮箱验证码' : '手机验证码'}
                </button>
              ))}
            </div>
          )}

          <div className="mb-7">
            <h1
              className="font-bold text-gray-900 mb-1"
              style={{ fontSize: '1.375rem', letterSpacing: '-0.016em' }}
            >
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h1>
            <p className="text-[13px] text-gray-400">
              {mode === 'login' ? '登录你的 NoteFlow 账号继续使用' : '填写信息，开始使用 NoteFlow'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'login' && topMode === 'password' && (
              <div className="space-y-1.5">
                <Label htmlFor="account" className="text-[13px] font-medium text-gray-600">
                  用户名 / 邮箱 / 手机号
                </Label>
                <Input
                  id="account"
                  placeholder="请输入用户名、邮箱或手机号"
                  value={form.account}
                  onChange={set('account')}
                  required
                  autoComplete="username"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  style={{ '--tw-ring-color': 'rgba(22,122,110,0.3)' } as React.CSSProperties}
                />
              </div>
            )}

            {showCodeLoginUI && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="codeTarget" className="text-[13px] font-medium text-gray-600">
                    {codeTargetType === 'email' ? '邮箱' : '手机号'}
                  </Label>
                  <Input
                    id="codeTarget"
                    type={codeTargetType === 'email' ? 'email' : 'tel'}
                    placeholder={codeTargetType === 'email' ? '请输入邮箱' : '请输入手机号'}
                    value={form.codeTarget}
                    onChange={set('codeTarget')}
                    required
                    className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="loginCode" className="text-[13px] font-medium text-gray-600">
                    验证码
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="loginCode"
                      placeholder="请输入验证码"
                      value={form.code}
                      onChange={set('code')}
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
              </>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-[13px] font-medium text-gray-600">
                  用户名
                </Label>
                <Input
                  id="username"
                  placeholder="请输入用户名（3~32 字符）"
                  value={form.username}
                  onChange={set('username')}
                  required
                  autoComplete="username"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                  style={{ '--tw-ring-color': 'rgba(22,122,110,0.3)' } as React.CSSProperties}
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[13px] font-medium text-gray-600">
                  邮箱
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="请输入邮箱"
                  value={form.email}
                  onChange={set('email')}
                  required
                  autoComplete="email"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {(mode === 'register' || (mode === 'login' && topMode === 'password')) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[13px] font-medium text-gray-600">
                    密码
                  </Label>
                  {mode === 'login' && topMode === 'password' && (
                    <button
                      type="button"
                      className="text-[12px] font-medium transition-colors"
                      style={{ color: '#167a6e' }}
                      onClick={() => setShowForgotPassword(true)}
                    >
                      忘记密码？
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                  value={form.password}
                  onChange={set('password')}
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-[13px] font-medium text-gray-600">
                  确认密码
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  required
                  autoComplete="new-password"
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="inviteCode" className="text-[13px] font-medium text-gray-600">
                  邀请码 <span className="text-xs text-gray-400">(选填, 注册即得 +200 电力)</span>
                </Label>
                <Input
                  id="inviteCode"
                  placeholder="填写好友邀请码"
                  value={form.inviteCode}
                  onChange={(e) => setForm((p) => ({ ...p, inviteCode: e.target.value.toUpperCase() }))}
                  maxLength={16}
                  className="h-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-300 rounded-lg text-sm font-mono tracking-wider focus-visible:ring-1 transition-colors"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg text-[13px] font-medium text-white transition-all duration-150 mt-1 active:scale-[0.99] disabled:opacity-55 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? '#167a6e'
                  : 'linear-gradient(135deg, #167a6e 0%, #1aa396 100%)',
              }}
            >
              {loading
                ? mode === 'login'
                  ? '登录中...'
                  : '注册中...'
                : mode === 'login'
                ? '登录'
                : '注册'}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-gray-400">
            {mode === 'login' ? (
              <>
                还没有账号？{' '}
                <button
                  type="button"
                  className="font-medium transition-colors"
                  style={{ color: '#167a6e' }}
                  onClick={() => switchMode('register')}
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账号？{' '}
                <button
                  type="button"
                  className="font-medium transition-colors"
                  style={{ color: '#167a6e' }}
                  onClick={() => switchMode('login')}
                >
                  去登录
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-6 shrink-0 text-[11px] text-gray-300">
          2026 NoteFlow
        </p>
      </div>

      <ForgotPasswordDialog open={showForgotPassword} onClose={() => setShowForgotPassword(false)} />
    </div>
  )
}
