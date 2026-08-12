/**
 * NoteFlow Mini Program - Model & Provider API Service
 */

const { request } = require('../utils/request');

const modelApi = {
  /** Get all LLM providers */
  getProviders: () => request({
    url: '/api/get_all_providers',
    suppressToast: true,
  }),

  /** Get models for a specific provider */
  getModels: (providerId) => request({
    url: `/api/model_list/${providerId}`,
    suppressToast: true,
  }),

  /** Get available note styles */
  getNoteStyles: () => request({
    url: '/api/note_styles',
    suppressToast: true,
  }),

  /** Get supported platforms */
  getPlatforms: () => request({
    url: '/api/platforms',
    suppressToast: true,
  }),

  /** Export note (MD/PDF) */
  exportNote: (taskId, format = 'markdown') => request({
    url: `/api/export/${taskId}`,
    method: 'POST',
    data: { format },
  }),
};

module.exports = { modelApi };
