import { useEffect, useState } from 'react'
import { Copy, Gift, Zap, Users, TrendingUp, CheckCircle2, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { billingApi, InvitedUser, Paginated, ReferralStats } from '@/services/billing'

const ReferralPage = () => {
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [invited, setInvited] = useState<Paginated<InvitedUser> | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    billingApi.referralMe().then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    billingApi.referralInvited(page, 20).then(setInvited).catch(() => {})
  }, [page])

  const shareLink = stats?.referral_code
    ? `${window.location.origin}/login?invite=${stats.referral_code}`
    : ''

  const copy = async (text: string, msg: string) => {
    if (!text) {
      toast.error('还未生成推荐码')
      return
    }
    // 优先走现代 Clipboard API (只有 HTTPS 或 localhost 可用)
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard.writeText(text)
        toast.success(msg)
        return
      } catch {
        // 落到 fallback
      }
    }
    // Fallback: 局域网 / HTTP 场景, 用旧版 execCommand
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '0'
      ta.style.left = '0'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (ok) {
        toast.success(msg)
      } else {
        toast.error('复制失败, 请手动选中复制')
      }
    } catch {
      toast.error('复制失败, 请手动选中复制')
    }
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#f5f5f5]">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-2 flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">我的推荐码</h1>
        </div>
        <p className="mb-6 text-sm text-neutral-500">
          复制邀请链接发给朋友，好友注册后双方都会获得电力奖励。
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 左侧主卡片 */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-500 p-6 text-white shadow-lg lg:col-span-2">
            <div className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-0.5 text-[11px] font-bold shadow">
              <Sparkles className="h-3 w-3" />
              专属邀请
            </div>

            <div className="mb-2 text-xl font-bold">分享 NoteFlow Pro，一起获得更多 AI Credits</div>
            <div className="mb-6 text-sm text-white/80">
              好友通过你的链接注册后，好友获得 <b className="font-semibold text-white">200 电力</b>，
              你获得 <b className="font-semibold text-white">20 电力</b> 返利。
            </div>

            <div className="mb-4">
              <div className="mb-1 text-xs text-white/70">你的邀请码</div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-white/15 px-4 py-2 font-mono text-2xl font-bold tracking-widest text-white backdrop-blur">
                  {stats?.referral_code || '……'}
                </span>
                <button
                  onClick={() => stats?.referral_code && copy(stats.referral_code, '推荐码已复制')}
                  className="rounded-lg bg-white/15 p-2 backdrop-blur transition hover:bg-white/25"
                  title="复制推荐码"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mb-2">
              <div className="mb-1 text-xs text-white/70">邀请链接</div>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={shareLink}
                  className="flex-1 rounded-lg bg-white/15 px-3 py-2 font-mono text-xs text-white backdrop-blur outline-none"
                />
                <button
                  onClick={() => copy(shareLink, '邀请链接已复制')}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-teal-600 transition hover:bg-neutral-100"
                >
                  <Copy className="mr-1 inline h-3 w-3" />
                  复制
                </button>
              </div>
              <div className="mt-2 text-xs text-white/70">
                微信、朋友圈、微博、社群都可以直接发送这个链接。
              </div>
            </div>

            <div className="mt-6 flex items-center gap-4 border-t border-white/20 pt-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-white/70" />
                <span className="text-sm">
                  <b className="text-lg font-bold">{stats?.invited_count ?? 0}</b> 人 已邀请
                </span>
              </div>
              <div className="h-4 w-px bg-white/20" />
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-white/70" />
                <span className="text-sm">
                  <b className="text-lg font-bold">{stats?.total_rewards_credits ?? 0}</b> 电力 累计获得
                </span>
              </div>
            </div>
          </div>

          {/* 右侧奖励规则 */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="mb-4 text-sm font-semibold text-neutral-800">奖励规则</div>
            <ul className="space-y-3 text-sm">
              <RuleItem label="好友注册获得" value={200} />
              <RuleItem label="普通注册奖励" value={100} muted />
              <RuleItem label="Pro 邀请加成" value={100} orange />
              <RuleItem label="你的返利" value={20} suffix="/人" />
            </ul>
          </div>
        </div>

        {/* 邀请记录 + 分享建议 */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-2">
            <div className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-800">
              邀请记录
            </div>
            <InvitedList invited={invited} page={page} onPageChange={setPage} />
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-neutral-800">分享建议</div>
            <ol className="space-y-3 text-xs text-neutral-600">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                  1
                </span>
                <span>优先复制邀请链接，好友点开后会自动带上邀请码。</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                  2
                </span>
                <span>可以附上一句说明：注册即可多拿 100 电力。</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                  3
                </span>
                <span>邀请记录按注册时间更新，复制链接不会消耗次数。</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

const RuleItem = ({
  label,
  value,
  suffix,
  muted,
  orange,
}: {
  label: string
  value: number
  suffix?: string
  muted?: boolean
  orange?: boolean
}) => (
  <li className="flex items-center justify-between">
    <span className={muted ? 'text-neutral-500' : 'text-neutral-700'}>{label}</span>
    <span
      className={`inline-flex items-center gap-1 font-mono font-semibold ${
        orange ? 'text-orange-500' : muted ? 'text-neutral-500' : 'text-teal-600'
      }`}
    >
      <Zap className={`h-3.5 w-3.5 ${orange ? 'text-orange-400' : 'fill-yellow-400 text-yellow-500'}`} />
      {orange ? '+' : ''}
      {value}
      {suffix || ''}
    </span>
  </li>
)

const InvitedList = ({
  invited,
  page,
  onPageChange,
}: {
  invited: Paginated<InvitedUser> | null
  page: number
  onPageChange: (p: number) => void
}) => {
  if (!invited || invited.list.length === 0) {
    return <div className="py-12 text-center text-sm text-neutral-500">还没有邀请记录, 快去分享吧</div>
  }
  const totalPages = Math.max(1, Math.ceil(invited.total / invited.page_size))
  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50">
          <tr className="text-left text-xs text-neutral-500">
            <th className="px-4 py-2.5 font-medium">被推荐人</th>
            <th className="px-4 py-2.5 text-right font-medium">我的返利</th>
            <th className="px-4 py-2.5 font-medium">注册时间</th>
            <th className="px-4 py-2.5 font-medium">首订阅</th>
          </tr>
        </thead>
        <tbody>
          {invited.list.map((u) => (
            <tr key={u.invitee_id} className="border-t border-neutral-100 hover:bg-neutral-50">
              <td className="px-4 py-3 text-xs text-neutral-700">{u.invitee_masked}</td>
              <td className="px-4 py-3 text-right font-mono font-semibold text-teal-600">
                <Zap className="mr-0.5 inline h-3 w-3 fill-yellow-400 text-yellow-500" />
                {u.reward_credits}
              </td>
              <td className="px-4 py-3 text-xs text-neutral-500">
                {new Date(u.registered_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-xs">
                {u.has_first_subscription ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    已订阅
                  </span>
                ) : (
                  <span className="text-neutral-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
          <span>
            共 {invited.total} 条 · 第 {page} / {totalPages} 页
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
      )}
    </>
  )
}

export default ReferralPage
