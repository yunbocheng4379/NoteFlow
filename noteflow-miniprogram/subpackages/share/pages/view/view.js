/**
 * 分享落地页
 *
 * 其他用户通过分享链接进入该页面，可查看笔记内容预览。
 * 底部引导用户进入小程序（或下载/注册）。
 */
const shareService = require('../../../services/share');
const markdownParser = require('../../../utils/markdown-parser');
const { formatRelativeTime } = require('../../../utils/format');

Page({
  data: {
    note: null,
    nodes: [],
    loading: true,
    error: '',
    expired: false,
  },

  onLoad(options) {
    if (options.id) {
      this.shareId = options.id;
      this.loadSharedNote();
    } else {
      this.setData({ error: '无效的分享链接', loading: false });
    }
  },

  async loadSharedNote() {
    try {
      const result = await shareService.getSharedNote(this.shareId);
      if (!result || result.expired) {
        this.setData({ expired: true, loading: false });
        return;
      }

      const note = {
        ...result,
        _time: formatRelativeTime(result.created_at),
        _platform: result.platform || 'unknown',
      };

      // 解析 Markdown
      const nodes = result.content
        ? markdownParser.parse(result.content)
        : [];

      this.setData({ note, nodes, loading: false });
    } catch (err) {
      console.error('[Share] Load failed:', err);
      this.setData({ error: '笔记不存在或已失效', loading: false });
    }
  },

  /** 进入小程序 */
  onEnterApp() {
    wx.switchTab({ url: '/pages/home/home' });
  },

  /** 复制笔记链接 */
  onCopyLink() {
    wx.setClipboardData({
      data: `https://your-domain.com/share/${this.shareId}`,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
    });
  },

  onShareAppMessage() {
    const { note } = this.data;
    return {
      title: note?.title || '看看这篇 AI 生成的笔记',
      path: `/subpackages/share/pages/view/view?id=${this.shareId}`,
      imageUrl: note?.video_thumbnail || '',
    };
  },

  onShareTimeline() {
    const { note } = this.data;
    return {
      title: note?.title || '看看这篇 AI 生成的笔记',
      query: `id=${this.shareId}`,
      imageUrl: note?.video_thumbnail || '',
    };
  },
});
