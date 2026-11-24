import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Check, FileText, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { points, request, useAction, type User } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/EmptyState'
import { ErrorLine } from '@/shared'
import { MathField } from './MathField'
import { parsePoints } from './decimal'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

export function PublishPage({ id, user }: { id: number; user: User }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [statement, setStatement] = useState('')
  const [limits, setLimits] = useState(['1'])
  const [reference, setReference] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const action = useAction()
  const dirty = !!(title || statement || reference || limits.length !== 1 || limits[0] !== '1')

  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!title.trim() || !statement.trim()) throw new Error('Заполните название и условия задания.')
      if (!reference || !reference.name.toLowerCase().endsWith('.tex') || !reference.size || reference.size > 256 * 1024) {
        throw new Error('Выберите непустой файл эталона .tex размером до 256 КБ.')
      }
      const tasks = limits.map((value, i) => {
        const max = parsePoints(value)
        if (!Number.isFinite(max) || max <= 0 || max > 10000) {
          throw new Error('Максимум за задачу ' + (i + 1) + ' должен быть больше нуля и не превышать 10 000.')
        }
        return { number: i + 1, max }
      })
      const form = new FormData()
      form.set('title', title.trim())
      form.set('statement', statement.trim())
      form.set('reference', reference)
      form.set('tasks', JSON.stringify(tasks))
      const saved = await request<{ id: number }>('subjects/' + id + '/assignments', 'POST', form)
      toast.success('Задание опубликовано')
      await navigate({ to: '/classroom/assignments/$id', params: { id: String(saved.id) }, ignoreBlocker: true })
    })
  }
  if (user.role !== 'teacher') return (
    <EmptyState action={<Button variant="outline" asChild><Link to="/classroom/subjects">К предметам</Link></Button>}>
      Опубликовать задание может преподаватель предмета.
    </EmptyState>
  )
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link to="/classroom/subjects/$id" params={{ id: String(id) }} className="mb-2 inline-flex min-h-9 items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-primary max-sm:min-h-11">
        <ArrowLeft className="size-3.5" /> Назад к предмету
      </Link>
      <h1 className="mb-3 font-serif text-2xl font-semibold">Новое задание</h1>
      <Card className="gap-0 py-4 sm:py-5"><CardContent className="px-4 sm:px-5">
        <UnsavedChangesGuard when={dirty} description="Заполненная форма задания не сохранена." />
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Название <span className="text-primary">*</span></Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название задания" required maxLength={160} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="statement">Условия задания <span className="text-primary">*</span></Label>
            <MathField id="statement" value={statement} onChange={setStatement}
              placeholder="Условия задач и требования к решению. Формулы можно записать в $…$."
              className="min-h-24" required maxLength={16000} />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Задачи и баллы</legend>
            <div className="space-y-3">
              {limits.map((value, i) => (
                <div key={i} className="rounded-lg border bg-background p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={'max-' + i} className="min-w-0 flex-1 text-[13px]">Задача {i + 1}</Label>
                    <Input id={'max-' + i} inputMode="decimal" value={value} required aria-label={'Максимальный балл за задачу ' + (i + 1)}
                      onChange={(e) => setLimits((old) => old.map((v, j) => j === i ? e.target.value : v))}
                      className="w-24 text-base md:text-[13px]" />
                    <span className="text-xs text-muted-foreground">б.</span>
                    <Button type="button" variant="outline" size="icon"
                      disabled={limits.length === 1} onClick={() => setLimits((old) => old.filter((_, j) => j !== i))}
                      aria-label={'Удалить задачу ' + (i + 1)}><X className="size-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" disabled={limits.length >= 100}
                onClick={() => setLimits((old) => [...old, '1'])}><Plus className="size-3.5" /> Добавить задачу</Button>
              <span className="text-xs text-muted-foreground">Всего баллов: {points(limits.reduce((n, v) => n + (parsePoints(v) || 0), 0))}</span>
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="reference-picker">Закрытый эталон решения <span className="text-primary">*</span></Label>
            <button id="reference-picker" type="button" onClick={() => fileInput.current?.click()}
              className="w-full rounded-lg border border-dashed text-left transition-colors hover:border-primary hover:bg-primary/5">
              <span className="flex min-w-0 items-center gap-2.5 px-4 py-3 text-sm text-muted-foreground">
                <FileText className="size-4.5 shrink-0" /><span className="truncate">{reference?.name || 'Выбрать файл .tex с решениями…'}</span>
              </span>
            </button>
            <input ref={fileInput} aria-label="Файл эталона" type="file" name="reference" accept=".tex" className="hidden"
              onChange={(e) => setReference(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">Один файл .tex в UTF-8, до 256 КБ. Он доступен преподавателю и используется для черновой проверки.</p>
          </div>
          <ErrorLine text={action.error} />
          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" disabled={action.busy}><Check className="size-4" />{action.busy ? 'Публикация…' : 'Опубликовать задание'}</Button>
            <Button type="button" variant="outline" asChild><Link to="/classroom/subjects/$id" params={{ id: String(id) }}>Отмена</Link></Button>
          </div>
        </form>
      </CardContent></Card>
    </div>
  )
}
