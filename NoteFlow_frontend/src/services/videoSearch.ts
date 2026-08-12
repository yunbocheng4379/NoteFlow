import request from '@/utils/request'

/**
 * 单条搜索结果，对应后端 /api/video_search 返回的 items 元素。
 * 后端字段允许缺失（尤其是 duration / publish_time / play_count 等），
 * 因此这里全部用 `| null` 表示以便前端做兜底渲染。
 */
export interface VideoSearchItem {
  platform: 'bilibili' | 'youtube'
  video_url: string
  title: string
  cover_url: string | null
  author: string | null
  duration: number | null
  publish_time: string | null
  play_count: number | null
}

export interface VideoSearchResponse {
  keyword: string
  total: number
  items: VideoSearchItem[]
  platform_status: {
    bilibili: 'ok' | 'failed'
    youtube: 'ok' | 'failed'
  }
}

/**
 * 视频搜索客户端。
 * - `@/utils/request` 的响应拦截器已经把 `ResponseWrapper.data` 剥掉，
 *   因此 `request.get` 的返回值直接就是 `VideoSearchResponse` payload。
 * - 通过 `AbortSignal` 允许 ExplorePanel 在关键词快速切换时取消旧请求。
 * - `suppressToast` 用来让页面自行决定失败时的提示（避免与拦截器 toast 重复）。
 */
export async function searchVideos(
  keyword: string,
  signal?: AbortSignal,
): Promise<VideoSearchResponse> {
  const data = (await request.get('/video_search', {
    params: { q: keyword, limit: 20 },
    signal,
    suppressToast: true,
    timeout: 20000,
  })) as unknown as VideoSearchResponse
  return data
}
