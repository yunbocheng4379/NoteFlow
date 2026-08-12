const { profileApi } = require('../../services/profile');
const { noteApi } = require('../../services/note');
const { clearSession } = require('../../utils/auth');
const app = getApp();

Page({
  data: { isLoggedIn: false, userInfo: null, credits: 0, totalTasks: 0, usedProviders: [], menuItems: [] },

  onShow() {
    const isLoggedIn = Boolean(wx.getStorageSync('access_token'));
    this.setData({ isLoggedIn });
    if (isLoggedIn) this.loadProfile();
    this.buildMenu(isLoggedIn);
  },

  async loadProfile() {
    try {
      const [profile, tasks] = await Promise.all([profileApi.getProfile(), noteApi.listTasks()]);
      const userInfo = { username: profile.username || 'NoteFlow 用户', email: profile.email || '', phone: profile.phone || '', avatar: profile.avatar || '' };
      const providers = [...new Set(tasks.map((task) => task.model_name).filter(Boolean))];
      const credits = Number(profile.credits || 0);
      this.setData({ userInfo, credits, totalTasks: tasks.length, usedProviders: providers });
      app.globalData.credits = credits;
      app.globalData.userInfo = userInfo;
    } catch (error) { this.setData({ userInfo: { username: 'NoteFlow 用户' } }); }
  },

  buildMenu(isLoggedIn) {
    this.setData({ menuItems: isLoggedIn ? [
      { key: 'notes', symbol: '□', title: '我的笔记', desc: '查看与管理生成记录', action: 'notes' },
      { key: 'usage', symbol: '·', title: '余额与用量', desc: '当前电力与生成统计', action: 'usage' },
      { key: 'help', symbol: '?', title: '帮助与反馈', desc: '遇到问题？告诉我们', action: 'help' },
    ] : [] });
  },

  onGoLogin() { wx.navigateTo({ url: '/pages/login/login' }); },

  onMenuTap(event) {
    const action = event.currentTarget.dataset.item.action;
    if (action === 'notes') wx.switchTab({ url: '/pages/tasks/tasks' });
    else wx.showToast({ title: action === 'usage' ? '余额功能即将开放' : '欢迎反馈你的想法', icon: 'none' });
  },

  onLogout() {
    wx.showModal({ title: '退出登录', content: '退出后仍可浏览首页，生成笔记需要重新登录。', confirmColor: '#C66B5D', success: ({ confirm }) => {
      if (!confirm) return;
      clearSession();
      this.setData({ isLoggedIn: false, userInfo: null, credits: 0, totalTasks: 0, usedProviders: [], menuItems: [] });
      wx.showToast({ title: '已退出登录', icon: 'success' });
    } });
  },

  onShareAppMessage() { return { title: 'NoteFlow · 把视频变成可复习的笔记', path: '/pages/home/home' }; },
});
