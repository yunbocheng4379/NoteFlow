import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import toast from 'react-hot-toast'
import { Loader2, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { billingApi, Order, formatYuan } from '@/services/billing'
import { useUserStore } from '@/store/userStore'

interface Props {
  order: Order | null
  onClose: () => void
  onSuccess?: () => void
  onSwitchMethod?: (method: 'ALIPAY' | 'WECHAT') => Promise<void>
}

const isMockOrder = (order: Order) => order.pay_method?.startsWith('MOCK_')

const REAL_METHODS: Array<{ code: 'ALIPAY' | 'WECHAT'; label: string; color: string }> = [
  { code: 'ALIPAY', label: '支付宝', color: 'text-[#1677ff]' },
  { code: 'WECHAT', label: '微信支付', color: 'text-[#07c160]' },
]

const MOCK_METHODS: Array<{ code: 'MOCK_ALIPAY' | 'MOCK_WECHAT'; label: string; color: string }> = [
  { code: 'MOCK_ALIPAY', label: '支付宝', color: 'text-[#1677ff]' },
  { code: 'MOCK_WECHAT', label: '微信支付', color: 'text-[#07c160]' },
]

const PayDialog = ({ order, onClose, onSuccess, onSwitchMethod }: Props) => {
  const [paying, setPaying] = useState(false)
  const [switching, setSwitching] = useState(false)
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const navigate = useNavigate()
  const onSuccessRef = useRef(onSuccess)
  const redirectedRef = useRef(false)
  onSuccessRef.current = onSuccess

  useEffect(() => {
    redirectedRef.current = false
  }, [order?.order_no])

  const completePayment = useCallback(async () => {
    if (redirectedRef.current) return
    redirectedRef.current = true
    toast.success('支付成功，电力已到账')
    await refreshBalance()
    onSuccessRef.current?.()
    navigate('/billing?tab=orders', { replace: true })
  }, [navigate, refreshBalance])

  const mock = order ? isMockOrder(order) : true
  const isAlipayPageOrder = !!order && !mock && order.pay_method === 'ALIPAY'
  const orderNo = order?.order_no
  const orderStatus = order?.status

  // 真实渠道: 轮询订单状态, notify 到账后自动关闭弹窗
  useEffect(() => {
    if (!orderNo || mock || orderStatus !== 'PENDING') return
    const timer = setInterval(async () => {
      try {
        const latest = await billingApi.getOrder(orderNo)
        if (latest.status === 'PAID') {
          clearInterval(timer)
          await completePayment()
        }
      } catch {
        // 轮询失败静默重试, 不打扰用户
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [completePayment, mock, orderNo, orderStatus])

  if (!order) return null

  const handlePay = async () => {
    if (!order.mock_qrcode_token) {
      toast.error('订单缺少支付凭证，无法完成 Mock 支付')
      return
    }
    setPaying(true)
    try {
      await billingApi.mockPay(order.order_no, order.mock_qrcode_token)
      await completePayment()
    } catch (e: any) {
      toast.error(e?.msg || '支付失败')
    } finally {
      setPaying(false)
    }
  }

  const handleAlipayPay = () => {
    if (!order.payment_url) {
      toast.error('支付宝支付地址缺失，请重新获取')
      return
    }
    window.location.assign(order.payment_url)
  }

  const handleSwitchMethod = async (method: 'ALIPAY' | 'WECHAT') => {
    if (!onSwitchMethod || method === order.pay_method) return
    setSwitching(true)
    try {
      await onSwitchMethod(method)
    } catch (e: any) {
      toast.error(e?.msg || '切换支付方式失败')
    } finally {
      setSwitching(false)
    }
  }

  const activeMethod = order.pay_method
  const METHODS = mock ? MOCK_METHODS : REAL_METHODS
  const qrPayload = mock
    ? `noteflow-mock://order/${order.order_no}?method=${activeMethod}`
    : order.qrcode_url || ''

  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认支付</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="text-center">
            <div className="text-3xl font-bold text-neutral-900">¥{formatYuan(order.amount_cents)}</div>
            <div className="mt-1 text-xs text-neutral-500">
              订单号 {order.order_no}
            </div>
          </div>

          {/* 支付方式 tab (真实渠道下切换需要重新下单, 由 onSwitchMethod 处理) */}
          <div className="flex gap-2 rounded-lg bg-neutral-100 p-1">
            {METHODS.map((m) => (
              <button
                key={m.code}
                onClick={() => (mock ? undefined : handleSwitchMethod(m.code as 'ALIPAY' | 'WECHAT'))}
                disabled={!mock && (switching || m.code === activeMethod)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  activeMethod === m.code
                    ? `bg-white shadow-sm ${m.color}`
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* 支付宝电脑网站支付不展示二维码, 微信和 MOCK 保持二维码流程 */}
          <div className="flex h-[232px] w-[232px] items-center justify-center rounded-xl border border-neutral-200 bg-white p-4">
            {switching ? (
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            ) : isAlipayPageOrder ? (
              <div className="text-center text-sm text-neutral-500">
                <div className="mb-2 text-4xl text-[#1677ff]">支</div>
                <div>支付宝收银台</div>
                <div className="mt-1 text-xs text-neutral-400">将在支付宝页面完成支付</div>
              </div>
            ) : (
              <QRCodeCanvas value={qrPayload} size={200} level="H" />
            )}
          </div>

          <div className="text-center text-xs text-neutral-500">
            <div>
              {isAlipayPageOrder
                ? '请点击下方按钮前往支付宝收银台'
                : `请使用 ${METHODS.find((m) => m.code === activeMethod)?.label} 扫码支付`}
            </div>
            <div className="mt-1 text-neutral-400">
              {mock
                ? '测试环境：点击下方「我已支付」直接模拟支付成功'
                : isAlipayPageOrder
                  ? '支付完成后将自动返回 NoteFlow 并确认到账'
                  : '扫码支付成功后将自动到账，无需手动确认'}
            </div>
          </div>

          <div className="flex w-full gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={paying}>
              取消
            </Button>
            {isAlipayPageOrder && (
              <Button
                className="flex-1 bg-[#1677ff] text-white hover:bg-[#0f63d6]"
                onClick={handleAlipayPay}
              >
                前往支付宝支付
              </Button>
            )}
            {mock && (
              <Button
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white"
                onClick={handlePay}
                disabled={paying}
              >
                {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                我已支付
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PayDialog
