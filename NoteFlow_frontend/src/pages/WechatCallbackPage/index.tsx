import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '@/services/auth'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'
import BrandLogo from '@/components/BrandLogo'
import toast from 'react-hot-toast'

/**
 * 微信扫码后落地页. 有两种运行环境:
 *
 * 1. iframe 内被后端 302 命中 (主路径):
 *    向父窗口 postMessage({type:'wechat-login', state}), 父页面 AuthPage 里的 Dialog
 *    收到后自行调 /auth/wechat/exchange 完成登录, 关闭 iframe.
 *
 * 2. 被用户直接以顶层窗口打开 (兜底: iframe 被浏览器隐私模式拦截时):
 *    自己调 /auth/wechat/exchange 完成登录, 然后 navigate 到 /bind-phone 或 /.
 */
export default function WechatCallbackPage() {
  const [params] = useSearchParams()
  const state = params.get('state') || ''
  const error = params.get('error') || ''
  const navigate = useNavigate()
  const setAuth = useUserStore((s) => s.setAuth)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const [message, setMessage] = useState('登录中...')

  useEffect(() => {
    const inIframe = typeof window !== 'undefined' && window.parent !== window

    if (inIframe) {
      // 主路径: 通知父页, 剩下的交给父页处理; 保留 loading 界面以防父页没关 iframe
      try {
        window.parent.postMessage(
          { type: 'wechat-login', state, error: error || undefined },
          window.location.origin,
        )
      } catch {
        // 极小概率: 父页在其他 origin (不该发生, 因为后端 302 目标就是同源)
      }
      setMessage(error ? '登录失败, 请重新扫码' : '登录成功, 正在返回...')
      return
    }

    // 兜底: iframe 被拦时用户会看到这个页面自己直接顶层打开
    if (error) {
      toast.error('微信登录失败, 请重新尝试')
      navigate('/login', { replace: true })
      return
    }
    if (!state) {
      navigate('/login', { replace: true })
      return
    }

    ;(async () => {
      try {
        const result = await authApi.wechatExchange(state)
        setAuth(result.token, result.user)
        rehydrateTaskStore()
        loadHistory()
        if (!result.user.phone) {
          navigate('/bind-phone', { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      } catch (err: any) {
        toast.error(err?.msg || '登录已失效, 请重新扫码')
        navigate('/login', { replace: true })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-white px-8">
      <div className="flex items-center justify-center gap-2.5 mb-4">
        <BrandLogo className="h-7 w-auto flex-shrink-0" />
        <span className="text-xl font-semibold tracking-tight text-gray-900">NoteFlow</span>
      </div>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  )
}
