const { completePcLogin } = require('../../services/auth');

function normalizeScene(scene) {
  const value = String(scene || '');
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canSubmitPcLogin(state) {
  return Boolean(String(state || '').trim());
}

function errorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  if (error && typeof error.msg === 'string' && error.msg) return error.msg;
  return '确认登录失败，请重试';
}

if (typeof Page === 'function') {
  Page({
    data: {
      state: '',
      status: 'idle',
      loading: false,
      error: '',
    },

    onLoad(options) {
      const state = normalizeScene(options && options.scene);
      if (!canSubmitPcLogin(state)) {
        this.setData({ status: 'invalid', error: '二维码无效或已过期，请返回 PC 端重新扫码' });
        return;
      }
      this.setData({ state, status: 'ready', error: '' });
    },

    async onConfirm() {
      if (this.data.loading || !canSubmitPcLogin(this.data.state)) return;
      this.setData({ loading: true, status: 'submitting', error: '' });

      try {
        const loginResult = await new Promise((resolve, reject) => {
          wx.login({
            success: resolve,
            fail: reject,
          });
        });
        if (!loginResult || !loginResult.code) {
          throw new Error('获取微信登录凭证失败');
        }
        await completePcLogin(this.data.state, loginResult.code);
        this.setData({ loading: false, status: 'success', error: '' });
      } catch (error) {
        this.setData({ loading: false, status: 'ready', error: errorMessage(error) });
      }
    },

    onRetry() {
      if (this.data.loading) return;
      this.setData({ error: '', status: canSubmitPcLogin(this.data.state) ? 'ready' : 'invalid' });
    },

    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/home/home' });
      }
    },
  });
}

module.exports = { normalizeScene, canSubmitPcLogin };
