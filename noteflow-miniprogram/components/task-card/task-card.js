const PLATFORM_MAP = {
  bilibili: { name: 'B站', color: '#FB7299' },
  youtube: { name: 'YouTube', color: '#FF0000' },
  douyin: { name: '抖音', color: '#000000' },
  kuaishou: { name: '快手', color: '#FF4906' },
  local: { name: '本地', color: '#999999' },
};

Component({
  properties: {
    task: {
      type: Object,
      value: null,
      observer(newVal) {
        if (newVal) {
          this.processTask(newVal);
        }
      },
    },
  },

  data: {
    platformLabel: '',
    platformColor: '',
    statusText: '',
    statusClass: '',
    relativeTime: '',
    thumbnail: '',
  },

  methods: {
    processTask(task) {
      const platform = PLATFORM_MAP[task.platform] || { name: task.platform || '未知', color: '#999999' };
      this.setData({
        platformLabel: platform.name,
        platformColor: platform.color,
        statusText: task.statusLabel || this.getStatusText(task.status),
        statusClass: this.getStatusClass(task.status),
        relativeTime: this.formatRelativeTime(task.created_at),
        thumbnail: task.cover_url || task.video_thumbnail || '',
      });
    },

    getStatusText(status) {
      const map = {
        pending: '排队中',
        downloading: '下载中',
        transcribing: '转写中',
        generating: '生成中',
        success: '已完成',
        failed: '失败',
      };
      return map[status] || status;
    },

    getStatusClass(status) {
      if (status === 'success') return 'status-success';
      if (status === 'failed') return 'status-error';
      return 'status-processing';
    },

    formatRelativeTime(dateStr) {
      if (!dateStr) return '';
      try {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;

        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}月${day}日`;
      } catch {
        return '';
      }
    },

    onTap() {
      this.triggerEvent('tap', { task: this.properties.task });
    },

    onLongPress() {
      this.triggerEvent('longpress', { task: this.properties.task });
    },
  },
});
