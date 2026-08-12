/**
 * NoteFlow Mini Program - Chat / AI Q&A Service
 */

const { request } = require('../utils/request');
const { buildChatPayload } = require('../utils/contracts');

module.exports = {
  /**
   * Build index for a note (needed before asking questions)
   * @param {string} taskId
   */
  indexNote: (taskId) => request({
    url: '/api/chat/index',
    method: 'POST',
    data: { task_id: taskId },
  }),

  /**
   * Check indexing status
   * @param {string} taskId
   */
  getChatStatus: (taskId) => request({
    url: '/api/chat/status',
    data: { task_id: taskId },
    suppressToast: true,
  }),

  /**
   * Ask a question about a single note (non-streaming)
   * @param {Object} params
   * @param {string} params.task_id
   * @param {string} params.question
   * @param {string} [params.provider_id]
   * @param {string} [params.model_name]
   */
  ask: (params) => request({
    url: '/api/chat/ask',
    method: 'POST',
    data: buildChatPayload(params),
    timeout: 60000,
  }),

  sendMessage: (params) => request({
    url: '/api/chat/ask',
    method: 'POST',
    data: buildChatPayload(params),
    timeout: 60000,
  }),

  /**
   * Ask a question about a single note (streaming, via enableChunked)
   * Requires WeChat base library 2.20+
   * @param {Object} params
   * @returns {wx.RequestTask} - Use .onChunkReceived() for streaming
   */
  askStream: (params) => {
    const ENV = require('../.env.js');
    const token = wx.getStorageSync('access_token');

    return wx.request({
      url: `${ENV.API_BASE}/api/chat/ask_stream`,
      method: 'POST',
      enableChunked: true,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      data: params,
      timeout: 120000,
    });
  },
};
