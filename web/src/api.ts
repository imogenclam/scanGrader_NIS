import { useState, useSyncExternalStore } from 'react'
import { focusManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useUser } from '@/lib/auth'

export type User = {
  id: number
  login: string
  full_name: string
  group: string
  email?: string
  role: 'student' | 'teacher'
}
export type Subject = {
  id: number
  title: string
  description?: string
  latest_title?: string
  invite_code?: string
  students: number
  assignments: number
}
export type Task = { number: number; max: number }
export type Assignment = {
  id: number
  subject_id: number
  subject_title?: string
  title: string
  statement: string
  tasks: Task[]
}
export type Grade = { number: number; score: number; comment: string }
export type Submission = {
  id: number
  state: string
  student: string
  group: string
  submitted_at: string
  draft?: Grade[]
  final?: Grade[]
  reason?: string
  approved_by?: string
  approved_at?: string
  can_retry?: boolean
}
export type Listed = Pick<Subject, 'id' | 'title'>

export function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const url = '/api/' + path
  if (method === 'POST') return api.post<T>(url, body)
  if (method === 'PUT') return api.put<T>(url, body)
  return api.get<T>(url)
}

export function useData<T>(path: string, poll: boolean | ((data: T) => boolean) = false) {
  const { user } = useUser()
  const client = useQueryClient()
  const visible = useSyncExternalStore(focusManager.subscribe, () => focusManager.isFocused())
  const queryKey = ['classroom', user?.id, user?.role, path]
  const { data, error } = useQuery<T>({
    queryKey,
    queryFn: ({ signal }) => api.get<T>('/api/' + path, { signal }),
    enabled: ({ state }) => {
      if (!user) return false
      if (!poll) return true
      return visible && (state.data === undefined || poll === true || poll(state.data))
    },
    refetchInterval: poll ? 3500 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: 'always',
    gcTime: 0,
  })
  const refresh = () => { void client.invalidateQueries({ queryKey, exact: true }) }
  return { data, error: error ? message(error) : '', refresh }
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : 'Не удалось выполнить действие'
}
export function useAction() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run }
}
export const states: Record<string, string> = {
  waiting: 'Ожидает оценки',
  queued: 'В очереди',
  processing: 'Идёт обработка',
  draft: 'Готов черновик',
  manual: 'Нужна ручная проверка',
  approved: 'Оценка утверждена',
}
export const points = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 6 })
