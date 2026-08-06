import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import gfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { Eye, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { exportSharedNote, getSharedNote, type SharedNote, type ShareExportFormat } from '@/services/share.ts'
import { ExportMenu } from '@/pages/ShareViewPage/ExportMenu'

export default function ShareViewPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<SharedNote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!token) return
    getSharedNote(token)
      .then(setData)
      .catch(() => setError('链接已失效或不存在'))
  }, [token])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-2xl">😢</p>
        <p className="text-neutral-600">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  const { note, view_count } = data
  const audioMeta = note.audio_meta || {}
  const markdownContent = Array.isArray(note.markdown)
    ? note.markdown.map((m: any) => m.content ?? '').join('\n\n---\n\n')
    : note.markdown ?? ''

  const baseURL = String(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const coverSrc = audioMeta.cover_url
    ? audioMeta.platform === 'local'
      ? audioMeta.cover_url
      : `${baseURL}/image_proxy?url=${encodeURIComponent(audioMeta.cover_url)}`
    : null

  return (
    <div className="mx-auto h-screen max-w-4xl overflow-y-auto px-4 py-10">
      {/* 视频元信息头部 */}
      <div className="mb-8 flex items-start gap-4">
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            className="h-20 w-32 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-snug text-neutral-900">
            {audioMeta.title || '分享笔记'}
          </h1>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-neutral-500">
            <Eye className="h-4 w-4" />
            <span>{view_count} 次浏览</span>
          </div>
        </div>
        <ExportMenu
          loading={exporting}
          onSelect={async (format: ShareExportFormat) => {
            if (!token) return
            setExporting(true)
            try {
              await exportSharedNote(token, format, audioMeta.title || '分享笔记')
            } catch {
              toast.error('导出失败，请稍后重试')
            } finally {
              setExporting(false)
            }
          }}
        />
      </div>

      {/* 笔记正文 */}
      <div className="markdown-body !bg-transparent !text-inherit">
        <ReactMarkdown
          remarkPlugins={[gfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {markdownContent}
        </ReactMarkdown>
      </div>

      <footer className="mt-16 border-t border-neutral-100 pt-6 text-center text-xs text-neutral-400">
        由 <a href="/" className="underline">NoteFlow</a> 生成
      </footer>
    </div>
  )
}
