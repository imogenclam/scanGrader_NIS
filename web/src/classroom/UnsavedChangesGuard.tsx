import { Button } from '@/components/ui/button'
import { useBlocker } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function UnsavedChangesGuard({
  when,
  title = 'Уйти без сохранения?',
  description = 'Несохранённые изменения пропадут.',
  cancelText = 'Остаться',
  confirmText = 'Уйти',
  beforeUnload = true,
  saveBeforeLeave,
  layerClassName,
  portalContainer,
  presentationActive = false,
  onExitPresentation,
}: {
  when: boolean
  title?: string
  description?: string
  cancelText?: string
  confirmText?: string
  beforeUnload?: boolean
  saveBeforeLeave?: () => Promise<boolean>
  layerClassName?: string
  portalContainer?: HTMLElement | null
  presentationActive?: boolean
  onExitPresentation?: () => void
}) {
  const save = useRef(saveBeforeLeave)
  useEffect(() => { save.current = saveBeforeLeave }, [saveBeforeLeave])

  const blocker = useBlocker({
    shouldBlockFn: async () => {
      if (!save.current || !(await save.current())) return true
      return !save.current
    },
    disabled: !when,
    enableBeforeUnload: () => when && beforeUnload,
    withResolver: true,
  })

  return (
    <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
      <AlertDialogContent className={layerClassName} overlayClassName={layerClassName} portalContainer={portalContainer}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {presentationActive && onExitPresentation && (
          <Button type="button" variant="outline" className="min-h-11" aria-label="Выйти из полноэкранного режима" onClick={onExitPresentation}>
            Выйти из полноэкранного режима
          </Button>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => blocker.proceed?.()}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
