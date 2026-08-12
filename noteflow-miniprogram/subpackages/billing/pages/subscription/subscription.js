/**
 * 会员订阅页面
 *
 * 展示订阅方案（月/季/年），含权益对比。
 * 支持微信支付订阅。
 */
const billingService = require('../../../services/billing');

const PLANS = [
  {
    id: 'monthly',
    name: '月度会员',
    price: 19.9,
    originalPrice: 29.9,
    period: '月',
    badge: '',
    features: ['每月 500 积分', '无限笔记生成', '知识库问答', '闪记卡功能'],
  },
  {
    id: 'quarterly',
    name: '季度会员',
    price: 49.9,
    originalPrice: 89.7,
    period: '季',
    badge: '热门',
    features: ['每月 800 积分', '无限笔记生成', '知识库问答', '闪记卡功能', '优先客服'],
  },
  {
    id: 'yearly',
    name: '年度会员',
    price: 149,
    originalPrice: 358.8,
    period: '年',
    badge: '最划算',
    features: ['每月 1200 积分', '无限笔记生成', '知识库问答', '闪记卡功能', '优先客服', '专属模型'],
  },
];

Page({
  data: {
    plans: PLANS,
    selectedIdx: 2,
    loading: false,
    hasSubscription: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({ hasSubscription: !!(app.globalData.activeSubscription) });
  },

  onSelectPlan(e) {
    this.setData({ selectedIdx: Number(e.currentTarget.dataset.idx) });
  },

  async onSubscribe() {
    if (this.data.loading) return;

    const plan = this.data.plans[this.data.selectedIdx];
    this.setData({ loading: true });

    try {
      // 1. 创建订阅订单
      const result = await billingService.createSubscription({
        plan_id: plan.id,
        amount: plan.price,
      });

      if (!result.prepay) {
        throw new Error('获取支付参数失败');
      }

      // 2. 调起微信支付
      const payResult = await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: result.prepay.timeStamp,
          nonceStr: result.prepay.nonceStr,
          package: result.prepay.package,
          signType: result.prepay.signType || 'RSA',
          paySign: result.prepay.paySign,
          success: (res) => resolve(res),
          fail: (err) => {
            if (err.errMsg.includes('cancel')) {
              resolve({ cancelled: true });
            } else {
              reject(err);
            }
          },
        });
      });

      if (payResult.cancelled) {
        wx.showToast({ title: '已取消', icon: 'none' });
        return;
      }

      wx.showToast({ title: '订阅成功！', icon: 'success' });
      this.setData({ hasSubscription: true });

      // 更新全局会员状态
      const app = getApp();
      app.globalData.activeSubscription = plan;

      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 1500);
    } catch (err) {
      console.error('[Subscription] Failed:', err);
      wx.showToast({ title: err.message || '订阅失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onShareAppMessage() {
    return {
      title: 'NoteFlow Pro — AI 笔记会员',
      path: '/pages/home/home',
    };
  },
});
