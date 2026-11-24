import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { errorMessage } from '@/lib/api'
import { AuthCard, AuthMessage, type AuthMsg } from './AuthCard'
import { requestPasswordCode, resetPassword } from './api'

// почта, код и новый пароль
function useForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState('')
  const [localDelivery, setLocalDelivery] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [msg, setMsg] = useState<AuthMsg | null>(null)

  const showErr = (fallback: string) => (e: unknown) =>
    setMsg({ type: 'error', text: errorMessage(e, fallback) })

  const sendCode = useMutation({
    mutationFn: (mail: string) => requestPasswordCode(mail),
  })
  const reset = useMutation({
    mutationFn: (data: { email: string; code: string; new_password: string }) => resetPassword(data),
  })

  const onSubmitEmail = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    sendCode.mutate(email.trim(), {
      onSuccess: (reply) => {
        setLocalDelivery(Boolean(reply.local_delivery))
        setCode('')
        setStep(2)
      },
      onError: showErr('Не удалось отправить код'),
    })
  }

  const onResend = () => {
    setMsg(null)
    sendCode.mutate(email.trim(), {
      onSuccess: () => setMsg({ type: 'success', text: 'Код отправлен повторно' }),
      onError: showErr('Не удалось отправить код'),
    })
  }

  const onSubmitReset = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (password.length < 8) {
      setMsg({ type: 'error', text: 'Пароль должен быть минимум 8 символов' })
      return
    }
    if (password !== password2) {
      setMsg({ type: 'error', text: 'Пароли не совпадают' })
      return
    }
    reset.mutate(
      { email: email.trim(), code: code.trim(), new_password: password },
      {
        onSuccess: () => setStep(3),
        onError: showErr('Не удалось сменить пароль'),
      },
    )
  }

  return {
    step, email, setEmail, code, setCode, password, setPassword, password2, setPassword2, msg, localDelivery,
    sending: sendCode.isPending, resetting: reset.isPending,
    onSubmitEmail, onResend, onSubmitReset, onLogin: () => navigate({ to: '/login' }),
  }
}

type Forgot = ReturnType<typeof useForgotPassword>

function EmailStep({ f }: { f: Forgot }) {
  const { onSubmitEmail, email, setEmail, sending } = f
  return (
    <>
      <div className="mb-2 font-serif text-xl font-semibold">Забыли пароль?</div>
      <p className="mb-5 text-sm text-muted-foreground">
        Укажите почту, на которую регистрировались, — пришлём код для смены пароля.
      </p>
      <form onSubmit={onSubmitEmail} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Ваш email"
            autoComplete="email"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="mt-1 w-full" disabled={sending}>
          {sending ? 'Отправка…' : 'Отправить код'}
        </Button>
      </form>
    </>
  )
}

function ResetStep({ f }: { f: Forgot }) {
  const { email, onSubmitReset, code, setCode, password, setPassword, password2, setPassword2, resetting, onResend, sending } = f
  return (
    <>
      <div className="mb-2 font-serif text-xl font-semibold">Новый пароль</div>
      <p className="mb-5 text-sm text-muted-foreground">
        Если почта {email.trim()} зарегистрирована, на неё пришёл 6-значный код. Он действует
        15 минут.
        {f.localDelivery && <> Локальные письма сохраняются в папке <code>data/mail</code> сервера.</>}
      </p>
      <form onSubmit={onSubmitReset} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Код из письма *</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            className="h-14 text-center !text-2xl tracking-[10px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Новый пароль *</Label>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Придумайте пароль"
            autoComplete="new-password"
            required
          />
          <div className="text-[11px] max-md:text-sm text-muted-foreground">Минимум 8 символов</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password2">Повторите пароль *</Label>
          <PasswordInput
            id="password2"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="Ещё раз тот же пароль"
            autoComplete="new-password"
            required
          />
        </div>
        <Button type="submit" className="mt-1 w-full" disabled={resetting}>
          {resetting ? 'Сохранение…' : 'Сменить пароль'}
        </Button>
      </form>
      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={onResend}
          disabled={sending}
          className="text-[13px] max-md:text-sm text-muted-foreground hover:underline disabled:opacity-50"
        >
          Отправить код повторно
        </button>
      </div>
    </>
  )
}

function DoneStep({ onLogin }: { onLogin: () => void }) {
  return (
    <>
      <div className="mb-3 font-serif text-xl font-semibold">Пароль изменён</div>
      <p className="mb-5 text-sm text-muted-foreground">
        Войдите с новым паролем. На других устройствах вход придётся сделать заново.
      </p>
      <Button className="w-full" onClick={onLogin}>
        Войти
      </Button>
    </>
  )
}

export function ForgotPasswordPage() {
  const f = useForgotPassword()
  return (
    <AuthCard
      gradientClass="bg-gradient-to-br from-blue-900 to-blue-600"
      subtitle="Восстановление пароля"
      className="max-w-[440px]"
    >
      <AuthMessage msg={f.msg} />

      {f.step === 1 && <EmailStep f={f} />}

      {f.step === 2 && <ResetStep f={f} />}

      {f.step === 3 && <DoneStep onLogin={f.onLogin} />}

      <Separator className="mt-5" />
      <div className="mt-4 flex justify-center gap-5 text-[13px] max-md:text-sm">
        <Link to="/login" className="text-primary hover:underline">
          Вспомнили пароль?
        </Link>
        <Link to="/register" className="text-primary hover:underline">
          Создать аккаунт
        </Link>
      </div>
    </AuthCard>
  )
}
