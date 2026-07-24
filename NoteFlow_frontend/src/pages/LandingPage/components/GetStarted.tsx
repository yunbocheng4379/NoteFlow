import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import { GITHUB_URL } from '../constants'

const OPTIONS = [
  {
    roman: 'I',
    title: '在线使用',
    subtitle: '推荐',
    body: '无需安装，注册账号后直接在网页里粘贴链接开始生成笔记。',
    code: null,
    link: { href: '/login', label: '前往登录', internal: true },
  },
  {
    roman: 'II',
    title: 'Docker Compose',
    subtitle: '自部署',
    body: '一条命令拉起完整 Web 栈，包含 MySQL、FastAPI 后端与前端。',
    code: 'docker compose up -d --build',
    link: null,
  },
  {
    roman: 'III',
    title: '桌面客户端',
    subtitle: 'Windows / macOS',
    body: '打包好的桌面应用，双击安装即可使用，无需配置环境。',
    code: null,
    link: {
      href: GITHUB_URL,
      label: '联系获取安装包',
      internal: false,
    },
  },
  {
    roman: 'IV',
    title: '浏览器插件',
    subtitle: 'Chrome / Edge',
    body: '在 chrome://extensions/ 加载解压后的扩展目录即可使用。',
    code: null,
    link: {
      href: GITHUB_URL,
      label: '联系获取安装说明',
      internal: false,
    },
  },
]

export default function GetStarted() {
  const [active, setActive] = useState(0)
  const current = OPTIONS[active]

  return (
    <section className="bg-[#fbfaf7] py-24">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
            几分钟就能<span className="text-primary">跑起来</span>。
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500">
            四种使用方式，挑一个适合你的。
          </p>
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_48px_-28px_rgba(0,0,0,0.14)] md:grid-cols-[220px_1fr]">
          <div className="flex flex-row overflow-x-auto border-b border-neutral-100 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
            {OPTIONS.map((opt, i) => (
              <button
                key={opt.roman}
                onClick={() => setActive(i)}
                className={`flex min-w-[160px] flex-1 items-center gap-3 px-5 py-4 text-left transition-colors md:min-w-0 ${
                  active === i
                    ? 'bg-neutral-50 md:border-l-2 md:border-l-neutral-900'
                    : 'hover:bg-neutral-50/60'
                }`}
              >
                <span className="font-serif text-sm text-primary italic">{opt.roman}</span>
                <span>
                  <span className="block text-sm font-medium text-neutral-900">{opt.title}</span>
                  <span className="block text-xs text-neutral-400">{opt.subtitle}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-5 p-8">
            <p className="text-sm text-neutral-600">{current.body}</p>

            {current.code && (
              <pre className="overflow-x-auto rounded-xl bg-neutral-900 p-5 text-sm text-neutral-100">
                <code>{current.code}</code>
              </pre>
            )}

            {current.link && (
              <div>
                {current.link.internal ? (
                  <Link
                    to={current.link.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {current.link.label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <a
                    href={current.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {current.link.label}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
