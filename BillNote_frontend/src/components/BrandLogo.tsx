interface BrandLogoProps {
  className?: string
}

// 无限符号 (∞) 造型路径，来自品牌 logomark
const MARK_PATH =
  'M0 14.5C7.00093e-07 6.49187 6.49187 -7.0009e-07 14.5 0C18.8417 3.7957e-07 22.7378 1.90824 25.3952 4.93177C30.2168 10.345 34.2038 10.0602 38.4379 6.06395C40.5154 4.10244 43.3173 2.9 46.4 2.9C52.8065 2.90001 58 8.0935 58 14.5C58 20.9065 52.8065 26.1 46.4 26.1C43.3173 26.1 40.5154 24.8975 38.4379 22.936C34.2048 18.9407 30.2187 18.655 25.3987 24.0642C22.7412 27.0901 18.8436 29 14.5 29C6.49187 29 -7.00091e-07 22.5081 0 14.5Z'

/**
 * BiliNote 品牌 logomark（无限符号造型）。
 * 已重新上色为系统青绿主色系（#167a6e → #1aa396 → #4dd9cc），
 * 仅保留 logo 图形，不含文字。宽高比约 2:1，建议用 h-* + w-auto 控制尺寸。
 */
export default function BrandLogo({ className }: BrandLogoProps) {
  return (
    <svg
      viewBox="0 0 58 29"
      fill="none"
      className={className}
      role="img"
      aria-label="BiliNote logo"
    >
      {/* 底色：品牌青绿 */}
      <path d={MARK_PATH} fill="#1aa396" />
      {/* 深色边缘（右上） */}
      <path d={MARK_PATH} fill="url(#brand_deep)" />
      {/* 亮青光晕（左下） */}
      <path d={MARK_PATH} fill="url(#brand_cyan)" />
      {/* 中调过渡 */}
      <path d={MARK_PATH} fill="url(#brand_mid)" />
      {/* 浅绿高光 */}
      <path d={MARK_PATH} fill="url(#brand_light)" />
      {/* 薄荷高光 */}
      <path d={MARK_PATH} fill="url(#brand_mint)" />
      <defs>
        <linearGradient
          id="brand_deep"
          x1="43.6961"
          y1="21.7069"
          x2="10.3036"
          y2="-4.24328"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0e655b" />
          <stop offset="0.841052" stopColor="#0e655b" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="brand_cyan"
          x1="14.5023"
          y1="27.0553"
          x2="23.4238"
          y2="-3.84997"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#5fe3d4" />
          <stop offset="1" stopColor="#5fe3d4" stopOpacity="0" />
        </linearGradient>
        <radialGradient
          id="brand_mid"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(45.4879 35.041) rotate(-122.928) scale(37.051 30.3393)"
        >
          <stop stopColor="#0f7d70" />
          <stop offset="0.568731" stopColor="#0f7d70" stopOpacity="0.26" />
          <stop offset="1" stopColor="#0f7d70" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id="brand_light"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(18.3021 -4.19503) rotate(77.6745) scale(24.9567 39.2264)"
        >
          <stop stopColor="#41d1b7" />
          <stop offset="0.492704" stopColor="#41d1b7" stopOpacity="0.35" />
          <stop offset="1" stopColor="#41d1b7" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id="brand_mint"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(59.6446 -10.7446) rotate(125.113) scale(27.1121 57.4261)"
        >
          <stop stopColor="#b9f5e6" />
          <stop offset="0.549191" stopColor="#b9f5e6" stopOpacity="0.3" />
          <stop offset="0.961144" stopColor="#b9f5e6" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  )
}
