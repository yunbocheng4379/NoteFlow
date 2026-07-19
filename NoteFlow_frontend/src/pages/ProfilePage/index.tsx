import { useState, useEffect, useRef } from 'react'
import { Camera, Shield, Phone, Mail, Clock, Coins, Eye, EyeOff, Check, Loader2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { profileApi, type ProfileInfo } from '@/services/profile'
import { useUserStore } from '@/store/userStore'
import ChangeContactDialog from '@/components/ChangeContactDialog'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

function formatDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function maskPhone(phone?: string | null) {
  if (!phone) return '未绑定'
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

export default function ProfilePage() {
  const { user, setAuth } = useUserStore()
  const token = useUserStore((s) => s.token)
  const fileRef = useRef<HTMLInputElement>(null)

  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // 基本资料 form
  const [username, setUsername] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // 修改密码 form
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)

  // 邮件通知设置
  const [savingNotify, setSavingNotify] = useState(false)
  const [savingAnnounce, setSavingAnnounce] = useState(false)

  // 修改手机号/邮箱 弹窗
  const [contactDialogField, setContactDialogField] = useState<'phone' | 'email' | null>(null)

  useEffect(() => {
    profileApi.getProfile()
      .then((data) => {
        setProfile(data)
        setUsername(data.username)
      })
      .catch(() => toast.error('获取个人信息失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleAvatarClick = () => fileRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setAvatarUploading(true)
    try {
      const { avatar_url } = await profileApi.uploadAvatar(file)
      setProfile((p) => p ? { ...p, avatar: avatar_url } : p)
      // Sync to userStore so sidebar avatar updates
      if (token && user) {
        setAuth(token, { ...user, avatar: avatar_url })
      }
      toast.success('头像已更新')
    } catch {
      // toast shown by interceptor
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (username === profile?.username) return
    setSavingProfile(true)
    try {
      await profileApi.updateProfile({ username })
      setProfile((p) => p ? { ...p, username } : p)
      if (token && user) {
        setAuth(token, { ...user, username })
      }
      toast.success('用户名已更新')
    } catch {
      setUsername(profile?.username ?? '')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPwd !== confirmPwd) return toast.error('两次密码输入不一致')
    if (newPwd.length < 6) return toast.error('新密码至少 6 位')
    setSavingPwd(true)
    try {
      await profileApi.changePassword({ old_password: oldPwd, new_password: newPwd })
      toast.success('密码修改成功')
      setOldPwd('')
      setNewPwd('')
      setConfirmPwd('')
    } catch {
      // toast shown by interceptor
    } finally {
      setSavingPwd(false)
    }
  }

  const handleToggleNotify = async (checked: boolean) => {
    setSavingNotify(true)
    try {
      await profileApi.updateNotifySetting({ email_notify_enabled: checked })
      setProfile((p) => p ? { ...p, email_notify_enabled: checked } : p)
      toast.success(checked ? '已开启邮件通知' : '已关闭邮件通知')
    } catch {
      // toast shown by interceptor
    } finally {
      setSavingNotify(false)
    }
  }

  const handleToggleAnnounce = async (checked: boolean) => {
    setSavingAnnounce(true)
    try {
      await profileApi.updateNotifySetting({ system_announce_enabled: checked })
      setProfile((p) => p ? { ...p, system_announce_enabled: checked } : p)
      toast.success(checked ? '已开启系统公告通知' : '已关闭系统公告通知')
    } catch {
      // toast shown by interceptor
    } finally {
      setSavingAnnounce(false)
    }
  }

  const handleContactChanged = (value: string) => {
    const field = contactDialogField
    if (!field) return
    setProfile((p) => (p ? { ...p, [field]: value } : p))
    if (token && user) {
      setAuth(token, { ...user, [field]: value })
    }
  }

  const avatarSrc = profile?.avatar
    ? profile.avatar.startsWith('http') ? profile.avatar : `${API_BASE}${profile.avatar}`
    : null

  const remainingPoints = profile?.credits ?? 0
  const usedPoints = profile?.used_points ?? 0
  const totalPoints = remainingPoints + usedPoints
  const pointPct = totalPoints > 0 ? Math.min(100, Math.round((usedPoints / totalPoints) * 100)) : 0

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full overflow-auto bg-neutral-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold text-gray-900">个人信息</h1>

        <div className="flex gap-6">
          {/* ── Left panel ── */}
          <div className="flex w-64 shrink-0 flex-col gap-4">
            {/* Avatar card */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              {/* Avatar */}
              <div className="relative mx-auto mb-4 h-24 w-24">
                <div
                  className="h-24 w-24 cursor-pointer overflow-hidden rounded-full border-2 border-neutral-200 transition-opacity hover:opacity-85"
                  onClick={handleAvatarClick}
                  title="点击更换头像"
                >
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center text-3xl font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #167a6e, #1aa396)' }}
                    >
                      {profile?.username?.[0]?.toUpperCase() ?? 'U'}
                    </div>
                  )}
                </div>

                {/* Camera overlay */}
                <button
                  onClick={handleAvatarClick}
                  disabled={avatarUploading}
                  className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-white shadow-md transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed"
                  title="更换头像"
                >
                  {avatarUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />
                  ) : (
                    <Camera className="h-3.5 w-3.5 text-neutral-600" />
                  )}
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              <p className="text-base font-semibold text-gray-900">{profile?.username}</p>

              {/* Verified badge */}
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: '#e6f7f5', color: '#167a6e' }}
              >
                <Check className="h-3 w-3" />
                已认证
              </span>

              {/* Info rows */}
              <div className="mt-5 space-y-2.5 text-left">
                <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="手机" value={maskPhone(profile?.phone)} />
                <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="邮箱" value={profile?.email ?? '—'} />
                <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="注册" value={formatDate(profile?.created_at ?? null)} />
                <InfoRow icon={<Clock className="h-3.5 w-3.5" />} label="登录" value={formatDate(profile?.last_login_at ?? null)} />
              </div>
            </div>

            {/* Points card */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Coins className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium text-gray-700">使用额度</span>
              </div>

              <div className="mb-2 flex justify-between text-xs text-neutral-500">
                <span>已使用 {usedPoints}</span>
                <span>共 {totalPoints}</span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pointPct}%`,
                    background: 'linear-gradient(90deg, #167a6e, #1aa396)',
                  }}
                />
              </div>

              <p className="mt-3 text-xs text-neutral-400">
                剩余 <span className="font-semibold text-gray-700">{remainingPoints}</span> 电力
              </p>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="flex flex-1 flex-col gap-4 min-w-0">
            {/* 基本资料 */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-sm font-semibold text-gray-900">基本资料</h2>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <FormField label="用户名">
                  <input
                    className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={3}
                    maxLength={32}
                  />
                </FormField>

                <FormField label="手机号">
                  <div className="flex gap-2">
                    <input
                      className="h-9 flex-1 rounded-lg border border-neutral-100 bg-neutral-50 px-3 text-sm text-neutral-400 outline-none cursor-not-allowed"
                      value={profile?.phone ?? '暂未绑定'}
                      readOnly
                    />
                    <button
                      type="button"
                      onClick={() => setContactDialogField('phone')}
                      className="shrink-0 rounded-lg px-3 text-sm font-medium text-teal-600 transition-colors hover:text-teal-700"
                    >
                      修改
                    </button>
                  </div>
                </FormField>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={savingProfile || username === profile?.username}
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-5 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #167a6e, #1aa396)' }}
                  >
                    {savingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    保存修改
                  </button>
                </div>
              </form>
            </section>

            {/* 邮件通知 */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-sm font-semibold text-gray-900">邮件通知</h2>
              <div className="space-y-4">
                <FormField label="邮箱地址">
                  <div className="flex gap-2">
                    <input
                      className="h-9 flex-1 rounded-lg border border-neutral-100 bg-neutral-50 px-3 text-sm text-neutral-400 outline-none cursor-not-allowed"
                      value={profile?.email ?? ''}
                      readOnly
                    />
                    <button
                      type="button"
                      onClick={() => setContactDialogField('email')}
                      className="shrink-0 rounded-lg px-3 text-sm font-medium text-teal-600 transition-colors hover:text-teal-700"
                    >
                      修改
                    </button>
                  </div>
                </FormField>

                <div className="space-y-2.5">
                  <ToggleRow
                    label="任务完成通知"
                    description="笔记生成完成时发送邮件"
                    checked={profile?.email_notify_enabled ?? false}
                    onChange={handleToggleNotify}
                    disabled={savingNotify}
                  />
                  <ToggleRow
                    label="系统公告"
                    description="管理员发布重要更新与公告时发送邮件"
                    checked={profile?.system_announce_enabled ?? false}
                    onChange={handleToggleAnnounce}
                    disabled={savingAnnounce}
                  />
                </div>
              </div>
            </section>

            {/* 账号安全 */}
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-2">
                <Shield className="h-4 w-4 text-teal-600" />
                <h2 className="text-sm font-semibold text-gray-900">账号安全</h2>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-4">
                <FormField label="当前密码">
                  <PasswordInput
                    value={oldPwd}
                    onChange={setOldPwd}
                    show={showOld}
                    onToggle={() => setShowOld((v) => !v)}
                    placeholder="请输入当前密码"
                    autoComplete="current-password"
                  />
                </FormField>

                <FormField label="新密码">
                  <PasswordInput
                    value={newPwd}
                    onChange={setNewPwd}
                    show={showNew}
                    onToggle={() => setShowNew((v) => !v)}
                    placeholder="至少 6 位"
                    autoComplete="new-password"
                  />
                </FormField>

                <FormField label="确认新密码">
                  <PasswordInput
                    value={confirmPwd}
                    onChange={setConfirmPwd}
                    show={showNew}
                    onToggle={() => setShowNew((v) => !v)}
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                  />
                </FormField>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={savingPwd || !oldPwd || !newPwd || !confirmPwd}
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-5 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #167a6e, #1aa396)' }}
                  >
                    {savingPwd && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    修改密码
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>

      <ChangeContactDialog
        open={contactDialogField !== null}
        field={contactDialogField ?? 'phone'}
        currentValue={contactDialogField === 'phone' ? profile?.phone ?? null : profile?.email ?? null}
        onClose={() => setContactDialogField(null)}
        onSuccess={handleContactChanged}
      />
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 text-neutral-400">{icon}</span>
      <span className="w-8 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 break-all text-gray-600">{value}</span>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
      <label className="text-sm text-neutral-500">{label}</label>
      {children}
    </div>
  )
}

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  placeholder?: string
  autoComplete?: string
}) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 pr-9 text-sm text-gray-900 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-700">{label}</p>
        <p className="text-xs text-neutral-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-5 w-9 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: checked ? '#167a6e' : '#e5e7eb' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
          style={{ left: checked ? '1.125rem' : '0.125rem' }}
        />
      </button>
    </div>
  )
}
