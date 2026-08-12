const { noteApi } = require('../../services/note');
const { chatApi } = require('../../services/chat');
const { modelApi } = require('../../services/model');
const { markdownParser } = require('../../utils/markdown-parser');

Page({
  data: {
    noteId: '', note: null, loading: true, loadError: '', mdNodes: [], activeTab: 'note',
    chatMessages: [], chatInput: '', chatSending: false, chatLoading: false, chatError: '', chatIndexed: false,
    chatProvider: null, chatModel: null,
  },

  onLoad(options) {
    if (!options.id) { this.setData({ loading: false, loadError: '笔记 ID 无效' }); return; }
    this.setData({ noteId: options.id });
    this.loadNote();
  },

  async loadNote() {
    this.setData({ loading: true, loadError: '' });
    try {
      const response = await noteApi.getTaskDetail(this.data.noteId);
      const note = { ...response, title: response.title || '未命名笔记', content: response.content || '' };
      this.setData({ note, mdNodes: markdownParser.parse(note.content), loading: false });
      wx.setNavigationBarTitle({ title: note.title.slice(0, 20) });
      this.loadChatConfig();
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '笔记加载失败，请重试' });
    }
  },

  async loadChatConfig() {
    try {
      const providers = await modelApi.getProviders();
      const chatProvider = providers?.[0] || null;
      const models = chatProvider ? await modelApi.getModels(chatProvider.id) : [];
      this.setData({ chatProvider, chatModel: models?.[0] || null });
    } catch { /* Q&A can show a clear model error when first used. */ }
  },

  onTabChange(event) { this.setData({ activeTab: event.currentTarget.dataset.tab }); },
  onImageTap() {},
  onChatInput(event) { this.setData({ chatInput: event.detail.value, chatError: '' }); },

  async ensureChatIndex() {
    if (this.data.chatIndexed) return true;
    await chatApi.indexNote(this.data.noteId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await chatApi.getChatStatus(this.data.noteId);
      if (status?.indexed || status?.status === 'indexed') { this.setData({ chatIndexed: true }); return true; }
      if (status?.status === 'failed') throw new Error('笔记索引失败，请稍后重试');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('笔记准备超时，请稍后再试');
  },

  async onSendMessage() {
    const question = this.data.chatInput.trim();
    if (!question || this.data.chatSending) return;
    if (!this.data.chatProvider || !this.data.chatModel) {
      this.setData({ chatError: '暂无可用问答模型，请稍后重试' });
      return;
    }
    const userMessage = { role: 'user', content: question, timestamp: new Date().toISOString() };
    const history = [...this.data.chatMessages, userMessage];
    this.setData({ chatMessages: history, chatInput: '', chatSending: true, chatLoading: true, chatError: '' });
    try {
      await this.ensureChatIndex();
      const response = await chatApi.ask({ taskId: this.data.noteId, question, history, providerId: this.data.chatProvider.id, modelName: this.data.chatModel.name });
      const answer = response?.answer || response?.content || '暂时没有找到答案。';
      this.setData({ chatMessages: [...history, { role: 'assistant', content: answer, timestamp: new Date().toISOString() }], chatSending: false, chatLoading: false });
    } catch (error) {
      this.setData({ chatSending: false, chatLoading: false, chatError: error.message || '回答失败，请重新发送' });
    }
  },

  onRetryChat() {
    if (this.data.chatMessages.length) {
      const lastUser = [...this.data.chatMessages].reverse().find((message) => message.role === 'user');
      if (lastUser) { this.setData({ chatInput: lastUser.content }); this.onSendMessage(); }
    }
  },

  onShareNote() { wx.showShareMenu({ withShareTicket: true }); },

  onCopyContent() {
    if (!this.data.note?.content) return;
    wx.setClipboardData({ data: this.data.note.content, success: () => wx.showToast({ title: '已复制笔记', icon: 'success' }) });
  },

  onDeleteNote() {
    wx.showModal({ title: '删除这份笔记？', content: '删除后无法恢复。', confirmColor: '#C66B5D', success: async ({ confirm }) => {
      if (!confirm) return;
      try { await noteApi.deleteTask(this.data.noteId); wx.showToast({ title: '已删除', icon: 'success' }); setTimeout(() => wx.navigateBack(), 400); }
      catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }); }
    } });
  },

  onShareAppMessage() { return { title: `${this.data.note?.title || 'NoteFlow 笔记'}`, path: `/pages/note-detail/note-detail?id=${this.data.noteId}` }; },
});
