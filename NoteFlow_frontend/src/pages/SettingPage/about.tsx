import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import FeedbackDialog from '@/components/FeedbackDialog'
import {
  ShieldCheck,
  Building2,
  Headphones,
  Github,
  Globe,
  FileText,
  Palette,
  Sparkles,
  Cpu,
  Mic,
  ListTree,
  Camera,
  Link2,
  MessageSquareHeart,
  ArrowRight,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import logo from '@/assets/icon.svg'
import wechatQr from '@/assets/wechat-community-qr.png'
import enterpriseServiceQr from '@/assets/enterprise-service-qr.png'

type Accent = 'teal' | 'amber' | 'sky' | 'violet' | 'rose' | 'emerald' | 'orange' | 'blue' | 'indigo'

const accentClasses: Record<Accent, { icon: string; ring: string }> = {
  teal: { icon: 'bg-teal-50 text-teal-600', ring: 'ring-teal-100' },
  amber: { icon: 'bg-amber-50 text-amber-600', ring: 'ring-amber-100' },
  sky: { icon: 'bg-sky-50 text-sky-600', ring: 'ring-sky-100' },
  violet: { icon: 'bg-violet-50 text-violet-600', ring: 'ring-violet-100' },
  rose: { icon: 'bg-rose-50 text-rose-600', ring: 'ring-rose-100' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
  orange: { icon: 'bg-orange-50 text-orange-600', ring: 'ring-orange-100' },
  blue: { icon: 'bg-blue-50 text-blue-600', ring: 'ring-blue-100' },
  indigo: { icon: 'bg-indigo-50 text-indigo-600', ring: 'ring-indigo-100' },
}

const features: {
  Icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  accent: Accent
}[] = [
  { Icon: Globe, title: '多平台支持', desc: '支持 Bilibili、YouTube、本地视频、抖音等多个平台', accent: 'teal' },
  { Icon: FileText, title: '笔记格式选择', desc: '支持返回多种笔记格式，满足不同需求', accent: 'sky' },
  { Icon: Palette, title: '笔记风格选择', desc: '支持多种笔记风格，个性化定制', accent: 'violet' },
  { Icon: Sparkles, title: '多模态视频理解', desc: '结合视觉和音频内容，全面理解视频', accent: 'amber' },
  { Icon: Cpu, title: '自定义 GPT 配置', desc: '支持自行配置 GPT 大模型', accent: 'blue' },
  { Icon: Mic, title: '本地音频转写', desc: '支持 Fast-Whisper 等本地模型音频转写', accent: 'rose' },
  { Icon: ListTree, title: '结构化笔记', desc: '自动生成结构化 Markdown 笔记', accent: 'emerald' },
  { Icon: Camera, title: '智能截图', desc: '可选插入自动截取的关键画面', accent: 'orange' },
  { Icon: Link2, title: '内容跳转', desc: '支持关联原视频的内容跳转链接', accent: 'indigo' },
]

export default function AboutPage() {
  const appVersion = __APP_VERSION__
  const [previewQr, setPreviewQr] = useState<{ src: string; alt: string } | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
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
          <div className="mb-10 text-center">
            <div className="text-primary mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-[var(--primary-light)] px-3 py-1 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5" />
              功能特性
            </div>
            <h2 className="text-3xl font-bold text-neutral-900">为视频学习设计的完整工具链</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              从下载、转写、结构化到导出，每一步都为效率而生。
            </p>
          </div>

          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ Icon, title, desc, accent }) => {
              const c = accentClasses[accent]
              return (
                <div
                  key={title}
                  className="group relative flex gap-4 rounded-2xl border border-neutral-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md hover:shadow-neutral-200/60"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${c.icon} ${c.ring}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
                    <p className="text-muted-foreground mt-1 text-sm leading-6">{desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Community & Service Section */}
        <section className="mb-16">
          <h2 className="mb-8 text-center text-3xl font-bold">联系我们</h2>
          <div className="mx-auto max-w-5xl">
            <div className="grid grid-cols-1 items-start justify-items-center gap-10 md:grid-cols-3">
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
              <div className="text-center">
                <h3 className="mb-3 text-xl font-semibold">联系客服</h3>
                <button
                  type="button"
                  onClick={() => setPreviewQr({ src: enterpriseServiceQr, alt: 'NoteFlow 客服二维码' })}
                  className="bg-muted mx-auto flex h-52 w-52 cursor-zoom-in items-center justify-center rounded-md transition-opacity hover:opacity-80"
                >
                  <img src={enterpriseServiceQr} alt="NoteFlow 客服二维码" className="h-full w-full object-contain" />
                </button>
                <p className="text-muted-foreground mt-3 text-sm">
                  遇到支付、账号或使用问题
                  <br />
                  扫码联系人工客服
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Feedback CTA */}
        <section className="mb-6">
          <div className="from-primary/5 via-primary/[0.03] relative mx-auto flex max-w-5xl flex-col items-center gap-4 overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-br to-transparent px-6 py-8 text-center md:flex-row md:items-center md:justify-between md:text-left">
            <div
              aria-hidden
              className="bg-primary/10 pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full blur-3xl"
            />
            <div
              aria-hidden
              className="bg-primary/10 pointer-events-none absolute -bottom-14 -left-10 h-32 w-32 rounded-full blur-3xl"
            />

            <div className="relative flex items-start gap-4">
              <span className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                <MessageSquareHeart className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-neutral-900">你的反馈是我们前进的动力</p>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  遇到问题、有想法或期待新功能，都欢迎告诉我们，我们会认真读完每一条。
                </p>
              </div>
            </div>

            <div className="relative flex shrink-0 flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => setFeedbackOpen(true)}>
                提交反馈
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
              <Button asChild size="sm" variant="outline">
                <a
                  href="https://github.com/yunbocheng4379"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github className="mr-1 h-3.5 w-3.5" />
                  GitHub
                </a>
              </Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={!!previewQr} onOpenChange={open => !open && setPreviewQr(null)}>
        <DialogContent className="flex max-w-sm flex-col items-center gap-4">
          <DialogTitle className="sr-only">{previewQr?.alt}</DialogTitle>
          {previewQr && (
            <img src={previewQr.src} alt={previewQr.alt} className="h-full w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </ScrollArea>
  )
}
