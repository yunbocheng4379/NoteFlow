export type LandingLang = 'zh' | 'en'

export interface LandingFeatureCopy {
  title: string
  subtitle: string
  desc: string
}

export interface LandingOptionCopy {
  title: string
  subtitle: string
  body: string
  linkLabel: string | null
}

export interface LandingCopy {
  nav: {
    features: string
    getStarted: string
    guide: string
    github: string
    cta: string
  }
  hero: {
    titleLine1: string
    titleLine2: string
    subtitle: string
    cta: string
    github: string
    imgAlt: string
  }
  platforms: {
    biliBili: string
    youtube: string
    douyin: string
    kuaishou: string
    local: string
  }
  featureGrid: {
    headingPrefix: string
    headingHighlight: string
    sub: string
    features: LandingFeatureCopy[]
  }
  getStarted: {
    headingPrefix: string
    headingHighlight: string
    sub: string
    options: LandingOptionCopy[]
  }
  cta: {
    heading: string
    sub: string
    button: string
  }
  footer: {
    columns: {
      product: { title: string; login: string; tryOnline: string }
      resources: { title: string; guide: string; faq: string }
      contact: { title: string; devHome: string; feedback: string }
    }
    tagline: { prefix: string; highlight: string; suffix: string }
    copyright: (year: number) => string
  }
}

export const LANDING_COPY: Record<LandingLang, LandingCopy> = {
  zh: {
    nav: {
      features: '功能',
      getStarted: '开始使用',
      guide: '使用指南',
      github: 'GitHub',
      cta: '立即使用',
    },
    hero: {
      titleLine1: '一条视频链接，',
      titleLine2: '变成一份笔记。',
      subtitle: 'AI 视频笔记助手，与你的观看和学习一起工作。',
      cta: '立即使用',
      github: 'GitHub',
      imgAlt: 'NoteFlow 登录页面',
    },
    platforms: {
      biliBili: '哔哩哔哩',
      youtube: 'YouTube',
      douyin: '抖音',
      kuaishou: '快手',
      local: '本地文件',
    },
    featureGrid: {
      headingPrefix: '六项能力，',
      headingHighlight: '一套工作流。',
      sub: '从单条视频到整个频道，从生成笔记到追问细节，NoteFlow 陪你走完整个流程。',
      features: [
        {
          title: '视频转笔记',
          subtitle: 'Video to Notes',
          desc: '粘贴视频链接或上传本地文件，AI 自动转写语音并生成结构化 Markdown 笔记与思维导图。',
        },
        {
          title: '笔记风格',
          subtitle: 'Note Styles',
          desc: '精简、教程、学术、小红书体等多种风格任选，也可以自建专属模板反复使用。',
        },
        {
          title: '批量与频道解析',
          subtitle: 'Batch & Channels',
          desc: '粘贴一整个 UP 主空间或频道链接，自动拉取视频列表，勾选后一次性批量生成。',
        },
        {
          title: 'AI 问答',
          subtitle: 'Chat with Notes',
          desc: '针对某篇笔记的原文内容直接提问，AI 结合视频信息作答，逐字流式输出。',
        },
        {
          title: '合集与闪卡',
          subtitle: 'Collections & Flashcards',
          desc: '把笔记归类进合集、融合成一篇综合笔记，或一键生成问答闪卡巩固记忆。',
        },
        {
          title: '浏览器插件',
          subtitle: 'Browser Extension',
          desc: '在视频网页里点一下插件图标，当前视频立刻开始生成笔记，无需跳转。',
        },
      ],
    },
    getStarted: {
      headingPrefix: '几分钟就能',
      headingHighlight: '跑起来。',
      sub: '四种使用方式，挑一个适合你的。',
      options: [
        {
          title: '在线使用',
          subtitle: '推荐',
          body: '无需安装，注册账号后直接在网页里粘贴链接开始生成笔记。',
          linkLabel: '前往登录',
        },
        {
          title: 'Docker Compose',
          subtitle: '自部署',
          body: '一条命令拉起完整 Web 栈，包含 MySQL、FastAPI 后端与前端。',
          linkLabel: null,
        },
        {
          title: '桌面客户端',
          subtitle: 'Windows / macOS',
          body: '打包好的桌面应用，双击安装即可使用，无需配置环境。',
          linkLabel: '联系获取安装包',
        },
        {
          title: '浏览器插件',
          subtitle: 'Chrome / Edge',
          body: '在 chrome://extensions/ 加载解压后的扩展目录即可使用。',
          linkLabel: '联系获取安装说明',
        },
      ],
    },
    cta: {
      heading: '省下重看视频的时间。',
      sub: '把第一条视频链接粘进去，剩下的交给 NoteFlow。',
      button: '立即使用',
    },
    footer: {
      columns: {
        product: { title: '产品', login: '登录 / 注册', tryOnline: '在线体验' },
        resources: { title: '资源', guide: '使用文档', faq: '常见问题' },
        contact: { title: '联系', devHome: '开发者主页', feedback: '问题反馈' },
      },
      tagline: { prefix: '专注', highlight: '笔记', suffix: '，服务于每一次观看。' },
      copyright: year => `© ${year} NoteFlow. 保留所有权利。`,
    },
  },
  en: {
    nav: {
      features: 'Features',
      getStarted: 'Get Started',
      guide: 'Guide',
      github: 'GitHub',
      cta: 'Try Now',
    },
    hero: {
      titleLine1: 'One video link,',
      titleLine2: 'one structured note.',
      subtitle: 'An AI video-note assistant that works alongside how you watch and learn.',
      cta: 'Try Now',
      github: 'GitHub',
      imgAlt: 'NoteFlow login page',
    },
    platforms: {
      biliBili: 'Bilibili',
      youtube: 'YouTube',
      douyin: 'Douyin',
      kuaishou: 'Kuaishou',
      local: 'Local files',
    },
    featureGrid: {
      headingPrefix: 'Six capabilities, ',
      headingHighlight: 'one workflow.',
      sub: 'From a single video to a whole channel, from note generation to follow-up questions — NoteFlow covers the full loop.',
      features: [
        {
          title: 'Video to Notes',
          subtitle: 'Video to Notes',
          desc: 'Paste a video link or upload a local file — AI transcribes the audio and generates a structured Markdown note with a mind map.',
        },
        {
          title: 'Note Styles',
          subtitle: 'Note Styles',
          desc: 'Choose from concise, tutorial, academic, or social-post styles, or build your own reusable template.',
        },
        {
          title: 'Batch & Channels',
          subtitle: 'Batch & Channels',
          desc: 'Paste a whole channel or creator space link, pull the video list automatically, and batch-generate notes for the ones you pick.',
        },
        {
          title: 'Chat with Notes',
          subtitle: 'Chat with Notes',
          desc: 'Ask questions directly about a note’s source content — AI answers using the video context, streamed word by word.',
        },
        {
          title: 'Collections & Flashcards',
          subtitle: 'Collections & Flashcards',
          desc: 'Group notes into collections, merge them into one combined note, or generate Q&A flashcards to reinforce what you learned.',
        },
        {
          title: 'Browser Extension',
          subtitle: 'Browser Extension',
          desc: 'Click the extension icon on any video page and start generating a note for it right away, no tab switching needed.',
        },
      ],
    },
    getStarted: {
      headingPrefix: 'Up and running ',
      headingHighlight: 'in minutes.',
      sub: 'Four ways to use it — pick whichever fits.',
      options: [
        {
          title: 'Use Online',
          subtitle: 'Recommended',
          body: 'No install needed — register an account and start pasting links right in the browser.',
          linkLabel: 'Go to login',
        },
        {
          title: 'Docker Compose',
          subtitle: 'Self-hosted',
          body: 'One command spins up the full web stack, including MySQL, the FastAPI backend, and the frontend.',
          linkLabel: null,
        },
        {
          title: 'Desktop App',
          subtitle: 'Windows / macOS',
          body: 'A packaged desktop app — double-click to install, no environment setup required.',
          linkLabel: 'Contact for installer',
        },
        {
          title: 'Browser Extension',
          subtitle: 'Chrome / Edge',
          body: 'Load the unpacked extension folder at chrome://extensions/ to get started.',
          linkLabel: 'Contact for install guide',
        },
      ],
    },
    cta: {
      heading: 'Stop rewatching. Start reading.',
      sub: 'Paste your first video link — NoteFlow takes it from there.',
      button: 'Try Now',
    },
    footer: {
      columns: {
        product: { title: 'Product', login: 'Log in / Sign up', tryOnline: 'Try online' },
        resources: { title: 'Resources', guide: 'Documentation', faq: 'FAQ' },
        contact: { title: 'Contact', devHome: 'Developer', feedback: 'Feedback' },
      },
      tagline: { prefix: 'Focused on ', highlight: 'notes', suffix: ', for every video you watch.' },
      copyright: year => `© ${year} NoteFlow. All rights reserved.`,
    },
  },
}
