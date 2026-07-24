import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ShieldCheck, Building2, Headphones, Github } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import logo from '@/assets/icon.svg'
import wechatQr from '@/assets/wechat-community-qr.png'
import enterpriseServiceQr from '@/assets/enterprise-service-qr.png'

export default function AboutPage() {
  const appVersion = __APP_VERSION__
  const [previewQr, setPreviewQr] = useState<{ src: string; alt: string } | null>(null)
  return (
    <ScrollArea className={'h-full w-full overflow-y-auto bg-white'}>
      <div className="w-full px-8 py-12 lg:px-16 xl:px-24">
        {/* Hero Section */}
        <div className="mb-16 flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex items-center gap-4">
            <img
              src={logo}
              alt="NoteFlow Logo"
              width={50}
              height={50}
              className="rounded-lg"
            />
            <h1 className="text-4xl font-bold">NoteFlow v{appVersion}</h1>
          </div>
          <p className="text-muted-foreground mb-6 text-xl italic">
            AI 视频笔记生成工具 让 AI 为你的视频做笔记
          </p>

          <div className="mb-8 flex flex-wrap justify-center gap-2">
            <Badge variant="secondary">AI 视频笔记</Badge>
            <Badge variant="secondary">多平台支持</Badge>
            <Badge variant="secondary">企业级部署</Badge>
            <Badge variant="secondary">持续更新</Badge>
          </div>

          <Button variant="outline" asChild>
            <a href="https://github.com/yunbocheng4379" target="_blank" rel="noreferrer">
              <Github className="mr-2 h-4 w-4" />
              作者主页
            </a>
          </Button>
        </div>

        {/* Product Introduction */}
        <section className="mb-16">
          <h2 className="mb-6 text-center text-3xl font-bold">✨ 产品简介</h2>
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-lg">
              NoteFlow 是一款 AI 视频笔记助手，支持通过哔哩哔哩、YouTube、抖音等视频链接，
              自动提取内容并生成结构清晰、重点明确的 Markdown
              格式笔记。支持插入截图、原片跳转等功能，帮助你更高效地学习和整理视频内容。
            </p>
          </div>
        </section>

        {/* Trust Section */}
        <section className="mb-16">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <ShieldCheck className="mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-1 font-semibold">数据安全</h3>
              <p className="text-muted-foreground text-sm">笔记与转写数据独立存储，账号间严格隔离</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <Building2 className="mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-1 font-semibold">企业级部署</h3>
              <p className="text-muted-foreground text-sm">支持私有化部署与定制集成，满足团队场景需求</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <Headphones className="mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-1 font-semibold">专属服务</h3>
              <p className="text-muted-foreground text-sm">会员与企业客户享一对一专属技术支持</p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="mb-16">
          <h2 className="mb-8 text-center text-3xl font-bold">🔧 功能特性</h2>
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: '多平台支持', desc: '支持 Bilibili、YouTube、本地视频、抖音等多个平台' },
              { title: '笔记格式选择', desc: '支持返回多种笔记格式，满足不同需求' },
              { title: '笔记风格选择', desc: '支持多种笔记风格，个性化定制' },
              { title: '多模态视频理解', desc: '结合视觉和音频内容，全面理解视频' },
              { title: '自定义 GPT 配置', desc: '支持自行配置 GPT 大模型' },
              { title: '本地音频转写', desc: '支持 Fast-Whisper 等本地模型音频转写' },
              { title: '结构化笔记', desc: '自动生成结构化 Markdown 笔记' },
              { title: '智能截图', desc: '可选插入自动截取的关键画面' },
              { title: '内容跳转', desc: '支持关联原视频的内容跳转链接' },
            ].map((feature, index) => (
              <Card key={index} className="h-full">
                <CardContent className="pt-2">
                  <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Community & Service Section */}
        <section className="mb-16">
          <h2 className="mb-8 text-center text-3xl font-bold">联系我们</h2>
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-col items-center justify-center gap-10 md:flex-row md:items-start">
              <div className="text-center">
                <h3 className="mb-3 text-xl font-semibold">NoteFlow 用户交流群</h3>
                <button
                  type="button"
                  onClick={() => setPreviewQr({ src: wechatQr, alt: 'NoteFlow 用户交流群' })}
                  className="bg-muted mx-auto flex h-52 w-52 cursor-zoom-in items-center justify-center rounded-md transition-opacity hover:opacity-80"
                >
                  <img src={wechatQr} alt="NoteFlow 用户交流群" className="h-full w-full object-contain" />
                </button>
                <p className="text-muted-foreground mt-3 text-sm">扫码加入交流群，一起讨论使用问题</p>
              </div>
              <div className="text-center">
                <h3 className="mb-3 text-xl font-semibold">企业定制 / 私有化部署</h3>
                <button
                  type="button"
                  onClick={() =>
                    setPreviewQr({ src: enterpriseServiceQr, alt: '企业定制 / 私有化部署咨询' })
                  }
                  className="bg-muted mx-auto flex h-52 w-52 cursor-zoom-in items-center justify-center rounded-md transition-opacity hover:opacity-80"
                >
                  <img
                    src={enterpriseServiceQr}
                    alt="企业定制 / 私有化部署咨询"
                    className="h-full w-full object-contain"
                  />
                </button>
                <p className="text-muted-foreground mt-3 text-sm">
                  提供企业专属部署、定制集成与一对一技术支持
                  <br />
                  扫码加微信，备注「企业定制」即可咨询
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t pt-8 text-center">
          <p className="mb-4">💬 你的支持与反馈是我们持续优化产品的动力，欢迎随时提出使用建议！</p>
        </footer>
      </div>

      <Dialog open={!!previewQr} onOpenChange={open => !open && setPreviewQr(null)}>
        <DialogContent className="flex max-w-sm flex-col items-center gap-4">
          <DialogTitle className="sr-only">{previewQr?.alt}</DialogTitle>
          {previewQr && (
            <img src={previewQr.src} alt={previewQr.alt} className="h-full w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </ScrollArea>
  )
}
