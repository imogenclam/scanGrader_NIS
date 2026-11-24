import { useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { MathContent } from '@/lib/mathjax'
import { hasRawMath } from '@/lib/math-text'
import { cn } from '@/lib/utils'
import { formatText } from './format-text'
import { LatexToolbar, type LatexTarget } from './LatexToolbar'
import { TexHint } from './TexHint'

// текстовое поле с панелью формул и предпросмотром
export function MathField({
  id,
  value,
  onChange,
  placeholder,
  className,
  required,
  maxLength,
}: {
  id?: string
  required?: boolean
  maxLength?: number
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const targetRef = useRef<LatexTarget | null>(null)
  const [showTools, setShowTools] = useState(false)

  // переносы тоже показываем: одиночный Enter теперь пробел
  const showPreview = hasRawMath(value) || value.trim().includes('\n')

  return (
    <div className="min-w-0">
      {showTools && <LatexToolbar targetRef={targetRef} />}
      <Textarea
        id={id}
        required={required}
        maxLength={maxLength}
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (taRef.current) targetRef.current = { el: taRef.current, setValue: onChange }
          // Оставляем панель на месте: при blur следующий элемент уже может быть нажат.
          setShowTools(true)
        }}
        placeholder={placeholder}
        className={cn('min-h-20 text-[13px] leading-relaxed', className)}
      />
      {showTools && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          Формулы в строке: <code className="rounded border bg-muted px-1 py-px font-mono">$E = mc^2$</code>{' '}
          · блочные: <code className="rounded border bg-muted px-1 py-px font-mono">{'$$\\int_a^b f$$'}</code>
          <TexHint className="text-[11px]" />
        </div>
      )}
      {showPreview && (
        <div className="mt-1.5 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Предпросмотр
          </div>
          <MathContent
            html={formatText(value, { tex: true })}
            className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}
