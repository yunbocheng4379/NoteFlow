Component({
  properties: {
    variant: {
      type: String,
      value: 'list',
    },
  },

  data: {
    listItems: Array.from({ length: 4 }, (_, i) => i),
    detailBlocks: Array.from({ length: 6 }, (_, i) => i),
  },
});
