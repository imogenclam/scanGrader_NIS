import { Link } from '@tanstack/react-router'
import { ArrowLeft, ClipboardCheck } from 'lucide-react'
import { AIReviewDialog } from './AIReviewDialog'
import { Button } from '@/components/ui/button'
import { states, type Assignment, type Submission } from '@/api'

export function AnnotateHeader({ submission, assignment, isTeacher, onOpenPanel }: {
  submission: Submission; assignment: Assignment; isTeacher: boolean; onOpenPanel: () => void
}) {
  return (
    <div className="z-20 flex h-13 shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-5">
      <Button variant="secondary" size="sm" className="size-10 sm:h-8 sm:w-auto" asChild>
        <Link to="/classroom/assignments/$id" params={{ id: String(assignment.id) }} aria-label="Назад к заданию">
          <ArrowLeft className="size-4" /><span className="hidden sm:inline">Назад</span>
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium">
          {isTeacher ? submission.student + ' — ' : ''}{assignment.title}
        </h1>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {isTeacher && submission.group ? submission.group + ' · ' : ''}{states[submission.state] ?? submission.state}
        </p>
      </div>
      {isTeacher && !!submission.draft?.length && <AIReviewDialog draft={submission.draft} tasks={assignment.tasks} />}
      <Button size="sm" className="h-10 shrink-0 md:hidden" onClick={onOpenPanel}>
        <ClipboardCheck className="size-4" /> Оценка
      </Button>
    </div>
  )
}
