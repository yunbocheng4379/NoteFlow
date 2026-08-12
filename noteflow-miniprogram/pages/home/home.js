const { parseUrl } = require('../../utils/platform-detector');
const { noteApi } = require('../../services/note');
const { modelApi } = require('../../services/model');
const { profileApi } = require('../../services/profile');
const pollingManager = require('../../utils/task-polling');
const { mapTaskStatus } = require('../../utils/contracts');
const app = getApp();

Page({
  data: {
    videoUrl: '', urlParsed: false, urlLoading: false, urlError: '', videoInfo: null,
    providers: [], models: [], styles: [], selectedProvider: null, selectedModel: null, selectedStyle: null,
    modelSelectorVisible: false, recentTasks: [], recentLoading: false, submitting: false,
    pendingTaskId: '', pendingTaskStatus: 'pending', pendingTaskLabel: '排队中', taskProgress: 12,
    credits: 0, isLoggedIn: false,
  },

  onLoad() { this.loadConfig(); },

  onShow() {
    const token = wx.getStorageSync('access_token');
    this.setData({ isLoggedIn: Boolean(token || app.globalData.isLoggedIn), credits: app.globalData.credits || 0 });
    this.loadRecentTasks();
    if (token) this.refreshCredits();
  },

  onUnload() {
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (this.data.pendingTaskId) pollingManager.stop(this.data.pendingTaskId);
  },

  async loadConfig() {
    try {
      const [providersResult, stylesResult] = await Promise.all([modelApi.getProviders(), modelApi.getNoteStyles()]);
      const providers = Array.isArray(providersResult) ? providersResult : [];
      const styles = Array.isArray(stylesResult) ? stylesResult : [];
      const selectedProvider = providers[0] || null;
      const models = selectedProvider ? await modelApi.getModels(selectedProvider.id) : [];
      this.setData({ providers, models: Array.isArray(models) ? models : [], styles, selectedProvider, selectedModel: models?.[0] || null, selectedStyle: styles[0] || null });
    } catch (error) {
      this.setData({ urlError: error.message || '配置加载失败，请稍后重试' });
    }
  },

  async loadRecentTasks() {
    if (!wx.getStorageSync('access_token')) return;
    this.setData({ recentLoading: true });
    try {
      const tasks = await noteApi.listTasks();
      this.setData({ recentTasks: tasks.slice(0, 3), recentLoading: false });
    } catch { this.setData({ recentLoading: false }); }
  },

  async refreshCredits() {
    try {
      const profile = await profileApi.getProfile();
      const credits = Number(profile?.credits || 0);
      this.setData({ credits });
      app.globalData.credits = credits;
    } catch { /* Profile is secondary to the generation flow. */ }
  },

  onUrlInput(event) {
    const videoUrl = event.detail.value;
    this.setData({ videoUrl, urlParsed: false, urlError: '', videoInfo: null });
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (videoUrl.trim().length >= 5) this._parseTimer = setTimeout(() => this.parseVideoUrl(), 600);
  },

  async parseVideoUrl() {
    const videoUrl = this.data.videoUrl.trim();
    const platform = parseUrl(videoUrl);
    if (!platform) {
      this.setData({ urlParsed: false, urlLoading: false, urlError: '暂不支持这个链接，请粘贴 B站、YouTube、抖音或快手视频' });
      return;
    }
    this.setData({ urlLoading: true, urlError: '' });
    try {
      const result = await noteApi.getVideoInfo(videoUrl);
      this.setData({ urlParsed: true, urlLoading: false, videoInfo: { title: result?.title || '未命名视频', cover_url: result?.cover_url || result?.thumbnail || '', duration: result?.duration || 0, platform, description: result?.description || '' } });
    } catch (error) { this.setData({ urlLoading: false, urlError: error.message || '视频信息获取失败，请重试' }); }
  },

  onRetryParse() { this.parseVideoUrl(); },
  onClearUrl() { this.setData({ videoUrl: '', urlParsed: false, urlError: '', videoInfo: null, urlLoading: false }); },
  onOpenModelSelector() { this.setData({ modelSelectorVisible: true }); },
  onCloseModelSelector() { this.setData({ modelSelectorVisible: false }); },

  async onSelectProvider(event) {
    const provider = event.detail.provider;
    this.setData({ selectedProvider: provider, models: [], selectedModel: null });
    try {
      const models = await modelApi.getModels(provider.id);
      this.setData({ models: Array.isArray(models) ? models : [], selectedModel: models?.[0] || null });
    } catch (error) { wx.showToast({ title: error.message || '模型加载失败', icon: 'none' }); }
  },

  onSelectModel(event) { this.setData({ selectedModel: event.detail.model }); },
  onSelectStyle(event) { this.setData({ selectedStyle: event.detail.style }); },

  async onSubmit() {
    if (!this.data.isLoggedIn) { wx.navigateTo({ url: '/pages/login/login' }); return; }
    const { videoUrl, videoInfo, selectedProvider, selectedModel, selectedStyle } = this.data;
    if (!videoUrl || !videoInfo) { wx.showToast({ title: '先粘贴并识别视频链接', icon: 'none' }); return; }
    if (!selectedProvider || !selectedModel) { wx.showToast({ title: '请先选择生成模型', icon: 'none' }); return; }
    this.setData({ submitting: true, urlError: '' });
    try {
      const result = await noteApi.generateNote({ url: videoUrl, platform: videoInfo.platform, provider: selectedProvider, model: selectedModel, style: selectedStyle });
      const taskId = result?.task_id;
      if (!taskId) throw new Error('任务创建失败，未返回任务 ID');
      const taskStatus = mapTaskStatus('PENDING');
      this.setData({ submitting: false, pendingTaskId: taskId, pendingTaskStatus: taskStatus.key, pendingTaskLabel: taskStatus.label, taskProgress: taskStatus.progress });
      this.startPolling(taskId);
    } catch (error) { this.setData({ submitting: false }); wx.showToast({ title: error.message || '提交失败，请稍后重试', icon: 'none' }); }
  },

  startPolling(taskId) {
    pollingManager.start(taskId, (result) => {
      const taskStatus = mapTaskStatus(result?.status || result?.task_status);
      this.setData({ pendingTaskStatus: taskStatus.key, pendingTaskLabel: result?.message || taskStatus.label, taskProgress: taskStatus.progress });
      if (taskStatus.key === 'success') {
        wx.showToast({ title: '笔记已生成', icon: 'success' });
        this.refreshCredits();
        setTimeout(() => wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${taskId}` }), 500);
        this.setData({ pendingTaskId: '' });
      } else if (taskStatus.terminal) {
        wx.showToast({ title: result?.message || taskStatus.label, icon: 'none' });
        this.setData({ pendingTaskId: '' });
      }
    });
  },

  onViewResult() { if (this.data.pendingTaskId) wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${this.data.pendingTaskId}` }); },

  onRecentTaskTap(event) {
    const task = event.currentTarget.dataset.task;
    if (task?.id && task.status === 'success') wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${task.id}` });
    else if (task?.status === 'processing' || task?.status === 'pending') wx.switchTab({ url: '/pages/tasks/tasks' });
  },

  onShareAppMessage() { return { title: 'NoteFlow · 把视频变成可复习的笔记', path: '/pages/home/home' }; },
});
