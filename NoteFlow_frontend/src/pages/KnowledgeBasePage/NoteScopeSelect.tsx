import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { getTasks, type TaskSummary } from '@/services/task'
import { cn } from '@/lib/utils'

interface NoteScopeSelectProps {
  value: string[] | null
  onChange: (taskIds: string[] | null) => void
  className?: string
}

export default function NoteScopeSelect({ value, onChange, className }: NoteScopeSelectProps) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || loaded) return
    getTasks()
      .then((list) => setTasks(list.filter((t) => t.status === 'SUCCESS')))
      .finally(() => setLoaded(true))
  }, [open, loaded])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const selected = value ? new Set(value) : null

  const toggle = (taskId: string) => {
    const current = selected ? new Set(selected) : new Set<string>()
    if (current.has(taskId)) current.delete(taskId)
    else current.add(taskId)
    onChange(current.size === 0 ? null : Array.from(current))
  }

  const label = !selected ? '全部笔记' : `已选 ${selected.size} 篇`

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-xs text-neutral-600 transition-colors hover:bg-neutral-50"
      >
        <FileText className="h-3.5 w-3.5 text-neutral-400" />
        <span>{label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-64 rounded-md border bg-popover text-popover-foreground shadow-md">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent',
              !selected && 'text-primary'
            )}
          >
            全部笔记
          </button>
          <div className="max-h-64 overflow-y-auto border-t">
            {!loaded ? (
              <p className="px-3 py-4 text-center text-xs text-neutral-400">加载中...</p>
            ) : tasks.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-neutral-400">暂无笔记</p>
            ) : (
              tasks.map((t) => (
                <label
                  key={t.task_id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={!!selected?.has(t.task_id)}
                    onChange={() => toggle(t.task_id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{t.title || t.video_id}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
