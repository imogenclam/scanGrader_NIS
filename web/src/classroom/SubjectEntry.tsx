import { type FormEvent, type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Check } from 'lucide-react'
import { toast } from 'sonner'
import { message, request, type User } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/EmptyState'
import { impossibleCodeChars } from './joinCode'

function RoleNotice({ children }: { children: ReactNode }) {
  return <EmptyState className="mx-auto max-w-xl" action={<Button variant="outline" asChild><Link to="/classroom/subjects">К предметам</Link></Button>}>{children}</EmptyState>
}

export function JoinSubjectForm({
  onJoined,
  autoFocus,
  className,
  initialCode = '',
  autoSubmit = false,
}: {
  onJoined?: (subjectId: string) => void
  autoFocus?: boolean
  className?: string
  initialCode?: string
  // пришёл по ссылке-приглашению: вступаем без лишнего нажатия
  autoSubmit?: boolean
}) {
  const [code, setCode] = useState(normalizeCode(initialCode))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const autoDone = useRef(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void join(code)
  }

  const join = async (raw: string) => {
    const inviteCode = raw.trim().toUpperCase()
    if (!inviteCode) return
    setSubmitting(true)
    setError('')
    try {
      const subject = await request<{ id: number }>('subjects/join', 'POST', { code: inviteCode })
      toast.success('Вы вступили в предмет')
      onJoined?.(String(subject.id))
    } catch (e) {
      const invalid = impossibleCodeChars(inviteCode)
      setError(message(e) + (invalid.length ? ' Проверьте символы: ' + invalid.join(', ') + '.' : ''))
    } finally {
      setSubmitting(false)
    }
  }

  const autoJoin = useEffectEvent(() => {
    if (autoDone.current || !code) return
    autoDone.current = true
    void join(code)
  })
  useEffect(() => {
    if (autoSubmit) autoJoin()
  }, [autoSubmit])

  return (
    <div className={className}>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] max-md:text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <div className="mb-4 flex flex-col gap-1.5">
          <Label htmlFor="code">Код предмета</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s+/g, '').toUpperCase())}
            placeholder="XXXXXX"
            maxLength={12}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus={autoFocus}
            className="h-12 text-center font-mono text-xl uppercase tracking-[0.3em]"
          />
        </div>
        <Button
          type="submit"
          disabled={submitting || !code.trim()}
          className="h-11 sm:h-9"
        >
          {submitting ? 'Вступаем…' : 'Вступить'}
        </Button>
      </form>
    </div>
  )
}

function normalizeCode(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase().slice(0, 12)
}

export function JoinPage({ user }: { user: User }) {
  const navigate = useNavigate()
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')?.trim() ?? ''
  const profileQuery = new URLSearchParams({ join: code })
  if (search.get('auto') === '1') profileQuery.set('auto', '1')
  if (user.role !== 'student') return <RoleNotice>Вступление по коду доступно студентам.</RoleNotice>
  return (
      <div className="mx-auto max-w-md">
        <Link to="/classroom/subjects" className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-primary max-sm:min-h-11">
          <ArrowLeft className="size-4" /> Мои предметы
        </Link>
        <h1 className="mb-3 font-serif text-2xl font-semibold">Вступить в предмет</h1>
        <Card className="gap-0 py-4 sm:py-5">
          <CardContent className="px-4 sm:px-5">
            {!user.full_name.trim() || !user.group.trim() ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Для вступления заполните ФИО и группу в профиле.</p>
                <Button asChild className="max-sm:h-11">
                  <a href={'/profile?' + profileQuery.toString()}>Заполнить профиль</a>
                </Button>
              </div>
            ) : (
              <JoinSubjectForm
                autoFocus={!code}
                initialCode={code}
                autoSubmit={!!code && search.get('auto') === '1'}
                onJoined={(id) => navigate({ to: '/classroom/subjects/$id', params: { id } })}
              />
            )}
          </CardContent>
        </Card>
      </div>
  )
}

export function CreateSubjectPage({ user }: { user: User }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user.role !== 'teacher') return <RoleNotice>Создать предмет может преподаватель.</RoleNotice>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.warning('Введите название предмета')
      return
    }
    setSubmitting(true)
    try {
      const subject = await request<{ id: number }>('subjects', 'POST', { title: title.trim(), description: description.trim() })
      toast.success('Предмет создан')
      navigate({ to: '/classroom/subjects/$id', params: { id: String(subject.id) } })
    } catch (e) {
      toast.error(message(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-3 font-serif text-2xl font-semibold">Новый предмет</h1>
        <Card className="gap-0 py-4 sm:py-5">
          <CardContent className="px-4 sm:px-5">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Название *</Label>
                <Input
                  id="title"
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Математический анализ"
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="description">Описание</Label>
                <Textarea
                  id="description"
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Краткое описание предмета..."
                  className="min-h-[90px]"
                />
              </div>
              <div className="mt-1 flex gap-2.5">
                <Button type="submit" disabled={submitting}>
                  <Check className="size-4" /> {submitting ? 'Создание…' : 'Создать предмет'}
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/classroom/subjects">Отмена</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
  )
}
