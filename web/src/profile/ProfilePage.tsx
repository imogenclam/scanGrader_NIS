import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { request, useAction, type User } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FadeUp, useFadeScreen } from '@/components/FadeUp'
import { ErrorLine } from '@/shared'
import { UnsavedChangesGuard } from '@/classroom/UnsavedChangesGuard'

export function ProfilePage({ user, onUser }: { user: User; onUser: (user: User) => void }) {
  const navigate = useNavigate()
  const profileQuery = new URLSearchParams(window.location.search)
  const inviteCode = profileQuery.get('join')
  const parts = user.full_name.trim().split(/\s+/)
  const [lastName, setLastName] = useState(parts[0] ?? '')
  const [firstName, setFirstName] = useState(parts[1] ?? '')
  const [middleName, setMiddleName] = useState(parts.slice(2).join(' '))
  const [group, setGroup] = useState(user.group)
  const action = useAction()
  useFadeScreen()
  const fullName = [lastName, firstName, middleName].map((part) => part.trim()).filter(Boolean).join(' ')
  const dirty = fullName !== user.full_name || group.trim() !== user.group
  const displayName = user.full_name || user.login
  function submit(e: FormEvent) {
    e.preventDefault()
    void action.run(async () => {
      if (!fullName || Array.from(fullName).length > 120) throw new Error('Укажите ФИО длиной до 120 знаков.')
      const updated = await request<User>('profile', 'PUT', { full_name: fullName, group: group.trim() })
      onUser(updated)
      toast.success('Личные данные сохранены')
      if (inviteCode !== null) {
        const query = new URLSearchParams()
        if (inviteCode) query.set('code', inviteCode)
        if (profileQuery.get('auto') === '1') query.set('auto', '1')
        await navigate({ href: '/classroom/join' + (query.size ? '?' + query.toString() : ''), ignoreBlocker: true })
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <FadeUp className="mb-3">
        <h1 className="font-serif text-2xl font-semibold">Профиль</h1>
      </FadeUp>
      <UnsavedChangesGuard when={dirty} description="Изменения профиля ещё не сохранены." />
      <FadeUp asChild i={2}>
        <Card className="gap-0 py-4 sm:py-5">
          <CardContent className="px-4 sm:px-5">
            <div className="mb-4 flex items-center gap-3 border-b pb-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary/10 font-semibold text-primary">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="break-words font-semibold">{displayName}</div>
                <div className="text-sm text-muted-foreground">{user.role === 'teacher' ? 'Преподаватель' : 'Студент'}</div>
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Фамилия</Label>
                  <Input id="lastName" autoComplete="family-name" maxLength={120} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Иванов" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Имя</Label>
                  <Input id="firstName" autoComplete="given-name" maxLength={120} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Иван" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="middleName">Отчество</Label>
                  <Input id="middleName" autoComplete="additional-name" maxLength={120} value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Иванович" />
                </div>
                {user.role === 'student' && <div className="space-y-1.5">
                  <Label htmlFor="groupNumber">Номер группы</Label>
                  <Input id="groupNumber" maxLength={40} required value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Например: ИУ6-32Б" />
                </div>}
              </div>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="login">Логин</Label>
                  <Input id="login" value={user.login} disabled />
                </div>
                {user.email && <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={user.email} readOnly />
                </div>}
              </div>
              <ErrorLine text={action.error} />
              <Button type="submit" className="max-sm:h-11" disabled={action.busy}>{action.busy ? 'Сохранение…' : 'Сохранить'}</Button>
            </form>
          </CardContent>
        </Card>
      </FadeUp>
    </div>
  )
}
