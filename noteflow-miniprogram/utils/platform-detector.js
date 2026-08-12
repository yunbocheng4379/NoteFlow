/**
 * NoteFlow Mini Program - URL Platform Detector
 *
 * Mirror of backend/app/validators/video_url_validator.py
 */

const PLATFORM_RULES = [
  { platform: 'bilibili',  label: 'B站',     pattern: /(?:www\.)?bilibili\.com\/video\/|b23\.tv|bilibili\.com\/bangumi/i },
  { platform: 'youtube',  label: 'YouTube',  pattern: /(?:www\.)?youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\//i },
  { platform: 'douyin',   label: '抖音',     pattern: /(?:www\.)?douyin\.com\/video\/|v\.douyin\.com\//i },
  { platform: 'kuaishou', label: '快手',     pattern: /(?:www\.)?kuaishou\.com\/short-video\/|v\.kuaishou\.com\//i },
];

const PLATFORM_COLORS = {
  bilibili:  '#FB7299',
  youtube:   '#FF0000',
  douyin:    '#000000',
  kuaishou:  '#FF4906',
  local:     '#666666',
};

const PLATFORM_ICONS = {
  bilibili:  '📺',
  youtube:   '▶️',
  douyin:    '🎵',
  kuaishou:  '⚡',
  local:     '📁',
};

/**
 * Detect platform from video URL
 * @param {string} url
 * @returns {{ platform: string, label: string } | null}
 */
function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();

  for (const rule of PLATFORM_RULES) {
    if (rule.pattern.test(trimmed)) {
      return {
        platform: rule.platform,
        label: rule.label,
      };
    }
  }

  return null;
}

function parseUrl(url) {
  return detectPlatform(url)?.platform || null;
}

/**
 * Get color for a platform
 */
function getPlatformColor(platform) {
  return PLATFORM_COLORS[platform] || '#999999';
}

/**
 * Get emoji icon for a platform
 */
function getPlatformIcon(platform) {
  return PLATFORM_ICONS[platform] || '📼';
}

/**
 * Get all supported platforms
 */
function getSupportedPlatforms() {
  return PLATFORM_RULES.map((r) => ({ platform: r.platform, label: r.label }));
}

/**
 * Validate if a URL looks like a video link
 */
function looksLikeVideoUrl(url) {
  if (!url) return false;
  try {
    new URL(url.trim());
    return PLATFORM_RULES.some((r) => r.pattern.test(url.trim()));
  } catch {
    return false;
  }
}

module.exports = {
  detectPlatform,
  parseUrl,
  getPlatformColor,
  getPlatformIcon,
  getSupportedPlatforms,
  looksLikeVideoUrl,
};
