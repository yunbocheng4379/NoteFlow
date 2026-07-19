import axios, { AxiosInstance, AxiosResponse } from 'axios';
import toast from 'react-hot-toast'
import { DISMISSED_UPDATE_LOG_SESSION_KEY } from '@/constant/updateLog'

export interface IResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

declare module 'axios' {
  export interface AxiosRequestConfig {
    suppressToast?: boolean
  }
}

const baseURL = import.meta.env.VITE_API_BASE_URL;

const request: AxiosInstance = axios.create({
  baseURL: baseURL || '/api',
  timeout: 10000,
});

// 请求拦截器：自动注入 token
request.interceptors.request.use((config) => {
  try {
    const stored = localStorage.getItem('noteflow-user')
    if (stored) {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        config.headers = config.headers ?? {}
        config.headers['Authorization'] = `Bearer ${state.token}`
      }
    }
  } catch {
    // ignore parse error
  }
  return config
})

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse<IResponse>) => {
    const res = response.data;
    if (res.code === 0) {
      return res.data;
    } else {
      if (!response.config?.suppressToast) {
        toast.error(res.msg || '操作失败，请稍后再试');
      }
      return Promise.reject(res);
    }
  },
  (error) => {
    const suppress = error?.config?.suppressToast === true
    const res = error?.response?.data as IResponse | undefined;

    // 401 自动清除登录态并跳转登录页
    if (error?.response?.status === 401) {
      localStorage.removeItem('noteflow-user')
      // sessionStorage 同一标签页内退出重登不会自动清空, 必须在这里显式清掉「已关闭」的更新日志记录,
      // 否则用户重新登录后即使管理员没结束通知也看不到
      sessionStorage.removeItem(DISMISSED_UPDATE_LOG_SESSION_KEY)
      window.location.href = '/login'
      return Promise.reject(res)
    }

    if (res) {
      if (!suppress) toast.error(res.msg || '服务器错误，请稍后再试');
      return Promise.reject(res);
    } else {
      if (!suppress) toast.error('请求失败，请检查网络连接或稍后再试')
      return Promise.reject({ code: -1, msg: '请求失败，请检查网络连接', data: null } as IResponse);
    }
  }
);

export default request
