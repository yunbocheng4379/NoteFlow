import request from '@/utils/request'
import toast from 'react-hot-toast'

export const generateNote = async (data: {
  video_url: string
  platform: string
  quality: string
  model_name: string
  provider_id: string
  task_id?: string
  format: Array<string>
  style: string
  extras?: string
  video_understand?: boolean
  video_interval?: number
  grid_size: Array<number>
  collection_id?: number
}) => {
  try {
    console.log('generateNote', data)
    const response = await request.post('/generate_note', data)

    if (!response) {
      if (response.data.msg) {
        toast.error(response.data.msg)
      }
      return null
    }
    toast.success('笔记生成任务已提交！')

    console.log('res', response)
    // 成功提示

    return response
  } catch (e: any) {
    console.error('❌ 请求出错', e)

    // 错误提示
    // toast.error('笔记生成失败，请稍后重试')

    throw e // 抛出错误以便调用方处理
  }
}

export const delete_task = async ({ video_id, platform }) => {
  try {
    const data = {
      video_id,
      platform,
    }
    const res = await request.post('/delete_task', data)


      toast.success('任务已成功删除')
      return res
  } catch (e) {
    toast.error('请求异常，删除任务失败')
    console.error('❌ 删除任务失败:', e)
    throw e
  }
}

export interface VideoInfo {
  title: string
  cover_url: string
  duration: number
  platform: string
  video_id: string
}

/**
 * 轻量解析视频元信息（标题/封面/时长），用于新建笔记弹窗的即时预览。
 * 不进入生成流程；解析失败时静默返回 null（不弹 toast）。
 */
export const getVideoInfo = async (
  video_url: string,
  platform: string,
): Promise<VideoInfo | null> => {
  try {
    const data = (await request.post(
      '/video_info',
      { video_url, platform },
      { timeout: 30000, suppressToast: true },
    )) as unknown as VideoInfo
    return data ?? null
  } catch (e) {
    console.warn('解析视频信息失败：', e)
    return null
  }
}

export const get_task_status = async (task_id: string) => {
  try {
    // 成功提示

    return await request.get('/task_status/' + task_id)
  } catch (e) {
    console.error('❌ 请求出错', e)

    // 错误提示
    toast.error('笔记生成失败，请稍后重试')

    throw e // 抛出错误以便调用方处理
  }
}

/**
 * 保存用户编辑后的笔记 Markdown 正文，覆盖后端持久化的当前内容。
 */
export const updateNoteContent = async (
  task_id: string,
  content: string,
): Promise<{ task_id: string; markdown: string }> => {
  return await request.put(`/note/${task_id}`, { content }, { suppressToast: true })
}

export interface ChannelVideoItem {
  video_url: string
  title: string
  cover_url: string
  duration: number
}

/**
 * 解析 UP主空间/合集/收藏夹 (B站) 或频道/播放列表 (YouTube) 链接，列出其中的视频。
 * 仅支持 bilibili / youtube。解析失败时抛出异常，由调用方决定如何提示。
 */
export const getChannelVideos = async (
  channel_url: string,
  platform: string,
): Promise<ChannelVideoItem[]> => {
  const data = (await request.post(
    '/channel_videos',
    { channel_url, platform },
    { timeout: 30000 },
  )) as unknown as { platform: string; videos: ChannelVideoItem[] }
  return data?.videos ?? []
}

export interface BatchVideoItem {
  video_url: string
  platform: string
}

export interface BatchGenerateResultItem {
  video_url: string
  task_id: string | null
  success: boolean
  message: string
}

/**
 * 批量提交笔记生成任务，共享同一份生成设置（模型/风格/quality/format 等）。
 */
export const generateNotesBatch = async (data: {
  items: BatchVideoItem[]
  quality: string
  model_name: string
  provider_id: string
  format: Array<string>
  style: string
  extras?: string
  video_understanding?: boolean
  video_interval?: number
  grid_size: Array<number>
  collection_id?: number
}): Promise<{ batch_id: string; results: BatchGenerateResultItem[] }> => {
  return await request.post('/generate_notes_batch', data)
}
