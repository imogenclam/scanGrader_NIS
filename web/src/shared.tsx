import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/EmptyState'

export function ErrorLine({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
      {text}
    </p>
  ) : null
}

export function Load({ error, retry }: { error: string; retry?: () => void }) {
  return error ? (
    <ErrorState className="mx-auto max-w-5xl" action={retry && <Button variant="outline" onClick={retry}>Повторить</Button>}>
      {error}
    </ErrorState>
  ) : (
    <div className="mx-auto max-w-5xl space-y-3" role="status" aria-label="Загрузка">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  )
}
