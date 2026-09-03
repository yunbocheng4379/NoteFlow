import { useEffect, useState } from 'react'
import { Bell, CheckCheck, ExternalLink, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { userNotificationsApi, type UserNotification } from '@/services/user_notifications'

const fmt = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const CATEGORY_LABEL: Record<string, string> = {
  note_style_review: '笔记风格审核',
  credit_adjustment: '电力调整',
}

const SEVERITY_LABEL: Record<string, string> = {
  info: '信息',
  warning: '提醒',
  error: '重要',
}

const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
}

export default function NotificationsPage() {
  const [items, setItems] = useState<UserNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<UserNotification | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const result = await userNotificationsApi.list({ page: 1, page_size: 100 })
      setItems(result.items ?? [])
    } catch {
      toast.error('加载通知失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const markRead = async (item: UserNotification) => {
    if (item.is_read) return
    try {
      await userNotificationsApi.markRead(item.id)
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_read: true } : row))
    } catch {
      toast.error('更新通知状态失败')
    }
  }

  const markAllRead = async () => {
    setBusy(true)
    try {
      await userNotificationsApi.markAllRead()
      setItems((current) => current.map((item) => ({ ...item, is_read: true })))
    } catch {
      toast.error('更新通知状态失败')
    } finally {
      setBusy(false)
    }
  }

  const openDetail = async (item: UserNotification) => {
    await markRead(item)
    setSelected({ ...item, is_read: true })
  }

  const unread = items.filter((item) => !item.is_read).length

  return (
    <div className="h-full w-full overflow-auto bg-[#f5f5f5]">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold text-neutral-900">我的通知</h1>
            {unread > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{unread} 条未读</span>}
          </div>
          <Button variant="outline" size="sm" disabled={!unread || busy} onClick={markAllRead}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
            全部已读
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">暂无通知</div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-neutral-50 ${item.is_read ? '' : 'bg-primary/[0.03]'}`}
                  onClick={() => markRead(item)}
                >
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.is_read ? 'bg-neutral-200' : 'bg-primary'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-800">{item.title}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ring-1 ${SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.info}`}>
                        {CATEGORY_LABEL[item.category] ?? SEVERITY_LABEL[item.severity] ?? '通知'}
                      </span>
                      {!item.is_read && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 ring-1 ring-blue-200">未读</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-500">{item.content}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-neutral-400">
                      <span>{fmt(item.created_at)}</span>
                      <button
                        onClick={(event) => { event.stopPropagation(); void openDetail(item) }}
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
        </div>
      </div>

      {selected && <NotificationDetail notification={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function NotificationDetail({
  notification,
  onClose,
}: {
  notification: UserNotification
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 border-b border-neutral-200 px-6 py-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-neutral-900">{notification.title}</h2>
                <span className={`rounded px-2 py-0.5 text-xs ring-1 ${SEVERITY_BADGE[notification.severity] ?? SEVERITY_BADGE.info}`}>
                  {CATEGORY_LABEL[notification.category] ?? SEVERITY_LABEL[notification.severity] ?? '通知'}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-400">{fmt(notification.created_at)}</p>
            </div>
            <button onClick={onClose} className="ml-2 shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600" aria-label="关闭">✕</button>
          </div>
        </div>
        <div className="overflow-y-auto px-8 py-6">
          <p className="whitespace-pre-wrap text-sm leading-7 text-neutral-700">{notification.content}</p>
          {notification.link && (
            <Link to={notification.link} onClick={onClose} className="mt-5 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              查看相关内容 <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
