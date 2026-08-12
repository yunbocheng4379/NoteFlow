/**
 * 生成闪记卡页
 *
 * 从指定笔记生成闪记卡。用户选择笔记 → 选择卡片数量 → 生成 → 预览。
 * 生成后可保存到闪记卡库或开始学习。
 */
const flashcardService = require('../../../services/flashcard');
const noteService = require('../../../services/note');

Page({
  data: {
    noteId: '',
    noteTitle: '',
    count: 10,
    countOptions: [5, 10, 15, 20],
    generating: false,
    cards: [],
    saved: false,
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ noteId: options.id, noteTitle: options.title || '' });
    }
  },

  /** 选择笔记 */
  async onSelectNote() {
    // 跳转到笔记列表选择
    wx.navigateTo({
      url: '/pages/tasks/tasks?mode=select',
      events: {
        noteSelected: (data) => {
          this.setData({
            noteId: data.id,
            noteTitle: data.title,
            cards: [],
            saved: false,
          });
        },
      },
    });
  },

  onSelectCount(e) {
    this.setData({ count: Number(e.currentTarget.dataset.n) });
  },

  /** 生成闪记卡 */
  async onGenerate() {
    if (!this.data.noteId) {
      wx.showToast({ title: '请先选择笔记', icon: 'none' });
      return;
    }

    this.setData({ generating: true, cards: [], saved: false });

    try {
      const result = await flashcardService.generate({
        note_id: this.data.noteId,
        count: this.data.count,
      });

      const cards = (result.cards || result.flashcards || []).map((c, i) => ({
        ...c,
        index: i + 1,
        flipped: false,
      }));

      this.setData({ cards, generating: false });
      wx.showToast({ title: `已生成 ${cards.length} 张`, icon: 'success' });
    } catch (err) {
      console.error('[FlashcardGenerate] Failed:', err);
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
      this.setData({ generating: false });
    }
  },

  /** 翻转卡片 */
  onFlipCard(e) {
    const { index } = e.currentTarget.dataset;
    const key = `cards[${index}].flipped`;
    this.setData({ [key]: !this.data.cards[index].flipped });
  },

  /** 保存闪记卡 */
  async onSave() {
    try {
      await flashcardService.saveCards({
        note_id: this.data.noteId,
        cards: this.data.cards.map((c) => ({ front: c.front || c.question, back: c.back || c.answer })),
      });
      this.setData({ saved: true });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  /** 去学习 */
  onStartStudy() {
    const ids = this.data.cards.map((c) => c.id).filter(Boolean).join(',');
    wx.navigateTo({ url: `/subpackages/flashcards/pages/study/study?ids=${ids}` });
  },

  onShareAppMessage() {
    return {
      title: `我用 NoteFlow 把「${this.data.noteTitle}」生成了闪记卡`,
      path: '/pages/home/home',
    };
  },
});
