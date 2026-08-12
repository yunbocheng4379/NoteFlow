/**
 * NoteFlow Mini Program - Formatting Utilities
 */

/**
 * Format timestamp to readable date string
 * @param {string|number} timestamp - ISO string or unix ms
 * @param {string} format - 'full' | 'date' | 'time' | 'relative'
 */
function formatTime(timestamp, format = 'full') {
  if (!timestamp) return '';

  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(Number(timestamp));
  if (isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  if (format === 'date') return `${year}-${month}-${day}`;
  if (format === 'time') return `${hours}:${minutes}`;
  if (format === 'full') return `${year}-${month}-${day} ${hours}:${minutes}`;

  if (format === 'relative') return relativeTime(date);

  return `${year}-${month}-${day}`;
}

/**
 * Relative time (e.g. "3分钟前", "昨天")
 */
function relativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 2) return '昨天';
  if (days < 7) return `${days}天前`;
  return formatTime(date, 'date');
}

/**
 * Format video duration from seconds to mm:ss or hh:mm:ss
 * @param {number} seconds
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '00:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const pad = (n) => String(n).padStart(2, '0');

  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Format credit/balance display
 * @param {number} credits
 */
function formatCredits(credits) {
  if (credits == null) return '0';
  if (credits >= 10000) {
    return `${(credits / 10000).toFixed(1)}万`;
  }
  return Number(credits).toLocaleString();
}

/**
 * Format file size
 * @param {number} bytes
 */
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format percentage
 * @param {number} value - 0-100
 */
function formatPercent(value) {
  return `${Math.round(value)}%`;
}

/**
 * Format task status for display
 * @param {string} status
 * @returns {{ label: string, tag: string }}
 */
function formatTaskStatus(status) {
  const map = {
    PENDING:      { label: '排队中',   tag: 'tag-blue' },
    DOWNLOADING:  { label: '下载中',   tag: 'tag-blue' },
    TRANSCRIBING: { label: '转写中',   tag: 'tag-blue' },
    GENERATING:   { label: '生成中',   tag: 'tag-blue' },
    SUCCESS:      { label: '已完成',   tag: 'tag-green' },
    FAILED:       { label: '失败',     tag: 'tag-red' },
    CANCELLED:    { label: '已取消',   tag: 'tag-orange' },
    TIMEOUT:      { label: '超时',     tag: 'tag-red' },
  };

  return map[status] || { label: status || '未知', tag: 'tag-blue' };
}

/**
 * Truncate text with ellipsis
 * @param {string} text
 * @param {number} maxLen
 */
function truncate(text, maxLen = 50) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Debounce utility
 * @param {Function} fn
 * @param {number} delay - ms
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * Throttle utility
 * @param {Function} fn
 * @param {number} interval - ms
 */
function throttle(fn, interval = 300) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}

module.exports = {
  formatTime,
  relativeTime,
  formatDuration,
  formatCredits,
  formatFileSize,
  formatPercent,
  formatTaskStatus,
  truncate,
  debounce,
  throttle,
};
