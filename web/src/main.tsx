import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, RouterProvider, useParams } from '@tanstack/react-router'
import { LoginForm } from '@/features/auth/LoginForm'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { AppShell } from '@/components/layout/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { profileQueryOptions, useUser } from '@/lib/auth'
import { setSessionLostHandler } from '@/lib/api'
import { saveReturnTo, takeReturnTo } from '@/lib/returnTo'
import type { User } from '@/api'
import './styles.css'

const SubjectsPage = lazy(() => import('@/classroom/Subjects').then(m => ({default: m.SubjectsPage})))
const CreateSubjectPage = lazy(() => import('@/classroom/SubjectEntry').then(m => ({default: m.CreateSubjectPage})))
const JoinPage = lazy(() => import('@/classroom/SubjectEntry').then(m => ({default: m.JoinPage})))
const SubjectPage = lazy(() => import('@/classroom/Subject').then(m => ({default: m.SubjectPage})))
const AssignmentPage = lazy(() => import('@/classroom/Assignment').then(m => ({default: m.AssignmentPage})))
const PublishPage = lazy(() => import('@/classroom/Publish').then(m => ({default: m.PublishPage})))
const ProfilePage = lazy(() => import('@/profile/ProfilePage').then(m => ({default: m.ProfilePage})))
const WorkPage = lazy(() => import('@/review/Work').then(m => ({default: m.WorkPage})))

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } })
setSessionLostHandler(() => client.setQueryData(profileQueryOptions().queryKey, null))

function NotFound() {
  return <main className="mx-auto max-w-lg p-8"><h1 className="mb-4 font-serif text-2xl">Страница не найдена</h1><Button asChild><a href="/classroom/subjects">Мои предметы</a></Button></main>
}

function Index() {
  const old = window.location.hash.slice(1)
  if (old === 'profile') return <Navigate to="/profile" replace />
  const match = /^(subject|assignment|work)\/([1-9][0-9]*)$/.exec(old)
  if (match) {
    const params = {id: match[2]}
    if (match[1] === 'subject') return <Navigate to="/classroom/subjects/$id" params={params} replace />
    if (match[1] === 'assignment') return <Navigate to="/classroom/assignments/$id" params={params} replace />
    return <Navigate to="/classroom/submissions/$id/view" params={params} replace />
  }
  return <Navigate to="/classroom/subjects" replace />
}

function AfterLogin() {
  const [target] = useState(takeReturnTo)
  useEffect(() => { if (target) window.location.replace(target) }, [target])
  return target ? null : <Navigate to="/classroom/subjects" replace />
}

function Private({ children, fullscreen = false }: { children: (user: User) => ReactNode; fullscreen?: boolean }) {
  const {user, isLoading, error, refetch} = useUser()
  if (isLoading) return <main className="mx-auto max-w-3xl p-6" aria-label="Загрузка"><Skeleton className="h-16 w-full" /></main>
  if (error) return <main className="mx-auto max-w-lg space-y-4 p-6"><p role="alert">Не удалось загрузить профиль.</p><Button onClick={() => void refetch()}>Повторить</Button></main>
  if (!user) {
    saveReturnTo(window.location.pathname + window.location.search)
    return <Navigate to="/login" replace />
  }
  const page = children(user)
  return fullscreen ? page : <AppShell>{page}</AppShell>
}

function Profile() {
  const queries = useQueryClient()
  return <Private>{user => <ProfilePage user={user} onUser={changed => queries.setQueryData(profileQueryOptions().queryKey, changed)} />}</Private>
}

function details(render: (id: number, user: User) => ReactNode, fullscreen = false) {
  return function Detail() {
    const params = useParams({ strict: false })
    const id = Number(params.id)
    if (!Number.isSafeInteger(id) || id <= 0) return <NotFound />
    return <Private fullscreen={fullscreen}>{user => <div className="contents" key={id}>{render(id, user)}</div>}</Private>
  }
}

const root = createRootRoute({
  component: () => <><Suspense fallback={<div role="status" aria-label="Загрузка страницы" className="mx-auto max-w-5xl p-6"><Skeleton className="h-20" /></div>}><Outlet /></Suspense><Toaster /></>,
  notFoundComponent: NotFound,
})
const route = <P extends string>(path: P, component: () => ReactNode) => createRoute({getParentRoute: () => root, path, component})
const routes = root.addChildren([
  route('/', Index),
  route('/dashboard', AfterLogin),
  route('/login', LoginForm), route('/register', RegisterPage), route('/forgot', ForgotPasswordPage),
  route('/profile', Profile),
  route('/classroom/subjects', () => <Private>{user => <SubjectsPage user={user} />}</Private>),
  route('/classroom/join', () => <Private>{user => <JoinPage user={user} />}</Private>),
  route('/classroom/subjects/create', () => <Private>{user => <CreateSubjectPage user={user} />}</Private>),
  route('/classroom/subjects/$id', details((id, user) => <SubjectPage id={id} user={user} />)),
  route('/classroom/subjects/$id/assignments/create', details((id, user) => <PublishPage id={id} user={user} />)),
  route('/classroom/assignments/$id', details((id, user) => <AssignmentPage id={id} user={user} />)),
  route('/classroom/submissions/$id/annotate', details((id, user) => <WorkPage id={id} user={user} />, true)),
  route('/classroom/submissions/$id/view', details((id, user) => <WorkPage id={id} user={user} />, true)),
])
const router = createRouter({routeTree: routes})
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
