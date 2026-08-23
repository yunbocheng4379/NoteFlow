import { useEffect, useState } from 'react'
import { BarChart3, CircleDollarSign, Loader2, RefreshCw, Search, Users, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminApi, AdminRechargeOrderList, RechargeOverview } from '@/services/admin'
import { formatYuan, ORDER_STATUS_LABEL } from '@/services/billing'
import { Button } from '@/components/ui/button'

const PAGE_SIZE = 20

const fmtDateTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

const payMethodLabel: Record<string, string> = {
  ALIPAY: '支付宝',
  WECHAT: '微信',
  MOCK_ALIPAY: '模拟支付宝',
  MOCK_WECHAT: '模拟微信',
}

const statusClass: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-700',
  PENDING: 'bg-amber-50 text-amber-700',
  CANCELLED: 'bg-neutral-100 text-neutral-500',
  REFUNDED: 'bg-blue-50 text-blue-700',
}

const MetricCard = ({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  hint: string
  icon: typeof Zap
  accent: string
}) => (
  <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-sm text-neutral-500">{label}</div>
        <div className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">{value}</div>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <div className="mt-3 text-xs text-neutral-400">{hint}</div>
  </div>
)

export default function RechargeOperations() {
  const [overview, setOverview] = useState<RechargeOverview | null>(null)
  const [orders, setOrders] = useState<AdminRechargeOrderList | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      adminApi.rechargeOverview(),
      adminApi.listRechargeOrders({
        page,
        page_size: PAGE_SIZE,
        keyword: search || undefined,
        status: status || undefined,
      }),
    ])
      .then(([summary, orderData]) => {
        setOverview(summary)
        setOrders(orderData)
      })
      .catch(() => toast.error('获取充值运营数据失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status])

  const handleSearch = () => {
    setPage(1)
    setSearch(keyword.trim())
  }

  const totalPages = orders ? Math.max(1, Math.ceil(orders.total / orders.page_size)) : 1

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
      <div className="mx-auto w-full max-w-7xl shrink-0 px-6 pt-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold text-neutral-900">充值运营</h1>
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              查看充值转化、收入表现和全部充值用户订单
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新数据
          </Button>
        </div>

        {!overview ? (
          <div className="flex items-center justify-center rounded-2xl border border-neutral-200 bg-white py-20 text-sm text-neutral-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="今日下单用户"
                value={`${overview.today.order_users} 人`}
                hint={`已支付充值用户 ${overview.today.paid_users} 人 · 已支付订单 ${overview.today.paid_orders} 笔`}
                icon={Users}
                accent="bg-blue-50 text-blue-600"
              />
              <MetricCard
                label="今日下单数"
                value={`${overview.today.order_count} 笔`}
                hint="按今日创建的充值订单统计"
                icon={BarChart3}
                accent="bg-violet-50 text-violet-600"
              />
              <MetricCard
                label="今日收入"
                value={`¥${formatYuan(overview.today.revenue_cents)}`}
                hint="仅统计已支付充值订单"
                icon={CircleDollarSign}
                accent="bg-emerald-50 text-emerald-600"
              />
              <MetricCard
                label="累计收入"
                value={`¥${formatYuan(overview.total.revenue_cents)}`}
                hint={`${overview.total.paid_users} 位用户 · ${overview.total.paid_orders} 笔已支付订单`}
                icon={Zap}
                accent="bg-orange-50 text-orange-600"
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <div className="border-b border-neutral-100 px-5 py-4">
                  <h2 className="font-semibold text-neutral-900">充值套餐表现</h2>
                  <p className="mt-1 text-xs text-neutral-400">按已支付订单统计，可用于判断不同价格档位的接受度</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">套餐</th>
                        <th className="px-5 py-3 font-medium">支付订单</th>
                        <th className="px-5 py-3 font-medium">购买用户</th>
                        <th className="px-5 py-3 font-medium">收入</th>
                        <th className="px-5 py-3 font-medium">发放电力</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.package_breakdown.length === 0 ? (
                        <tr><td colSpan={5} className="px-5 py-8 text-center text-neutral-400">暂无已支付充值数据</td></tr>
                      ) : overview.package_breakdown.map(item => (
                        <tr key={item.code} className="border-t border-neutral-100">
                          <td className="px-5 py-3 font-medium text-neutral-800">{item.name}</td>
                          <td className="px-5 py-3 text-neutral-600">{item.paid_orders}</td>
                          <td className="px-5 py-3 text-neutral-600">{item.paid_users}</td>
                          <td className="px-5 py-3 text-neutral-700">¥{formatYuan(item.revenue_cents)}</td>
                          <td className="px-5 py-3 text-neutral-600">{item.credits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-neutral-900">累计充值概况</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-4 py-3">
                    <span className="text-neutral-500">累计已支付订单</span><b>{overview.total.paid_orders} 笔</b>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-4 py-3">
                    <span className="text-neutral-500">累计充值用户</span><b>{overview.total.paid_users} 人</b>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-4 py-3">
                    <span className="text-neutral-500">累计发放电力</span><b>{overview.total.credits}</b>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-5 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 pb-8">
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-5 py-4">
              <div>
                <h2 className="font-semibold text-neutral-900">全部充值订单</h2>
                <p className="mt-1 text-xs text-neutral-400">包含待支付、已支付和已关闭订单，便于跟进转化漏斗</p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && handleSearch()}
                    placeholder="订单号 / 用户名 / 邮箱"
                    className="h-9 w-56 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={handleSearch}>搜索</Button>
                <select
                  value={status}
                  onChange={event => { setPage(1); setStatus(event.target.value) }}
                  className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-600 outline-none focus:border-primary"
                >
                  <option value="">全部状态</option>
                  <option value="PAID">已支付</option>
                  <option value="PENDING">待支付</option>
                  <option value="CANCELLED">已关闭</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">用户</th>
                    <th className="px-5 py-3 font-medium">套餐</th>
                    <th className="px-5 py-3 font-medium">金额 / 电力</th>
                    <th className="px-5 py-3 font-medium">支付方式</th>
                    <th className="px-5 py-3 font-medium">状态</th>
                    <th className="px-5 py-3 font-medium">下单时间</th>
                    <th className="px-5 py-3 font-medium">支付时间</th>
                  </tr>
                </thead>
                <tbody>
                  {!orders || orders.list.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-12 text-center text-neutral-400">暂无充值订单</td></tr>
                  ) : orders.list.map(order => (
                    <tr key={order.id} className="border-t border-neutral-100">
                      <td className="px-5 py-3">
                        <div className="font-medium text-neutral-800">{order.user.username}</div>
                        <div className="mt-0.5 text-xs text-neutral-400">{order.user.email || order.user.phone || `ID ${order.user.id}`}</div>
                      </td>
                      <td className="px-5 py-3 text-neutral-700">
                        {order.package.name}
                        {order.package.is_one_time && <span className="ml-1 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-600">一次性</span>}
                        <div className="mt-0.5 text-xs text-neutral-400">{order.order_no}</div>
                      </td>
                      <td className="px-5 py-3"><div className="font-medium">¥{formatYuan(order.amount_cents)}</div><div className="text-xs text-neutral-400">+{order.credits_amount} 电力</div></td>
                      <td className="px-5 py-3 text-neutral-600">{payMethodLabel[order.pay_method] || order.pay_method}</td>
                      <td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusClass[order.status] || 'bg-neutral-100 text-neutral-500'}`}>{ORDER_STATUS_LABEL[order.status] || order.status}</span></td>
                      <td className="px-5 py-3 text-xs text-neutral-500">{fmtDateTime(order.created_at)}</td>
                      <td className="px-5 py-3 text-xs text-neutral-500">{fmtDateTime(order.paid_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3 text-xs text-neutral-500">
              <span>共 {orders?.total ?? 0} 笔</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button>
                <span>{page} / {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage(value => value + 1)}>下一页</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
