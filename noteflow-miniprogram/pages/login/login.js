const { wechatLogin, emailLogin } = require('../../utils/auth');

Page({
  data: { account: '', password: '', loading: false, error: '', fallbackVisible: false },

  onShow() {
    if (wx.getStorageSync('access_token')) wx.switchTab({ url: '/pages/home/home' });
  },

  onAccountInput(event) { this.setData({ account: event.detail.value, error: '' }); },
  onPasswordInput(event) { this.setData({ password: event.detail.value, error: '' }); },
  onShowFallback() { this.setData({ fallbackVisible: true, error: '' }); },

  async onWechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try { await wechatLogin(); this.finishLogin(); }
    catch (error) { this.setData({ loading: false, error: error.message || '微信登录失败，请改用账号登录' }); }
  },

  async onAccountLogin() {
    const account = this.data.account.trim();
    const password = this.data.password;
    if (!account) { this.setData({ error: '请输入邮箱、用户名或手机号' }); return; }
    if (!password) { this.setData({ error: '请输入密码' }); return; }
    this.setData({ loading: true, error: '' });
    try { await emailLogin(account, password); this.finishLogin(); }
    catch (error) { this.setData({ loading: false, error: error.message || '登录失败，请检查账号和密码' }); }
  },

  finishLogin() {
    this.setData({ loading: false });
    wx.showToast({ title: '欢迎回来', icon: 'success', duration: 900 });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/home/home' });
    }, 900);
  },
});
