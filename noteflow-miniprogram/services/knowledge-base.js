/**
 * NoteFlow Mini Program - Knowledge Base API Service
 *
 * Cross-note AI Q&A, powered by ChromaDB vector indexing.
 */

const { request } = require('../utils/request');

module.exports = {
  /** List knowledge base conversations */
  listConversations: () => request({
    url: '/api/kb/conversations',
    suppressToast: true,
  }),

  /** Create a new conversation */
  createConversation: (name) => request({
    url: '/api/kb/conversations',
    method: 'POST',
    data: { name },
  }),

  /** Get conversation detail */
  getConversation: (id) => request({
    url: `/api/kb/conversations/${id}`,
    suppressToast: true,
  }),

  /** Delete a conversation */
  deleteConversation: (id) => request({
    url: `/api/kb/conversations/${id}`,
    method: 'DELETE',
  }),

  /** Ask a question across all indexed notes */
  ask: (conversationId, question) => request({
    url: '/api/kb/ask',
    method: 'POST',
    data: { conversation_id: conversationId, question },
    timeout: 90000,
  }),

  /** Ask with streaming (via enableChunked) */
  askStream: (conversationId, question) => {
    const ENV = require('../.env.js');
    const token = wx.getStorageSync('access_token');

    return wx.request({
      url: `${ENV.API_BASE}/api/kb/ask_stream`,
      method: 'POST',
      enableChunked: true,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      data: { conversation_id: conversationId, question },
      timeout: 120000,
    });
  },
};
