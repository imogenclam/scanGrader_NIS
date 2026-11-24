import { FileText } from 'lucide-react'
import { type Assignment, type Submission, type User, useData } from '@/api'
import { FadeUp, useFadeScreen } from '@/components/FadeUp'
import { EmptyState } from '@/components/EmptyState'
import { MathText } from '@/lib/mathjax'
import { ErrorLine, Load } from '@/shared'
import { Upload } from './Upload'
import { AssignmentInfoCard } from './AssignmentInfoCard'
import { SubmissionCard } from './SubmissionCard'
import { MySubmissionCard } from './MySubmissionCard'
import { StudentBreadcrumbs } from './StudentBreadcrumbs'

type AssignmentDetail = { assignment: Assignment; submissions: Submission[] }

export function AssignmentPage({ id, user }: { id: number; user: User }) {
  const isTeacher = user.role === 'teacher'
  const { data, error, refresh } = useData<AssignmentDetail>('assignments/' + id,
    details => isTeacher || details.submissions[0]?.state !== 'approved')
  useFadeScreen(!!data)
  if (!data) return <Load error={error} retry={refresh} />
  const { assignment, submissions } = data
  const mySubmission = submissions[0]
  const reviewed = isTeacher ? submissions.filter((s) => s.state === 'approved').length : 0
  return (
    <>
      <StudentBreadcrumbs assignment={assignment} />
      <FadeUp asChild><h1 className="mb-3 min-w-0 break-words font-serif text-2xl font-semibold leading-tight">
        <MathText inline text={assignment.title} className="!leading-tight" />
      </h1></FadeUp>
      <div className="space-y-5">
        <AssignmentInfoCard assignment={assignment} isTeacher={isTeacher} showTasks={isTeacher || mySubmission?.state !== 'approved'} />
        <ErrorLine text={error} />
        {isTeacher ? (
          <section aria-labelledby="submission-list-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h2 id="submission-list-title" className="text-lg font-semibold">Работы студентов</h2>
              {submissions.length > 0 && <span className="text-sm tabular-nums text-muted-foreground">Проверено {reviewed} из {submissions.length}</span>}
            </div>
            {submissions.length === 0 ? <EmptyState icon={FileText}>Пока никто не сдал работу</EmptyState> : (
              <ul className="divide-y rounded-xl border bg-card shadow-sm">
                {submissions.map((submission) => <li key={submission.id}><SubmissionCard submission={submission} /></li>)}
              </ul>
            )}
          </section>
        ) : (
          mySubmission ? <MySubmissionCard submission={mySubmission} /> : <Upload assignmentId={id} onDone={refresh} />
        )}
      </div>
    </>
  )
}
