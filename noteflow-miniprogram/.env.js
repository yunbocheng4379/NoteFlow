// NoteFlow Mini Program - Environment Configuration
//
// WeChat DevTools can access the backend running on this machine when
// "不校验合法域名" is enabled. Change API_ENV to "production" before release.
const API_ENV = 'local';
const API_BASES = {
  local: 'http://127.0.0.1:8483',
  production: 'https://www.noteflow.vip',
};

const ENV = {
  API_ENV,
  API_BASE: API_BASES[API_ENV],

  // Request timeout in milliseconds
  REQUEST_TIMEOUT: 30000,

  // Task polling interval in milliseconds
  POLLING_INTERVAL: 3000,

  // Max polling attempts (30 * 3s = 90s max wait)
  MAX_POLLING_ATTEMPTS: 30,

  // Image proxy endpoint
  IMAGE_PROXY_PATH: '/api/image_proxy',

  // Supported platforms
  PLATFORMS: ['bilibili', 'youtube', 'douyin', 'kuaishou', 'local'],

  // App version
  VERSION: '1.0.0',
};

module.exports = ENV;
