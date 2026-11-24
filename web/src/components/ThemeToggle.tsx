import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'vm-tap relative inline-flex h-7 w-[52px] shrink-0 items-center rounded-full border border-border bg-muted',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <Sun className="pointer-events-none absolute left-1.5 size-3.5 text-muted-foreground" />
      <Moon className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" />
      <span
        className={cn(
          'pointer-events-none z-10 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform',
          isDark ? 'translate-x-[26px]' : 'translate-x-0.5',
        )}
      >
        {isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
      </span>
    </button>
  )
}
