import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { billingApi, Order, formatYuan } from '@/services/billing'
import { useUserStore } from '@/store/userStore'
import {
  canCreatePaymentOrder,
  selectPaymentMethod,
  WECHAT_UNAVAILABLE_MESSAGE,
} from './paymentAvailability'

interface Props {
  order: Order | null
  draft?: PaymentDraft | null
  onClose: () => void
  onSuccess?: () => void
  onCreateOrder?: (method: 'ALIPAY' | 'WECHAT') => Promise<Order>
  onCreateOrderError?: (error: unknown) => void
  onRegeneratePayment?: (order: Order) => Promise<Order>
}

export interface PaymentDraft {
  kind: Order['kind']
  itemId: number
  amountCents: number
  creditsAmount: number
  isFirstSubscription: boolean
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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error !== 'object' || error === null || !('msg' in error)) return fallback
  const message = (error as { msg?: unknown }).msg
  return typeof message === 'string' && message ? message : fallback
}

const PayDialog = ({
  order,
  draft = null,
  onClose,
  onSuccess,
  onCreateOrder,
  onCreateOrderError,
  onRegeneratePayment,
}: Props) => {
  const [paying, setPaying] = useState(false)
  const [selectedMethod, setSelectedMethod] = useState<'ALIPAY' | 'WECHAT'>('ALIPAY')
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const navigate = useNavigate()
  const onSuccessRef = useRef(onSuccess)
  const redirectedRef = useRef(false)
  const alipayNavigationStartedRef = useRef(false)
  const creatingOrderRef = useRef(false)
  onSuccessRef.current = onSuccess

  const activeOrder = order || createdOrder
  const mock = activeOrder ? isMockOrder(activeOrder) : false
  const isDraft = !activeOrder && !!draft
  const isAlipayOrder = !!activeOrder && !mock && activeOrder.pay_method === 'ALIPAY'
  const hasPagePayment = isAlipayOrder && !!activeOrder?.payment_url
  const orderNo = activeOrder?.order_no
  const orderStatus = activeOrder?.status

  useEffect(() => {
    redirectedRef.current = false
    alipayNavigationStartedRef.current = false
    setNow(Date.now())
  }, [order?.order_no, draft?.kind, draft?.itemId])

  useEffect(() => {
    if (draft) {
      setSelectedMethod('ALIPAY')
      setCreatedOrder(null)
    }
  }, [draft])

  const completePayment = useCallback(async () => {
    if (redirectedRef.current) return
    redirectedRef.current = true
    toast.success('支付成功，电力已到账')
    await refreshBalance()
    onSuccessRef.current?.()
    navigate('/billing?tab=orders', { replace: true })
  }, [navigate, refreshBalance])

  useEffect(() => {
    if (!activeOrder || mock || activeOrder.status !== 'PENDING') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeOrder, mock])

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

  if (!activeOrder && !draft) return null

  const amountCents = activeOrder?.amount_cents ?? draft?.amountCents ?? 0
  const activeMethod = activeOrder?.pay_method ?? selectedMethod
  const METHODS = activeOrder && mock ? MOCK_METHODS : REAL_METHODS
  const qrPayload = activeOrder && mock
    ? `noteflow-mock://order/${activeOrder.order_no}?method=${activeMethod}`
    : activeOrder?.qrcode_url || ''
  const qrExpired = !!activeOrder?.expires_at &&
    activeOrder.status === 'PENDING' &&
    new Date(activeOrder.expires_at).getTime() <= now

  const handlePay = async () => {
    if (!activeOrder?.mock_qrcode_token) {
      toast.error('订单缺少支付凭证，无法完成 Mock 支付')
      return
    }
    setPaying(true)
    try {
      await billingApi.mockPay(activeOrder.order_no, activeOrder.mock_qrcode_token)
      await completePayment()
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, '支付失败'))
    } finally {
      setPaying(false)
    }
  }

  const handleCreateOrder = async () => {
    if (!draft || !onCreateOrder) return
    if (!canCreatePaymentOrder(selectedMethod)) {
      toast.error(WECHAT_UNAVAILABLE_MESSAGE)
      return
    }
    if (creatingOrderRef.current) return
    creatingOrderRef.current = true
    const method = selectedMethod
    const isAlipay = method === 'ALIPAY'
    if (!isAlipay) setPaying(true)
    try {
      const nextOrder = await onCreateOrder(method)
      if (isAlipay && nextOrder.payment_url) {
        navigateToAlipay(nextOrder.payment_url)
        return
      }
      if (isAlipay) {
        toast.error('支付宝支付地址缺失，请重新生成')
        return
      }
      setCreatedOrder(nextOrder)
    } catch (e: unknown) {
      if (onCreateOrderError) {
        onCreateOrderError(e)
      } else {
        toast.error(getErrorMessage(e, '下单失败'))
      }
    } finally {
      creatingOrderRef.current = false
      if (!isAlipay) setPaying(false)
    }
  }

  const handleRegeneratePayment = async () => {
    if (!activeOrder || !onRegeneratePayment) return
    setPaying(true)
    try {
      const refreshedOrder = await onRegeneratePayment(activeOrder)
      setCreatedOrder(refreshedOrder)
      setNow(Date.now())
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, '支付凭证重新生成失败'))
    } finally {
      setPaying(false)
    }
  }

  const navigateToAlipay = (paymentUrl = activeOrder?.payment_url) => {
    if (!paymentUrl) {
      toast.error('支付宝支付地址缺失，请重新生成')
      return
    }
    if (alipayNavigationStartedRef.current) return
    alipayNavigationStartedRef.current = true
    window.location.replace(paymentUrl)
  }

  return (
    <Dialog open={!!activeOrder || !!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认支付</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="text-center">
            <div className="text-3xl font-bold text-neutral-900">¥{formatYuan(amountCents)}</div>
            {activeOrder ? (
              <div className="mt-1 text-xs text-neutral-500">订单号 {activeOrder.order_no}</div>
            ) : (
              <div className="mt-1 text-xs text-neutral-500">请选择支付方式</div>
            )}
          </div>

          {/* 订单创建前可自由选择支付方式，确认支付后才向后端创建对应渠道订单。 */}
          <div className="flex gap-2 rounded-lg bg-neutral-100 p-1">
            {METHODS.map((m) => (
              <button
                key={m.code}
                onClick={() => {
                  if (m.code === 'WECHAT') {
                    toast.error(WECHAT_UNAVAILABLE_MESSAGE)
                    return
                  }
                  if (isDraft && !creatingOrderRef.current) {
                    setSelectedMethod(selectPaymentMethod(selectedMethod, m.code as 'ALIPAY' | 'WECHAT'))
                  }
                }}
                disabled={!isDraft || paying || m.code === activeMethod}
                aria-disabled={m.code === 'WECHAT' || undefined}
                title={m.code === 'WECHAT' ? WECHAT_UNAVAILABLE_MESSAGE : undefined}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  m.code === 'WECHAT'
                    ? 'cursor-not-allowed text-neutral-400'
                    : activeMethod === m.code
                      ? `bg-white shadow-sm ${m.color}`
                      : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                {m.code === 'WECHAT' ? `${m.label}（即将上线）` : m.label}
              </button>
            ))}
          </div>

          {/* 支付宝使用网页收银台，微信使用二维码，Mock 保留测试支付流程。 */}
          <div className="flex h-[232px] w-[232px] items-center justify-center rounded-xl border border-neutral-200 bg-white p-4">
            {paying ? (
              <div className="text-sm text-neutral-400">正在创建支付订单…</div>
            ) : isDraft ? (
              <div className="text-center text-sm text-neutral-500">
                <div className={`mb-2 text-4xl ${selectedMethod === 'ALIPAY' ? 'text-[#1677ff]' : 'text-[#07c160]'}`}>
                  {selectedMethod === 'ALIPAY' ? '支' : '微'}
                </div>
                <div>{selectedMethod === 'ALIPAY' ? '支付宝支付' : '微信支付'}</div>
                <div className="mt-1 text-xs text-neutral-400">点击下方按钮后生成支付凭证</div>
              </div>
            ) : qrExpired ? (
              <div className="text-center text-sm text-neutral-500">
                <div className="mb-2 text-4xl text-amber-500">!</div>
                <div>支付凭证已过期</div>
                <div className="mt-1 text-xs text-neutral-400">请重新生成支付凭证后再支付</div>
              </div>
            ) : hasPagePayment ? (
              <div className="text-center text-sm text-neutral-500">
                <div className="mb-2 text-4xl text-[#1677ff]">支</div>
                <div>支付宝网页支付</div>
                <div className="mt-1 text-xs text-neutral-400">点击下方按钮进入支付宝官方收银台</div>
              </div>
            ) : !activeOrder?.qrcode_url ? (
              <div className="text-center text-sm text-neutral-500">
                <div>支付二维码暂不可用</div>
                <div className="mt-1 text-xs text-neutral-400">请稍后重试</div>
              </div>
            ) : (
              <QRCodeCanvas value={qrPayload} size={200} level="H" />
            )}
          </div>

          <div className="text-center text-xs text-neutral-500">
            <div>
              {isDraft
                ? selectedMethod === 'ALIPAY'
                  ? '点击下方按钮进入支付宝支付'
                  : '点击下方按钮生成微信支付二维码'
                : qrExpired
                ? '支付凭证已过期，请重新生成'
                : hasPagePayment
                ? '点击下方按钮进入支付宝官方收银台'
                : `请使用 ${METHODS.find((m) => m.code === activeMethod)?.label} 扫码支付`}
            </div>
            <div className="mt-1 text-neutral-400">
              {isDraft
                ? '订单将在确认支付方式后创建'
                : mock
                ? '测试环境：点击下方「我已支付」直接模拟支付成功'
                : qrExpired
                  ? '原订单已关闭，重新生成后会创建新的支付订单'
                  : hasPagePayment
                    ? '支付完成后请返回 NoteFlow，系统会自动确认到账'
                  : '扫码支付成功后将自动到账，无需手动确认'}
            </div>
          </div>

          <div className="flex w-full gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={paying}>
              取消
            </Button>
            {isDraft && (
              <Button
                className={`flex-1 text-white ${selectedMethod === 'ALIPAY' ? 'bg-[#1677ff] hover:bg-[#0f63d6]' : 'bg-[#07c160] hover:bg-[#06a951]'}`}
                onClick={() => { void handleCreateOrder() }}
                disabled={paying}
              >
                去支付
              </Button>
            )}
            {qrExpired && isAlipayOrder && onRegeneratePayment && (
              <Button
                className="flex-1 bg-[#1677ff] text-white hover:bg-[#0f63d6]"
                onClick={() => { void handleRegeneratePayment() }}
                disabled={paying}
              >
                重新生成支付凭证
              </Button>
            )}
            {hasPagePayment && !qrExpired && activeOrder?.payment_url && (
              <a
                href={activeOrder.payment_url}
                target="_self"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  navigateToAlipay()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  navigateToAlipay()
                }}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-[#1677ff] text-sm font-medium text-white outline-none hover:bg-[#0f63d6] focus-visible:ring-2 focus-visible:ring-[#1677ff]/40"
              >
                去支付
              </a>
            )}
            {mock && (
              <Button
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white"
                onClick={handlePay}
                disabled={paying}
              >
                {paying ? '正在处理…' : <><Check className="mr-2 h-4 w-4" />我已支付</>}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PayDialog
