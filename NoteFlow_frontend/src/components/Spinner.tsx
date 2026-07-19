import { FC } from 'react'
import { cn } from '@/lib/utils'

interface SpinnerProps {
  className?: string
}

/**
 * 轻量主题色加载动画：双层旋转圆环，平滑顺滑，跟随系统主题色（primary）。
 * 用 currentColor 取色，外层可用 text-primary 等控制颜色，className 控制尺寸。
 */
const Spinner: FC<SpinnerProps> = ({ className }) => {
  return (
    <span
      className={cn('relative inline-flex h-5 w-5 text-primary', className)}
      role="status"
      aria-label="加载中"
    >
      {/* 底环 */}
      <span className="absolute inset-0 rounded-full border-2 border-current opacity-20" />
      {/* 旋转弧 */}
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
    </span>
  )
}

export default Spinner
