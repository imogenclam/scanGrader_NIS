import { type FormEvent } from 'react'
import { Check, Clock, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MathContent } from '@/lib/mathjax'
import { mskDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { GradeSummary } from '@/classroom/GradeSummary'
import { formatText } from '@/classroom/format-text'
import { ErrorLine } from '@/shared'
import type { Assignment, Submission } from '@/api'
import { GradePanel, type ChangeRow, type ReviewRow } from './GradePanel'
import { useSheetTyping } from './useSheetTyping'

interface Props {
  submission: Submission
  assignment: Assignment
  isTeacher: boolean
  rows: ReviewRow[]
  onChange: ChangeRow
  busy: boolean
  error: string
  onSave: () => void
  onRetry: () => void
}

export function ReviewPanel({ submission: s, assignment, isTeacher, rows, onChange, busy, error, onSave, onRetry }: Props) {
  const sheet = useSheetTyping()
  const editable = isTeacher && (s.state === 'draft' || s.state === 'manual') && !s.final
  function submit(e: FormEvent) { e.preventDefault(); if (editable) onSave() }
  return (
    <form onSubmit={submit} className={cn('flex min-h-0 flex-1 flex-col', sheet.typing ? 'max-md:overflow-y-auto' : 'overflow-hidden')}>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain', sheet.typing && 'max-md:flex-none max-md:overflow-visible')}
        onFocus={sheet.onFocus} onBlur={sheet.onBlur}>
        {isTeacher && (
          <details className="group shrink-0 border-b px-4 py-3">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Условие задания<span className="font-normal normal-case tracking-normal group-open:hidden">показать</span>
            </summary>
            <MathContent html={formatText(assignment.statement, { tex: true })} className="mt-2 break-words text-sm [overflow-wrap:anywhere]" />
          </details>
        )}
        {s.final && s.state === 'approved' ? (
          <div className="space-y-3 px-4 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-success">
              <Check className="size-4" /> Итоговая оценка
            </div>
            <GradeSummary grades={s.final} tasks={assignment.tasks} />
            {(s.approved_by || s.approved_at) && (
              <p className="border-t pt-2 text-xs text-muted-foreground">
                {s.approved_by}{s.approved_at && (s.approved_by ? ' · ' : '') + mskDateTime(s.approved_at, ' в ')}
              </p>
            )}
          </div>
        ) : editable ? (
          <>
            <div className="shrink-0 space-y-2 border-b px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {s.state === 'manual' ? (
                <>
                  <p className="font-semibold text-foreground">Ручная проверка</p>
                  <p>{s.reason || 'Проверьте скан и выставьте баллы за задачи вручную.'}</p>
                  {s.can_retry && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRetry}>
                    <RotateCcw className="size-3.5" /> Повторить ИИ-проверку
                  </Button>}
                </>
              ) : (
                <p>ИИ предложил баллы и комментарии. Проверьте их перед утверждением.</p>
              )}
            </div>
            <fieldset disabled={busy} className="min-w-0"><GradePanel tasks={assignment.tasks} rows={rows} onChange={onChange} /></fieldset>
          </>
        ) : (
          <div role="status" className="space-y-2 px-4 py-4 text-sm text-muted-foreground">
            <Clock className="size-5 text-warning" />
            <p className="font-semibold text-foreground">{isTeacher ? 'Идёт обработка работы' : 'Работа сдана'}</p>
            <p>{isTeacher ? 'Черновик появится здесь автоматически после проверки.' : 'Баллы и комментарии появятся после утверждения преподавателем.'}</p>
          </div>
        )}
      </div>
      {(editable || error) && <div className="flex shrink-0 flex-col gap-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <ErrorLine text={error} />
        {editable && <>
          <Button type="submit" variant="success" className="h-11 w-full md:h-9" disabled={busy}>
            <Send className="size-4" />{busy ? 'Сохранение…' : 'Утвердить оценку'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">Студент увидит баллы и комментарии.</p>
        </>}
      </div>}
    </form>
  )
}
