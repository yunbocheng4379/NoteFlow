import {
  BotMessageSquare,
  Captions,
  Activity,
  Users,
  MessageSquareWarning,
  Bell,
  Cookie,
  Megaphone,
} from 'lucide-react'
import MenuBar, { IMenuProps } from '@/pages/SettingPage/components/menuBar.tsx'
import { useUserStore } from '@/store/userStore'

const Menu = () => {
  const user = useUserStore((s) => s.user)
  const isAdmin = !!user?.is_admin

  const menuList: IMenuProps[] = [
    {
      id: 'model',
      name: 'AI 模型设置',
      icon: <BotMessageSquare />,
      path: '/settings/model',
    },
    {
      id: 'transcriber',
      name: '音频转写配置',
      icon: <Captions />,
      path: '/settings/transcriber',
    },
    {
      id: 'monitor',
      name: '部署监控',
      icon: <Activity />,
      path: '/settings/monitor',
    },
    // 用户管理: 仅管理员可见
    ...(isAdmin
      ? [
          {
            id: 'users',
            name: '用户管理',
            icon: <Users />,
            path: '/settings/users',
          },
          {
            id: 'feedback',
            name: '反馈管理',
            icon: <MessageSquareWarning />,
            path: '/settings/feedback',
          },
          {
            id: 'cookie-pool',
            name: 'Cookie 池',
            icon: <Cookie />,
            path: '/settings/cookie-pool',
          },
          {
            id: 'notifications',
            name: '系统通知',
            icon: <Bell />,
            path: '/settings/notifications',
          },
          {
            id: 'update-logs-admin',
            name: '更新日志配置',
            icon: <Megaphone />,
            path: '/settings/update-logs-admin',
          },
        ]
      : []),
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="mt-1 flex-1">
        {menuList &&
          menuList.map(item => {
            return <MenuBar key={item.id} menuItem={item} />
          })}
      </div>
    </div>
  )
}
export default Menu