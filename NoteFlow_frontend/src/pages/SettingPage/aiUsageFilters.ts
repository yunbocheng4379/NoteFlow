import type { AiUsageFilters } from '@/services/aiUsage'

export function clearAiUsageFilter(searchParams: URLSearchParams, key: keyof AiUsageFilters) {
  const next = new URLSearchParams(searchParams)
  next.delete(key)
  next.delete('page')
  return next
}

export function isInvalidAiUsageDateRange(startDateTime: string, endDateTime: string) {
  if (!startDateTime || !endDateTime) return false
  return new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()
}
