// NoteFlow Mini Program - App Entry
const ENV = require('./.env.js');
const { getAccessToken, clearSession } = require('./utils/auth');
const pollingManager = require('./utils/task-polling');

App({
  onLaunch(options) {
    console.log('[NoteFlow] App launch', options);
    this._initApp();
  },

  onShow(options) {
    console.log('[NoteFlow] App show', options);
    // Resume any active polling on app show
    pollingManager.resumeAll();
  },

  onHide() {
    console.log('[NoteFlow] App hide');
    // Pause all polling to save resources
    pollingManager.pauseAll();
  },

  async _initApp() {
    try {
      // Check if user has a stored token and validate it
      const token = getAccessToken();
      if (token) {
        this.globalData.isLoggedIn = true;
        this.globalData.token = token;
        // Validate token in background
        this._validateToken();
      }
    } catch (err) {
      console.warn('[NoteFlow] Init error:', err);
    }
  },

  async _validateToken() {
    try {
      const { request } = require('./utils/request');
      const user = await request({ url: '/api/auth/me', suppressToast: true });
      this.globalData.userInfo = user;
      this.globalData.isLoggedIn = true;
    } catch (err) {
      // Token expired or invalid, clear it
      clearSession();
    }
  },

  // Global data accessible by all pages via getApp().globalData
  globalData: {
    userInfo: null,
    token: '',
    isLoggedIn: false,
    credits: 0,
    activeSubscription: null,
    env: ENV,
  },
});
