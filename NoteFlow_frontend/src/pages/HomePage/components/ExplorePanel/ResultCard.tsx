import { FC } from 'react'
import { Clock, SlidersHorizontal } from 'lucide-react'

import { BiliBiliLogo, YoutubeLogo } from '@/components/Icons/platform.tsx'
import { VideoSearchItem } from '@/services/videoSearch.ts'

const apiBase = String(import.meta.env.VITE_API_BASE_URL || 'api').replace(/\/$/, '')
const proxiedCover = (url?: string | null) =>
  url ? `${apiBase}/image_proxy?url=${encodeURIComponent(url)}` : ''

const formatDuration = (sec?: number | null): string => {
  if (!sec || sec <= 0) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

const platformLabel: Record<VideoSearchItem['platform'], string> = {
  bilibili: 'B站',
  youtube: 'YouTube',
}
const platformLogo: Record<VideoSearchItem['platform'], FC> = {
  bilibili: BiliBiliLogo,
  youtube: YoutubeLogo,
}

interface ResultCardProps {
  item: VideoSearchItem
  onSelect: (item: VideoSearchItem) => void
  onMoreSettings: (item: VideoSearchItem) => void
}

const ResultCard: FC<ResultCardProps> = ({ item, onSelect, onMoreSettings }) => {
  const PlatformLogo = platformLogo[item.platform]
  const duration = formatDuration(item.duration)

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-left transition-all hover:-translate-y-0.5 hover:border-[#167a6e]/40 hover:shadow-md"
    >
      {/* Cover with platform badge + duration */}
      <div className="relative aspect-[16/9] w-full bg-neutral-100">
        {item.cover_url && (
          <img
            src={proxiedCover(item.cover_url)}
            alt={item.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <span className="inline-block h-2.5 w-2.5 [&_svg]:h-full [&_svg]:w-full">
            <PlatformLogo />
          </span>
          {platformLabel[item.platform]}
        </span>
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <Clock className="h-2.5 w-2.5" />
            {duration}
          </span>
        )}
        {/* More settings button — top-right */}
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onMoreSettings(item)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onMoreSettings(item)
            }
          }}
          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/90 text-neutral-700 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
          title="更多设置"
        >
          <SlidersHorizontal className="h-3 w-3" />
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-0.5 px-2.5 py-2">
        <p
          className="line-clamp-2 text-xs font-medium leading-relaxed text-neutral-800"
          title={item.title}
        >
          {item.title || '未命名视频'}
        </p>
        {item.author && (
          <p className="truncate text-[11px] text-neutral-500">{item.author}</p>
        )}
      </div>
    </button>
  )
}

export default ResultCard
