/**
 * 积分充值页面
 *
 * 展示积分套餐列表，支持微信支付购买积分。
 * 包含套餐选择、金额计算、支付流程。
 */
const billingService = require('../../../services/billing');
const { showToast, showLoading, hideLoading } = require('../../../utils/request');

// 积分套餐
const CREDIT_PACKAGES = [
  { id: 'basic', name: '基础包', credits: 100, price: 9.9, badge: '' },
  { id: 'popular', name: '热门包', credits: 500, price: 39.9, badge: '推荐' },
  { id: 'pro', name: '专业包', credits: 1200, price: 79.9, badge: '超值' },
  { id: 'max', name: '旗舰包', credits: 3000, price: 169.9, badge: '最划算' },
];

Page({
  data: {
    packages: CREDIT_PACKAGES,
    selectedIdx: 1,
    loading: false,
    credits: 0,
  },

  onLoad() {
    const app = getApp();
    this.setData({ credits: app.globalData.credits || 0 });
  },

  onShow() {
    const app = getApp();
    this.setData({ credits: app.globalData.credits || 0 });
  },

  /** 选择套餐 */
  onSelectPackage(e) {
    const { idx } = e.currentTarget.dataset;
    this.setData({ selectedIdx: Number(idx) });
  },

  /** 发起微信支付 */
  async onPurchase() {
    if (this.data.loading) return;

    const pkg = this.data.packages[this.data.selectedIdx];
    this.setData({ loading: true });

    try {
      // 1. 调用后端创建充值订单，获取预支付参数
      const result = await billingService.rechargeCredits({
        package_id: pkg.id,
        credits: pkg.credits,
        amount: pkg.price,
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
        wx.showToast({ title: '已取消支付', icon: 'none' });
        return;
      }

      // 3. 支付成功，刷新积分余额
      wx.showToast({ title: `获得 ${pkg.credits} 积分！`, icon: 'success' });

      const app = getApp();
      app.globalData.credits = (app.globalData.credits || 0) + pkg.credits;
      this.setData({ credits: app.globalData.credits });

      // 延迟跳转回个人页
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }, 1500);
    } catch (err) {
      console.error('[Recharge] Purchase failed:', err);
      wx.showToast({ title: err.message || '支付失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onShareAppMessage() {
    return {
      title: 'NoteFlow AI 笔记助手 — 高效记笔记',
      path: '/pages/home/home',
    };
  },
});
