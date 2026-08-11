import { useState, useRef, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import {
  SlidersHorizontal,
  LayoutDashboard,
  ListTodo,
  MessageSquareWarning,
  LogOut,
  Palette,
  User,
  ChevronUp,
  Zap,
  ReceiptText,
  Gift,
  Info,
  Megaphone,
  Folder,
  BookOpen,
} from 'lucide-react'
import logo from '@/assets/icon.svg'
import { useUserStore } from '@/store/userStore'
import { clearTaskStoreForLogout } from '@/store/taskStore'
import { clearDismissedUpdateLogs } from '@/services/updateLog'
import FeedbackDialog from '@/components/FeedbackDialog'
import WorkspaceAssistant from '@/components/WorkspaceAssistant'
import { useAssistantStore } from '@/store/assistantStore'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: '工作台', to: '/' },
  { icon: ListTodo, label: '任务列表', to: '/tasks' },
  { icon: Folder, label: '笔记合集', to: '/collections', pro: true },
  { icon: BookOpen, label: '知识库', to: '/knowledge-base', pro: true },
  { icon: Palette, label: '笔记风格', to: '/note-style' },
  { icon: Megaphone, label: '更新日志', to: '/update-logs' },
  { icon: Zap, label: '升级 Pro', to: '/upgrade' },
  { icon: ReceiptText, label: '账单与额度', to: '/billing' },
  { icon: Gift, label: '我的推荐码', to: '/referral' },
] // 全体用户可见的「更新日志」入口

const Index = () => {
  const location = useLocation()
  const { user, clearAuth, credits, activeSubscription } = useUserStore()
  const clearAssistant = useAssistantStore(state => state.clear)
  const isAdmin = !!user?.is_admin
  const [showFeedback, setShowFeedback] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userCardRef = useRef<HTMLDivElement>(null)

  const handleLogout = () => {
    clearTaskStoreForLogout()
    clearAssistant()
    clearDismissedUpdateLogs()
    clearAuth()
    window.location.href = '/login'
  }

  const avatarSrc = user?.avatar
    ? user.avatar.startsWith('http')
      ? user.avatar
      : `${API_BASE}${user.avatar}`
    : null

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userCardRef.current && !userCardRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="flex h-[calc(100vh-var(--banner-h,0px))] overflow-hidden transition-[height] duration-150">
      {/* 左侧导航栏：宽度平滑过渡，icon 始终固定在左侧 */}
      <nav
        className={`relative flex shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-14' : 'w-44'
        }`}
      >
        {/* 顶部 toggle 区域：整行可点击，logo 固定不动 */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex h-14 w-full shrink-0 items-center border-b border-neutral-100 hover:bg-neutral-50"
        >
          {/* logo 固定在 w-14 的列中，始终不移动 */}
          <span className="flex w-14 shrink-0 items-center justify-center">
            <img src={logo} alt="logo" className="h-7 w-7 object-contain" />
          </span>
          {/* 文字和收起图标，展开时淡入，折叠时淡出 */}
          <span
            className={`flex min-w-0 items-center overflow-hidden transition-[opacity,max-width] duration-200 ${
              collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
            }`}
          >
            <span className="text-sm font-semibold whitespace-nowrap text-gray-800">NoteFlow</span>
          </span>
        </button>

        {/* 主导航区 */}
        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden px-1 py-2">
          {NAV_ITEMS.map(({ icon: Icon, label, to, pro }) => {
            const isActive = location.pathname === to
            const isUpgrade = to === '/upgrade'
            let cls = isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-neutral-100 hover:text-foreground'
            if (isUpgrade) {
              cls = isActive
                ? 'bg-blue-50 text-blue-600'
                : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'
            }
            return (
              <Link
                key={to}
                to={to}
                className={`flex h-9 w-full items-center rounded-lg transition-colors ${cls}`}
              >
                <span className="flex w-12 shrink-0 items-center justify-center">
                  <Icon className="h-5 w-5" />
                </span>
                <span
                  className={`flex items-center gap-1 overflow-hidden text-sm whitespace-nowrap transition-[opacity,max-width] duration-200 ${
                    collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
                  } ${isUpgrade ? 'font-semibold' : ''}`}
                >
                  {label}
                  {pro && (
                    <span className="rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-800">
                      Pro
                    </span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>

        {/* 底部操作区 */}
        <div className="flex flex-col gap-0.5 px-1 py-2">
          {/* 关于: 所有用户可见（位于主导航底部，「问题反馈」上方） */}
          <Link
            to="/about"
            className={`flex h-9 w-full items-center rounded-lg transition-colors ${
              location.pathname === '/about'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-neutral-100'
            }`}
          >
            <span className="flex w-12 shrink-0 items-center justify-center">
              <Info className="h-5 w-5" />
            </span>
            <span
              className={`overflow-hidden text-sm whitespace-nowrap transition-[opacity,max-width] duration-200 ${
                collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
              }`}
            >
              关于
            </span>
          </Link>

          <button
            onClick={() => setShowFeedback(true)}
            className="text-muted-foreground hover:text-foreground flex h-9 w-full items-center rounded-lg transition-colors hover:bg-neutral-100"
          >
            <span className="flex w-12 shrink-0 items-center justify-center">
              <MessageSquareWarning className="h-5 w-5" />
            </span>
            <span
              className={`overflow-hidden text-sm whitespace-nowrap transition-[opacity,max-width] duration-200 ${
                collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
              }`}
            >
              问题反馈
            </span>
          </button>

          {/* 全局配置: 仅管理员可见 */}
          {isAdmin && (
            <Link
              to="/settings"
              className="text-muted-foreground hover:text-foreground flex h-9 w-full items-center rounded-lg transition-colors hover:bg-neutral-100"
            >
              <span className="flex w-12 shrink-0 items-center justify-center">
                <SlidersHorizontal className="h-5 w-5" />
              </span>
              <span
                className={`overflow-hidden text-sm whitespace-nowrap transition-[opacity,max-width] duration-200 ${
                  collapsed ? 'max-w-0 opacity-0' : 'max-w-[120px] opacity-100'
                }`}
              >
                全局配置
              </span>
            </Link>
          )}

          {/* 电力余额卡片 */}
          <Link
            to="/billing"
            className={`mt-1 flex items-center rounded-xl bg-slate-950 text-white shadow-sm transition-colors hover:bg-slate-900 ${
              collapsed ? 'h-10 justify-center px-0' : 'h-14 gap-3 px-3'
            }`}
            title={`剩余电力 ${credits}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white">
              <Zap className="h-4 w-4 fill-current" />
            </span>
            <span
              className={`flex min-w-0 flex-col overflow-hidden transition-[opacity,max-width] duration-200 ${
                collapsed ? 'max-w-0 opacity-0' : 'max-w-[100px] opacity-100'
              }`}
            >
              <span className="truncate text-lg leading-5 font-bold tabular-nums">{credits}</span>
              <span className="truncate text-[10px] leading-3 font-medium tracking-[0.16em] text-white/55 uppercase">
                剩余电力
              </span>
              {activeSubscription && (
                <span className="mt-0.5 truncate text-[10px] leading-3 text-emerald-200">
                  {activeSubscription.plan_name}
                </span>
              )}
            </span>
          </Link>

          {/* 用户卡片 + 弹出菜单 */}
          <div ref={userCardRef} className="relative mt-1">
            {/* 弹出菜单，向上弹出 */}
            {showUserMenu && (
              <div className="absolute right-0 bottom-full left-0 mb-1.5 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
                <Link
                  to="/profile"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-neutral-50"
                >
                  <User className="h-4 w-4 text-neutral-500" />
                  个人信息
                </Link>
                <div className="mx-2 h-px bg-neutral-100" />
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-500 transition-colors hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            )}

            {/* 用户卡片按钮 */}
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className={`flex w-full items-center rounded-xl border transition-colors ${
                showUserMenu
                  ? 'border-neutral-200 bg-neutral-50'
                  : 'border-transparent hover:bg-neutral-50'
              } ${collapsed ? 'justify-center px-0 py-2' : 'gap-2 px-2 py-2'}`}
            >
              {/* 头像 */}
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt="avatar"
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700">
                  {user?.username?.[0]?.toUpperCase() ?? 'U'}
                </span>
              )}

              {/* 用户名，折叠时隐藏 */}
              <span
                className={`flex min-w-0 flex-1 flex-col items-start overflow-hidden transition-[opacity,max-width] duration-200 ${
                  collapsed ? 'max-w-0 opacity-0' : 'max-w-[80px] opacity-100'
                }`}
              >
                <span className="w-full truncate text-xs font-medium whitespace-nowrap text-gray-800">
                  {user?.username ?? '用户'}
                </span>
              </span>

              {/* 展开箭头 */}
              <ChevronUp
                className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-[opacity,transform] duration-200 ${
                  collapsed ? 'opacity-0' : 'opacity-100'
                } ${showUserMenu ? 'rotate-180' : 'rotate-0'}`}
              />
            </button>
          </div>
        </div>
      </nav>

      <div className="flex h-full flex-1 overflow-hidden">
        <Outlet />
      </div>

      <FeedbackDialog open={showFeedback} onClose={() => setShowFeedback(false)} />
      <WorkspaceAssistant />
    </div>
  )
}

export default Index
