import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CircleUserRound, Loader2, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import {
  CloudPlatform,
  getAuthStatus,
  getAuthUrl,
  logoutCloud,
} from '@/services/cloudDrive.ts'
import { BaiduPanLogo } from './logos'
import FileBrowser from './FileBrowser'

interface PlatformMeta {
  value: CloudPlatform
  label: string
  Logo: React.FC<{ className?: string }>
  hint: string
}

const PLATFORMS: PlatformMeta[] = [
  {
    value: 'baidu_pan',
    label: '百度网盘',
    Logo: BaiduPanLogo,
    hint: '下载速度取决于百度网盘对该账号的服务限制，非会员通常较慢',
  },
]

interface CloudDrivePanelProps {
  onSubmitSuccess?: (taskIds: string[]) => void
}

const CloudDrivePanel = ({ onSubmitSuccess }: CloudDrivePanelProps) => {
  const [activePlatform, setActivePlatform] = useState<CloudPlatform>('baidu_pan')
  const [loggedIn, setLoggedIn] = useState<boolean>(false)
  const [accountName, setAccountName] = useState<string | null>(null)
  const [checkingStatus, setCheckingStatus] = useState<boolean>(true)
  const [loginInProgress, setLoginInProgress] = useState<boolean>(false)

  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true)
    try {
      const s = await getAuthStatus(activePlatform)
      setLoggedIn(s.logged_in)
      setAccountName(s.account_name)
    } catch (e: any) {
      setLoggedIn(false)
      setAccountName(null)
    } finally {
      setCheckingStatus(false)
    }
  }, [activePlatform])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  // OAuth 弹窗回调后, 通过 window.message 通知父窗口
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'cloud-drive-oauth') return
      setLoginInProgress(false)
      if (data.success) {
        toast.success(`已登录${data.accountName ? ' ' + data.accountName : ''}`)
        refreshStatus()
      } else {
        toast.error(data.message || '登录失败')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [refreshStatus])

  const handleLogin = async () => {
    setLoginInProgress(true)
    try {
      const { auth_url } = await getAuthUrl(activePlatform)
      const w = 600
      const h = 720
      const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
      const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
      window.open(
        auth_url,
        `oauth-${activePlatform}`,
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      )
    } catch (e: any) {
      setLoginInProgress(false)
      toast.error(e?.msg || e?.message || '打开授权页失败')
    }
  }

  const handleLogout = async () => {
    try {
      await logoutCloud(activePlatform)
      toast.success('已登出')
      setLoggedIn(false)
      setAccountName(null)
    } catch (e: any) {
      toast.error(e?.msg || e?.message || '登出失败')
    }
  }

  const active = PLATFORMS.find(p => p.value === activePlatform)!
  const ActiveLogo = active.Logo

  return (
    <div className="space-y-4">
      {/* 二级平台切换 */}
      <div className="flex gap-2">
        {PLATFORMS.map(p => {
          const Logo = p.Logo
          const isActive = p.value === activePlatform
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setActivePlatform(p.value)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-all ${
                isActive
                  ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-sm'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900'
              }`}
            >
              <Logo className="text-base" />
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>

      {/* 状态区 */}
      {checkingStatus ? (
        <div className="flex h-56 items-center justify-center rounded-xl border border-neutral-100 bg-neutral-50 text-neutral-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-sm">检查登录状态...</span>
        </div>
      ) : !loggedIn ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-gradient-to-b from-neutral-50/50 to-white">
          <ActiveLogo className="mb-3 text-5xl" />
          <p className="mb-4 text-sm text-neutral-500">
            请登录 <span className="text-neutral-700">{active.label}</span> 以访问您的文件
          </p>
          <Button size="sm" onClick={handleLogin} disabled={loginInProgress}>
            {loginInProgress && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            登录 {active.label}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 已登录状态栏 */}
          <div className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <ActiveLogo className="text-lg" />
              <span className="font-medium text-neutral-700">{active.label}</span>
              {accountName && (
                <span className="flex items-center gap-1 text-neutral-500">
                  <span className="text-neutral-300">·</span>
                  <CircleUserRound className="h-3.5 w-3.5" />
                  <span>{accountName}</span>
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-7 text-xs text-neutral-500 hover:text-neutral-700"
            >
              <LogOut className="mr-1 h-3 w-3" />
              登出
            </Button>
          </div>

          <p className="text-xs text-neutral-400">{active.hint}</p>

          {/* 文件浏览器 */}
          <FileBrowser platform={activePlatform} onSubmitSuccess={onSubmitSuccess} />
        </div>
      )}
    </div>
  )
}

export default CloudDrivePanel
