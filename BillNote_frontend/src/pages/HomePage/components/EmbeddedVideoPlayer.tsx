import { X } from 'lucide-react'
import type { AudioMeta } from '@/store/taskStore'

export interface SeekSignal {
  /** 跳转目标秒数 */
  seconds: number
  /** 每次点击自增，用于强制重挂载 iframe 触发重新定位 */
  nonce: number
}

interface EmbeddedVideoPlayerProps {
  audioMeta?: AudioMeta
  seek: SeekSignal | null
  onClose: () => void
}

/** 判断该平台 + video_id 是否支持页面内嵌入播放 */
export function isEmbeddable(audioMeta?: AudioMeta): boolean {
  if (!audioMeta?.video_id) return false
  return audioMeta.platform === 'bilibili' || audioMeta.platform === 'youtube'
}

/** 根据平台与跳转秒数拼接官方 iframe 嵌入地址 */
function buildEmbedUrl(audioMeta: AudioMeta, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds))

  if (audioMeta.platform === 'bilibili') {
    // video_id 形如 BV1xx411c7xx 或多 P 的 BV1xx411c7xx_p2
    const [bvid, page] = audioMeta.video_id.split('_p')
    const p = page || '1'
    return `https://player.bilibili.com/player.html?bvid=${bvid}&p=${p}&t=${t}&autoplay=1&high_quality=1`
  }

  // youtube
  return `https://www.youtube.com/embed/${audioMeta.video_id}?start=${t}&autoplay=1`
}

export default function EmbeddedVideoPlayer({
  audioMeta,
  seek,
  onClose,
}: EmbeddedVideoPlayerProps) {
  if (!audioMeta || !seek || !isEmbeddable(audioMeta)) return null

  const src = buildEmbedUrl(audioMeta, seek.seconds)

  return (
    <div className="mb-3 overflow-hidden rounded-lg border bg-black shadow-sm">
      <div className="flex items-center justify-between bg-neutral-900 px-3 py-1.5">
        <span className="truncate text-xs font-medium text-white/80" title={audioMeta.title}>
          {audioMeta.title || '原片播放'}
        </span>
        <button
          onClick={onClose}
          className="flex shrink-0 items-center rounded p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭播放器"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        {/* key 绑定 nonce：每次点击时间戳都重挂载 iframe，从新时间点开始播放 */}
        <iframe
          key={seek.nonce}
          src={src}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          scrolling="no"
          frameBorder="0"
        />
      </div>
    </div>
  )
}
