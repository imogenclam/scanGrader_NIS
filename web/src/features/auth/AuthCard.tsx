import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { MathBackground } from '@/features/auth/MathBackground'

export interface AuthMsg {
  type: 'success' | 'error'
  text: string
}

export function AuthMessage({ msg }: { msg: AuthMsg | null }) {
  if (!msg) return null
  return (
    <div role={msg.type === 'error' ? 'alert' : 'status'}
      className={cn(
        'mb-4 rounded-lg border px-3.5 py-2.5 text-[13px] max-md:text-sm',
        msg.type === 'success'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      {msg.text}
    </div>
  )
}

export function AuthLogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <path d="M7 25 H25 M7 25 V7" stroke="rgba(255,255,255,.5)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 9 Q16 30 24 9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

export function AuthCard({
  gradientClass,
  subtitle,
  logo,
  className,
  children,
}: {
  gradientClass: string
  subtitle: string
  logo?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <MathBackground />
      <Card
        className={cn(
          'w-full max-w-[400px] gap-0 overflow-hidden rounded-2xl border border-white/50 bg-white/45 p-0 shadow-2xl shadow-primary/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/40', // rules:allow ts-hard-color — стекло поверх живого фона
          className,
        )}
      >
        <div className="flex items-center gap-3.5 px-8 pb-5 pt-7">
          <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl shadow-lg shadow-primary/25', gradientClass)}>
            {logo ?? <AuthLogoMark />}
          </div>
          <div>
            <div className="font-serif text-xl font-semibold">Scan Grader</div>
            <div className="text-xs max-md:text-sm text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <div className="mx-8 h-px bg-border/60" />
        <CardContent className="px-8 pb-8 pt-6 [&_input]:border-foreground/25">{children}</CardContent>
      </Card>
    </div>
  )
}
