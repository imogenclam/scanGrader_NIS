import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { Assignment } from '@/api'

export function StudentBreadcrumbs({ assignment }: { assignment: Assignment }) {
  return (
    <nav aria-label="Путь к заданию" className="mb-2 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <Link to="/classroom/subjects" className="inline-flex min-h-9 shrink-0 items-center rounded-sm hover:text-primary max-sm:min-h-11">Мои предметы</Link>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
      <Link to="/classroom/subjects/$id" params={{ id: String(assignment.subject_id) }}
        className="min-w-0 truncate rounded-sm leading-9 hover:text-primary max-sm:leading-[44px]">
        {assignment.subject_title || 'Предмет'}
      </Link>
    </nav>
  )
}
