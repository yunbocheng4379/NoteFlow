/**
 * 订单记录页面
 *
 * 展示用户的充值/订阅订单列表。支持分页加载、下拉刷新。
 */
const billingService = require('../../../services/billing');
const { formatRelativeTime } = require('../../../utils/format');

const STATUS_MAP = {
  'pending': { label: '待支付', color: '#FFC300' },
  'paid': { label: '已支付', color: '#07C160' },
  'cancelled': { label: '已取消', color: '#999' },
  'refunded': { label: '已退款', color: '#FA5151' },
  'completed': { label: '已完成', color: '#07C160' },
};

Page({
  data: {
    orders: [],
    loading: false,
    page: 1,
    hasMore: true,
    statusMap: STATUS_MAP,
  },

  onLoad() {
    this.loadOrders(true);
  },

  onPullDownRefresh() {
    this.loadOrders(true).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadOrders(false);
  },

  async loadOrders(reset) {
    if (this.data.loading) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;

    try {
      const result = await billingService.getOrders({ page, page_size: 20 });
      const orders = (result.orders || result.data || []).map((o) => ({
        ...o,
        _time: formatRelativeTime(o.created_at),
        _status: STATUS_MAP[o.status] || { label: o.status, color: '#999' },
        _amount: o.amount ? `¥${Number(o.amount).toFixed(2)}` : '--',
      }));

      this.setData({
        orders: reset ? orders : [...this.data.orders, ...orders],
        page: reset ? 2 : page + 1,
        hasMore: orders.length >= 20,
        loading: false,
      });
    } catch (err) {
      console.error('[Orders] Load failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onTapOrder(e) {
    const { id } = e.currentTarget.dataset;
    // 仅展示，不做跳转
    wx.showToast({ title: `订单 ${id}`, icon: 'none' });
  },
});
