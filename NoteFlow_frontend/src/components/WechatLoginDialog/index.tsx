import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { authApi } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'
import toast from 'react-hot-toast'

const QR_TIMEOUT_MS = 3 * 60 * 1000

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 微信扫码登录弹窗:
 * 1. 打开时向后端拿 qr_url + state, 放进 iframe.src 显示官方二维码
 * 2. 挂 window message 监听, iframe 里的 /wechat/callback 页 postMessage 过来
 * 3. 收到 message 后调 /auth/wechat/exchange 换 token+user, 存 store 后跳转
 * 4. PhoneGuard 会兜底把没绑手机的用户送到 /bind-phone (这里也显式跳一次更快)
 */
export default function WechatLoginDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const setAuth = useUserStore((s) => s.setAuth)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const [qrUrl, setQrUrl] = useState<string>('')
  const [state, setState] = useState<string>('')
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef<string>('')

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const loadQr = useCallback(async () => {
    setExpired(false)
    setQrUrl('')
    setState('')
    stateRef.current = ''
    try {
      const res = await authApi.wechatQrUrl()
      setQrUrl(res.qr_url)
      setState(res.state)
      stateRef.current = res.state
      // 3 分钟本地过期兜底, 微信原生二维码 5 分钟, 提前一点避免用户扫到无效码
      timerRef.current = setTimeout(() => setExpired(true), QR_TIMEOUT_MS)
    } catch (err: any) {
      toast.error(err?.msg || '微信登录暂不可用')
      onClose()
    }
  }, [onClose])

  const handleExchange = useCallback(
    async (evtState: string) => {
      if (loading) return
      setLoading(true)
      try {
        const result = await authApi.wechatExchange(evtState)
        setAuth(result.token, result.user)
        rehydrateTaskStore()
        loadHistory()
        onClose()
        if (!result.user.phone) {
          navigate('/bind-phone', { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      } catch (err: any) {
        toast.error(err?.msg || '登录已失效, 请重新扫码')
        setExpired(true)
      } finally {
        setLoading(false)
      }
    },
    [loading, setAuth, loadHistory, navigate, onClose],
  )

  useEffect(() => {
    if (!open) {
      cleanup()
      return
    }

    loadQr()

    const handler = (evt: MessageEvent) => {
      if (evt.origin !== window.location.origin) return
      const data = evt.data as { type?: string; state?: string; error?: string } | undefined
      if (!data || data.type !== 'wechat-login') return
      if (!stateRef.current || data.state !== stateRef.current) return
      if (data.error) {
        toast.error('微信登录失败, 请重新扫码')
        setExpired(true)
        return
      }
      handleExchange(data.state)
    }
    window.addEventListener('message', handler)

    return () => {
      window.removeEventListener('message', handler)
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="sm:max-w-[360px] bg-white">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-semibold text-gray-900">
            微信扫码登录
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {!qrUrl && !expired && (
            <div className="w-[300px] h-[360px] flex items-center justify-center text-sm text-gray-400">
              加载中...
            </div>
          )}
          {qrUrl && !expired && (
            <iframe
              src={qrUrl}
              title="wechat-qrconnect"
              width={300}
              height={360}
              className="border-0"
              sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation"
            />
          )}
          {expired && (
            <div className="w-[300px] h-[360px] flex flex-col items-center justify-center gap-3">
              <p className="text-sm text-gray-500">二维码已失效</p>
              <button
                type="button"
                onClick={loadQr}
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-white"
                style={{ background: '#07C160' }}
              >
                点击刷新
              </button>
            </div>
          )}
          <p className="text-[12px] text-gray-400 text-center">
            请使用微信扫描二维码进行登录
            <br />
            登录后需绑定手机号完成账号验证
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
