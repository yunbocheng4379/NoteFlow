const STATUS_DEFINITIONS = {
  SUCCESS: { key: 'success', label: '已完成', terminal: true, progress: 100 },
  FAILED: { key: 'failed', label: '生成失败', terminal: true, progress: 100 },
  CANCELLED: { key: 'failed', label: '已取消', terminal: true, progress: 100 },
  TIMEOUT: { key: 'failed', label: '处理超时', terminal: true, progress: 100 },
  PENDING: { key: 'pending', label: '排队中', terminal: false, progress: 12 },
  DOWNLOADING: { key: 'processing', label: '获取视频', terminal: false, progress: 28 },
  TRANSCRIBING: { key: 'processing', label: '转写内容', terminal: false, progress: 52 },
  GENERATING: { key: 'processing', label: '生成笔记', terminal: false, progress: 78 },
};

function normalizeAuthResult(result = {}) {
  return {
    token: result.token || result.access_token || '',
    refreshToken: result.refresh_token || '',
    user: result.user || null,
  };
}

function saveSessionPayload(result = {}) {
  const auth = normalizeAuthResult(result);
  return {
    accessToken: auth.token,
    refreshToken: auth.refreshToken,
    user: auth.user,
  };
}

function buildGeneratePayload(form = {}) {
  return {
    video_url: form.url || form.video_url || '',
    platform: form.platform || '',
    quality: form.quality || 'best',
    screenshot: Boolean(form.screenshot),
    link: Boolean(form.link),
    model_name: form.model_name || form.model?.name || '',
    provider_id: form.provider_id || form.provider?.id || '',
    format: Array.isArray(form.format) ? form.format : [],
    style: form.style_value || form.style?.value || form.style?.name || '',
    video_understanding: Boolean(form.video_understanding),
    video_interval: Number(form.video_interval || 0),
    grid_size: Array.isArray(form.grid_size) ? form.grid_size : [],
  };
}

function unwrapResponse(body) {
  if (!body || typeof body !== 'object' || !('code' in body)) return body;
  if (body.code === 200 || body.success === true) {
    return body.data !== undefined ? body.data : body;
  }
  const error = new Error(body.msg || body.message || '请求失败');
  error.code = body.code;
  error.message = body.msg || body.message || '请求失败';
  error.data = body;
  throw error;
}

function mapTaskStatus(status) {
  const normalized = String(status || 'PENDING').toUpperCase();
  return { ...(STATUS_DEFINITIONS[normalized] || STATUS_DEFINITIONS.PENDING) };
}

function normalizeTask(task = {}) {
  const status = mapTaskStatus(task.status || task.task_status);
  return {
    ...task,
    id: task.id || task.task_id,
    title: task.title || '未命名笔记',
    status: status.key,
    statusLabel: status.label,
    terminal: status.terminal,
    progress: status.progress,
  };
}

function buildChatPayload(params = {}) {
  return {
    task_id: params.task_id || params.taskId || '',
    question: params.question || '',
    history: Array.isArray(params.history) ? params.history : [],
    provider_id: params.provider_id || params.providerId || '',
    model_name: params.model_name || params.modelName || '',
  };
}

module.exports = {
  normalizeAuthResult,
  saveSessionPayload,
  buildGeneratePayload,
  unwrapResponse,
  mapTaskStatus,
  normalizeTask,
  buildChatPayload,
};
