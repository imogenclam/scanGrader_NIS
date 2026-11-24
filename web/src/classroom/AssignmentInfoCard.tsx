import { FileDown } from 'lucide-react'
import type { Assignment } from '@/api'
import { MathContent } from '@/lib/mathjax'
import { Button } from '@/components/ui/button'
import { formatText } from './format-text'
import { TasksBlock } from './TasksBlock'

export function AssignmentInfoCard({ assignment, isTeacher, showTasks }: { assignment: Assignment; isTeacher: boolean; showTasks: boolean }) {
  const hasTasks = showTasks && assignment.tasks.length > 0
  if (!assignment.statement && !hasTasks && !isTeacher) return null
  return (
    <section aria-label="Условие и баллы" className="divide-y rounded-xl border bg-card shadow-sm">
      {assignment.statement && <MathContent html={formatText(assignment.statement, { tex: true })}
        className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed sm:px-5" />}
      {(hasTasks || isTeacher) && <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        {hasTasks && <TasksBlock assignment={assignment} />}
        {isTeacher && <Button variant="outline" size="sm" asChild className="max-sm:h-11">
          <a href={'/api/assignments/' + assignment.id + '/reference'} download><FileDown className="size-4" /> Скачать эталон .tex</a>
        </Button>}
      </div>}
    </section>
  )
}
