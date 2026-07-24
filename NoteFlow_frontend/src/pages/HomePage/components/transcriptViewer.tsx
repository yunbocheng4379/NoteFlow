"use client"

import { useTaskStore, type AudioMeta } from "@/store/taskStore"
import { useEffect, useState, useRef } from "react"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area.tsx"
import { isEmbeddable } from "@/pages/HomePage/components/EmbeddedVideoPlayer.tsx"

interface Segment {
  start: number
  end: number
  text: string

}

interface Task {
  transcript?: {
    segments?: Segment[]
  }
  audioMeta?: AudioMeta
}

interface TranscriptViewerProps {
  /** 可嵌入平台（B站/YouTube）：在页面内播放器定位播放 */
  onSeek?: (seconds: number) => void
}

/** 不支持页面内嵌入的平台，构建外部跳转链接（新标签页打开并定位到指定时间） */
function buildExternalTimestampUrl(audioMeta: AudioMeta, seconds: number): string | null {
  const t = Math.max(0, Math.floor(seconds))
  if (!audioMeta.video_id) return null

  if (audioMeta.platform === 'douyin') {
    return `https://www.douyin.com/video/${audioMeta.video_id}?start_time=${t}`
  }
  return null
}

const TranscriptViewer = ({ onSeek }: TranscriptViewerProps) => {
  const getCurrentTask = useTaskStore((state) => state.getCurrentTask)
  const currentTaskId = useTaskStore((state) => state.currentTaskId)
  const [task, setTask] = useState<Task | null>(null)
  const [activeSegment, setActiveSegment] = useState<number | null>(null)
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    setTask(getCurrentTask())
  }, [currentTaskId, getCurrentTask])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const canEmbed = isEmbeddable(task?.audioMeta)

  const jumpToTimestamp = (seconds: number) => {
    if (canEmbed) {
      onSeek?.(seconds)
      return
    }
    const url = task?.audioMeta ? buildExternalTimestampUrl(task.audioMeta, seconds) : null
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleSegmentClick = (index: number, seconds: number) => {
    setActiveSegment(index)
    jumpToTimestamp(seconds)
  }

  const scrollToSegment = (index: number) => {
    segmentRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    })
  }

  return (
      <div className="transcript-viewer flex h-full w-full flex-col  rounded-md border bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">转写结果</h2>
        {!task?.transcript?.segments?.length ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">暂无转写内容</div>
        ) : (
            <>


            <div className="mb-3 grid grid-cols-[80px_1fr] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                <div>时间</div>
                <div>内容</div>
              </div>
            <ScrollArea className="w-full overflow-y-auto">

              <div className="space-y-1">
                {task.transcript.segments.map((segment, index) => {
                  const jumpable = canEmbed || (task.audioMeta && !!buildExternalTimestampUrl(task.audioMeta, segment.start))
                  return (
                    <div
                        key={index}
                        ref={(el) => (segmentRefs.current[index] = el)}
                        className={cn(
                            "group grid grid-cols-[80px_1fr] gap-2 rounded-md p-2 transition-colors hover:bg-slate-50",
                            activeSegment === index && "bg-slate-100",
                        )}
                        onClick={() => handleSegmentClick(index, segment.start)}
                    >
                      <div
                          className={cn(
                              "flex items-center gap-1 text-xs text-slate-500",
                              jumpable && "cursor-pointer hover:text-teal-600",
                          )}
                          title={jumpable ? "跳转到视频对应位置" : undefined}
                      >
                        <Play
                            className={cn(
                                "h-3 w-3 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100",
                                !jumpable && "invisible",
                            )}
                        />
                        <span>{formatTime(segment.start)}</span>
                      </div>

                      <div className="text-sm leading-relaxed text-slate-700">
                        {segment.speaker && (
                            <span className="mr-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {segment.speaker}
                    </span>
                        )}
                        {segment.text}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>

            </>
        )}


        {task?.transcript?.segments?.length > 0 && (
            <div className="mt-4 flex justify-between border-t pt-3 text-xs text-slate-500">
              <span>共 {task.transcript.segments.length} 条片段</span>
              <span>总时长: {formatTime(task.transcript.segments[task.transcript.segments.length - 1]?.end || 0)}</span>
            </div>
        )}
      </div>
  )
}

export default TranscriptViewer
