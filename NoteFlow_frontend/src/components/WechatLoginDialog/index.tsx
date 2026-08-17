import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { authApi } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'
import toast from 'react-hot-toast'

const QR_TIMEOUT_MS = 3 * 60 * 1000
const POLL_INTERVAL_MS = 2000

interface Props {
  open: boolean
  onClose: () => void
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'msg' in error) {
    const message = (error as { msg?: unknown }).msg
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/**
 * 微信小程序扫码登录弹窗:
 * 1. 打开时向后端申请一次性小程序码和 state
 * 2. PC 端轮询 state 状态, 小程序确认后换取一次性 ticket
 * 3. 用 ticket 换取现有系统 JWT, 写入 userStore 后继续当前权限流程
 */
export default function WechatLoginDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const setAuth = useUserStore((s) => s.setAuth)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const [qrImage, setQrImage] = useState('')
  const [state, setState] = useState('')
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exchangeStartedRef = useRef(false)

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (expiryRef.current) {
      clearTimeout(expiryRef.current)
      expiryRef.current = null
    }
  }, [])

  const loadQr = useCallback(async () => {
    cleanup()
    exchangeStartedRef.current = false
    setExpired(false)
    setLoading(false)
    setQrImage('')
    setState('')

    try {
      const result = await authApi.wechatMiniQr()
      setQrImage(result.qr_image)
      setState(result.state)
      expiryRef.current = setTimeout(() => {
        cleanup()
        setExpired(true)
      }, Math.min(result.expires_in * 1000, QR_TIMEOUT_MS))
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '微信登录暂不可用'))
      onClose()
    }
  }, [cleanup, onClose])

  const handleExchange = useCallback(
    async (currentState: string) => {
      if (exchangeStartedRef.current) return
      exchangeStartedRef.current = true
      cleanup()
      setLoading(true)
      try {
        const result = await authApi.wechatMiniExchange(currentState)
        setAuth(result.token, result.user)
        rehydrateTaskStore()
        loadHistory()
        onClose()
        if (!result.user.phone) {
          navigate('/bind-phone', { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      } catch (err: unknown) {
        exchangeStartedRef.current = false
        toast.error(getErrorMessage(err, '登录已失效，请重新扫码'))
        setExpired(true)
      } finally {
        setLoading(false)
      }
    },
    [cleanup, loadHistory, navigate, onClose, setAuth],
  )

  useEffect(() => {
    if (!open) {
      cleanup()
      return
    }
    loadQr()
    return cleanup
  }, [cleanup, loadQr, open])

  useEffect(() => {
    if (!open || !state || expired || loading) return

    let disposed = false
    const poll = async () => {
      try {
        const result = await authApi.wechatMiniStatus(state)
        if (disposed) return
        if (result.status === 'ready') {
          await handleExchange(state)
        } else if (result.status === 'expired' || result.status === 'failed') {
          cleanup()
          setExpired(true)
        }
      } catch {
        // 网络瞬时失败时继续轮询，二维码 TTL 到期后再提示用户刷新。
      }
    }

    poll()
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      disposed = true
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [cleanup, expired, handleExchange, loading, open, state])

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : null)}>
      <DialogContent className="sm:max-w-[360px] bg-white">
        <DialogHeader>
          <DialogTitle className="text-center text-base font-semibold text-gray-900">
            微信扫码登录
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {!qrImage && !expired && (
            <div className="flex h-[300px] w-[300px] items-center justify-center text-sm text-gray-400">
              加载中...
            </div>
          )}
          {qrImage && !expired && (
            <div className="flex h-[300px] w-[300px] items-center justify-center rounded-xl bg-white p-2 shadow-sm">
              <img src={qrImage} alt="微信小程序扫码登录二维码" className="h-full w-full object-contain" />
            </div>
          )}
          {expired && (
            <div className="flex h-[300px] w-[300px] flex-col items-center justify-center gap-3">
              <p className="text-sm text-gray-500">二维码已失效</p>
              <button
                type="button"
                onClick={loadQr}
                className="h-9 rounded-lg px-4 text-[13px] font-medium text-white"
                style={{ background: '#07C160' }}
              >
                点击刷新
              </button>
            </div>
          )}
          <p className="text-center text-[12px] text-gray-400">
            请使用微信扫描二维码
            <br />
            在小程序中确认登录后完成认证
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
