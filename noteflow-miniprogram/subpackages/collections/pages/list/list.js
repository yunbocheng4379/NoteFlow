/**
 * 笔记合集列表页
 *
 * 展示用户创建的笔记合集。支持新建合集、进入合集详情。
 */
const collectionService = require('../../../services/collection');
const { formatRelativeTime } = require('../../../utils/format');

Page({
  data: {
    collections: [],
    loading: true,
    creating: false,
    page: 1,
    hasMore: true,
  },

  onLoad() {
    this.loadCollections(true);
  },

  onPullDownRefresh() {
    this.loadCollections(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadCollections(false);
  },

  async loadCollections(reset) {
    if (this.data.loading && !reset) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;

    try {
      const result = await collectionService.getCollections({ page, page_size: 20 });
      const collections = (result.collections || result.data || []).map((c) => ({
        ...c,
        _time: formatRelativeTime(c.created_at || c.updated_at),
        _count: c.note_count || c.count || 0,
      }));

      this.setData({
        collections: reset ? collections : [...this.data.collections, ...collections],
        page: reset ? 2 : page + 1,
        hasMore: collections.length >= 20,
        loading: false,
      });
    } catch (err) {
      console.error('[Collections] Load failed:', err);
      this.setData({ loading: false });
    }
  },

  /** 新建合集 */
  async onCreateCollection() {
    this.setData({ creating: true });
    try {
      const result = await collectionService.createCollection({
        name: '未命名合集',
      });
      const id = result.id || result.collection_id;
      if (id) {
        wx.navigateTo({ url: `/subpackages/collections/pages/detail/detail?id=${id}` });
      }
    } catch (err) {
      wx.showToast({ title: '创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  /** 进入合集详情 */
  onTapCollection(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/subpackages/collections/pages/detail/detail?id=${id}` });
  },

  /** 长按删除 */
  onLongPressCollection(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除合集',
      content: `确定删除「${name}」？笔记不会被删除。`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await collectionService.deleteCollection(id);
          const collections = this.data.collections.filter((c) => c.id !== id);
          this.setData({ collections });
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '我的 NoteFlow 笔记合集',
      path: '/pages/home/home',
    };
  },
});
