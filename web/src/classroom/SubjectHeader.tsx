import { Link } from '@tanstack/react-router'
import { ArrowLeft, Copy, Send } from 'lucide-react'
import { FadeUp } from '@/components/FadeUp'
import { Button } from '@/components/ui/button'
import type { Subject } from '@/api'
import { cardGradient, copyCode, copyInvite, firstChar } from './utils'

export function SubjectHeader({ subject, isTeacher }: { subject: Subject; isTeacher: boolean }) {
  const code = isTeacher && subject.invite_code
  return (
    <FadeUp>
      <Link to="/classroom/subjects" className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-primary max-sm:min-h-11">
        <ArrowLeft className="size-4" /> Мои предметы
      </Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <span aria-hidden="true" style={{ background: cardGradient(subject.id) }}
            className="grid size-11 shrink-0 place-items-center rounded-xl font-serif text-xl font-semibold text-white">{firstChar(subject.title)}</span>
          <div className="my-auto min-w-0">
            <h1 className="break-words font-serif text-2xl font-semibold leading-tight">{subject.title}</h1>
            {subject.description && <p className="mt-1 max-w-prose whitespace-pre-line break-words text-sm text-muted-foreground">{subject.description}</p>}
          </div>
        </div>
        {code && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" title="Скопировать код" onClick={() => copyCode(code)}>
              <Copy className="size-3.5" /> Код: <span className="font-mono tracking-wide">{code}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="max-sm:h-11" onClick={() => copyInvite(subject.title, code)}>
              <Send className="size-3.5" /> Скопировать приглашение
            </Button>
          </div>
        )}
      </div>
    </FadeUp>
  )
}
