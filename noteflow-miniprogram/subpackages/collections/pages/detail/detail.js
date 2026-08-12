/**
 * 合集详情页
 *
 * 展示合集中的笔记列表，支持从合集中移除笔记、重命名合集。
 */
const collectionService = require('../../../services/collection');
const { formatRelativeTime } = require('../../../utils/format');

Page({
  data: {
    collection: null,
    notes: [],
    loading: true,
    renaming: false,
  },

  onLoad(options) {
    this.collectionId = options.id;
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const result = await collectionService.getCollectionDetail(this.collectionId);
      const collection = {
        ...result,
        _time: formatRelativeTime(result.updated_at || result.created_at),
        _count: (result.notes || []).length,
      };
      this.setData({
        collection,
        notes: (result.notes || []).map((n) => ({
          ...n,
          _time: formatRelativeTime(n.created_at),
        })),
        loading: false,
      });
    } catch (err) {
      console.error('[CollectionDetail] Load failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /** 进入笔记详情 */
  onTapNote(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${id}` });
  },

  /** 重命名合集 */
  onRename() {
    this.setData({ renaming: true });
  },

  async onConfirmRename(e) {
    const name = e.detail.value?.trim();
    this.setData({ renaming: false });

    if (!name || name === this.data.collection.name) return;

    try {
      await collectionService.updateCollection(this.collectionId, { name });
      this.setData({ 'collection.name': name });
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },

  onCancelRename() {
    this.setData({ renaming: false });
  },

  /** 从合集中移除笔记 */
  async onRemoveNote(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除笔记',
      content: `将「${title}」从本合集中移除？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await collectionService.removeNoteFromCollection(this.collectionId, id);
          const notes = this.data.notes.filter((n) => n.id !== id);
          this.setData({ notes, 'collection._count': notes.length });
          wx.showToast({ title: '已移除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '移除失败', icon: 'none' });
        }
      },
    });
  },

  /** 删除合集 */
  onDelete() {
    wx.showModal({
      title: '删除合集',
      content: '确定删除此合集？笔记不会被删除。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await collectionService.deleteCollection(this.collectionId);
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1200);
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.collection?.name || '笔记合集',
      path: `/pages/home/home`,
    };
  },
});
