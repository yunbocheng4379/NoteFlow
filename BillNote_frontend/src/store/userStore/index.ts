import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserInfo } from '@/services/auth'
import { billingApi, ActiveSubscription } from '@/services/billing'

interface UserStore {
  token: string | null
  user: UserInfo | null
  credits: number
  activeSubscription: ActiveSubscription | null
  setAuth: (token: string, user: UserInfo) => void
  clearAuth: () => void
  isLoggedIn: () => boolean
  refreshBalance: () => Promise<void>
  setCredits: (c: number, sub?: ActiveSubscription | null) => void
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      credits: 0,
      activeSubscription: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null, credits: 0, activeSubscription: null }),
      isLoggedIn: () => !!get().token,
      setCredits: (c, sub) =>
        set((s) => ({ credits: c, activeSubscription: sub === undefined ? s.activeSubscription : sub })),
      refreshBalance: async () => {
        try {
          const r = await billingApi.balance()
          set({ credits: r.credits, activeSubscription: r.active_subscription })
        } catch {
          // 静默失败: 不打断主流程
        }
      },
    }),
    {
      name: 'noteflow-user',
      partialize: (s) => ({ token: s.token, user: s.user }), // credits 不持久化, 登录时重拉
    },
  ),
)
