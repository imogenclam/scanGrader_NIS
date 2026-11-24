import { Link } from '@tanstack/react-router'
import { GraduationCap, Presentation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { AuthCard, AuthMessage } from './AuthCard'
import { RoleChoice } from './RoleChoice'
import { useRegister } from './useRegister'
import { loginFix } from './loginRules'

type Register = ReturnType<typeof useRegister>

// занятый логин: свободные рядом; занятая почта: войти или восстановить
function TakenHints({ r }: { r: Register }) {
  const { step, taken, pickLogin, email } = r
  return (
    <>
      {step === 1 && taken?.field === 'login' && taken.suggestions.length > 0 && (
        <div className="-mt-2 mb-4 flex flex-wrap gap-2">
          {taken.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pickLogin(s)}
              className="min-h-11 rounded-full border border-primary/40 bg-primary/5 px-3.5 font-mono text-sm text-primary hover:bg-primary/10 md:min-h-9"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {step === 1 && taken?.field === 'email' && (
        <div className="-mt-2 mb-4 grid gap-2 sm:grid-cols-2">
          <Button asChild className="min-h-11 md:min-h-9">
            <a href={'/login?' + new URLSearchParams({ login: email.trim() })}>Войти с этой почтой</a>
          </Button>
          <Button asChild variant="outline" className="min-h-11 md:min-h-9">
            <Link to="/forgot">Забыли пароль?</Link>
          </Button>
        </div>
      )}
    </>
  )
}

function LoginEmailFields({ r }: { r: Register }) {
  const { login, setLogin, taken, setTaken, loginIssue, email, setEmail } = r
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login">Логин *</Label>
        <Input
          id="login"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={login}
          onChange={(e) => {
            setLogin(e.target.value)
            if (taken?.field === 'login') setTaken(null)
          }}
          placeholder="Придумайте логин"
          autoComplete="username"
          aria-invalid={!!loginIssue}
          aria-describedby="login-hint"
          required
        />
        <div id="login-hint" aria-live="polite" className={loginIssue ? 'text-[12px] max-md:text-sm text-destructive' : 'text-[11px] max-md:text-sm text-muted-foreground'}>
          {loginIssue ?? 'Буквы, цифры, точка, дефис и подчёркивание, без пробелов и @'}
          {loginIssue && loginFix(login) !== login && loginFix(login).length >= 3 && (
            <button
              type="button"
              onClick={() => {
                if (login.includes('@') && !email.trim()) setEmail(login.trim())
                setLogin(loginFix(login))
              }}
              className="ml-1 font-medium text-primary underline underline-offset-2"
            >
              Исправить на «{loginFix(login)}»
            </button>
          )}
        </div>
      </div>
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
          required
        />
      </div>
    </>
  )
}

function RegisterStep1({ r }: { r: Register }) {
  const {
    role, setRole, teacherNote, setTeacherNote, lastName, setLastName, firstName, setFirstName,
    password, setPassword, password2, setPassword2, sending, onSubmitStep1,
  } = r
  return (
    <>
      <div className="mb-4 font-serif text-xl font-semibold">Создать аккаунт</div>

      <div className="mb-5 flex flex-col gap-2">
        <Label>Кто вы?</Label>
        <div className="grid grid-cols-2 gap-2.5">
          <RoleChoice
            icon={GraduationCap}
            title="Студент"
            sub="Учусь, решаю задания"
            selected={role === 'student'}
            onSelect={() => setRole('student')}
          />
          <RoleChoice
            icon={Presentation}
            title="Преподаватель"
            sub="Веду занятия"
            selected={role === 'teacher'}
            onSelect={() => setRole('teacher')}
            goal="teacher_click"
          />
        </div>
      </div>

      <form onSubmit={onSubmitStep1} className="flex flex-col gap-3.5">
        {role === 'teacher' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="teacher-note">Где преподаёте *</Label>
            <Textarea
              id="teacher-note"
              value={teacherNote}
              onChange={(e) => setTeacherNote(e.target.value)}
              aria-required
              placeholder="Вуз, кафедра, предмет. Например: МГУ, ВМК, матанализ"
              rows={3}
              maxLength={500}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="last-name">Фамилия *</Label>
            <Input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Иванова"
              autoComplete="family-name"
              maxLength={50}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="first-name">Имя *</Label>
            <Input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Мария"
              autoComplete="given-name"
              maxLength={50}
              required
            />
          </div>
        </div>
        <p className="-mt-2 text-[11px] max-md:text-sm text-muted-foreground">Так вас увидит преподаватель в ведомости и на летучке</p>
        <LoginEmailFields r={r} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Пароль *</Label>
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
        <Button type="submit" className="mt-1 w-full" disabled={sending}>
          {sending ? 'Отправка…' : 'Продолжить'}
        </Button>
      </form>
    </>
  )
}

function RegisterStep2({ r }: { r: Register }) {
  const { pendingEmail, code, setCode, verifying, onSubmitVerify, needPasswordAgain, backToForm, onResend, sending, resendIn } = r
  return (
    <>
      <div className="mb-5 font-serif text-xl font-semibold">Подтвердите email</div>
      <p className="mb-5 text-sm text-muted-foreground">
        {r.localDelivery ? <>Письмо для {pendingEmail} сохранено в папке <code>data/mail</code> локального сервера.</> : <>Мы отправили 6-значный код на {pendingEmail}</>}
      </p>
      <form onSubmit={onSubmitVerify} className="flex flex-col gap-3.5">
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
        <Button type="submit" className="mt-1 w-full" disabled={verifying}>
          {verifying ? 'Проверка…' : 'Подтвердить'}
        </Button>
      </form>
      <div className="mt-3 text-center">
        {needPasswordAgain ? (
          <button
            type="button"
            onClick={backToForm}
            className="text-[13px] max-md:text-sm text-muted-foreground hover:underline"
          >
            Нужен новый код — вернуться к анкете
          </button>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={sending || resendIn > 0}
            className="text-[13px] max-md:text-sm text-muted-foreground hover:underline disabled:opacity-50"
          >
            {resendIn > 0 ? `Отправить код повторно через ${resendIn} с` : 'Отправить код повторно'}
          </button>
        )}
      </div>
    </>
  )
}

export function RegisterPage() {
  const r = useRegister()
  return (
    <AuthCard
      gradientClass="bg-gradient-to-br from-blue-900 to-blue-600"
      subtitle="Регистрация аккаунта"
      className="max-w-[440px]"
    >
      <AuthMessage msg={r.msg} />
      <TakenHints r={r} />

      {r.step === 1 && <RegisterStep1 r={r} />}

      {r.step === 2 && <RegisterStep2 r={r} />}

      <Separator className="mt-5" />
      <div className="mt-4 flex justify-center gap-5 text-[13px] max-md:text-sm">
        <Link to="/login" className="text-primary hover:underline">
          Уже есть аккаунт?
        </Link>
      </div>
    </AuthCard>
  )
}
