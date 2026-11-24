import { Link } from '@tanstack/react-router'
import { Check, Clock, Download, Eye, PenLine, Sparkles } from 'lucide-react'
import { states, type Submission } from '@/api'
import { mskDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function SubmissionCard({ submission: s }: { submission: Submission }) {
  const approved = s.state === 'approved'
  const ready = s.state === 'draft'
  const color = approved ? 'bg-success-soft text-success' : ready ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400' : 'bg-warning-soft text-warning'
  const StatusIcon = approved ? Check : ready ? Sparkles : Clock
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">{s.student.charAt(0).toUpperCase()}</span>
      <div className="min-w-0 flex-1 basis-40">
        <div className="break-words text-sm font-semibold">{s.student}</div>
        <div className="break-words text-xs text-muted-foreground">{s.group && s.group + ' · '}{mskDateTime(s.submitted_at, ' в ')}</div>
      </div>
      <Badge className={cn('gap-1', color)}><StatusIcon className="size-3" />{states[s.state] ?? s.state}</Badge>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant={approved ? 'outline' : 'default'} className="max-sm:h-11" asChild>
          <Link to="/classroom/submissions/$id/annotate" params={{ id: String(s.id) }}>
            {approved ? <Eye className="size-3.5" /> : <PenLine className="size-3.5" />}{approved ? 'Посмотреть' : 'Проверить'}
          </Link>
        </Button>
        <Button size="icon" variant="ghost" className="size-11 text-muted-foreground sm:size-8" asChild>
          <a href={'/api/submissions/' + s.id + '/pdf'} download={'Работа - ' + s.student + '.pdf'} aria-label="Скачать работу" title="Скачать работу"><Download className="size-4" /></a>
        </Button>
      </div>
    </div>
  )
}
