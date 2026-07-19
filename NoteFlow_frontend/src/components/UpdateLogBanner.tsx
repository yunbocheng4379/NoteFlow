import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import {
  DISMISSED_LOG_SESSION_KEY,
  userUpdateLogApi,
  type UpdateLogItem,
} from '@/services/updateLog'
import { useUserStore } from '@/store/userStore'

/**
 * 更新日志顶部横幅: 始终只展示当前唯一一条 ``active`` 行.
 *
 * 关闭行为:
 *   - 把当前 active 的 ``id`` 写入 ``sessionStorage``,
 *     本次浏览器会话内重复命中同一 id 不再展示.
 *   - 用户刷新页面/关闭浏览器再开会话重置, 但其实只是「本会话内不打扰」.
 *   - 提供「查看更新」按钮跳转到 /update-logs 页面, 也算一次有效关闭.
 *
 * 样式参考 StartupBanner, 复用 indigo-50 主色, 跟系统通知/错误 banner 区分.
 */
export default function UpdateLogBanner() {
  const isLoggedIn = useUserStore((s) => s.isLoggedIn())
  const [log, setLog] = useState<UpdateLogItem | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!isLoggedIn) {
      setLog(null)
      return
    }
    let alive = true
    userUpdateLogApi
      .active()
      .then((row) => {
        if (!alive) return
        if (!row) {
          setLog(null)
          return
        }
        setLog(row)
        const ids = readDismissed()
        setDismissed(ids.has(row.id))
      })
      .catch(() => {
        // 静默: 后端不通时不要打扰用户.
      })
    return () => {
      alive = false
    }
  }, [isLoggedIn])

  if (!log || dismissed) return null

  const handleDismiss = () => {
    const ids = readDismissed()
    ids.add(log.id)
    try {
      sessionStorage.setItem(DISMISSED_LOG_SESSION_KEY, JSON.stringify([...ids]))
    } catch {
      /* 私密模式写不进去, 仅本次刷新内有效 */
    }
    setDismissed(true)
  }

  const handleView = () => {
    // 点击「查看更新」也视为一次关闭, 进入详情页后不再弹
    handleDismiss()
    window.location.href = '/update-logs'
  }

  return (
    <div
      data-update-log-banner
      className="fixed left-0 right-0 top-0 z-[9990] flex items-center gap-3 border-b border-indigo-200 bg-indigo-50/95 px-4 py-2 text-sm text-indigo-900 shadow-sm backdrop-blur-sm"
    >
      <Megaphone className="h-4 w-4 shrink-0 text-indigo-500" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{log.title}</span>
        {log.version && (
          <span className="ml-2 rounded bg-white/80 px-1.5 py-0.5 text-[11px] text-indigo-700 ring-1 ring-indigo-200">
            {log.version}
          </span>
        )}
        {log.summary && (
          <span className="ml-2 truncate align-middle text-indigo-700/90">
            {log.summary}
          </span>
        )}
      </div>
      <button
        onClick={handleView}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
      >
        查看更新
      </button>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
        aria-label="关闭通知"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function readDismissed(): Set<number> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_LOG_SESSION_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      return new Set(arr.filter((x) => typeof x === 'number'))
    }
    return new Set()
  } catch {
    return new Set()
  }
}

/**
 * 占位块: 不再固定 40px，而是用 CSS 变量 `--banner-h` 同步真实高度，
 * 并用 ResizeObserver 监听变化实时刷新。挂在外层布局上方，
 * 让页面内容以 `100vh - var(--banner-h)` 计算可用高度，从而做到
 * 「有 banner 让位、无 banner 恢复」动态切换。
 */
export function UpdateLogBannerSpacer() {
  const isLoggedIn = useUserStore((s) => s.isLoggedIn())
  const [log, setLog] = useState<UpdateLogItem | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!isLoggedIn) {
      setLog(null)
      return
    }
    let alive = true
    userUpdateLogApi
      .active()
      .then((row) => {
        if (!alive) return
        if (!row) { setLog(null); return }
        setLog(row)
        const ids = readDismissed()
        setDismissed(ids.has(row.id))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [isLoggedIn])

  useEffect(() => {
    if (!log || dismissed) {
      document.documentElement.style.setProperty('--banner-h', '0px')
      return
    }
    // 启动一次空写入, 让外层先用预估高度, 真正高度由 banner 自己的 ResizeObserver 同步过来
    const banner = document.querySelector<HTMLElement>('[data-update-log-banner]')
    if (banner) {
      document.documentElement.style.setProperty('--banner-h', `${banner.offsetHeight}px`)
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const h = entry.contentRect.height
          document.documentElement.style.setProperty('--banner-h', `${Math.round(h)}px`)
        }
      })
      ro.observe(banner)
      return () => ro.disconnect()
    }
  }, [log, dismissed])

  if (!log || dismissed) return null
  return <div className="h-[var(--banner-h)] shrink-0 transition-[height] duration-150" />
}
