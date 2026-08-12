/**
 * NoteFlow Mini Program - Authentication & WeChat Login Bridge
 *
 * Flow: wx.login() → POST /api/auth/wechat-login → JWT token
 */

const ENV = require('../.env.js');
const { saveSessionPayload } = require('./contracts');

function saveSession(result) {
  const session = saveSessionPayload(result);
  if (!session.accessToken) {
    throw new Error('登录响应缺少 token');
  }
  wx.setStorageSync('access_token', session.accessToken);
  if (session.refreshToken) {
    wx.setStorageSync('refresh_token', session.refreshToken);
  } else {
    wx.removeStorageSync('refresh_token');
  }
  const app = getApp();
  app.globalData.token = session.accessToken;
  app.globalData.isLoggedIn = true;
  app.globalData.userInfo = session.user;
  return session.user;
}

/**
 * WeChat login flow
 * 1. Call wx.login() to get code
 * 2. Send code to backend for user lookup/creation
 * 3. Store JWT token
 */
async function wechatLogin() {
  try {
    // Step 1: Get WeChat login code
    const { code } = await _wxLogin();
    if (!code) {
      throw new Error('获取微信登录凭证失败');
    }

    // Step 2: Exchange code for JWT
    const { request } = require('./request');
    const result = await request({
      url: '/api/auth/wechat-login',
      method: 'POST',
      data: { code },
      noAuth: true,
      suppressToast: true,
    });

    return saveSession(result);
  } catch (err) {
    console.error('[Auth] WeChat login failed:', err);
    throw err;
  }
}

/**
 * Phone + verification code login
 */
async function phoneLogin(phone, code) {
  const { request } = require('./request');
  const result = await request({
    url: '/api/auth/login-by-code',
    method: 'POST',
    data: { phone, code },
    noAuth: true,
  });

  return saveSession(result);
}

/**
 * Email + password login
 */
async function emailLogin(email, password) {
  const { request } = require('./request');
  const result = await request({
    url: '/api/auth/login',
    method: 'POST',
    data: { account: email, password },
    noAuth: true,
  });

  return saveSession(result);
}

/**
 * Register new account
 */
async function register(username, email, password) {
  const { request } = require('./request');
  return request({
    url: '/api/auth/register',
    method: 'POST',
    data: { username, email, password },
    noAuth: true,
  });
}

/**
 * Send verification code
 */
async function sendCode(phone) {
  const { request } = require('./request');
  return request({
    url: '/api/auth/send-code',
    method: 'POST',
    data: { phone },
    noAuth: true,
  });
}

/**
 * Refresh access token using refresh_token
 */
async function refreshAccessToken() {
  return null;
}

/**
 * Get current user info from backend
 */
async function getCurrentUser() {
  const { request } = require('./request');
  return request({ url: '/api/auth/me' });
}

/**
 * Clear login state (logout)
 */
function clearSession() {
  wx.removeStorageSync('access_token');
  wx.removeStorageSync('refresh_token');

  const app = getApp();
  app.globalData.token = '';
  app.globalData.isLoggedIn = false;
  app.globalData.userInfo = null;
  app.globalData.credits = 0;
}

function logout() {
  clearSession();

  wx.reLaunch({ url: '/pages/login/login' });
}

/**
 * Check if user is logged in (local check, no network request)
 */
function isLoggedIn() {
  const app = getApp();
  return app.globalData.isLoggedIn && !!app.globalData.token;
}

/**
 * Get stored access token
 */
function getAccessToken() {
  return wx.getStorageSync('access_token') || '';
}

/**
 * Check if stored token is likely expired (client-side estimate)
 */
function isTokenExpired() {
  return !getAccessToken();
}

/**
 * Ensure user is authenticated or redirect to login.
 * Returns true if authenticated, false otherwise (page will redirect).
 */
function requireAuth() {
  if (!isLoggedIn()) {
    wx.navigateTo({ url: '/pages/login/login' });
    return false;
  }
  return true;
}

/**
 * Promisified wx.login()
 */
function _wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) {
          resolve({ code: res.code });
        } else {
          reject(new Error(res.errMsg || 'wx.login failed'));
        }
      },
      fail: (err) => {
        reject(err);
      },
    });
  });
}

/**
 * Get WeChat user profile (avatar, nickname) via button authorization
 */
function getWechatUserProfile() {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        resolve(res.userInfo);
      },
      fail: (err) => {
        reject(err);
      },
    });
  });
}

module.exports = {
  wechatLogin,
  phoneLogin,
  emailLogin,
  register,
  sendCode,
  refreshAccessToken,
  getCurrentUser,
  logout,
  isLoggedIn,
  getAccessToken,
  isTokenExpired,
  requireAuth,
  getWechatUserProfile,
  saveSession,
  clearSession,
};
