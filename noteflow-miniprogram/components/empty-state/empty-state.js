const VARIANTS = {
  tasks: {
    icon: '📝',
    defaultTitle: '还没有笔记',
    defaultDesc: '输入视频链接，AI 帮你生成笔记',
  },
  search: {
    icon: '🔍',
    defaultTitle: '没有找到相关内容',
    defaultDesc: '试试其他关键词吧',
  },
  network: {
    icon: '📡',
    defaultTitle: '网络连接失败',
    defaultDesc: '请检查网络后重试',
  },
  generic: {
    icon: '📭',
    defaultTitle: '暂无内容',
    defaultDesc: '',
  },
};

Component({
  properties: {
    variant: {
      type: String,
      value: 'generic',
    },
    title: {
      type: String,
      value: '',
    },
    description: {
      type: String,
      value: '',
    },
    actionText: {
      type: String,
      value: '',
    },
  },

  computed: {},

  data: {
    icon: '',
    displayTitle: '',
    displayDesc: '',
  },

  observers: {
    'variant, title, description'(variant, title, description) {
      const cfg = VARIANTS[variant] || VARIANTS.generic;
      this.setData({
        icon: cfg.icon,
        displayTitle: title || cfg.defaultTitle,
        displayDesc: description || cfg.defaultDesc,
      });
    },
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
