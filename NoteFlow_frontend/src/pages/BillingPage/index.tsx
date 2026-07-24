import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Zap, ArrowUpRight, ArrowDownRight, Loader2, ReceiptText, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  billingApi,
  CreditTransaction,
  Order,
  TX_TYPE_LABEL,
  ORDER_STATUS_LABEL,
  formatYuan,
  Paginated,
} from '@/services/billing'
import { useUserStore } from '@/store/userStore'
import { Button } from '@/components/ui/button'
import PayDialog from '@/pages/UpgradePage/PayDialog'

type Tab = 'transactions' | 'orders'

const BillingPage = () => {
  const { credits, activeSubscription, refreshBalance } = useUserStore()
  const [tab, setTab] = useState<Tab>('transactions')
  const [txs, setTxs] = useState<Paginated<CreditTransaction> | null>(null)
  const [orders, setOrders] = useState<Paginated<Order> | null>(null)
  const [txPage, setTxPage] = useState(1)
  const [orderPage, setOrderPage] = useState(1)
  const [loadingTx, setLoadingTx] = useState(false)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [payingOrder, setPayingOrder] = useState<Order | null>(null)

  useEffect(() => {
    refreshBalance()
  }, [])

  useEffect(() => {
    if (tab === 'transactions') {
      setLoadingTx(true)
      billingApi
        .listTransactions(txPage, 20)
        .then(setTxs)
        .catch(() => {})
        .finally(() => setLoadingTx(false))
    }
  }, [tab, txPage])

  useEffect(() => {
    if (tab === 'orders') {
      setLoadingOrder(true)
      billingApi
        .listOrders(orderPage, 20)
        .then(setOrders)
        .catch(() => {})
        .finally(() => setLoadingOrder(false))
    }
  }, [tab, orderPage])

  const rePay = async (order: Order) => {
    // 重新支付需要 mock_qrcode_token, 而 listOrders 返回的历史订单 token 为 null
    // 简化: 用户重新走充值下单流程
    try {
      const full = await billingApi.getOrder(order.order_no)
      if (!full.mock_qrcode_token) {
        toast.error('支付凭证已失效，请重新下单')
        return
      }
      setPayingOrder(full)
    } catch (e: any) {
      toast.error(e?.msg || '获取订单失败')
    }
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#f5f5f5]">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-center gap-2">
          <ReceiptText className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">账单与额度</h1>
        </div>

        {/* 顶部余额卡片 */}
        <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 p-6 text-white shadow-lg">
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs uppercase tracking-wider text-white/70">当前电力</div>
              <div className="flex items-baseline gap-2">
                <Zap className="h-7 w-7 fill-yellow-300 text-yellow-300" />
                <span className="text-4xl font-bold">{credits}</span>
                <span className="text-sm text-white/70">电力</span>
              </div>
              {activeSubscription && (
                <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs backdrop-blur">
                  <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">PRO</span>
                  <span className="font-medium">{activeSubscription.plan_name}</span>
                  <span className="text-white/50">·</span>
                  <span className="text-white/85">到期 {fmtDate(activeSubscription.end_at)}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      activeSubscription.days_left <= 7
                        ? 'bg-amber-400/90 text-amber-950'
                        : 'bg-white/20 text-white'
                    }`}
                  >
                    {activeSubscription.days_left <= 7
                      ? `仅剩 ${activeSubscription.days_left} 天`
                      : `剩余 ${activeSubscription.days_left} 天`}
                  </span>
                </div>
              )}
            </div>
            {/* CTA: 横向排版, 且靠底对齐 */}
            <div className="flex shrink-0 gap-3">
              <Link to="/upgrade?tab=recharge">
                <Button className="bg-white text-teal-600 shadow-sm hover:bg-neutral-100">去充值</Button>
              </Link>
              <Link to="/upgrade?tab=subscription">
                <Button
                  variant="outline"
                  className="border-white/50 bg-white/10 text-white backdrop-blur hover:bg-white/20"
                >
                  {activeSubscription ? '续费会员' : '升级会员'}
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Tab */}
        <div className="mb-4 inline-flex rounded-xl bg-neutral-100 p-1">
          <button
            onClick={() => setTab('transactions')}
            className={`rounded-lg px-6 py-2 text-sm font-medium transition ${
              tab === 'transactions'
                ? 'bg-white text-primary shadow-sm'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <ReceiptText className="mr-1.5 inline h-4 w-4" />
            电力流水
          </button>
          <button
            onClick={() => setTab('orders')}
            className={`rounded-lg px-6 py-2 text-sm font-medium transition ${
              tab === 'orders'
                ? 'bg-white text-primary shadow-sm'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <CreditCard className="mr-1.5 inline h-4 w-4" />
            订单记录
          </button>
        </div>

        {/* 内容区 */}
        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          {tab === 'transactions' && (
            <TransactionsList
              data={txs}
              loading={loadingTx}
              page={txPage}
              onPageChange={setTxPage}
            />
          )}
          {tab === 'orders' && (
            <OrdersList
              data={orders}
              loading={loadingOrder}
              page={orderPage}
              onPageChange={setOrderPage}
              onRePay={rePay}
            />
          )}
        </div>
      </div>

      <PayDialog
        order={payingOrder}
        onClose={() => setPayingOrder(null)}
        onSuccess={() => {
          setPayingOrder(null)
          setOrderPage(1)
          refreshBalance()
        }}
      />
    </div>
  )
}

// ============================================================================
const TransactionsList = ({
  data,
  loading,
  page,
  onPageChange,
}: {
  data: Paginated<CreditTransaction> | null
  loading: boolean
  page: number
  onPageChange: (p: number) => void
}) => {
  if (loading && !data) return <SpinnerRow />
  if (!data || data.list.length === 0) return <EmptyRow text="暂无流水" />

  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          <tr className="text-left text-xs text-neutral-500">
            <th className="w-40 px-4 py-3 font-medium">时间</th>
            <th className="w-32 px-4 py-3 font-medium">类型</th>
            <th className="px-4 py-3 text-right font-medium">变动</th>
            <th className="px-4 py-3 text-right font-medium">余额</th>
            <th className="px-4 py-3 font-medium">备注</th>
          </tr>
        </thead>
        <tbody>
          {data.list.map((tx) => {
            const isIn = tx.amount > 0
            return (
              <tr key={tx.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{fmtTime(tx.created_at)}</td>
                <td className="px-4 py-3">
                  <span className="whitespace-nowrap rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    {TX_TYPE_LABEL[tx.type] || tx.type}
                  </span>
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right font-mono font-semibold ${
                    isIn ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {isIn ? (
                    <ArrowUpRight className="mr-0.5 inline h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-0.5 inline h-3 w-3" />
                  )}
                  {isIn ? '+' : ''}
                  {tx.amount}
                </td>
                <td className="px-4 py-3 text-right font-mono text-neutral-700">{tx.balance_after}</td>
                <td className="px-4 py-3 text-xs text-neutral-500">{tx.note || '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pager page={page} total={data.total} pageSize={data.page_size} onPageChange={onPageChange} />
    </>
  )
}

// ============================================================================
const OrdersList = ({
  data,
  loading,
  page,
  onPageChange,
  onRePay,
}: {
  data: Paginated<Order> | null
  loading: boolean
  page: number
  onPageChange: (p: number) => void
  onRePay: (o: Order) => void
}) => {
  if (loading && !data) return <SpinnerRow />
  if (!data || data.list.length === 0) return <EmptyRow text="暂无订单" />

  return (
    <>
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50">
          <tr className="text-left text-xs text-neutral-500">
            <th className="px-4 py-3 font-medium">订单号</th>
            <th className="px-4 py-3 font-medium">类型</th>
            <th className="px-4 py-3 text-right font-medium">金额</th>
            <th className="px-4 py-3 text-right font-medium">电力</th>
            <th className="px-4 py-3 font-medium">状态</th>
            <th className="px-4 py-3 font-medium">时间</th>
            <th className="px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.list.map((o) => (
            <tr key={o.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="px-4 py-3 font-mono text-xs text-neutral-600">{o.order_no}</td>
              <td className="px-4 py-3 text-xs">
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-700">
                  {o.kind === 'RECHARGE' ? '充值' : '订阅'}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-neutral-800">¥{formatYuan(o.amount_cents)}</td>
              <td className="px-4 py-3 text-right font-mono text-neutral-700">
                <Zap className="mr-0.5 inline h-3 w-3 fill-yellow-400 text-yellow-500" />
                {o.credits_amount}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={o.status} />
              </td>
              <td className="px-4 py-3 text-xs text-neutral-500">{fmtTime(o.created_at)}</td>
              <td className="px-4 py-3">
                {o.status === 'PENDING' && (
                  <button
                    onClick={() => onRePay(o)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    继续支付
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} total={data.total} pageSize={data.page_size} onPageChange={onPageChange} />
    </>
  )
}

// ============================================================================
const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    PAID: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
    PENDING: 'bg-yellow-50 text-yellow-600 ring-yellow-200',
    CANCELLED: 'bg-neutral-100 text-neutral-500 ring-neutral-200',
    REFUNDED: 'bg-blue-50 text-blue-600 ring-blue-200',
  }
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs ring-1 ${
        styles[status] || 'bg-neutral-100 text-neutral-500 ring-neutral-200'
      }`}
    >
      {ORDER_STATUS_LABEL[status] || status}
    </span>
  )
}

const SpinnerRow = () => (
  <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
  </div>
)

const EmptyRow = ({ text }: { text: string }) => (
  <div className="py-16 text-center text-sm text-neutral-500">{text}</div>
)

const Pager = ({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number
  total: number
  pageSize: number
  onPageChange: (p: number) => void
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
      <span>
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
        >
          上一页
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}

const fmtTime = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default BillingPage
