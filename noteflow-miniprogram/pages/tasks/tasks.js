const { noteApi } = require('../../services/note');
const pollingManager = require('../../utils/task-polling');

Page({
  data: {
    tasks: [],
    filteredTasks: [],
    filter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'processing', label: '生成中' },
      { key: 'success', label: '已完成' },
      { key: 'failed', label: '失败' },
    ],
    loading: true,
    loadError: '',
    isLoggedIn: false,
  },

  onShow() {
    const isLoggedIn = Boolean(wx.getStorageSync('access_token'));
    this.setData({ isLoggedIn });
    if (isLoggedIn) this.loadTasks();
  },

  onHide() {
    this.stopPagePolling();
  },

  onUnload() {
    this.stopPagePolling();
  },

  onPullDownRefresh() {
    this.loadTasks().finally(() => wx.stopPullDownRefresh());
  },

  async loadTasks() {
    if (!this.data.isLoggedIn) return;
    this.setData({ loading: true, loadError: '' });
    try {
      const tasks = await noteApi.listTasks();
      this.setData({ tasks, loading: false });
      this.applyFilter();
      this.startPagePolling(tasks);
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '笔记加载失败，请重试' });
    }
  },

  onRetry() {
    this.loadTasks();
  },

  onFilterChange(event) {
    this.setData({ filter: event.currentTarget.dataset.filter }, () => this.applyFilter());
  },

  applyFilter() {
    const { tasks, filter } = this.data;
    this.setData({ filteredTasks: filter === 'all' ? tasks : tasks.filter((task) => task.status === filter) });
  },

  startPagePolling(tasks) {
    this.stopPagePolling();
    tasks.filter((task) => !task.terminal).forEach((task) => {
      pollingManager.start(task.id, (result) => {
        const nextTasks = this.data.tasks.map((item) => {
          if (item.id !== task.id) return item;
          const updated = { ...item, status: result?.status || item.status, message: result?.message || item.message };
          return require('../../utils/contracts').normalizeTask(updated);
        });
        this.setData({ tasks: nextTasks });
        this.applyFilter();
      });
    });
  },

  stopPagePolling() {
    this.data.tasks.filter((task) => !task.terminal).forEach((task) => pollingManager.stop(task.id));
  },

  onTaskTap(event) {
    const task = event.detail.task;
    if (!task) return;
    if (task.status === 'success') {
      wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${task.id}` });
    } else if (task.status === 'failed') {
      wx.showToast({ title: task.message || '这份笔记生成失败', icon: 'none' });
    } else {
      wx.showToast({ title: task.statusLabel || '笔记正在生成中', icon: 'none' });
    }
  },

  onTaskLongPress(event) {
    const task = event.detail.task;
    wx.showActionSheet({
      itemList: ['删除笔记'],
      itemColor: '#C66B5D',
      success: async ({ tapIndex }) => {
        if (tapIndex !== 0) return;
        try {
          await noteApi.deleteTask(task.id);
          this.setData({ tasks: this.data.tasks.filter((item) => item.id !== task.id) });
          this.applyFilter();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' });
        }
      },
    });
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  onGoLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onShareAppMessage() {
    return { title: '我的笔记 · NoteFlow', path: '/pages/tasks/tasks' };
  },
});
