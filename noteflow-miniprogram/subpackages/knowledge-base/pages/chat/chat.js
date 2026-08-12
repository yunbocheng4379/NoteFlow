/**
 * 知识库问答页
 *
 * 基于用户所有笔记的 RAG 问答。输入问题后，后端检索相关笔记段落
 * 并调用 LLM 生成回答。支持流式显示。
 */
const kbService = require('../../../services/knowledge-base');

Page({
  data: {
    messages: [],
    inputValue: '',
    sending: false,
    scrollToView: '',
    knowledgeBaseReady: false,
  },

  onLoad() {
    this.checkKBStatus();
  },

  async checkKBStatus() {
    try {
      const status = await kbService.getKnowledgeBaseStatus();
      this.setData({ knowledgeBaseReady: status?.ready || status?.indexed_count > 0 });
    } catch (err) {
      this.setData({ knowledgeBaseReady: false });
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  async onSend() {
    const question = this.data.inputValue.trim();
    if (!question || this.data.sending) return;

    const userMsg = { role: 'user', content: question, timestamp: this._now() };
    const loadingMsg = { role: 'assistant', content: '', loading: true, timestamp: this._now() };

    const messages = [...this.data.messages, userMsg, loadingMsg];
    this.setData({
      messages,
      inputValue: '',
      sending: true,
      scrollToView: `msg-${messages.length - 1}`,
    });

    try {
      const result = await kbService.askQuestion({ question });

      const answer = result.answer || result.content || '抱歉，我无法回答这个问题。';
      const sources = result.sources || [];

      // 构建带来源引用的回答
      let fullAnswer = answer;
      if (sources.length > 0) {
        fullAnswer += '\n\n---\n**参考笔记：**\n';
        sources.slice(0, 3).forEach((s, i) => {
          fullAnswer += `\n${i + 1}. ${s.title || '笔记片段'}`;
        });
      }

      loadingMsg.content = fullAnswer;
      loadingMsg.loading = false;
      this.setData({ messages, sending: false, scrollToView: `msg-${messages.length - 1}` });
    } catch (err) {
      loadingMsg.content = '回答失败，请重试';
      loadingMsg.loading = false;
      loadingMsg.error = true;
      this.setData({ messages, sending: false });
    }
  },

  /** 重试最后一条消息 */
  onRetry(e) {
    const { index } = e.currentTarget.dataset;
    const msg = this.data.messages[index];
    if (!msg || msg.role !== 'assistant') return;

    // 找到对应的上一条用户消息
    const userMsg = this.data.messages[index - 1];
    if (!userMsg || userMsg.role !== 'user') return;

    this.setData({
      inputValue: userMsg.content,
      messages: this.data.messages.slice(0, index),
    });
    this.onSend();
  },

  onShareAppMessage() {
    return {
      title: 'NoteFlow 知识库 — AI 问答你的所有笔记',
      path: '/pages/home/home',
    };
  },

  _now() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
});
