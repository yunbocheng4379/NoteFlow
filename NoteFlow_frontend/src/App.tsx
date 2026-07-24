import './App.css'
import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, HashRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { useTaskPolling } from '@/hooks/useTaskPolling.ts'
import { useCheckBackend } from '@/hooks/useCheckBackend.ts'
import { systemCheck } from '@/services/system.ts'
import BackendInitDialog from '@/components/BackendInitDialog'
import StartupBanner from '@/components/SystemDiagnostic/StartupBanner'
import BackendHealthIndicator from '@/components/BackendHealth/BackendHealthIndicator'
import UpdateLogBanner, { UpdateLogBannerSpacer } from '@/components/UpdateLogBanner'
import Index from '@/pages/Index.tsx'
import { HomePage } from './pages/HomePage/Home.tsx'
import LandingPage from '@/pages/LandingPage'
import { useUserStore } from '@/store/userStore'
import { rehydrateTaskStore, useTaskStore } from '@/store/taskStore'

const AuthPage = lazy(() => import('@/pages/AuthPage'))
const BindPhonePage = lazy(() => import('@/pages/BindPhonePage'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const SettingPage = lazy(() => import('./pages/SettingPage/index.tsx'))

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauri) return <>{children}</>
  if (localStorage.getItem('noteflow-onboarded') !== '1') return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

// 未登录访问根路径 "/" 时跳转到独立的产品介绍首页 /welcome，而非直接跳登录页；
// 未登录访问其它受保护路径（如 /tasks）时仍跳转 /login，行为不变
function AuthGuard({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useUserStore((s) => s.isLoggedIn())
  const location = useLocation()
  if (!isLoggedIn) {
    if (location.pathname === '/') return <Navigate to="/welcome" replace />
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

// 手机号未绑定时强制跳转绑定页; 老用户下次登录同样会被拦下来 (每次进入受保护路由都检查)
function PhoneGuard({ children }: { children: React.ReactNode }) {
  const user = useUserStore((s) => s.user)
  if (!user?.phone) return <Navigate to="/bind-phone" replace />
  return <>{children}</>
}

// 仅管理员可访问; 普通用户 (含 URL 直达) 一律跳回工作台
function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = useUserStore((s) => s.user)
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

const Model = lazy(() => import('@/pages/SettingPage/Model.tsx'))
const DownloaderForm = lazy(() => import('@/components/Form/DownloaderForm/Form.tsx'))
const ProviderForm = lazy(() => import('@/components/Form/modelForm/Form.tsx'))
const AboutPage = lazy(() => import('@/pages/SettingPage/about.tsx'))
const Monitor = lazy(() => import('@/pages/SettingPage/Monitor.tsx'))
const TranscriberPage = lazy(() => import('@/pages/SettingPage/transcriber.tsx'))
const NoteStylePage = lazy(() => import('@/pages/SettingPage/NoteStylePage.tsx'))
const UserManagementPage = lazy(() => import('@/pages/SettingPage/UserManagement.tsx'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const TaskListPage = lazy(() => import('@/pages/TaskListPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const ShareViewPage = lazy(() => import('@/pages/ShareViewPage/index.tsx'))
const CollectionShareViewPage = lazy(() => import('@/pages/ShareViewPage/CollectionView.tsx'))
const FeedbackPage = lazy(() => import('@/pages/FeedbackPage'))
const CookiePoolPage = lazy(() => import('@/pages/SettingPage/CookiePool'))
const NotificationsPage = lazy(() => import('@/pages/SettingPage/Notifications'))
const UpgradePage = lazy(() => import('@/pages/UpgradePage'))
const BillingPage = lazy(() => import('@/pages/BillingPage'))
const ReferralPage = lazy(() => import('@/pages/ReferralPage'))
const UpdateLogPage = lazy(() => import('@/pages/UpdateLogPage'))
const UpdateLogsAdminPage = lazy(() => import('@/pages/SettingPage/UpdateLogs'))
const CollectionPage = lazy(() => import('@/pages/CollectionPage'))
const CollectionDetailPage = lazy(() => import('@/pages/CollectionPage/Detail'))
const FlashcardPage = lazy(() => import('@/pages/FlashcardPage'))

function App() {
  useTaskPolling(3000)
  const { loading, initialized, failed, lastError, retry } = useCheckBackend()
  const user = useUserStore((s) => s.user)
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const loadHistory = useTaskStore((s) => s.loadHistory)
  const historyLoaded = useTaskStore((s) => s.historyLoaded)

  // On page refresh/boot, bind taskStore to the correct user key, then load history from backend
  useEffect(() => {
    if (user?.id) {
      rehydrateTaskStore(user.id)
    }
  }, [])

  // Load task history once the backend is ready and user is logged in
  useEffect(() => {
    if (initialized && user?.id && !historyLoaded) {
      loadHistory()
    }
  }, [initialized, user?.id])

  // 拉一次电力余额, 挂在侧栏 / NoteForm 里显示
  useEffect(() => {
    if (initialized && user?.id) {
      refreshBalance()
    }
  }, [initialized, user?.id])

  useEffect(() => {
    if (initialized) {
      systemCheck()
    }
  }, [initialized])

  if (!initialized) {
    return (
      <>
        <StartupBanner />
        <BackendInitDialog
          open={loading}
          failed={failed}
          lastError={lastError}
          onRetry={retry}
        />
      </>
    )
  }

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const Router = isTauri ? HashRouter : BrowserRouter

  return (
    <>
      <StartupBanner />
      <UpdateLogBanner />
      <BackendHealthIndicator />
      <Router>
        <Suspense fallback={<div className="flex h-screen items-center justify-center">加载中…</div>}>
          <Routes>
            <Route path="/welcome" element={<LandingPage />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/bind-phone" element={<BindPhonePage />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/sn/:token" element={<ShareViewPage />} />
            <Route path="/sc/:token" element={<CollectionShareViewPage />} />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <PhoneGuard>
                    <OnboardingGuard>
                      <UpdateLogBannerSpacer />
                      <Index />
                    </OnboardingGuard>
                  </PhoneGuard>
                </AuthGuard>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="tasks" element={<TaskListPage />} />
              <Route path="collections" element={<CollectionPage />} />
              <Route path="collections/:id" element={<CollectionDetailPage />} />
              <Route path="flashcards/:setId" element={<FlashcardPage />} />
              <Route path="note-style" element={<NoteStylePage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="upgrade" element={<UpgradePage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="referral" element={<ReferralPage />} />
              <Route path="update-logs" element={<UpdateLogPage />} />
              <Route path="about" element={<AboutPage />} />
              <Route
                path="settings"
                element={
                  <AdminGuard>
                    <SettingPage />
                  </AdminGuard>
                }
              >
                <Route index element={<Navigate to="model" replace />} />
                <Route path="model" element={<Model />}>
                  <Route path="new" element={<ProviderForm isCreate />} />
                  <Route path=":id" element={<ProviderForm />} />
                </Route>
                <Route path="download" element={<DownloaderForm />} />
                <Route path="transcriber" element={<TranscriberPage />} />
                <Route path="monitor" element={<Monitor />} />
                <Route path="users" element={<UserManagementPage />} />
                <Route path="feedback" element={<FeedbackPage />} />
                <Route path="cookie-pool" element={<CookiePoolPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="update-logs-admin" element={<UpdateLogsAdminPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </>
  )
}

export default App
