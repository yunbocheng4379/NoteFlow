/**
 * NoteFlow Mini Program - Auth API Service
 */

const { request } = require('../utils/request');

module.exports = {
  /** Get current user info */
  me: () => request({ url: '/api/auth/me' }),

  /** Email + password login */
  login: (email, password) => request({
    url: '/api/auth/login',
    method: 'POST',
    data: { account: email, password },
    noAuth: true,
  }),

  /** Register new account */
  register: (username, email, password) => request({
    url: '/api/auth/register',
    method: 'POST',
    data: { username, email, password },
    noAuth: true,
  }),

  /** Send verification code to phone */
  sendCode: (phone) => request({
    url: '/api/auth/send-code',
    method: 'POST',
    data: { phone },
    noAuth: true,
  }),

  /** Phone + verification code login */
  loginByCode: (phone, code) => request({
    url: '/api/auth/login-by-code',
    method: 'POST',
    data: { phone, code },
    noAuth: true,
  }),

  /** WeChat login with code */
  wechatLogin: (code) => request({
    url: '/api/auth/wechat-login',
    method: 'POST',
    data: { code },
    noAuth: true,
  }),

  /** Refresh access token */
  refreshToken: (refreshToken) => request({
    url: '/api/auth/refresh',
    method: 'POST',
    data: { refresh_token: refreshToken },
    noAuth: true,
    suppressToast: true,
  }),
};
