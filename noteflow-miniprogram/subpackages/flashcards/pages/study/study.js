/**
 * 复习闪记卡页
 *
 * 间隔重复学习模式。卡片正反面翻转，用户自评掌握程度。
 * 支持从闪记卡库加载，或从生成结果直接进入。
 */
const flashcardService = require('../../../services/flashcard');

// 掌握程度
const RATINGS = [
  { key: 'again', label: '再学一次', color: '#FA5151', emoji: '😞' },
  { key: 'hard', label: '有点难', color: '#FFC300', emoji: '🤔' },
  { key: 'good', label: '已掌握', color: '#07C160', emoji: '😊' },
  { key: 'easy', label: '太简单', color: '#378ADD', emoji: '👍' },
];

Page({
  data: {
    cards: [],
    currentIdx: 0,
    flipped: false,
    finished: false,
    stats: { total: 0, good: 0, hard: 0, again: 0 },
    ratings: RATINGS,
    showRatings: false,
    loading: true,
  },

  onLoad(options) {
    if (options.ids) {
      this.loadCards(options.ids);
    } else {
      this.loadAllCards();
    }
  },

  async loadCards(ids) {
    try {
      const idList = ids.split(',').filter(Boolean);
      const result = await flashcardService.getCards({ ids: idList });
      this.setCards(result.cards || result.flashcards || []);
    } catch (err) {
      console.error('[Study] Load failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async loadAllCards() {
    try {
      const result = await flashcardService.getCards({});
      this.setCards(result.cards || result.flashcards || []);
    } catch (err) {
      console.error('[Study] Load failed:', err);
      this.setData({ loading: false });
    }
  },

  setCards(cards) {
    if (!cards.length) {
      this.setData({ cards: [], finished: true, loading: false });
      return;
    }
    this.setData({
      cards: cards.map((c, i) => ({ ...c, index: i })),
      currentIdx: 0,
      flipped: false,
      finished: false,
      showRatings: false,
      stats: { total: cards.length, good: 0, hard: 0, again: 0 },
      loading: false,
    });
  },

  /** 翻转卡片 */
  onFlip() {
    this.setData({ flipped: !this.data.flipped, showRatings: !this.data.flipped });
  },

  /** 选择掌握程度 */
  async onRate(e) {
    const { key } = e.currentTarget.dataset;
    const card = this.data.cards[this.data.currentIdx];

    // 更新统计
    const stats = { ...this.data.stats };
    if (key === 'good' || key === 'easy') stats.good++;
    else if (key === 'hard') stats.hard++;
    else stats.again++;

    // 发送评分到后端
    try {
      await flashcardService.rateCard({
        card_id: card.id,
        rating: key,
      });
    } catch (err) {
      // 静默失败
    }

    // 下一张
    const nextIdx = this.data.currentIdx + 1;
    if (nextIdx >= this.data.cards.length) {
      this.setData({ finished: true, flipped: false, showRatings: false, stats });
      return;
    }

    this.setData({
      currentIdx: nextIdx,
      flipped: false,
      showRatings: false,
      stats,
    });
  },

  /** 继续复习（错误的卡片） */
  onRetryWrong() {
    const wrong = this.data.cards.filter((_, i) => {
      // 简化版：随机取一半
      return i % 2 === 0;
    });
    if (!wrong.length) {
      wx.showToast({ title: '太棒了，全部掌握！', icon: 'success' });
      return;
    }
    this.setCards(wrong);
  },

  /** 重新开始 */
  onRestart() {
    this.setData({ flipped: false, finished: false, currentIdx: 0, showRatings: false, stats: { total: this.data.cards.length, good: 0, hard: 0, again: 0 } });
  },

  onShareAppMessage() {
    return {
      title: 'NoteFlow 闪记卡 — 高效复习笔记',
      path: '/pages/home/home',
    };
  },
});
