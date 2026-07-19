import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import gfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import { Loader2, Megaphone } from 'lucide-react'

import { userUpdateLogApi, type UpdateLogItem } from '@/services/updateLog'
import { ScrollArea } from '@/components/ui/scroll-area'
import 'github-markdown-css/github-markdown-light.css'
import 'katex/dist/katex.min.css'

const PAGE_SIZE = 10

function formatDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_LABEL: Record<UpdateLogItem['status'], string> = {
  pending: '未通知',
  active: '通知中',
  ended: '已结束',
}

const STATUS_BADGE: Record<UpdateLogItem['status'], string> = {
  pending: 'bg-neutral-100 text-neutral-500 ring-neutral-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ended: 'bg-amber-50 text-amber-700 ring-amber-200',
}

export default function UpdateLogPage() {
  const [items, setItems] = useState<UpdateLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<UpdateLogItem | null>(null)

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const res = await userUpdateLogApi.list({
          page: targetPage,
          page_size: PAGE_SIZE,
        })
        setItems(res.items)
        setTotal(res.total)
        setPage(res.page)
      } catch {
        // request 拦截器已 toast
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    load(1)
  }, [load])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  )

  return (
    <div className="h-full w-full overflow-auto bg-neutral-50">
      <div className="mx-auto max-w-4xl p-6">
        {/* 标题 */}
        <div className="mb-6 flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">更新日志</h1>
          {total > 0 && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
              共 {total} 条
            </span>
          )}
        </div>

        {/* 列表 */}
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              暂无更新日志
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start gap-3 px-5 py-4 hover:bg-neutral-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">
                        {it.title}
                      </span>
                      {it.version && (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">
                          {it.version}
                        </span>
                      )}
                      <span
                        className={`rounded px-2 py-0.5 text-xs ring-1 ${STATUS_BADGE[it.status]}`}
                      >
                        {STATUS_LABEL[it.status]}
                      </span>
                    </div>
                    {it.summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                        {it.summary}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                      {it.published_at && <span>发布 {formatDate(it.published_at)}</span>}
                      {it.ended_at && <span>结束 {formatDate(it.ended_at)}</span>}
                      <button
                        onClick={() => setSelected(it)}
                        className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        查看详情
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <span>
                共 {total} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => load(page - 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => load(page + 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 详情 Modal — 直接渲染 content (Markdown) */}
      {selected && (
        <UpdateLogDetail log={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ─── 详情对话框 ────────────────────────────────────────────────────────────

function UpdateLogDetail({
  log,
  onClose,
}: {
  log: UpdateLogItem
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* 固定标题栏 */}
        <div className="shrink-0 border-b border-neutral-200 px-6 py-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold text-neutral-900">
                  {log.title}
                </h2>
                {log.version && (
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">
                    {log.version}
                  </span>
                )}
                <span
                  className={`rounded px-2 py-0.5 text-xs ring-1 ${STATUS_BADGE[log.status]}`}
                >
                  {STATUS_LABEL[log.status]}
                </span>
              </div>
              {log.summary && (
                <p className="mt-1 text-sm text-neutral-500">{log.summary}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                {log.published_at && <span>发布 {formatDate(log.published_at)}</span>}
                {log.ended_at && <span>结束 {formatDate(log.ended_at)}</span>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="ml-2 shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 内容区: Markdown 渲染 */}
        <ScrollArea className="flex-1">
          <div className="markdown-body px-8 py-6">
            <ReactMarkdown
              remarkPlugins={[gfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeSlug]}
              components={markdownComponents}
            >
              {log.content}
            </ReactMarkdown>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

// 简化版 Markdown components, 复用笔记正文里的样式但不需要锚点跳转/原片链接
const markdownComponents = {
  h1: ({ children, ...p }: any) => (
    <h1
      className="text-gray-900 my-6 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl"
      {...p}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...p }: any) => (
    <h2
      className="text-gray-900 mt-10 mb-4 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0"
      {...p}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...p }: any) => (
    <h3
      className="text-gray-900 mt-8 mb-4 scroll-m-20 text-xl font-semibold tracking-tight"
      {...p}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...p }: any) => (
    <p className="leading-7 [&:not(:first-child)]:mt-6" {...p}>
      {children}
    </p>
  ),
  ul: ({ children, ...p }: any) => (
    <ul className="my-6 ml-6 list-disc [&>li]:mt-2" {...p}>
      {children}
    </ul>
  ),
  ol: ({ children, ...p }: any) => (
    <ol className="my-6 ml-6 list-decimal [&>li]:mt-2" {...p}>
      {children}
    </ol>
  ),
  li: ({ children, ...p }: any) => (
    <li className="my-1" {...p}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...p }: any) => (
    <blockquote
      className="border-primary/20 text-muted-foreground mt-6 border-l-4 pl-4 italic"
      {...p}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children, ...p }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
      {...p}
    >
      {children}
    </a>
  ),
  strong: ({ children, ...p }: any) => (
    <strong className="text-gray-900 font-bold" {...p}>
      {children}
    </strong>
  ),
  code: ({ inline, className, children, ...p }: any) => {
    if (inline || !className) {
      return (
        <code
          className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm"
          {...p}
        >
          {children}
        </code>
      )
    }
    return (
      <code className={className} {...p}>
        {children}
      </code>
    )
  },
  hr: (p: any) => <hr className="border-muted-foreground/20 my-8" {...p} />,
}
