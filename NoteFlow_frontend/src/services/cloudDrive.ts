import request from '@/utils/request'

export type CloudPlatform = 'baidu_pan'

export interface CloudFile {
  fs_id: number
  path: string
  name: string
  size: number
  is_dir: boolean
  server_ctime: number
}

export interface CloudFileList {
  files: CloudFile[]
  has_more: boolean
  start: number
  limit: number
}

export interface CloudAuthStatus {
  logged_in: boolean
  account_name: string | null
  expires_at?: string | null
}

/**
 * 说明: 项目的 axios 拦截器在 code===0 时已经返回 res.data,
 * 所以下面的 request 调用直接拿到 data 载荷, 不需要再 .data.data.
 */

/** 获取 OAuth 授权 URL, 前端用 window.open 打开 */
export const getAuthUrl = async (
  platform: CloudPlatform,
): Promise<{ auth_url: string; state: string }> => {
  return (await request.get(`/cloud_drive/auth/${platform}/url`)) as unknown as {
    auth_url: string
    state: string
  }
}

/** 查询用户是否已绑定该网盘 */
export const getAuthStatus = async (
  platform: CloudPlatform,
): Promise<CloudAuthStatus> => {
  return (await request.get(`/cloud_drive/auth/${platform}/status`)) as unknown as CloudAuthStatus
}

/** 登出 (删除凭据) */
export const logoutCloud = async (platform: CloudPlatform): Promise<void> => {
  await request.post(`/cloud_drive/auth/${platform}/logout`)
}

/** 列出指定路径下的视频文件和文件夹 */
export const listCloudFiles = async (
  platform: CloudPlatform,
  path: string = '/',
  start: number = 0,
  limit: number = 100,
): Promise<CloudFileList> => {
  return (await request.get('/cloud_drive/files', {
    params: { platform, path, start, limit },
  })) as unknown as CloudFileList
}

/** 从网盘选中的文件生成笔记 */
export const generateFromCloud = async (payload: {
  platform: CloudPlatform
  files: Array<{ fs_id: number; path: string; name: string }>
  model_name: string
  provider_id: string
  quality: string
  format: string[]
  style: string
  extras?: string
  collection_id?: number
}): Promise<{ task_ids: string[]; errors: Array<{ file: string; msg: string }> }> => {
  return (await request.post('/cloud_drive/generate', payload)) as unknown as {
    task_ids: string[]
    errors: Array<{ file: string; msg: string }>
  }
}
