Component({
  properties: {
    message: {
      type: Object,
      value: { role: 'assistant', content: '', timestamp: '' },
    },
    loading: {
      type: Boolean,
      value: false,
    },
    error: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isUser: false,
    displayTime: '',
    formattedContent: '',
  },

  observers: {
    'message'(msg) {
      if (!msg) return;
      const isUser = msg.role === 'user';
      this.setData({
        isUser,
        displayTime: this.formatTime(msg.timestamp),
        formattedContent: msg.content || '',
      });
    },
  },

  methods: {
    formatTime(ts) {
      if (!ts) return '';
      try {
        const d = new Date(ts);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
      } catch {
        return '';
      }
    },
  },
});
