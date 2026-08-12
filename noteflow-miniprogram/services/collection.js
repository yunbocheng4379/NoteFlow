/**
 * NoteFlow Mini Program - Collection API Service
 */

const { request, get } = require('../utils/request');

module.exports = {
  /** List all collections */
  list: () => request({ url: '/api/collections', suppressToast: true }),

  /** Create a collection */
  create: (name, description) => request({
    url: '/api/collections',
    method: 'POST',
    data: { name, description },
  }),

  /** Get collection detail */
  getDetail: (id) => request({
    url: `/api/collections/${id}`,
    suppressToast: true,
  }),

  /** Update collection */
  update: (id, data) => request({
    url: `/api/collections/${id}`,
    method: 'PUT',
    data,
  }),

  /** Delete collection */
  delete: (id) => request({
    url: `/api/collections/${id}`,
    method: 'DELETE',
  }),

  /** Get items in a collection */
  getItems: (collectionId) => request({
    url: `/api/collections/${collectionId}/items`,
    suppressToast: true,
  }),

  /** Add note to collection */
  addItem: (collectionId, taskId) => request({
    url: `/api/collections/${collectionId}/items`,
    method: 'POST',
    data: { task_id: taskId },
  }),

  /** Remove note from collection */
  removeItem: (collectionId, taskId) => request({
    url: `/api/collections/${collectionId}/items/${taskId}`,
    method: 'DELETE',
  }),

  /** Merge multiple notes into one (Pro) */
  merge: (collectionId) => request({
    url: `/api/collections/${collectionId}/merge`,
    method: 'POST',
  }),

  /** Export collection */
  export: (collectionId, format = 'pdf') => request({
    url: `/api/collections/${collectionId}/export`,
    method: 'POST',
    data: { format },
  }),
};
