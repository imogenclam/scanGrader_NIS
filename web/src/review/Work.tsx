import { useState, useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { points, request, useAction, useData, type Assignment, type Grade, type Submission, type User } from '@/api'
import { Load } from '@/shared'
import { parsePoints } from '@/classroom/decimal'
import { UnsavedChangesGuard } from '@/classroom/UnsavedChangesGuard'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AnnotateCanvas } from '@/features/annotate/AnnotateCanvas'
import { AnnotateHeader } from '@/features/annotate/AnnotateHeader'
import { AnnotateToolbar } from '@/features/annotate/AnnotateToolbar'
import { ReviewPanel } from '@/features/annotate/ReviewPanel'
import { useSubmissionPdf } from '@/features/annotate/useSubmissionPdf'
import type { ReviewRow, ChangeRow } from '@/features/annotate/GradePanel'

type WorkDetails = { submission: Submission; assignment: Assignment }
const desktopMedia = '(min-width: 768px)'
function subscribeDesktop(listener: () => void) {
  const query = window.matchMedia(desktopMedia)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

export function WorkPage({ id, user }: { id: number; user: User }) {
  return <SubmissionPage key={user.id + '/' + user.role + '/' + id} id={id} user={user} />
}

function SubmissionPage({ id, user }: { id: number; user: User }) {
  const { data, error, refresh } = useData<WorkDetails>('submissions/' + id, work => work.submission.state !== 'approved')
  if (!data) return (
    <main className="mx-auto max-w-5xl space-y-5 p-5">
      <Button variant="outline" size="sm" asChild><Link to="/classroom/subjects">← Мои предметы</Link></Button>
      <Load error={error} retry={refresh} />
    </main>
  )
  return <SubmissionWorkspace data={data} isTeacher={user.role === 'teacher'} refresh={refresh} loadError={error} />
}

function SubmissionWorkspace({ data, isTeacher, refresh, loadError }: { data: WorkDetails; isTeacher: boolean; refresh: () => void; loadError: string }) {
  const { assignment, submission } = data
  const url = '/api/submissions/' + submission.id + '/pdf'
  const pdf = useSubmissionPdf(url)
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopMedia).matches)
  const [panelOpen, setPanelOpen] = useState(false)
  const [edits, setEdits] = useState<Record<number, Partial<Pick<ReviewRow, 'score' | 'comment'>>>>({})
  const [confirmed, setConfirmed] = useState<Grade[] | null>(null)
  const [retried, setRetried] = useState(false)
  const action = useAction()

  // Поллинг и повторный запрос ИИ обновляют только поля, которых учитель ещё не касался.
  const rows: ReviewRow[] = assignment.tasks.map((task) => {
    const draft = submission.draft?.find((g) => g.number === task.number)
    return {
      number: task.number,
      score: edits[task.number]?.score ?? (draft ? String(draft.score) : ''),
      comment: edits[task.number]?.comment ?? draft?.comment ?? '',
    }
  })
  // Переход уже сохранён сервером; следующий ответ опроса дополнит его автором и временем.
  let current = submission
  if (confirmed && !submission.final) current = { ...submission, state: 'approved', final: confirmed }
  else if (retried && submission.can_retry) current = { ...submission, state: 'queued', can_retry: false }
  const dirty = !current.final && Object.keys(edits).length > 0

  const change: ChangeRow = (number, field, value) => {
    setEdits((old) => ({ ...old, [number]: { ...old[number], [field]: value } }))
  }
  function approve() {
    void action.run(async () => {
      const grades: Grade[] = rows.map((row, i) => {
        const score = parsePoints(row.score)
        const max = assignment.tasks[i].max
        if (!Number.isFinite(score) || score < 0 || score > max) {
          throw new Error('Укажите балл за задачу ' + row.number + ' от 0 до ' + points(max) + '.')
        }
        const comment = row.comment.trim()
        if (!comment || Array.from(comment).length > 1000) throw new Error('Введите комментарий к задаче ' + row.number + ' длиной до 1000 знаков.')
        return { number: row.number, score, comment }
      })
      try {
        await request('submissions/' + submission.id + '/approve', 'POST', { grades })
        setConfirmed(grades)
        setEdits({})
        toast.success('Оценка утверждена')
      } finally {
        refresh()
      }
    })
  }
  function retry() {
    void action.run(async () => {
      try {
        await request('submissions/' + submission.id + '/retry', 'POST')
        setRetried(true)
        toast.success('Работа снова в очереди проверки')
      } finally {
        refresh()
      }
    })
  }
  const sidePanel = <ReviewPanel submission={current} assignment={assignment} isTeacher={isTeacher} rows={rows}
    onChange={change} busy={action.busy} onSave={approve} onRetry={retry} error={action.error || loadError} />

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <UnsavedChangesGuard when={dirty} description="Введённые баллы и комментарии ещё не утверждены." />
      <AnnotateHeader submission={current} assignment={assignment} isTeacher={isTeacher} onOpenPanel={() => setPanelOpen(true)} />
      <AnnotateToolbar pdf={pdf} url={url} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <AnnotateCanvas pdf={pdf} url={url} />
        {desktop ? (
          <aside aria-label="Оценка и комментарии" className="flex w-80 shrink-0 flex-col overflow-hidden border-l bg-card">{sidePanel}</aside>
        ) : (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            <SheetContent side="bottom" aria-describedby={undefined} className="h-[85dvh] gap-0 p-0">
              <SheetHeader className="border-b px-4 py-3"><SheetTitle className="text-base">Оценка и комментарии</SheetTitle></SheetHeader>
              {sidePanel}
            </SheetContent>
          </Sheet>
        )}
      </div>
    </main>
  )
}
