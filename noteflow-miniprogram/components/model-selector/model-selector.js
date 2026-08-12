Component({
  properties: {
    providers: {
      type: Array,
      value: [],
    },
    models: {
      type: Array,
      value: [],
    },
    styles: {
      type: Array,
      value: [],
    },
    selectedProvider: {
      type: Object,
      value: null,
    },
    selectedModel: {
      type: Object,
      value: null,
    },
    selectedStyle: {
      type: Object,
      value: null,
    },
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.setData({ animating: true });
        }
      },
    },
  },

  data: {
    animating: false,
    activeTab: 'model',
  },

  methods: {
    onClose() {
      this.setData({ animating: false });
      setTimeout(() => {
        this.triggerEvent('close');
      }, 250);
    },

    onMaskTap() {
      this.onClose();
    },

    switchTab(e) {
      const { tab } = e.currentTarget.dataset;
      this.setData({ activeTab: tab });
    },

    onSelectProvider(e) {
      const { item } = e.currentTarget.dataset;
      this.triggerEvent('selectProvider', { provider: item });
    },

    onSelectModel(e) {
      const { item } = e.currentTarget.dataset;
      this.triggerEvent('selectModel', { model: item });
    },

    onSelectStyle(e) {
      const { item } = e.currentTarget.dataset;
      this.triggerEvent('selectStyle', { style: item });
    },

    preventBubble() {},
  },
});
