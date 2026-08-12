// 网盘品牌图标. 默认 1em 尺寸, 由外层用字号或 Tailwind 尺寸类控制大小.

interface LogoProps {
  className?: string
}

export const BaiduPanLogo = ({ className }: LogoProps) => (
  <img
    src="/cloud_drive/baidu_pan.png"
    alt="百度网盘"
    className={`inline-block object-contain ${className ?? ''}`}
    width="1em"
    height="1em"
  />
)
