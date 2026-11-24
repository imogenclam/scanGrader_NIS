import { Link } from '@tanstack/react-router'
import { Check, Clock, Download, Eye } from 'lucide-react'
import { type Assignment, type Submission, useData } from '@/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { mskDateTime } from '@/lib/time'
import { ErrorLine } from '@/shared'
import { GradeSummary } from './GradeSummary'

function ApprovedScores({ id }: { id: number }) {
  const { data, error } = useData<{ submission: Submission; assignment: Assignment }>('submissions/' + id)
  if (error) return <ErrorLine text={error} />
  if (!data?.submission.final) return <p role="status" className="text-sm text-muted-foreground">Загрузка оценки…</p>
  return <GradeSummary grades={data.submission.final} tasks={data.assignment.tasks} />
}

export function MySubmissionCard({ submission }: { submission: Submission }) {
  const approved = submission.state === 'approved'
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <div aria-hidden="true" className={'grid size-9 shrink-0 place-items-center rounded-full ' + (approved ? 'bg-success-soft' : 'bg-warning-soft')}>
          {approved ? <Check className="size-5 text-success" /> : <Clock className="size-5 text-warning" />}
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-semibold">{approved ? 'Работа проверена' : 'Работа ожидает проверки'}</h2>
          <p className="text-sm text-muted-foreground">Сдано {mskDateTime(submission.submitted_at, ' в ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="outline" className="max-sm:h-11" asChild>
            <Link to="/classroom/submissions/$id/view" params={{ id: String(submission.id) }}><Eye className="size-3.5" /> Просмотреть работу</Link>
          </Button>
          <Button size="icon" variant="ghost" className="size-11 text-muted-foreground sm:size-8" asChild>
            <a href={'/api/submissions/' + submission.id + '/pdf'} download="Моя работа.pdf" aria-label="Скачать мою работу" title="Скачать мою работу"><Download className="size-4" /></a>
          </Button>
        </div>
      </div>
      {approved && <div className="border-t px-4 py-3 sm:px-5"><ApprovedScores id={submission.id} /></div>}
    </Card>
  )
}
