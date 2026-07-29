import { Rocket, CreditCard, ListVideo, Telescope, type LucideIcon } from 'lucide-react'

export interface GuideArticleMeta {
  slug: string
  roman: string
  icon: LucideIcon
  title: string
  subtitle: string
  summary: string
}

export const GUIDE_ARTICLES: GuideArticleMeta[] = [
  {
    slug: 'quick-start',
    roman: 'I',
    icon: Rocket,
    title: '快速上手',
    subtitle: 'Quick Start',
    summary: '粘贴一条视频链接，几分钟内拿到结构化笔记与思维导图。',
  },
  {
    slug: 'membership',
    roman: 'II',
    icon: CreditCard,
    title: '开通会员',
    subtitle: 'Membership & Credits',
    summary: '电力计费怎么算、充值与订阅的区别、账单在哪里查。',
  },
  {
    slug: 'batch-generate',
    roman: 'III',
    icon: ListVideo,
    title: '批量生成',
    subtitle: 'Batch Generate',
    summary: '一次性解析整个 UP 主空间或频道，批量转成笔记。',
  },
  {
    slug: 'roadmap',
    roman: 'IV',
    icon: Telescope,
    title: '未来展望',
    subtitle: 'Roadmap',
    summary: '合集、闪卡之后，浏览器插件与 AI 问答还会走到哪里。',
  },
]

export function getGuideArticle(slug: string | undefined) {
  return GUIDE_ARTICLES.find(a => a.slug === slug)
}

export function getAdjacentArticles(slug: string) {
  const idx = GUIDE_ARTICLES.findIndex(a => a.slug === slug)
  return {
    prev: idx > 0 ? GUIDE_ARTICLES[idx - 1] : undefined,
    next: idx >= 0 && idx < GUIDE_ARTICLES.length - 1 ? GUIDE_ARTICLES[idx + 1] : undefined,
  }
}
