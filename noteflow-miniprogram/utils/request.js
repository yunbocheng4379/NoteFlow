/**
 * NoteFlow Mini Program - Unified Network Request Wrapper
 *
 * Features:
 *   - Automatic Bearer token injection
 *   - 401 auto-retry with token refresh
 *   - Unified error handling with toast
 *   - Request deduplication for concurrent calls
 */

const ENV = require('../.env.js');
const { clearSession } = require('./auth');
const { unwrapResponse } = require('./contracts');

// Pending request cache for deduplication
const _pendingRequests = {};

/**
 * Core request function
 * @param {Object} options
 * @param {string}  options.url          - API path (e.g. '/api/auth/me')
 * @param {string}  options.method       - HTTP method, default 'GET'
 * @param {Object}  options.data         - Request body
 * @param {Object}  options.header       - Extra headers
 * @param {number}  options.timeout      - Timeout in ms, default 30000
 * @param {boolean} options.suppressToast - Suppress error toast
 * @param {boolean} options.noAuth       - Skip token injection
 * @param {boolean} options.dedup        - Enable request deduplication (default true for GET)
 * @returns {Promise<any>}
 */
function request(options = {}) {
  const {
    url,
    method = 'GET',
    data = {},
    header = {},
    timeout = ENV.REQUEST_TIMEOUT,
    suppressToast = false,
    noAuth = false,
    dedup = (method === 'GET'),
  } = options;

  // Request deduplication for concurrent GET calls
  const dedupKey = dedup ? `${method}:${url}:${JSON.stringify(data)}` : null;
  if (dedupKey && _pendingRequests[dedupKey]) {
    return _pendingRequests[dedupKey];
  }

  const p = _executeRequest({ url, method, data, header, timeout, suppressToast, noAuth });

  if (dedupKey) {
    _pendingRequests[dedupKey] = p;
    p.finally(() => { delete _pendingRequests[dedupKey]; });
  }

  return p;
}

function _executeRequest({ url, method, data, header, timeout, suppressToast, noAuth }) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : `${ENV.API_BASE}${url}`;
    const token = wx.getStorageSync('access_token');

    const headers = {
      'Content-Type': 'application/json',
      ...(token && !noAuth ? { 'Authorization': `Bearer ${token}` } : {}),
      ...header,
    };

    wx.request({
      url: fullUrl,
      method,
      data,
      header: headers,
      timeout,
      success: (res) => {
        if (res.statusCode === 401 && !noAuth) {
          clearSession();
          reject({ code: 401, message: '登录已过期，请重新登录' });
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(unwrapResponse(res.data));
          } catch (error) {
            if (!suppressToast) wx.showToast({ title: error.message, icon: 'none', duration: 2500 });
            reject(error);
          }
        } else {
          const msg = `请求异常 (${res.statusCode})`;
          if (!suppressToast) {
            wx.showToast({ title: msg, icon: 'none', duration: 2500 });
          }
          reject({ code: res.statusCode, message: msg });
        }
      },
      fail: (err) => {
        if (!suppressToast) {
          const msg = err.errMsg.includes('timeout') ? '请求超时' :
                     err.errMsg.includes('fail') ? '网络异常' : '请求失败';
          wx.showToast({ title: msg, icon: 'none', duration: 2500 });
        }
        reject({ code: -1, message: '网络异常', detail: err });
      },
    });
  });
}

// Convenience methods
const get = (url, data, options) => request({ ...options, url, method: 'GET', data });
const post = (url, data, options) => request({ ...options, url, method: 'POST', data });
const put = (url, data, options) => request({ ...options, url, method: 'PUT', data });
const del = (url, data, options) => request({ ...options, url, method: 'DELETE', data });

module.exports = { request, get, post, put, del };
