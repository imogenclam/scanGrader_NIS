import { type ReactNode, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { BookOpen, LogOut, Menu, User } from 'lucide-react'
import { Popover } from 'radix-ui'
import { toast } from 'sonner'
import { useUser } from '@/lib/auth'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { logout } from '@/features/auth/api'
import { AuthLogoMark } from '@/features/auth/AuthCard'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'

async function logoutAndLeave() {
  try {
    await logout()
    window.location.assign('/login')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось выйти из аккаунта'))
  }
}

const frame = 'mx-auto w-full max-w-[60rem] px-4 sm:px-6'
const menuItem = 'flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-sm hover:bg-accent focus-visible:bg-accent'

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const [menuOpen, setMenuOpen] = useState(false)
  const inClassroom = useRouterState({ select: (s) => s.location.pathname.startsWith('/classroom/') })
  const displayName = user?.full_name || user?.login

  return (
    <div className="min-h-screen" data-app-shell>
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className={cn(frame, 'flex h-14 items-center gap-2 sm:gap-4')}>
          <Link to="/classroom/subjects" aria-label="Scan Grader" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-primary"><AuthLogoMark /></span>
            <span className="font-serif text-lg font-semibold tracking-tight">Scan <span className="text-primary">Grader</span></span>
          </Link>
          <nav aria-label="Основная навигация" className="ml-1 hidden border-l pl-4 sm:block">
            <Link to="/classroom/subjects"
              className={cn('inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-accent', inClassroom ? 'bg-primary/8 text-primary' : 'text-muted-foreground')}>
              <BookOpen className="size-4" /> Мои предметы
            </Link>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            {user && (
              <Link to="/profile" aria-label="Профиль" title="Профиль"
                className="hidden h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-accent sm:inline-flex [&.active]:bg-accent">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/10 text-xs text-primary">{displayName?.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="max-w-44 truncate">{displayName}</span>
              </Link>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label="Выйти" title="Выйти" onClick={logoutAndLeave}
              className="hidden text-muted-foreground sm:inline-flex">
              <LogOut className="size-4" />
            </Button>
            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Popover.Trigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-11 sm:hidden" aria-label="Меню">
                  <Menu className="size-5" />
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content aria-label="Навигация" align="end" sideOffset={6} collisionPadding={12}
                  className="z-50 w-48 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md">
                  <nav aria-label="Разделы">
                    <Popover.Close asChild><Link to="/classroom/subjects" className={menuItem}><BookOpen className="size-4" /> Мои предметы</Link></Popover.Close>
                    <Popover.Close asChild><Link to="/profile" className={menuItem}><User className="size-4" /> Профиль</Link></Popover.Close>
                  </nav>
                  <button type="button" onClick={logoutAndLeave} className={menuItem}><LogOut className="size-4" /> Выйти</button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
      </header>
      <main className={cn(frame, 'min-w-0 pb-8 pt-4 sm:pt-6')}>{children}</main>
    </div>
  )
}
