Component({
  properties: {
    credits: {
      type: Number,
      value: 0,
      observer(newVal) {
        this.setData({ displayCredits: this.formatCredits(newVal) });
      },
    },
    compact: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    displayCredits: '0',
  },

  lifetimes: {
    attached() {
      this.setData({ displayCredits: this.formatCredits(this.properties.credits) });
    },
  },

  methods: {
    formatCredits(num) {
      if (num === null || num === undefined) return '0';
      if (num >= 10000) {
        const wan = num / 10000;
        return wan % 1 === 0 ? `${wan}万` : `${wan.toFixed(1)}万`;
      }
      return String(num);
    },

    onTap() {
      this.triggerEvent('tap');
    },
  },
});
