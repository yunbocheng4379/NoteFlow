import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MarqueeOnHoverProps {
  children: ReactNode
  className?: string
  /** 悬停触发滚动的元素；不传则使用组件根节点自身 */
  hoverRef?: React.RefObject<HTMLElement | null>
  /** 滚动速度（像素/秒），默认 60 */
  speed?: number
  /** 溢出时右侧渐变遮罩的宽度（像素） */
  fadeWidth?: number
}

/**
 * 内容宽度超过容器时：
 * - 静置状态在右侧显示渐变遮罩，暗示后面还有内容（无省略号）
 * - 鼠标悬停在容器/指定元素上时，横向滚动展示完整内容，滚到尾部停顿
 * - 鼠标移开时回到起点
 * 未溢出时行为等同普通 span。
 */
const MarqueeOnHover = ({
  children,
  className,
  hoverRef,
  speed = 60,
  fadeWidth = 20,
}: MarqueeOnHoverProps) => {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const contentRef = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(0)
  const [hovered, setHovered] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current
      const content = contentRef.current
      if (!container || !content) return
      const diff = content.scrollWidth - container.clientWidth
      setOverflow(diff > 1 ? diff : 0)
    }
    measure()

    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [children])

  useEffect(() => {
    const target = hoverRef?.current ?? containerRef.current
    if (!target) return
    const enter = () => setHovered(true)
    const leave = () => setHovered(false)
    target.addEventListener('mouseenter', enter)
    target.addEventListener('mouseleave', leave)
    return () => {
      target.removeEventListener('mouseenter', enter)
      target.removeEventListener('mouseleave', leave)
    }
  }, [hoverRef])

  const isOverflowing = overflow > 0
  const duration = isOverflowing ? Math.max(overflow / speed, 0.6) : 0
  const maskStyle: React.CSSProperties = isOverflowing
    ? {
        WebkitMaskImage: `linear-gradient(to right, black 0, black calc(100% - ${fadeWidth}px), transparent 100%)`,
        maskImage: `linear-gradient(to right, black 0, black calc(100% - ${fadeWidth}px), transparent 100%)`,
      }
    : {}

  return (
    <span
      ref={containerRef}
      className={cn('relative block min-w-0 overflow-hidden whitespace-nowrap', className)}
      style={maskStyle}
    >
      <span
        ref={contentRef}
        className="inline-block whitespace-nowrap will-change-transform"
        style={{
          transform: hovered && isOverflowing ? `translateX(-${overflow}px)` : 'translateX(0)',
          transition: `transform ${duration}s linear`,
        }}
      >
        {children}
      </span>
    </span>
  )
}

export default MarqueeOnHover
