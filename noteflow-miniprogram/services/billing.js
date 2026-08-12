/**
 * NoteFlow Mini Program - Billing API Service
 *
 * Handles credits, subscription, orders, payments.
 * WeChat Pay integration via wx.requestPayment.
 */

const { request } = require('../utils/request');
const ENV = require('../.env.js');

module.exports = {
  // ===== Balance =====

  /** Get current balance and subscription status */
  getBalance: () => request({
    url: '/api/billing/balance',
    suppressToast: true,
  }),

  // ===== Pricing =====

  /** Preview cost before generating */
  pricingPreview: (params) => request({
    url: '/api/billing/pricing/preview',
    method: 'POST',
    data: params,
    suppressToast: true,
  }),

  // ===== Recharge Packages =====

  /** Get available recharge packages */
  getRechargePackages: () => request({
    url: '/api/billing/recharge/packages',
    suppressToast: true,
  }),

  /** Create a recharge order */
  createRechargeOrder: (packageId) => request({
    url: '/api/billing/order/recharge',
    method: 'POST',
    data: { package_id: packageId },
  }),

  // ===== Subscription =====

  /** Get subscription plans */
  getSubscriptionPlans: () => request({
    url: '/api/billing/subscription/plans',
    suppressToast: true,
  }),

  /** Create a subscription order */
  createSubscriptionOrder: (planId) => request({
    url: '/api/billing/order/subscription',
    method: 'POST',
    data: { plan_id: planId },
  }),

  // ===== Payment =====

  /**
   * Invoke WeChat Pay with prepay parameters from backend
   * @param {Object} payParams - { timeStamp, nonceStr, package, signType, paySign }
   * @returns {Promise<{success: boolean, reason?: string}>}
   */
  wechatPay: (payParams) => {
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: payParams.timeStamp,
        nonceStr: payParams.nonceStr,
        package: payParams.package,
        signType: payParams.signType || 'RSA',
        paySign: payParams.paySign,
        success: () => {
          resolve({ success: true });
        },
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('cancel')) {
            resolve({ success: false, reason: 'cancelled' });
          } else {
            reject({ success: false, reason: 'payment_failed', detail: err });
          }
        },
      });
    });
  },

  /** Mock payment (for testing) */
  mockPay: (orderNo) => request({
    url: '/api/billing/order/mock_pay',
    method: 'POST',
    data: { order_no: orderNo },
  }),

  // ===== Orders / Transactions =====

  /** List orders */
  listOrders: (params = {}) => request({
    url: '/api/billing/orders',
    data: params,
    suppressToast: true,
  }),

  /** List transactions */
  listTransactions: (params = {}) => request({
    url: '/api/billing/transactions',
    data: params,
    suppressToast: true,
  }),

  // ===== Referral =====

  /** Get referral info */
  getReferralInfo: () => request({
    url: '/api/billing/referral/me',
    suppressToast: true,
  }),

  /** Get invite code */
  getInviteCode: () => request({
    url: '/api/billing/referral/code',
    suppressToast: true,
  }),
};
