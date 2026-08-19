import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { billingApi } from '@/services/billing'
import { useUserStore } from '@/store/userStore'

type Result = 'loading' | 'paid' | 'pending' | 'failed' | 'invalid'

const AlipayReturnPage = () => {
  const [searchParams] = useSearchParams()
  const [result, setResult] = useState<Result>('loading')
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const orderNo = searchParams.get('out_trade_no')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    if (!orderNo) {
      setResult('invalid')
      return () => undefined
    }

    const poll = async () => {
      try {
        const latest = await billingApi.getOrder(orderNo)
        if (cancelled) return
        if (latest.status === 'PAID') {
          setResult('paid')
          await refreshBalance()
          return
        }
        if (latest.status !== 'PENDING') {
          setResult('failed')
          return
        }
        if (Date.now() - startedAt >= 60_000) {
          setResult('pending')
          return
        }
        setResult('loading')
        timer = setTimeout(poll, 2000)
      } catch {
        if (cancelled) return
        if (Date.now() - startedAt >= 60_000) {
          setResult('pending')
          return
        }
        timer = setTimeout(poll, 2000)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [orderNo, refreshBalance])

  const title = {
    loading: '正在确认支付结果',
    paid: '支付成功',
    pending: '支付结果确认中',
    failed: '订单未完成',
    invalid: '缺少订单号',
  }[result]

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-neutral-200">
        {result === 'paid' ? (
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        ) : result === 'loading' ? (
          <Loader2 className="mx-auto h-14 w-14 animate-spin text-blue-500" />
        ) : (
          <CircleAlert className="mx-auto h-14 w-14 text-amber-500" />
        )}
        <h1 className="mt-4 text-xl font-semibold text-neutral-900">{title}</h1>
        {orderNo && <p className="mt-2 text-xs text-neutral-500">订单号：{orderNo}</p>}
        {result === 'paid' && <p className="mt-3 text-sm text-neutral-600">权益已到账，可以继续使用 NoteFlow。</p>}
        {result === 'pending' && (
          <p className="mt-3 text-sm text-neutral-600">支付宝已返回，但后台还在等待异步通知，请稍后到账单页查看。</p>
        )}
        {result === 'failed' && <p className="mt-3 text-sm text-neutral-600">该订单没有完成支付，未发放任何权益。</p>}
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/billing">
            <Button variant="outline">查看账单</Button>
          </Link>
          <Link to="/upgrade">
            <Button>返回购买页</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default AlipayReturnPage
