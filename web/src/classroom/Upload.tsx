import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { FileText, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { request, useAction } from '@/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ErrorLine } from '@/shared'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

export function Upload({ assignmentId, onDone }: { assignmentId: number; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const sent = Boolean(confirmation)
  const action = useAction()
  function pick(files: File[]) {
    if (!files.length) return
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith('.pdf') || !files[0].size || files[0].size > 20 * 1024 * 1024) {
      setFileError('Выберите один непустой PDF размером до 20 МБ.')
      return
    }
    setFileError('')
    setFile(files[0])
  }
  function drop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!action.busy && !sent) pick(Array.from(e.dataTransfer.files))
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || sent || fileError) return
    void action.run(async () => {
      const form = new FormData()
      form.set('file', file)
      const result = await request<{ id: number; already_submitted: boolean }>('assignments/' + assignmentId + '/submissions', 'POST', form)
      const message = result.already_submitted ? 'Работа уже сдана' : 'Работа сдана'
      setConfirmation(message)
      if (result.already_submitted) {
        toast.info(message, {
          description: <>Сохранён первоначальный PDF.{' '}
            <Link to="/classroom/submissions/$id/view" params={{ id: String(result.id) }} className="text-primary underline underline-offset-2">Открыть сданную работу</Link>
          </>,
          duration: 10_000,
        })
      } else {
        toast.success(message)
      }
      onDone()
    })
  }
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <UnsavedChangesGuard when={!!file && !sent} description="Выбранный файл ещё не отправлен." />
      <div className="px-4 pt-4 sm:px-5">
        <h2 className="text-lg font-semibold">Сдать работу</h2>
      </div>
      <form className="space-y-3 px-4 pb-4 pt-2 sm:px-5" onSubmit={submit}>
        <input ref={inputRef} type="file" name="file" accept=".pdf,application/pdf" className="hidden" aria-label="PDF решения"
          onChange={(e) => { pick(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <button type="button" disabled={action.busy || sent} className={cn(
          'flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary',
          dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary hover:bg-primary/5',
        )}
          onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)} onDrop={drop}>
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><UploadCloud className="size-5" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{file ? 'Выбрать другой PDF' : 'Выберите или перетащите PDF со сканами'}</span>
            <span className="block text-xs text-muted-foreground">Один файл, до 5 страниц и 20 МБ</span>
          </span>
        </button>
        {file && (
          <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 p-2">
            <FileText className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>{file.name}</span>
            <Button type="button" variant="ghost" size="icon" disabled={action.busy || sent} aria-label="Убрать файл"
              onClick={() => { setFile(null); setFileError('') }}><X className="size-4" /></Button>
          </div>
        )}
        <ErrorLine text={fileError || action.error} />
        <Button type="submit" disabled={!file || !!fileError || action.busy || sent} className="h-11 md:h-9">
          <UploadCloud className="size-4" />{action.busy ? 'Отправка…' : confirmation || 'Сдать работу'}
        </Button>
      </form>
    </Card>
  )
}
