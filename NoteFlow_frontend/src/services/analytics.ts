export type AnalyticsEventName =
  | 'page_view'
  | 'feature_click'
  | 'feature_submit'
  | 'feature_success'
  | 'feature_error'
  | 'assistant_question'
  | 'assistant_handoff'

type AnalyticsPrimitive = string | number | boolean | null

export interface AnalyticsEventOptions {
  pagePath?: string
  target?: string
  properties?: Record<string, AnalyticsPrimitive>
}

interface QueuedAnalyticsEvent {
  event_name: AnalyticsEventName
  page_path: string
  target?: string
  visitor_id: string
  session_id: string
  properties?: Record<string, AnalyticsPrimitive>
}

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string) || '/api').replace(/\/$/, '')
const VISITOR_STORAGE_KEY = 'noteflow-analytics-visitor-id'
const SESSION_STORAGE_KEY = 'noteflow-analytics-session-id'
const MAX_BATCH_SIZE = 10
const FLUSH_DELAY_MS = 2000

const queue: QueuedAnalyticsEvent[] = []
let memoryVisitorId: string | null = null
let memorySessionId: string | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lifecycleBound = false

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function readOrCreate(storage: Storage | undefined, key: string, prefix: string): string {
  try {
    const existing = storage?.getItem(key)
    if (existing) return existing
    const value = createId(prefix)
    storage?.setItem(key, value)
    return value
  } catch {
    return createId(prefix)
  }
}

function getVisitorId(): string {
  if (!memoryVisitorId) {
    memoryVisitorId = readOrCreate(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      VISITOR_STORAGE_KEY,
      'visitor',
    )
  }
  return memoryVisitorId
}

function getSessionId(): string {
  if (!memorySessionId) {
    memorySessionId = readOrCreate(
      typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
      SESSION_STORAGE_KEY,
      'session',
    )
  }
  return memorySessionId
}

function getPagePath(path = window.location.pathname): string {
  return path
    .replace(/^\/(sn|sc)\/[^/]+/, '/$1/:token')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '/:id')
    .slice(0, 255)
}

function getToken(): string | null {
  try {
    const stored = localStorage.getItem('noteflow-user')
    return stored ? JSON.parse(stored)?.state?.token ?? null : null
  } catch {
    return null
  }
}

function bindLifecycle(): void {
  if (lifecycleBound || typeof window === 'undefined') return
  lifecycleBound = true
  window.addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true)
  })
}

async function flush(preferBeacon = false): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!queue.length || typeof window === 'undefined') return

  const events = queue.splice(0, MAX_BATCH_SIZE)
  const body = JSON.stringify({ events })
  const token = getToken()

  if (preferBeacon && !token && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(
      `${API_BASE}/analytics/events`,
      new Blob([body], { type: 'application/json' }),
    )
    if (sent) {
      if (queue.length) void flush(true)
      return
    }
  }

  try {
    await fetch(`${API_BASE}/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      keepalive: preferBeacon,
    })
  } catch {
    // Analytics is best-effort and must never block a product action.
  }

  if (queue.length) void flush(preferBeacon)
}

function scheduleFlush(): void {
  if (queue.length >= MAX_BATCH_SIZE) {
    void flush()
    return
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS)
  }
}

export function track(eventName: AnalyticsEventName, options: AnalyticsEventOptions = {}): void {
  if (typeof window === 'undefined') return
  bindLifecycle()
  queue.push({
    event_name: eventName,
    page_path: getPagePath(options.pagePath),
    ...(options.target ? { target: options.target.slice(0, 128) } : {}),
    visitor_id: getVisitorId(),
    session_id: getSessionId(),
    ...(options.properties ? { properties: options.properties } : {}),
  })
  scheduleFlush()
}

export function trackPageView(pathname: string): void {
  track('page_view', { pagePath: pathname })
}

export function trackFeatureClick(target: string, properties?: Record<string, AnalyticsPrimitive>): void {
  track('feature_click', { target, properties })
}

export function trackFeatureSubmit(target: string, properties?: Record<string, AnalyticsPrimitive>): void {
  track('feature_submit', { target, properties })
}

export function trackFeatureResult(
  target: string,
  success: boolean,
  properties?: Record<string, AnalyticsPrimitive>,
): void {
  track(success ? 'feature_success' : 'feature_error', { target, properties })
}

export function trackAssistantQuestion(): void {
  track('assistant_question', { target: 'product_assistant' })
}

export function trackAssistantHandoff(): void {
  track('assistant_handoff', { target: 'human_support' })
}
