import { type FormEvent, useEffect, useReducer, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, errorMessage } from '@/lib/api'
import { profileQueryOptions, useUser } from '@/lib/auth'
import { register, verifyEmail, type RegisterBody } from './api'
import type { AuthMsg } from './AuthCard'
import { loginProblem } from './loginRules'

export type RegisterRole = RegisterBody['requested_role']

const SAVE_KEY = 'sg_register_progress'
const SAVE_TTL_MS = 60 * 60 * 1000

interface SavedProgress {
  step: 2
  pendingEmail: string
  login: string
  email: string
  role: RegisterRole
  teacherNote: string
  lastName?: string
  firstName?: string
  ts: number
}

// пароль тут не храним, только шаг и адрес
function readProgress(): SavedProgress | null {
  try {
    const raw = sessionStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SavedProgress
    if (s.step !== 2 || !s.pendingEmail || Date.now() - s.ts > SAVE_TTL_MS) return null
    return s
  } catch {
    return null
  }
}

function writeProgress(s: Omit<SavedProgress, 'ts'>) {
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify({ ...s, ts: Date.now() }))
  } catch {
    /* пусто */
  }
}

// со страницы входа: регистрация начата раньше, осталось ввести код
function progressFromLink(): SavedProgress | null {
  const p = new URLSearchParams(window.location.search)
  const email = (p.get('email') ?? '').trim()
  if (p.get('verify') !== '1' || !email.includes('@')) return null
  return { step: 2, pendingEmail: email, login: '', email, role: 'student', teacherNote: '', ts: Date.now() }
}

function clearProgress() {
  try {
    sessionStorage.removeItem(SAVE_KEY)
  } catch {
    /* пусто */
  }
}

// поля анкеты и кода одним состоянием
interface RegisterFields {
  role: RegisterRole
  teacherNote: string
  lastName: string
  firstName: string
  login: string
  email: string
  password: string
  password2: string
  code: string
}

type FieldAction = { [K in keyof RegisterFields]: { field: K; value: RegisterFields[K] } }[keyof RegisterFields]

const fieldsReducer = (s: RegisterFields, a: FieldAction): RegisterFields => ({ ...s, [a.field]: a.value })

// со страницы входа приходят с уже набранным логином или почтой
function initialFields(restored: SavedProgress | null): RegisterFields {
  const fromLogin = new URLSearchParams(window.location.search)
  return {
    role: restored?.role ?? 'student',
    teacherNote: restored?.teacherNote ?? '',
    lastName: restored?.lastName ?? '',
    firstName: restored?.firstName ?? '',
    login: restored?.login ?? fromLogin.get('login') ?? '',
    email: restored?.email ?? fromLogin.get('email') ?? '',
    password: '',
    password2: '',
    code: '',
  }
}

function useResendCountdown() {
  const [resendIn, setResendIn] = useState(0)
  useEffect(() => {
    if (resendIn <= 0) return
    const t = window.setTimeout(() => setResendIn((v) => v - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendIn])
  return [resendIn, setResendIn] as const
}

// что не так в анкете до отправки
function step1Problem(f: RegisterFields, loginIssue: string | null): string | null {
  if (f.role === 'teacher' && f.teacherNote.trim().length < 3) {
    return 'Напишите, где вы преподаёте: вуз, школа или курсы (хотя бы 3 символа)'
  }
  if (loginIssue) return loginIssue
  if (f.password !== f.password2) return 'Пароли не совпадают'
  if (f.password.length < 8) return 'Пароль должен быть минимум 8 символов'
  return null
}

// шаги: анкета, код из письма, заявка преподавателя
export function useRegister() {
  const navigate = useNavigate()
  const { user, isLoading } = useUser()
  const queryClient = useQueryClient()

  const restored = useState(() => readProgress() ?? progressFromLink())[0]
  const [step, setStep] = useState<1 | 2>(restored?.step ?? 1)
  // после перезагрузки пароля в памяти нет, повторную отправку кода не делаем
  const [needPasswordAgain, setNeedPasswordAgain] = useState(!!restored)
  const [resendIn, setResendIn] = useResendCountdown()
  const [f, dispatch] = useReducer(fieldsReducer, restored, initialFields)
  const set = <K extends keyof RegisterFields>(field: K) => (value: RegisterFields[K]) =>
    dispatch({ field, value } as FieldAction)
  const loginIssue = loginProblem(f.login)
  // 409: что занято и какие логины свободны
  const [taken, setTaken] = useState<{ field: 'login' | 'email'; suggestions: string[] } | null>(null)
  const [localDelivery, setLocalDelivery] = useState(false)
  const [pendingEmail, setPendingEmail] = useState(restored?.pendingEmail ?? '')
  const [msg, setMsg] = useState<AuthMsg | null>(null)

  useEffect(() => {
    if (!isLoading && user) {
      clearProgress()
      navigate({ to: '/dashboard', replace: true })
    }
  }, [isLoading, user, navigate])

  const showErr = (fallback: string) => (e: unknown) => {
    setMsg({ type: 'error', text: errorMessage(e, fallback) })
    const body = e instanceof ApiError && e.status === 409 ? (e.body as { field?: string; suggestions?: string[] }) : null
    setTaken(
      body && (body.field === 'login' || body.field === 'email')
        ? { field: body.field, suggestions: body.suggestions ?? [] }
        : null,
    )
  }

  const payload = (): RegisterBody => ({
    login: f.login.trim(),
    password: f.password,
    email: f.email.trim(),
    requested_role: f.role,
    teacher_note: f.role === 'teacher' ? f.teacherNote.trim() : undefined,
    // без ФИО на летучке и в ведомости человек «Студент»
    full_name: [f.lastName.trim(), f.firstName.trim()].filter(Boolean).join(' ') || undefined,
  })

  const sendCode = useMutation({
    mutationFn: register,
  })

  const onSubmitStep1 = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setTaken(null)
    const problem = step1Problem(f, loginIssue)
    if (problem) {
      setMsg({ type: 'error', text: problem })
      if (f.role === 'teacher' && f.teacherNote.trim().length < 3) document.getElementById('teacher-note')?.focus()
      return
    }
    sendCode.mutate(payload(), {
      onSuccess: (json) => {
        if (!json.need_verify) {
          setMsg({ type: 'error', text: json.message || 'Ошибка регистрации' })
          return
        }
        setLocalDelivery(Boolean(json.local_delivery))
        const email = f.email.trim()
        setPendingEmail(email)
        set('code')('')
        setStep(2)
        setNeedPasswordAgain(false)
        setResendIn(60)
        const { role, teacherNote, lastName, firstName } = f
        writeProgress({ step: 2, pendingEmail: email, login: f.login.trim(), email, role, teacherNote, lastName, firstName })
      },
      onError: showErr('Ошибка регистрации'),
    })
  }

  const onResend = () => {
    if (!pendingEmail) return
    setMsg(null)
    sendCode.mutate(
      { ...payload(), email: pendingEmail },
      {
        onSuccess: () => {
          setMsg({ type: 'success', text: 'Код отправлен повторно, он тот же, что в первом письме' })
          setResendIn(60)
        },
        onError: showErr('Ошибка отправки кода'),
      },
    )
  }

  const verify = useMutation({
    mutationFn: () =>
      verifyEmail(pendingEmail, f.code.trim()),
    onSuccess: (json) => {
      if (!json.success) {
        setMsg({ type: 'error', text: json.message || 'Неверный код' })
        return
      }
      clearProgress()
      setMsg({ type: 'success', text: 'Аккаунт создан! Открываем кабинет...' })
      // сервер уже выдал вход вместе с подтверждением почты
      void queryClient
        .invalidateQueries({ queryKey: profileQueryOptions().queryKey })
        .then(() => navigate({ to: '/dashboard', replace: true }))
    },
    onError: showErr('Неверный код'),
  })

  return {
    step,
    msg,
    role: f.role, setRole: set('role'),
    teacherNote: f.teacherNote, setTeacherNote: set('teacherNote'),
    lastName: f.lastName, setLastName: set('lastName'),
    firstName: f.firstName, setFirstName: set('firstName'),
    login: f.login, setLogin: set('login'),
    loginIssue,
    taken, setTaken,
    pickLogin: (s: string) => {
      set('login')(s)
      setTaken(null)
      setMsg({ type: 'success', text: `Логин «${s}» свободен. Нажмите «Продолжить».` })
    },
    email: f.email, setEmail: set('email'),
    password: f.password, setPassword: set('password'),
    password2: f.password2, setPassword2: set('password2'),
    code: f.code, setCode: set('code'),
    pendingEmail, localDelivery,
    needPasswordAgain,
    resendIn,
    sending: sendCode.isPending,
    verifying: verify.isPending,
    onSubmitStep1,
    onResend,
    onSubmitVerify: (e: FormEvent) => {
      e.preventDefault()
      setMsg(null)
      verify.mutate()
    },
    backToForm: () => {
      clearProgress()
      setMsg({ type: 'success', text: 'Заполните анкету ещё раз — код придёт заново' })
      setStep(1)
      setNeedPasswordAgain(false)
    },
  }
}
