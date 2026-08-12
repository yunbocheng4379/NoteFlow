// NoteFlow Mini Program - Environment Configuration
const ENV = {
  // API base URL - change this for different environments
  // Replace with the HTTPS backend domain registered in the WeChat console.
  API_BASE: 'https://api.noteflow.app',

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
