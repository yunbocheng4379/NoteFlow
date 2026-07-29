import GuideLayout from '../components/GuideLayout'
import GuideShot from '../components/GuideShot'
import upgradeShot from '@/assets/guide/upgrade.png'
import billingShot from '@/assets/guide/billing.png'

export default function MembershipArticle() {
  return (
    <GuideLayout slug="membership">
      <section>
        <p className="leading-7 text-neutral-600">
          NoteFlow 全站用「电力」（credits）统一计费，生成一篇笔记会按模型和视频时长消耗一定电力。
          电力永久不过期，会员订阅则是在电力之外提供额外权益。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">充值电力 vs 开通会员</h2>
        <p className="leading-7 text-neutral-600">
          「开通会员」页面分两个 Tab：<strong className="text-neutral-900">电力充值</strong>是一次性购买电力包，
          适合按需使用；<strong className="text-neutral-900">会员订阅</strong>按月/季/年计费，
          每月自动发放固定电力，并解锁高级模型、多任务并发、导出 PDF/Word/PPT、思维导图海报、
          批量转笔记、合集融合与分享等会员专属能力。
        </p>
        <GuideShot src={upgradeShot} alt="开通会员页面，电力充值与会员订阅两个 Tab" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">下单与支付</h2>
        <p className="leading-7 text-neutral-600">
          选好套餐后选择支付宝或微信扫码支付，订单会每 2 秒自动轮询状态，支付成功后自动到账并刷新余额，
          无需手动刷新页面。切换支付方式会重新下单生成新的二维码。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">账单中心</h2>
        <p className="leading-7 text-neutral-600">
          「账单」页顶部显示当前电力余额，若有生效中的会员还会显示套餐名称、到期日和剩余天数（临期会变色提醒）。
          下方分「电力流水」和「订单记录」两个 Tab：流水记录每一笔充值、消耗、退费、月度发放、注册赠送、
          邀请返利等收支明细；订单记录可以查看历史订单状态，未支付的订单还能一键重新拉起支付。
        </p>
        <GuideShot src={billingShot} alt="账单页面，展示电力余额与流水记录" />
      </section>
    </GuideLayout>
  )
}
