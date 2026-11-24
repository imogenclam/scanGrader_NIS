import { Link } from '@tanstack/react-router'
import { ChevronRight, FileText, GraduationCap, Link2, LogIn, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeUp, useFadeScreen } from '@/components/FadeUp'
import { cn } from '@/lib/utils'
import { useData, type Subject, type User } from '@/api'
import { cardGradient, copyCode, firstChar } from './utils'

function SubjectRow({ subject, isTeacher }: { subject: Subject; isTeacher: boolean }) {
  const id = String(subject.id)
  return (
    <li className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:flex sm:px-4">
      <span aria-hidden="true" style={{ background: cardGradient(subject.id) }}
        className="col-start-1 row-start-1 grid size-10 shrink-0 place-items-center rounded-lg font-serif text-lg font-semibold text-white">
        {firstChar(subject.title)}
      </span>
      <div className="col-start-2 row-start-1 min-w-0 flex-1">
        <Link to="/classroom/subjects/$id" params={{ id }} title={subject.title} className="block w-fit max-w-full break-words rounded-sm text-[15px] font-semibold leading-snug hover:text-primary after:absolute after:inset-0 focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring max-sm:line-clamp-2">
          {subject.title}
        </Link>
        {subject.description && <p className="truncate text-[13px] text-muted-foreground" title={subject.description}>{subject.description}</p>}
        {subject.latest_title && <p className="truncate text-[13px] text-muted-foreground" title={subject.latest_title}>Последнее задание · {subject.latest_title}</p>}
        {isTeacher && !subject.assignments && (
          <Link to="/classroom/subjects/$id/assignments/create" params={{ id }} className="relative z-10 inline-flex min-h-8 items-center rounded-sm text-[13px] font-medium text-primary hover:underline sm:min-h-6">
            Выдать первое задание
          </Link>
        )}
      </div>
      <div className={cn('pointer-events-none flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground sm:gap-3', isTeacher ? 'col-start-2 row-start-2' : 'col-start-3 row-start-1')}>
        {isTeacher && <span className="inline-flex items-center gap-1" title="Студенты"><Users className="size-3.5" aria-hidden="true" /><span className="sr-only">Студентов: </span>{subject.students}</span>}
        <span className="inline-flex items-center gap-1" title="Задания"><FileText className="size-3.5" aria-hidden="true" /><span className="sr-only">Заданий: </span>{subject.assignments}</span>
      </div>
      {isTeacher && subject.invite_code && (
        <Button type="button" variant="ghost" size="icon" className="relative z-10 col-start-3 row-span-2 row-start-1 size-11 shrink-0 text-muted-foreground sm:size-9"
          title="Скопировать код" aria-label={'Скопировать код предмета «' + subject.title + '»'} onClick={() => copyCode(subject.invite_code!)}>
          <Link2 className="size-4" />
        </Button>
      )}
      <ChevronRight aria-hidden="true" className="pointer-events-none hidden size-4 shrink-0 text-muted-foreground sm:block" />
    </li>
  )
}

export function SubjectsPage({ user }: { user: User }) {
  const isTeacher = user.role === 'teacher'
  const { data, error, refresh } = useData<Subject[]>('subjects')
  useFadeScreen(!!data || !!error)
  const action = (
    <Button asChild className="max-sm:h-11">
      {isTeacher ? (
        <Link to="/classroom/subjects/create" aria-label="Создать предмет">
          <Plus className="size-4" /><span>Создать<span className="hidden sm:inline"> предмет</span></span>
        </Link>
      ) : (
        <Link to="/classroom/join" aria-label="Вступить по коду">
          <LogIn className="size-4" /><span>Вступить<span className="hidden sm:inline"> по коду</span></span>
        </Link>
      )}
    </Button>
  )
  return (
    <>
      <FadeUp className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-[22px] font-semibold sm:text-2xl">Мои предметы</h1>
        {(!!data?.length || !!error) && action}
      </FadeUp>
      {!data && !error && <div role="status" aria-label="Загрузка предметов" className="space-y-2"><Skeleton className="h-14 w-full rounded-xl" /><Skeleton className="h-14 w-full rounded-xl" /></div>}
      {error && <ErrorState action={<Button variant="outline" onClick={refresh}>Повторить</Button>}>{error}</ErrorState>}
      {data?.length === 0 && (
        <FadeUp i={1}>
          <EmptyState icon={GraduationCap} title="Предметов пока нет" action={action} className="border-solid shadow-sm">
            {isTeacher ? 'После создания вы сможете пригласить студентов.' : 'Код для вступления выдаёт преподаватель.'}
          </EmptyState>
        </FadeUp>
      )}
      {!!data?.length && (
        <FadeUp i={1} asChild><ul aria-label="Предметы" className="divide-y rounded-xl border bg-card shadow-sm">
          {data.map((subject) => <SubjectRow key={subject.id} subject={subject} isTeacher={isTeacher} />)}
        </ul></FadeUp>
      )}
    </>
  )
}
