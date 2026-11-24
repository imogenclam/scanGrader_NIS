import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RoleChoice({
  icon: Icon,
  title,
  sub,
  selected,
  onSelect,
  goal,
}: {
  icon: LucideIcon
  title: string
  sub: string
  selected: boolean
  onSelect: () => void
  goal?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-ym-goal={goal}
      className={cn(
        'flex flex-col items-start gap-1.5 rounded-xl border px-3.5 py-3 text-left transition',
        'hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
          : 'border-foreground/20 bg-background/40',
      )}
    >
      <Icon className={cn('size-5', selected ? 'text-primary' : 'text-muted-foreground')} />
      <div className="text-sm font-medium leading-none">{title}</div>
      <div className="text-[11px] max-md:text-sm leading-tight text-muted-foreground">{sub}</div>
    </button>
  )
}
