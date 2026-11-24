import { points, type Task } from '@/api'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { parsePoints } from '@/classroom/decimal'

export type ReviewRow = { number: number; score: string; comment: string }
export type ChangeRow = (number: number, field: 'score' | 'comment', value: string) => void

export function GradePanel({ tasks, rows, onChange }: { tasks: Task[]; rows: ReviewRow[]; onChange: ChangeRow }) {
  const sum = rows.reduce((acc, row) => {
    const n = parsePoints(row.score)
    return acc + (Number.isFinite(n) ? n : 0)
  }, 0)
  return (
    <div className="flex shrink-0 flex-col gap-2.5 border-b px-4 py-3.5">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Оценка по задачам</h2>
      {rows.map((row, index) => (
        <div key={row.number} className="space-y-1.5 pt-1">
          <div className="flex items-center gap-2">
            <label htmlFor={'score-' + row.number} className="flex-1 text-[12.5px]">Задача {row.number}</label>
            <Input id={'score-' + row.number} aria-label={'Балл за задачу ' + row.number} inputMode="decimal"
              data-grade-input="1" value={row.score} required placeholder="Балл"
              onChange={(e) => onChange(row.number, 'score', e.target.value)}
              className="h-9 w-20 text-center text-base md:text-[13px]" />
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">/ {points(tasks[index].max)}</span>
          </div>
          <label htmlFor={'comment-' + row.number} className="text-xs text-muted-foreground">Комментарий</label>
          <Textarea id={'comment-' + row.number} aria-label={'Комментарий к задаче ' + row.number}
            value={row.comment} required maxLength={1000} placeholder="Комментарий к решению…"
            onChange={(e) => onChange(row.number, 'comment', e.target.value)}
            className="min-h-16 resize-y text-base leading-relaxed md:text-sm" />
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t pt-1.5 text-[13px]">
        <span>Итого</span><span><strong className="text-[15px] text-success">{points(sum)}</strong> / {points(tasks.reduce((n, task) => n + task.max, 0))}</span>
      </div>
    </div>
  )
}
