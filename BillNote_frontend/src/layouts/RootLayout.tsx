import type { ReactNode, FC } from 'react'
// import "@/global.css"
import { Toaster } from 'react-hot-toast'

interface RootLayoutProps {
  children: ReactNode
}

export const metadata = {
  title: 'NoteFlow - AI 视频笔记助手',
  description: '通过视频链接结合大模型自动生成对应的笔记',
}

const RootLayout: FC<RootLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-neutral-900">
      <Toaster
        position="top-center"
        gutter={10}
        toastOptions={{
          duration: 3000,
          // 基础卡片样式：白底、细边、柔和阴影，跨类型统一
          style: {
            maxWidth: '380px',
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(15,23,42,0.06)',
            boxShadow: '0 6px 24px rgba(15,23,42,0.10), 0 1px 2px rgba(15,23,42,0.06)',
            color: '#1e293b',
            fontSize: '13.5px',
            lineHeight: '1.45',
            fontWeight: 500,
          },
          success: {
            duration: 2500,
            iconTheme: { primary: '#167a6e', secondary: '#ffffff' },
            style: { borderLeft: '3px solid #167a6e' },
          },
          error: {
            duration: 4000,
            iconTheme: { primary: '#e11d48', secondary: '#ffffff' },
            style: { borderLeft: '3px solid #e11d48' },
          },
          loading: {
            iconTheme: { primary: '#167a6e', secondary: '#e2e8f0' },
            style: { borderLeft: '3px solid #94a3b8' },
          },
        }}
      />
      {children}
    </div>
  )
}

export default RootLayout
