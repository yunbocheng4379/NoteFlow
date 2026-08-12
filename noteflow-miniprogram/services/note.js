/**
 * NoteFlow Mini Program - Note API Service
 */

const { request } = require('../utils/request');
const { buildGeneratePayload, normalizeTask } = require('../utils/contracts');

function generateNote(form) {
  return request({
    url: '/api/generate_note',
    method: 'POST',
    data: buildGeneratePayload(form),
  });
}

async function getTaskDetail(taskId) {
  const response = await request({
    url: `/api/task_status/${taskId}`,
    suppressToast: true,
    dedup: false,
  });
  if (response?.status !== 'SUCCESS' || !response.result) {
    throw new Error(response?.message || '笔记还在生成中');
  }
  const result = response.result;
  const meta = result.audio_meta || {};
  return {
    id: taskId,
    title: meta.title || result.title || '未命名笔记',
    content: result.markdown || result.content || '',
    platform: meta.platform || result.platform || '',
    video_thumbnail: meta.cover_url || result.cover_url || '',
    video_url: meta.video_url || result.video_url || '',
    created_at: result.created_at || '',
    credits_used: result.credits_used || 0,
    model_name: result.model_name || '',
    result,
  };
}

module.exports = {
  /**
   * Submit a note generation task
   * @param {Object} params
   * @param {string} params.url - Video URL
   * @param {string} [params.provider_id] - LLM provider
   * @param {string} [params.model_name] - LLM model
   * @param {string} [params.style_id] - Note style
   * @param {boolean} [params.generate_toc] - Include table of contents
   * @param {boolean} [params.include_links] - Include source links
   * @param {boolean} [params.include_screenshots] - Include screenshots
   * @param {boolean} [params.include_summary] - Include summary
   */
  generateNote,

  /**
   * Get task status
   * @param {string} taskId
   */
  getTaskStatus: (taskId) => request({
    url: `/api/task_status/${taskId}`,
    suppressToast: true,
    dedup: false,
  }),

  /**
   * List all tasks
   * @param {Object} params
   * @param {number} [params.page]
   * @param {number} [params.page_size]
   * @param {string} [params.status] - Filter by status
   * @param {string} [params.search] - Search keyword
   * @param {string} [params.platform] - Filter by platform
   */
  listTasks: async (params = {}) => {
    const result = await request({ url: '/api/tasks', data: params });
    const records = Array.isArray(result) ? result : result?.items || [];
    return records.map(normalizeTask);
  },

  getTaskList: async (params = {}) => {
    const result = await request({ url: '/api/tasks', data: params });
    const records = Array.isArray(result) ? result : result?.items || [];
    return records.map(normalizeTask);
  },

  getTaskDetail,

  /**
   * Delete a task
   * @param {string} taskId
   */
  deleteTask: (taskId) => request({
    url: `/api/tasks/${taskId}`,
    method: 'DELETE',
  }),

  /**
   * Update note title
   * @param {string} taskId
   * @param {string} title
   */
  updateNoteTitle: (taskId, title) => request({
    url: `/api/note/${taskId}/title`,
    method: 'PUT',
    data: { title },
  }),

  /**
   * Update note content (manual edit)
   * @param {string} taskId
   * @param {string} content
   */
  updateNoteContent: (taskId, content) => request({
    url: `/api/note/${taskId}`,
    method: 'PUT',
    data: { content },
  }),

  /**
   * Get video info preview
   * @param {string} url
   */
  getVideoInfo: (url) => request({
    url: '/api/video_info',
    method: 'POST',
    data: { url },
    suppressToast: true,
  }),

  /**
   * Batch generate notes (Pro feature)
   * @param {string[]} urls
   */
  generateBatch: (urls) => request({
    url: '/api/generate_notes_batch',
    method: 'POST',
    data: { urls },
  }),
};
