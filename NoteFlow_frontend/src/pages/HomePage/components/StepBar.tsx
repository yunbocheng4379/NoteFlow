import { FC, useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  label: string
  key: string
}

interface StepBarProps {
  steps: Step[]
  currentStep: string
}

/**
 * 把后端阶段状态归一到 5 个可视化节点的索引。
 * FORMATTING 归到「总结内容」，SAVING 归到最后一步，避免回退/空档。
 */
const STATUS_TO_INDEX: Record<string, number> = {
  PENDING: 0,
  PARSING: 0,
  DOWNLOADING: 1,
  TRANSCRIBING: 2,
  SUMMARIZING: 3,
  FORMATTING: 3,
  SAVING: 4,
  SUCCESS: 4,
}

const fmtSeconds = (ms: number) => {
  const s = ms / 1000
  return s >= 10 ? `${Math.floor(s)}s` : `${s.toFixed(1)}s`
}

const StepBar: FC<StepBarProps> = ({ steps, currentStep }) => {
  const currentIndex = useMemo(() => {
    if (currentStep in STATUS_TO_INDEX) return STATUS_TO_INDEX[currentStep]
    const i = steps.findIndex(s => s.key === currentStep)
    return i === -1 ? 0 : i
  }, [currentStep, steps])

  const isDone = currentStep === 'SUCCESS'

  // 记录每个节点开始的时间戳，用于读秒
  const startedAtRef = useRef<number[]>([])
  // 已完成节点的最终耗时（毫秒）
  const durationsRef = useRef<Record<number, number>>({})
  const [, forceTick] = useState(0)

  // 节点推进时，落定上一节点耗时、记录新节点起点
  useEffect(() => {
    const now = Date.now()
    if (startedAtRef.current[currentIndex] == null) {
      startedAtRef.current[currentIndex] = now
    }
    // 把当前节点之前、尚未落定的节点耗时补齐
    for (let i = 0; i < currentIndex; i++) {
      if (startedAtRef.current[i] == null) startedAtRef.current[i] = now
      if (durationsRef.current[i] == null) {
        const start = startedAtRef.current[i]
        const end = startedAtRef.current[i + 1] ?? now
        durationsRef.current[i] = Math.max(0, end - start)
      }
    }
    if (isDone && durationsRef.current[currentIndex] == null) {
      durationsRef.current[currentIndex] =
        now - (startedAtRef.current[currentIndex] ?? now)
    }
  }, [currentIndex, isDone])

  // 当前节点读秒：每 100ms 刷新
  useEffect(() => {
    if (isDone) return
    const t = setInterval(() => forceTick(v => v + 1), 100)
    return () => clearInterval(t)
  }, [isDone])

  const now = Date.now()

  return (
    <div className="flex w-full max-w-xl items-start justify-between">
      {steps.map((step, index) => {
        const completed = index < currentIndex || (isDone && index === currentIndex)
        const active = index === currentIndex && !isDone
        const isLast = index === steps.length - 1

        // 该节点显示的秒数
        let seconds = ''
        if (completed && durationsRef.current[index] != null) {
          seconds = fmtSeconds(durationsRef.current[index])
        } else if (active && startedAtRef.current[index] != null) {
          seconds = fmtSeconds(now - startedAtRef.current[index])
        }

        return (
          <div key={step.key} className="relative flex flex-1 flex-col items-center">
            {/* 连接线（指向下一节点）*/}
            {!isLast && (
              <div className="absolute left-1/2 top-4 h-0.5 w-full -translate-y-1/2">
                <div className="h-full w-full rounded-full bg-neutral-200" />
                <div
                  className={cn(
                    'absolute inset-0 h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-700 ease-out',
                    completed ? 'w-full' : 'w-0',
                  )}
                />
              </div>
            )}

            {/* 节点圆圈 */}
            <div
              className={cn(
                'relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-500',
                completed && 'bg-primary text-white shadow-md shadow-primary/30',
                active && 'bg-primary text-white',
                !completed && !active && 'bg-neutral-200 text-neutral-400',
              )}
            >
              {/* 当前节点光晕脉冲 */}
              {active && (
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
              )}
              <span className="relative">
                {completed ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
              </span>
            </div>

            {/* 步骤名称 */}
            <div
              className={cn(
                'mt-2.5 text-center text-xs transition-colors duration-300',
                active ? 'font-semibold text-primary' : completed ? 'text-neutral-600' : 'text-neutral-400',
              )}
            >
              {step.label}
            </div>

            {/* 读秒 */}
            <div className="mt-0.5 h-4 text-center text-[11px] tabular-nums">
              {seconds && (
                <span className={active ? 'text-primary/80' : 'text-neutral-400'}>{seconds}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default StepBar
