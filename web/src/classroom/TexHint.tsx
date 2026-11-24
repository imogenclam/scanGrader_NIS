import { cn } from '@/lib/utils'

// под полем авторского текста: переносы там по правилу TeX (formatText tex)
export function TexHint({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>
      Новый абзац — пустая строка, перенос строки —{' '}
      <code className="rounded border bg-muted px-1 py-px font-mono text-[11px]">{'\\\\'}</code>
    </p>
  )
}
