/**
 * NoteFlow Mini Program - Share API Service
 */

const { request } = require('../utils/request');

module.exports = {
  /** Enable sharing for a note, get share token */
  enableShare: (taskId) => request({
    url: `/api/share/enable/${taskId}`,
    method: 'POST',
  }),

  /** Disable sharing for a note */
  disableShare: (taskId) => request({
    url: `/api/share/disable/${taskId}`,
    method: 'POST',
  }),

  /** View a shared note (no auth required) */
  viewSharedNote: (token) => request({
    url: `/api/share/view/${token}`,
    noAuth: true,
  }),
};
