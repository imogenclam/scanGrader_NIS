import { points, type Grade, type Task } from '@/api'
import { MathText } from '@/lib/mathjax'

export function GradeSummary({ grades, tasks }: { grades: Grade[]; tasks: Task[] }) {
  const total = grades.reduce((sum, g) => sum + g.score, 0)
  const max = tasks.reduce((sum, t) => sum + t.max, 0)
  return (
    <div className="min-w-0">
      <div className="font-serif text-2xl font-semibold text-primary">
        {points(total)}<span className="font-sans text-sm text-muted-foreground"> / {points(max)}</span>
      </div>
      <div className="mt-3 space-y-0">
        {grades.map((g) => {
          const task = tasks.find((t) => t.number === g.number)
          return (
            <div key={g.number} className="border-b py-2.5 last:border-0">
              <div className="flex justify-between gap-3 text-[13px]">
                <span>Задача {g.number}</span>
                <strong className="shrink-0 text-primary">{points(g.score)}{task && ' / ' + points(task.max)}</strong>
              </div>
              <MathText text={g.comment} className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
