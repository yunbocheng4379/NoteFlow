import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Zap, Check, Sparkles, Download, HelpCircle, Infinity as InfIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  billingApi,
  formatYuan,
  Order,
  RechargePackage,
  SubscriptionPlan,
} from '@/services/billing'
import { Button } from '@/components/ui/button'
import PayDialog from './PayDialog'

type Tab = 'recharge' | 'subscription'

const UpgradePage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: Tab = searchParams.get('tab') === 'recharge' ? 'recharge' : 'subscription'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [packages, setPackages] = useState<RechargePackage[]>([])
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [payingOrder, setPayingOrder] = useState<Order | null>(null)

  // URL ?tab= 变化时同步切换 (支持从账单页带参跳转 / 浏览器前进后退)
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'recharge' || t === 'subscription') {
      setTab(t)
    }
  }, [searchParams])

  const switchTab = (t: Tab) => {
    setTab(t)
    setSearchParams({ tab: t }, { replace: true })
  }

  useEffect(() => {
    Promise.all([billingApi.rechargePackages(), billingApi.subscriptionPlans()])
      .then(([pkgs, pls]) => {
        setPackages(pkgs)
        setPlans(pls)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const showFirstSubHint = useMemo(() => plans.some((p) => p.is_first_subscription), [plans])

  const handleBuyRecharge = async (pkg: RechargePackage) => {
    try {
      const order = await billingApi.createRechargeOrder(pkg.id, 'MOCK_ALIPAY')
      setPayingOrder(order)
    } catch (e: any) {
      toast.error(e?.msg || '下单失败')
    }
  }

  const handleBuySubscription = async (plan: SubscriptionPlan) => {
    try {
      const order = await billingApi.createSubscriptionOrder(plan.id, 'MOCK_ALIPAY')
      setPayingOrder(order)
    } catch (e: any) {
      toast.error(e?.msg || '下单失败')
    }
  }

  return (
    <div className="theme-pro relative min-h-full w-full overflow-auto bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* 顶部 brand chip + 标题 */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-1.5 text-xs font-bold tracking-wider text-white shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            BILINOTE PRO
          </div>
          <h1 className="mt-4 text-3xl font-bold text-neutral-900">选择适合您的方案</h1>
          <p className="mt-2 text-sm text-neutral-500">
            全平台视频转笔记 · 支持 GPT-4o / Claude / Gemini · 一键导出 PDF / Word / 图片 / PPT
          </p>

          {showFirstSubHint && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-xs text-orange-600 ring-1 ring-orange-200">
              🎉 新人首单 · 年度会员首期立省 ¥31
            </div>
          )}
        </div>

        {/* Tab 切换 */}
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-xl bg-neutral-100 p-1">
            <button
              onClick={() => switchTab('recharge')}
              className={`rounded-lg px-6 py-2 text-sm font-medium transition ${
                tab === 'recharge'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              电力充值
            </button>
            <button
              onClick={() => switchTab('subscription')}
              className={`rounded-lg px-6 py-2 text-sm font-medium transition ${
                tab === 'subscription'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              会员订阅
            </button>
          </div>
        </div>

        {loading && (
          <div className="py-16 text-center text-sm text-neutral-500">加载中…</div>
        )}

        {!loading && tab === 'recharge' && (
          <RechargeTab packages={packages} onBuy={handleBuyRecharge} />
        )}
        {!loading && tab === 'subscription' && (
          <SubscriptionTab plans={plans} onBuy={handleBuySubscription} />
        )}

        {/* FAQ */}
        <FAQ />

        {/* 底部提示 */}
        <div className="mt-8 border-t border-neutral-200 pt-6 text-center text-xs text-neutral-400">
          所有支付通过支付宝官方渠道处理，不存储您的支付信息。电力到账后不支持退款，请按需购买。
        </div>
      </div>

      <PayDialog order={payingOrder} onClose={() => setPayingOrder(null)} />

      {/* 蓝色主题覆盖 */}
      <style>{`
        .theme-pro { --pro-primary: #2563eb; }
      `}</style>
    </div>
  )
}

// ============================================================================
// 电力充值 Tab
// ============================================================================
const RechargeTab = ({
  packages,
  onBuy,
}: {
  packages: RechargePackage[]
  onBuy: (pkg: RechargePackage) => void
}) => {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {packages.map((pkg) => {
        const isFeatured = pkg.badge === '最受欢迎'
        return (
          <div
            key={pkg.id}
            className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
              isFeatured ? 'border-blue-500 ring-1 ring-blue-500/40' : 'border-neutral-200'
            }`}
          >
            {pkg.badge && (
              <div className="absolute -top-3 right-4 rounded-full bg-gradient-to-r from-orange-500 to-orange-400 px-3 py-0.5 text-[11px] font-bold text-white shadow-sm">
                {pkg.badge}
              </div>
            )}

            <div className="mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 fill-yellow-400 text-yellow-500" />
              <span className="text-2xl font-bold text-neutral-900">{pkg.credits}</span>
              <span className="text-sm text-neutral-500">电力</span>
            </div>

            <div className="mb-1 text-sm text-neutral-500">{pkg.name}</div>
            <div className="mb-1 text-4xl font-bold text-neutral-900">¥{formatYuan(pkg.price_cents)}</div>
            {pkg.description && (
              <div className="mb-2 text-xs text-neutral-500">{pkg.description}</div>
            )}
            {pkg.unit_price_text && (
              <div className="mb-4 text-xs text-neutral-400">{pkg.unit_price_text}</div>
            )}

            <div className="mb-6 flex items-center gap-1 text-xs text-neutral-500">
              <InfIcon className="h-3 w-3" />
              电力永久有效
            </div>

            <Button
              onClick={() => onBuy(pkg)}
              className={`mt-auto w-full ${
                isFeatured
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white'
                  : 'bg-white text-blue-600 ring-1 ring-blue-500/50 hover:bg-blue-50'
              }`}
            >
              立即购买 ¥{formatYuan(pkg.price_cents)}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// 会员订阅 Tab
// ============================================================================
const SUB_BENEFITS = [
  '高级 AI 模型解锁 (GPT-4o / Claude)',
  '同时处理 3 个并发任务',
  '导出 PDF / Word / 图片 / PPT',
  '总结海报 / 思维导图',
  '专属会员标识 + 客服优先响应',
]

const EXCLUSIVE_FEATURES: Array<{
  icon: string
  label: string
  desc: string
  tag?: string
}> = [
  {
    icon: '/recharge_icon/model.png',
    label: '更强模型',
    desc: 'GPT-4o · Claude Sonnet · Gemini Pro, 一键切换最适合当前内容的模型',
  },
  {
    icon: '/recharge_icon/fast.png',
    label: '更高效率',
    desc: '长视频自动分块 + 3 个并发任务齐跑, 1 小时视频几分钟出结构化笔记',
  },
  {
    icon: '/recharge_icon/point.png',
    label: '多格式导出',
    desc: 'Markdown / PDF / Word / 图片 / PPT / 思维导图 / 海报, 直接交付不用二次加工',
  },
  {
    icon: '/recharge_icon/synthesis.png',
    label: '优先生成',
    desc: '独立 VIP 通道, 高峰期无需排队, 提交即开始转写',
  },
  {
    icon: '/recharge_icon/priority.png',
    label: '批量转笔记',
    desc: '粘贴 B 站合集 / 收藏夹 / UP 主链接, 一次最多 100 个视频并行处理, 失败自动按条退电力',
    tag: 'NEW',
  },
  {
    icon: '/recharge_icon/batch.png',
    label: '合集融合',
    desc: '把整套合集 N 篇笔记 AI 合并为一份大纲 / 知识图谱 / 精华摘要, 每月 5-15 次免费名额',
    tag: 'NEW',
  },
  {
    icon: '/recharge_icon/share.png',
    label: '合集分享+ZIP',
    desc: '合集一键生成公开链接 /s/xxx 发给朋友, 或打包 ZIP 离线带走 (.md + meta.json)',
    tag: 'NEW',
  },
  {
    icon: '/recharge_icon/ask.png',
    label: '电力永久有效',
    desc: '订阅或充值得到的电力, 从不过期不扣减, 按需消耗',
  },
  {
    icon: '/recharge_icon/service.png',
    label: '专属服务',
    desc: '会员标识 + 客服 1v1 优先响应, 问题反馈直达开发团队',
  },
]

const SubscriptionTab = ({
  plans,
  onBuy,
}: {
  plans: SubscriptionPlan[]
  onBuy: (plan: SubscriptionPlan) => void
}) => {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const isFeatured = !!plan.badge
          const durationLabel =
            plan.duration_days === 30 ? '/月' : plan.duration_days === 90 ? '/季' : '/年'
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                isFeatured ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-neutral-200'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-orange-500 to-orange-400 px-3 py-0.5 text-[11px] font-bold text-white shadow-sm whitespace-nowrap">
                  {plan.badge}
                </div>
              )}

              <div className="mb-2 text-sm font-medium text-neutral-800">{plan.name}</div>

              {plan.original_price_cents && (
                <div className="text-xs text-neutral-400 line-through">
                  原价 ¥{formatYuan(plan.original_price_cents)}
                </div>
              )}

              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-neutral-900">
                  ¥{formatYuan(plan.current_price_cents)}
                </span>
                <span className="text-sm text-neutral-500">{durationLabel}</span>
              </div>

              {plan.is_first_subscription && (
                <div className="mb-3 flex items-center gap-1.5">
                  <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">
                    新人首单
                  </span>
                  <span className="text-xs text-neutral-500">
                    续费 ¥{formatYuan(plan.renewal_price_cents)}
                    {durationLabel}
                  </span>
                </div>
              )}

              <div className="mt-1 mb-1 flex items-center gap-2 text-sm text-neutral-700">
                <Zap className="h-4 w-4 fill-yellow-400 text-yellow-500" />
                <span className="font-semibold">{plan.monthly_credits}</span>
                <span className="text-neutral-500">电力 / 月</span>
              </div>
              {plan.description && (
                <div className="mb-4 text-xs text-neutral-500">{plan.description}</div>
              )}

              <ul className="mb-6 space-y-2 text-sm">
                {SUB_BENEFITS.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-neutral-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => onBuy(plan)}
                className={`mt-auto w-full ${
                  isFeatured
                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white'
                    : 'bg-white text-blue-600 ring-1 ring-blue-500/50 hover:bg-blue-50'
                }`}
              >
                立即订阅 ¥{formatYuan(plan.current_price_cents)}
              </Button>

              <div className="mt-2 text-center text-xs text-neutral-400">
                开通即得 {plan.monthly_credits} 电力
              </div>
            </div>
          )
        })}
      </div>

      {/* 会员独享 */}
      <div className="mt-16 rounded-2xl border border-neutral-200 bg-gradient-to-b from-white to-blue-50/30 p-8">
        <div className="mb-6 text-center">
          <div className="mb-1 text-xs uppercase tracking-wider text-blue-600">EXCLUSIVE</div>
          <div className="text-2xl font-bold text-neutral-900">不止多了功能 · 是少了等待</div>
          <div className="mt-1 text-sm text-neutral-500">会员独享 9 项高效特权</div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXCLUSIVE_FEATURES.map(({ icon, label, desc, tag }) => (
            <div
              key={label}
              className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm"
            >
              <img src={icon} alt={label} className="h-20 w-20 shrink-0 object-contain" />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                  {label}
                  {tag && (
                    <span className="rounded bg-red-500 px-1 py-0.5 text-[9px] font-bold text-white">
                      {tag}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-neutral-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ============================================================================
// FAQ
// ============================================================================
const FAQ_ITEMS: Array<[string, string]> = [
  [
    '一篇笔记消耗多少电力？',
    '按视频时长阶梯计费, 公式: 模型基准价 × 时长档位。档位: ≤30 分钟 1×、≤1 小时 2×、≤2 小时 4×、≤4 小时 8×、≤6 小时 12×。例: GPT-4o (基准 20 电力) 生成 30 分钟视频扣 20、1 小时扣 40、2 小时扣 80、4 小时扣 160、6 小时扣 240。基础模型基准价 20、高级模型 30-40, 模型卡片悬浮 ⓘ 看完整档位表。',
  ],
  [
    '为什么开「视频理解」更贵？',
    '视频理解 (VU) 需要抽关键帧 + 多模态模型分析画面, 长视频帧更多、成本更高, 所以加价也跟时长档位走 — 30 分钟视频开 VU 多 10 电力, 3 小时课程开 VU 多 80 电力。VU 是 VIP 功能, 基准 +10 电力 / 30 分钟。',
  ],
  [
    '为什么长视频贵这么多？',
    '长视频涉及的算力是线性增长的: ①Whisper / Groq 全程转写按音频时长收费; ②抽关键帧 + GPU 处理量随时长成正比; ③大模型按 token 量分段推理, 内容越长 token 越多。一篇 30 分钟视频通常 1-3 分钟出结果, 4 小时课程需要独占 1 个 worker 15-30 分钟。按时长计费让短视频用户不为长视频用户买单, 长视频用户付出对应的算力成本。',
  ],
  [
    '可以上传超过 6 小时的视频吗？',
    '目前单视频上限 6 小时, 超过会在提交时被拒绝。原因: 超长视频对 worker 算力占用极大, 且单次任务越长越容易失败重跑。建议超长视频在源站分集或本地剪切后再上传。上限可由管理员通过系统配置调整。',
  ],
  [
    '为什么提交后实际扣的电力跟提交前显示的不一样？',
    '提交前按视频源站返回的时长「预估」, worker 真正下载视频后会拿到精确时长重新结算 —— 更短就退差额到余额, 更长就补扣; 余额不够也不会让任务失败, 系统接受小亏。所以 footer 显示的是预估, 任务详情页看到的是真实扣费。',
  ],
  [
    '电力会过期吗？',
    '不会。充值或订阅获得的电力永久有效, 不设过期时间。',
  ],
  [
    '订阅和充值有什么区别？',
    '充值是一次性购买电力; 订阅是按月 / 年付费, 每月自动发放电力, 且解锁高级模型 / PDF / Word / PPT / 海报等高级功能, 长期使用更划算。',
  ],
  [
    '支付失败怎么办？',
    '支付失败不会扣款, 请检查网络后重试。如有疑问请联系客服。',
  ],
  [
    '可以退款吗？',
    '电力到账后不支持退款, 请按实际需求购买。如遇系统问题导致电力未到账, 请联系客服处理。',
  ],
]

const FAQ = () => (
  <div className="mt-16">
    <h2 className="mb-6 text-center text-xl font-bold text-neutral-900">常见问题</h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {FAQ_ITEMS.map(([q, a]) => (
        <div key={q} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-sm font-semibold text-neutral-800">{q}</div>
            <div className="text-xs leading-relaxed text-neutral-500">{a}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
)

export default UpgradePage
