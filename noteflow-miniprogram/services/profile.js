/**
 * NoteFlow Mini Program - Profile API Service
 */

const { request } = require('../utils/request');

module.exports = {
  /** Get user profile */
  getProfile: () => request({ url: '/api/profile', suppressToast: true }),

  /** Update user profile */
  updateProfile: (data) => request({
    url: '/api/profile',
    method: 'PUT',
    data,
  }),

  /** Update password */
  updatePassword: (oldPassword, newPassword) => request({
    url: '/api/profile/password',
    method: 'PUT',
    data: { old_password: oldPassword, new_password: newPassword },
  }),

  /** Upload avatar (wx.chooseImage first, then upload) */
  uploadAvatar: (filePath) => {
    return new Promise((resolve, reject) => {
      const ENV = require('../.env.js');
      const token = wx.getStorageSync('access_token');

      wx.uploadFile({
        url: `${ENV.API_BASE}/api/profile/avatar`,
        filePath,
        name: 'file',
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
        success: (res) => {
          try {
            const data = JSON.parse(res.data);
            if (data.code === 200 || data.success) {
              resolve(data.data || data);
            } else {
              wx.showToast({ title: data.msg || '上传失败', icon: 'none' });
              reject(data);
            }
          } catch {
            resolve(res);
          }
        },
        fail: (err) => {
          wx.showToast({ title: '上传失败', icon: 'none' });
          reject(err);
        },
      });
    });
  },

  /** Get notification settings */
  getNotificationSettings: () => request({
    url: '/api/profile/notify',
    suppressToast: true,
  }),

  /** Update notification settings */
  updateNotificationSettings: (settings) => request({
    url: '/api/profile/notify',
    method: 'PUT',
    data: settings,
  }),
};
