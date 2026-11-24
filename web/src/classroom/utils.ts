import { toast } from 'sonner'
import { inviteText } from './invite'
import { copyText } from '@/lib/clipboard'

export function cardGradient(id: number): string {
  return CARD_GRADIENTS[Math.abs(id) % CARD_GRADIENTS.length]
}

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #1e3a8a, #1e40af)',
  'linear-gradient(135deg, #312e81, #3730a3)',
  'linear-gradient(135deg, #064e3b, #065f46)',
  'linear-gradient(135deg, #4c1d95, #5b21b6)',
  'linear-gradient(135deg, #78350f, #92400e)',
  'linear-gradient(135deg, #0c4a6e, #0e7490)',
  'linear-gradient(135deg, #831843, #9d174d)',
  'linear-gradient(135deg, #3f6212, #4d7c0f)',
]

export function firstChar(s: string): string {
  const t = (s ?? '').trim()
  return t ? [...t][0].toUpperCase() : '?'
}

export async function copyCode(code: string) {
  if (await copyText(code)) toast.success('Код скопирован')
  else toast.error('Не удалось скопировать код')
}

export async function copyInvite(title: string, code: string) {
  if (await copyText(inviteText(title, code, window.location.origin)))
    toast.success('Приглашение скопировано, отправьте его в чат группы')
  else toast.error('Не удалось скопировать приглашение')
}
