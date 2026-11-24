import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
  role?: 'alert'
}

export function EmptyState({ icon: Icon, title, children, action, className, role }: EmptyStateProps) {
  return (
    <div role={role} className={cn('flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed bg-card px-4 py-3 sm:px-5', className)}>
      {Icon && <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4.5" /></span>}
      <div className="min-w-0 flex-auto basis-40 sm:basis-auto">
        {title && <h3 className="text-sm font-semibold">{title}</h3>}
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState(props: Omit<EmptyStateProps, 'icon' | 'role'>) {
  return <EmptyState role="alert" {...props} />
}
