import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ApiError, errorMessage } from '@/lib/api'
import { profileQueryOptions, useUser } from '@/lib/auth'
import { AuthCard, AuthMessage, type AuthMsg } from '@/features/auth/AuthCard'
import { checkLogin, signIn } from './api'

type Step = 'id' | 'password'

// сообщение по параметрам адреса: OAuth, удаление, смена пароля
function initialMsg(): AuthMsg | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('password_changed')) return { type: 'success', text: 'Пароль изменён. Войдите с новым паролем.' }
  // сюда приводит одобрение заявки: старый вход отозван
  if (params.get('reason') === 'approved')
    return { type: 'success', text: 'Кабинет преподавателя открыт. Войдите ещё раз, чтобы он появился.' }
  return null
}

// шаги входа: логин, пароль, подсказки после неудачи
function useLoginFlow() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, isLoading } = useUser()

  const [step, setStep] = useState<Step>('id')
  // «Войти с этой почтой» со страницы регистрации
  const [login, setLogin] = useState(() => new URLSearchParams(window.location.search).get('login') ?? '')
  const [password, setPassword] = useState('')
  // после неудачи ведём и в регистрацию, а не только в «Забыли пароль?»
  const [failed, setFailed] = useState(false)
  // аккаунта ещё нет: код из письма не введён
  const [pendingReg, setPendingReg] = useState(false)
  const [msg, setMsg] = useState<AuthMsg | null>(initialMsg)

  useEffect(() => {
    if (!isLoading && user) navigate({ to: '/dashboard', replace: true })
  }, [isLoading, user, navigate])

  const checkMut = useMutation({
    mutationFn: checkLogin,
    onSuccess: () => {
      setMsg(null)
      setStep('password')
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 429) {
        setMsg({ type: 'error', text: e.message })
      } else {
        setMsg({ type: 'error', text: 'Не удалось проверить. Попробуйте ещё раз.' })
      }
    },
  })

  const loginMut = useMutation({
    mutationFn: signIn,
    onSuccess: async () => {
      setMsg({ type: 'success', text: 'Вход выполнен! Перенаправление...' })
      await queryClient.invalidateQueries({ queryKey: profileQueryOptions().queryKey })
      navigate({ to: '/dashboard', replace: true })
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 401 && (e.body as { pending_registration?: boolean } | null)?.pending_registration) {
        setFailed(false)
        setPendingReg(true)
        setMsg({
          type: 'error',
          text: login.includes('@')
            ? e.message
            : e.message + ' Введите вместо логина почту, на которую пришло письмо.',
        })
      } else if (e instanceof ApiError && e.status === 401) {
        setFailed(true)
        setMsg({
          type: 'error',
          text: 'Неверный пароль или аккаунта с таким логином нет. Проверьте, что логин или email набран без опечаток.',
        })
      } else if (e instanceof ApiError && e.status === 429) {
        setFailed(true)
        setMsg({
          type: 'error',
          text:
            errorMessage(e, 'Слишком много неудачных попыток. Повторите через 15 минут.') +
            ' Если аккаунта у вас ещё нет, ждать не нужно: создайте его сейчас.',
        })
      } else if (e instanceof ApiError) {
        setMsg({ type: 'error', text: e.message })
      } else if (e instanceof Error) {
        setMsg({ type: 'error', text: 'Ошибка сети: ' + e.message })
      }
    },
  })

  const onNext = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    checkMut.mutate(login.trim())
  }
  const onLogin = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    loginMut.mutate({ login: login.trim(), password })
  }
  const backToId = () => {
    setStep('id')
    setPassword('')
    setMsg(null)
    setFailed(false)
    setPendingReg(false)
  }
  const registerHref = '/register?' + new URLSearchParams(login.includes('@') ? { email: login.trim() } : { login: login.trim() })

  return {
    step, login, setLogin, password, setPassword, failed, pendingReg, msg,
    checkPending: checkMut.isPending, loginPending: loginMut.isPending,
    onNext, onLogin, backToId, registerHref,
  }
}

type LoginFlow = ReturnType<typeof useLoginFlow>

// после неудачи ведём и в регистрацию, а не только в «Забыли пароль?»
function LoginFailedHint({ login, registerHref }: { login: string; registerHref: string }) {
  return (
    <div className="mb-4 rounded-lg border bg-background/60 px-3.5 py-3 text-[13px] max-md:text-sm">
      <div className="mb-2.5 font-medium">Впервые здесь или аккаунта с «{login.trim()}» нет?</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild className="min-h-11 md:min-h-9">
          <a href={registerHref}>Создать аккаунт</a>
        </Button>
        <Button asChild variant="outline" className="min-h-11 md:min-h-9">
          <Link to="/forgot">Восстановить пароль</Link>
        </Button>
      </div>
    </div>
  )
}

function PasswordStep({ flow }: { flow: LoginFlow }) {
  const { onLogin, backToId, login, password, setPassword, loginPending } = flow
  return (
    <form onSubmit={onLogin} className="flex flex-col gap-4">
      <button
        type="button"
        onClick={backToId}
        className="-mt-1 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {login.trim()}
      </button>
      <div className="flex flex-col gap-1.5">
        {/* менеджер паролей связывает пароль с логином этой же формы */}
        <input type="text" name="username" autoComplete="username" value={login.trim()} readOnly hidden />
        <Label htmlFor="password">Пароль</Label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Введите пароль"
          autoFocus
          required
        />
      </div>
      <Button type="submit" className="mt-1 w-full" disabled={loginPending || !password}>
        {loginPending ? 'Вход…' : 'Войти'}
      </Button>
      <Link to="/forgot" className="text-center text-[13px] max-md:text-sm text-muted-foreground hover:text-primary hover:underline">
        Забыли пароль?
      </Link>
      {/* человек полчаса входил, не имея аккаунта */}
      <div className="text-center text-[13px] max-md:text-sm">
        <span className="text-muted-foreground">Ещё нет аккаунта?&nbsp;</span>
        <Link to="/register" className="text-primary hover:underline">
          Создать аккаунт
        </Link>
      </div>
    </form>
  )
}

function IdStep({ flow }: { flow: LoginFlow }) {
  const { onNext, login, setLogin, checkPending } = flow
  return (
    <>
      <form onSubmit={onNext} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login">Логин или Email</Label>
          <Input
            id="login"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Введите логин или email"
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="mt-1 w-full" disabled={!login.trim() || checkPending}>
          {checkPending ? 'Проверяем…' : 'Далее'}
        </Button>
      </form>

      <Separator className="mt-5" />
      <div className="mt-4 flex flex-col items-center gap-1.5 text-[13px] max-md:text-sm">
        <div>
          <span className="text-muted-foreground">Нет аккаунта?&nbsp;</span>
          <Link to="/register" className="text-primary hover:underline">
            Создать аккаунт
          </Link>
        </div>
        <Link to="/forgot" className="text-muted-foreground hover:text-primary hover:underline">
          Забыли пароль?
        </Link>
      </div>
    </>
  )
}

export function LoginForm() {
  const flow = useLoginFlow()
  const { step, login, failed, pendingReg, msg, registerHref } = flow

  return (
    <AuthCard gradientClass="bg-gradient-to-br from-blue-900 to-blue-600" subtitle="Проверка письменных работ по математике">
      <AuthMessage msg={msg} />
      {step === 'password' && pendingReg && login.includes('@') && (
        <Button asChild className="mb-4 min-h-11 w-full md:min-h-9">
          <a href={'/register?' + new URLSearchParams({ verify: '1', email: login.trim() })}>Ввести код из письма</a>
        </Button>
      )}
      {step === 'password' && failed && <LoginFailedHint login={login} registerHref={registerHref} />}

      {step === 'password' ? <PasswordStep flow={flow} /> : <IdStep flow={flow} />}
    </AuthCard>
  )
}
