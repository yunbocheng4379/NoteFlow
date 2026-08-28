type RawInfo = Record<string, unknown> | null | undefined

/** Resolve the original web page URL shown by the video banner. */
export function getOriginalVideoUrl(
  videoUrl?: string,
  rawInfo?: RawInfo,
  platform?: string,
  videoId?: string,
): string {
  const candidates = [videoUrl, rawInfo?.webpage_url, rawInfo?.source_url]

  const directUrl = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim()),
  )?.trim()
  if (directUrl) return directUrl

  const normalizedId = String(videoId || '').trim()
  if (platform === 'douyin' && /^\d+$/.test(normalizedId)) {
    return `https://www.douyin.com/video/${normalizedId}`
  }
  if (platform === 'kuaishou' && /^[0-9A-Za-z]+$/.test(normalizedId)) {
    return `https://www.kuaishou.com/short-video/${normalizedId}`
  }
  return ''
}
