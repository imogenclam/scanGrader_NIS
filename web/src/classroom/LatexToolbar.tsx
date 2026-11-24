import { useState, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LatexTarget {
  el: HTMLTextAreaElement | HTMLInputElement
  setValue: (value: string) => void
}

export type LatexTargetRef = RefObject<LatexTarget | null>

interface LatexButton {
  label: string
  latex: string
  cb?: number
  title?: string
  plain?: boolean
}

// выделение текста — не формула, доллары вокруг не нужны
const TEXT_BUTTONS: LatexButton[] = [
  { label: 'Ж', latex: '\\textbf{}', cb: 1, title: 'Полужирный (\\textbf)', plain: true },
  { label: 'К', latex: '\\textit{}', cb: 1, title: 'Курсив (\\textit)', plain: true },
]

const LATEX_BUTTONS: { g: string; items: LatexButton[] }[] = [
  {
    g: 'Структура',
    items: [
      { label: 'a/b', latex: '\\frac{}{}', cb: 3, title: 'Дробь' },
      { label: '√x', latex: '\\sqrt{}', cb: 1, title: 'Корень' },
      { label: 'xⁿ', latex: '^{}', cb: 1, title: 'Степень' },
      { label: 'xₙ', latex: '_{}', cb: 1, title: 'Нижний индекс' },
      { label: '( )', latex: '\\left( \\right)', cb: 8, title: 'Скобки' },
      { label: 'x̄', latex: '\\overline{}', cb: 1, title: 'Черта сверху' },
      { label: 'Cₙᵏ', latex: '\\binom{}{}', cb: 3, title: 'Биномиальный коэффициент' },
      { label: '(⋮)', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', cb: 0, title: 'Матрица 2×2' },
      { label: '{ ⋮', latex: '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}', cb: 0, title: 'Система (cases)' },
    ],
  },
  {
    g: 'Множества и логика',
    items: [
      { label: 'ℝ', latex: '\\mathbb{R}', title: 'Действительные числа' },
      { label: '∀', latex: '\\forall' },
      { label: '∃', latex: '\\exists' },
      { label: '∈', latex: '\\in' },
      { label: '⊂', latex: '\\subset' },
      { label: '∧', latex: '\\land' },
      { label: '∨', latex: '\\lor' },
      { label: '¬', latex: '\\neg' },
    ],
  },
  {
    g: '∫ Σ',
    items: [
      { label: '∫', latex: '\\int', cb: 0, title: 'Интеграл' },
      { label: '∫ᵃᵇ', latex: '\\int_{a}^{b}', cb: 0, title: 'Интеграл с пределами' },
      { label: 'Σ', latex: '\\sum_{i=1}^{n}', cb: 0, title: 'Сумма' },
      { label: '∏', latex: '\\prod_{i=1}^{n}', cb: 0, title: 'Произведение' },
      { label: 'lim', latex: '\\lim_{x \\to \\infty}', cb: 0, title: 'Предел' },
    ],
  },
  {
    g: 'Буквы',
    items: [
      { label: 'α', latex: '\\alpha' },
      { label: 'β', latex: '\\beta' },
      { label: 'γ', latex: '\\gamma' },
      { label: 'δ', latex: '\\delta' },
      { label: 'π', latex: '\\pi' },
      { label: 'σ', latex: '\\sigma' },
      { label: 'θ', latex: '\\theta' },
      { label: 'λ', latex: '\\lambda' },
      { label: 'μ', latex: '\\mu' },
      { label: '∞', latex: '\\infty' },
    ],
  },
  {
    g: 'Знаки',
    items: [
      { label: '≤', latex: '\\leq' },
      { label: '≥', latex: '\\geq' },
      { label: '≠', latex: '\\neq' },
      { label: '≈', latex: '\\approx' },
      { label: '±', latex: '\\pm' },
      { label: '×', latex: '\\times' },
      { label: '→', latex: '\\to' },
      { label: '⟺', latex: '\\Leftrightarrow' },
    ],
  },
]

function isInMathMode(text: string, pos: number): boolean {
  let count = 0
  let i = 0
  while (i < pos) {
    if (text[i] === '$') {
      if (i + 1 < pos && text[i + 1] === '$') i += 2
      else i++
      count++
    } else {
      i++
    }
  }
  return count % 2 === 1
}

export function LatexToolbar({ targetRef }: { targetRef: LatexTargetRef }) {
  const [open, setOpen] = useState(false)

  function insertLatex(latex: string, cursorBack: number, plain = false) {
    const target = targetRef.current
    if (!target) return
    const ta = target.el
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? start
    const selected = ta.value.substring(start, end)
    let insert = latex
    let cb = cursorBack || 0
    if (selected && insert.includes('{}')) {
      insert = insert.replace('{}', '{' + selected + '}')
      cb = 0
    }
    if (!plain && !isInMathMode(ta.value, start)) {
      insert = '$' + insert + '$'
      if (cb > 0) cb += 1
    }
    const next = ta.value.substring(0, start) + insert + ta.value.substring(end)
    target.setValue(next)
    const pos = start + insert.length - cb
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="mb-2.5 rounded-lg border bg-muted/50">
      {/* выделение всегда на виду, формулы на телефоне складываются */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 md:pb-0">
        <span className="hidden whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-muted-foreground md:inline">
          Текст:
        </span>
        {TEXT_BUTTONS.map((btn) => (
          <button
            key={btn.latex}
            type="button"
            title={btn.title}
            className={cn(
              'min-h-11 min-w-11 rounded border bg-background px-2 font-serif text-[15px] text-foreground transition-colors hover:border-primary hover:text-primary md:min-h-8 md:min-w-8 md:text-[13px]',
              btn.label === 'Ж' ? 'font-bold' : 'italic',
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertLatex(btn.latex, btn.cb || 0, true)}
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 flex-1 items-center justify-between text-left text-[13px] font-medium md:hidden"
        >
          Вставить формулу
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      <div
        className={cn(
          'flex-wrap items-center gap-1.5 px-3 pb-2 md:flex md:py-2',
          open ? 'flex' : 'hidden',
        )}
      >
        {LATEX_BUTTONS.map((group, gi) => (
          <div key={group.g} className="flex flex-wrap items-center gap-1.5">
            {gi > 0 && <span className="mx-1 hidden h-5 w-px shrink-0 bg-border md:block" />}
            <span className="w-full whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-muted-foreground md:w-auto">
              {group.g}:
            </span>
            {group.items.map((btn) => (
              <button
                key={btn.latex + btn.label}
                type="button"
                title={btn.title || btn.latex}
                className="min-h-11 min-w-11 rounded border bg-background px-2 py-0.5 font-serif text-[15px] text-foreground transition-colors hover:border-primary hover:text-primary md:min-h-0 md:min-w-7 md:text-[13px]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertLatex(btn.latex, btn.cb || 0)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
