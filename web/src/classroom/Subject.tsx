import { Link } from '@tanstack/react-router'
import { ChevronRight, ClipboardList, Inbox, Plus } from 'lucide-react'
import { useData, type Listed, type Subject, type User } from '@/api'
import { MathText } from '@/lib/mathjax'
import { FadeUp, useFadeScreen } from '@/components/FadeUp'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { Load } from '@/shared'
import { SubjectHeader } from './SubjectHeader'

export function SubjectPage({ id, user }: { id: number; user: User }) {
  const { data, error, refresh } = useData<{ subject: Subject; assignments: Listed[] }>('subjects/' + id)
  const isTeacher = user.role === 'teacher'
  useFadeScreen(!!data)
  if (!data) return <Load error={error} retry={refresh} />
  const { subject, assignments } = data
  return (
    <>
      <SubjectHeader subject={subject} isTeacher={isTeacher} />
      <section aria-labelledby="assignment-list-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="assignment-list-title" className="text-lg font-semibold">Задания</h2>
          {isTeacher && <Button asChild className="max-sm:h-11">
            <Link to="/classroom/subjects/$id/assignments/create" params={{ id: String(id) }}>
              <Plus className="size-4" /> Создать задание
            </Link>
          </Button>}
        </div>
        {assignments.length === 0 ? (
          <EmptyState icon={Inbox}>Заданий пока нет</EmptyState>
        ) : (
          <FadeUp i={1} asChild><ul className="divide-y rounded-xl border bg-card shadow-sm">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <Link to="/classroom/assignments/$id" params={{ id: String(assignment.id) }}
                  className="group flex min-h-13 items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring sm:px-4">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><ClipboardList className="size-4" /></span>
                  <MathText inline text={assignment.title} className="min-w-0 flex-1 break-words text-sm font-semibold !leading-snug group-hover:text-primary" />
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul></FadeUp>
        )}
      </section>
    </>
  )
}
