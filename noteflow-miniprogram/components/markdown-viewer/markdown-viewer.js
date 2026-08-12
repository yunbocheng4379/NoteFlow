Component({
  properties: {
    nodes: {
      type: Array,
      value: [],
    },
  },

  data: {
    imageList: [],
  },

  methods: {
    onImageTap(e) {
      const { src } = e.currentTarget.dataset;
      if (!src) return;
      wx.previewImage({
        current: src,
        urls: this.data.imageList,
      });
      this.triggerEvent('imageTap', { src });
    },

    updateImageList() {
      const images = [];
      const collectImages = (list) => {
        for (const node of list) {
          if (node.type === 'image' && node.src) {
            images.push(node.src);
          }
          if (node.children) {
            collectImages(node.children);
          }
        }
      };
      collectImages(this.properties.nodes);
      this.setData({ imageList: images });
    },
  },

  observers: {
    'nodes'(nodes) {
      if (nodes && nodes.length > 0) {
        this.updateImageList();
      }
    },
  },
});
