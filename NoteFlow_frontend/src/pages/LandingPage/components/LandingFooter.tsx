import { Link } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import { GITHUB_URL } from '../constants'

const COLUMNS = [
  {
    title: '产品',
    links: [
      { label: '登录 / 注册', href: '/login', internal: true },
      { label: '在线体验', href: '/login', internal: true },
    ],
  },
  {
    title: '资源',
    links: [
      { label: '使用文档', href: '/login', internal: true },
      { label: '常见问题', href: '/login', internal: true },
    ],
  },
  {
    title: '联系',
    links: [
      { label: '开发者主页', href: GITHUB_URL },
      { label: '问题反馈', href: GITHUB_URL },
    ],
  },
]

export default function LandingFooter() {
  return (
    <footer className="border-t border-neutral-100 bg-[#fbfaf7] py-16">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
            <BrandLogo className="h-6 w-auto shrink-0" />
            <span className="text-base font-semibold text-neutral-800">NoteFlow</span>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-medium text-neutral-800">{col.title}</h4>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((l) =>
                  l.internal ? (
                    <li key={l.label}>
                      <Link
                        to={l.href}
                        className="text-sm text-neutral-500 transition-colors hover:text-neutral-800"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-neutral-500 transition-colors hover:text-neutral-800"
                      >
                        {l.label}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-neutral-200 pt-8 text-center">
          <p className="text-lg text-neutral-700">
            专注<span className="text-primary">笔记</span>，服务于每一次观看。
          </p>
          <p className="mt-6 text-xs text-neutral-400">
            © {new Date().getFullYear()} NoteFlow. 保留所有权利。
          </p>
        </div>
      </div>
    </footer>
  )
}
