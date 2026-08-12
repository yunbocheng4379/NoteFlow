Component({
  properties: {
    videoInfo: {
      type: Object,
      value: null,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    error: {
      type: String,
      value: '',
    },
  },

  data: {
    platformName: '',
    platformColor: '',
    durationText: '',
  },

  observers: {
    'videoInfo'(info) {
      if (!info) return;
      const map = {
        bilibili: { name: 'B站', color: '#FB7299' },
        youtube: { name: 'YouTube', color: '#FF0000' },
        douyin: { name: '抖音', color: '#000000' },
        kuaishou: { name: '快手', color: '#FF4906' },
      };
      const p = map[info.platform] || { name: info.platform || '', color: '#999999' };
      const totalSec = info.duration || 0;
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      this.setData({
        platformName: p.name,
        platformColor: p.color,
        durationText: `${min}:${String(sec).padStart(2, '0')}`,
      });
    },
  },
});
