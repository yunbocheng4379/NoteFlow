/**
 * 网盘品牌图标. 默认 width/height="1em", 交给外层 span/div 通过字号或 w-*/h-* 控制大小.
 * currentColor 用于文字色继承; 品牌色写在 fill 属性里, 图标始终显示品牌色, 不受父级 text 颜色影响.
 */

interface LogoProps {
  className?: string
}

export const BaiduPanLogo = ({ className }: LogoProps) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="1" y="1" width="22" height="22" rx="5" fill="#3086FF" />
    <ellipse cx="7.5" cy="10.5" rx="1.6" ry="2.2" fill="#fff" />
    <ellipse cx="12" cy="7.5" rx="1.8" ry="2" fill="#fff" />
    <ellipse cx="16.8" cy="11" rx="1.4" ry="1.6" fill="#fff" />
    <ellipse cx="12" cy="16" rx="4" ry="2.4" fill="#fff" />
  </svg>
)
