import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import gfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { ChevronDown, ChevronRight, Eye, Folder, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  exportSharedCollectionNote,
  getSharedCollection,
  type SharedCollection,
  type ShareExportFormat,
} from '@/services/share.ts'
import { ExportMenu } from '@/pages/ShareViewPage/ExportMenu'

function NoteEntry({ note, token }: { note: SharedCollection['notes'][number]; token: string }) {
  const [expanded, setExpanded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const audioMeta = note.note.audio_meta || {}
  const markdownContent = Array.isArray(note.note.markdown)
    ? note.note.markdown.map((m: any) => m.content ?? '').join('\n\n---\n\n')
    : note.note.markdown ?? ''

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-neutral-50"
      >
        <span className="truncate text-sm font-medium text-neutral-800">
          {audioMeta.title || note.task_id}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-neutral-100 px-5 py-5">
          <div className="mb-3 flex justify-end">
            <ExportMenu
              size="xs"
              label="导出此篇"
              loading={exporting}
              onSelect={async (format: ShareExportFormat) => {
                setExporting(true)
                try {
                  await exportSharedCollectionNote(
                    token,
                    note.task_id,
                    format,
                    audioMeta.title || note.task_id,
                  )
                } catch {
                  toast.error('导出失败，请稍后重试')
                } finally {
                  setExporting(false)
                }
              }}
            />
          </div>
          <div className="markdown-body !bg-transparent !text-inherit">
            <ReactMarkdown remarkPlugins={[gfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {markdownContent}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CollectionShareViewPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<SharedCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    getSharedCollection(token)
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

  const { collection, notes, view_count } = data

  return (
    <div className="mx-auto h-screen max-w-4xl overflow-y-auto px-4 py-10">
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
          {collection.cover_url ? (
            <img src={collection.cover_url} alt={collection.name} className="h-full w-full object-cover" />
          ) : (
            <Folder className="h-7 w-7 text-neutral-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-snug text-neutral-900">{collection.name}</h1>
          {collection.description && (
            <p className="mt-1 text-sm text-neutral-500">{collection.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-sm text-neutral-500">
            <span>{notes.length} 篇笔记</span>
            <span className="flex items-center gap-1">
              <Eye className="h-4 w-4" />
              {view_count} 次浏览
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {notes.map((note) => (
          <NoteEntry key={note.task_id} note={note} token={token!} />
        ))}
      </div>

      <footer className="mt-16 border-t border-neutral-100 pt-6 text-center text-xs text-neutral-400">
        由 <a href="/" className="underline">NoteFlow</a> 生成
      </footer>
    </div>
  )
}
